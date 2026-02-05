/**
 * Proxy Middleware - Pipeline-Based Implementation
 * 
 * A production-quality HTTP proxy with explicit chaos pipeline:
 * 1. Match rules (first match wins)
 * 2. Rate limit check
 * 3. Timeout (hang then close)
 * 4. Forced error
 * 5. Proxy to upstream
 * 6. Latency delay (before sending response)
 * 7. Corrupt JSON (only if upstream returned JSON)
 * 
 * Each request produces an actionsApplied array tracking what happened.
 */

import { Request, Response, NextFunction, Router } from 'express';
import { Readable } from 'stream';
import { getConfig, addLog } from './state.js';
import {
    runPreProxyPipeline,
    getPostProxyEffects,
    corruptJsonBody,
    delay,
} from './chaos-engine.js';
import { RequestLog } from './types.js';
import { broadcast } from './websocket.js';

// ============================================================================
// Constants
// ============================================================================

const HOP_BY_HOP_HEADERS = new Set([
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization',
    'te', 'trailer', 'transfer-encoding', 'upgrade', 'host', 'content-length',
]);

const SKIP_RESPONSE_HEADERS = new Set([
    'transfer-encoding', 'connection', 'keep-alive',
]);

const TIMEOUT_CHAOS_MAX_DURATION_MS = 5 * 60 * 1000;

// ============================================================================
// Router Setup
// ============================================================================

export const proxyRouter = Router();

proxyRouter.use((req: Request, res: Response, next: NextFunction) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
        (req as Request & { rawBody?: Buffer }).rawBody =
            chunks.length > 0 ? Buffer.concat(chunks) : undefined;
        next();
    });
    req.on('error', next);
});

proxyRouter.all('*', proxyHandler);

// ============================================================================
// Helpers
// ============================================================================

function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function filterRequestHeaders(
    headers: Record<string, string | string[] | undefined>
): Record<string, string> {
    const filtered: Record<string, string> = {};
    const connectionHeader = headers['connection'];
    const connectionTokens = new Set<string>();

    if (typeof connectionHeader === 'string') {
        connectionHeader.split(',').forEach(t => connectionTokens.add(t.trim().toLowerCase()));
    }

    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();
        if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;
        if (connectionTokens.has(lowerKey)) continue;

        if (typeof value === 'string') {
            filtered[key] = value;
        } else if (Array.isArray(value)) {
            filtered[key] = value.join(', ');
        }
    }
    return filtered;
}

function cloneHeadersForLog(
    headers: Record<string, string | string[] | undefined>
): Record<string, string> {
    const cloned: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') cloned[key] = value;
        else if (Array.isArray(value)) cloned[key] = value.join(', ');
    }
    return cloned;
}

function sendErrorResponse(res: Response, status: number, message: string, details?: string): void {
    res.status(status).json({ error: true, message, ...(details && { details }) });
}

// ============================================================================
// Main Handler
// ============================================================================

async function proxyHandler(
    req: Request & { rawBody?: Buffer },
    res: Response,
    _next: NextFunction
): Promise<void> {
    const config = getConfig();
    const startTime = Date.now();
    const requestId = generateRequestId();
    const actionsApplied: string[] = [];

    // -------------------------------------------------------------------------
    // Validate configuration
    // -------------------------------------------------------------------------

    if (!config.targetUrl) {
        sendErrorResponse(res, 503, 'No target URL configured',
            'Set a target URL via PUT /api/config before using the proxy.');
        return;
    }

    // -------------------------------------------------------------------------
    // Build target URL
    // -------------------------------------------------------------------------

    let targetUrl: URL;
    try {
        targetUrl = new URL(req.path, config.targetUrl);
        const queryIndex = req.originalUrl.indexOf('?');
        if (queryIndex !== -1) {
            targetUrl.search = req.originalUrl.slice(queryIndex);
        }
    } catch (err) {
        sendErrorResponse(res, 502, 'Invalid target URL',
            `Failed to construct URL: ${err instanceof Error ? err.message : String(err)}`);
        return;
    }

    // -------------------------------------------------------------------------
    // Initialize log entry
    // -------------------------------------------------------------------------

    const logEntry: RequestLog = {
        id: requestId,
        timestamp: new Date().toISOString(),
        method: req.method,
        path: req.path + (targetUrl.search || ''),
        headers: cloneHeadersForLog(req.headers),
        chaosApplied: false,
        actionsApplied: [],
    };

    // -------------------------------------------------------------------------
    // Run Pre-Proxy Pipeline (Steps 1-4)
    // -------------------------------------------------------------------------

    if (config.enabled) {
        const preResult = runPreProxyPipeline(req.path, req.method);
        actionsApplied.push(...preResult.actionsApplied);

        if (preResult.matchedRule) {
            logEntry.chaosApplied = true;
            logEntry.chaosType = preResult.matchedRule.chaosType;
            logEntry.chaosRuleId = preResult.matchedRule.id;
            logEntry.chaosRuleName = preResult.matchedRule.name;
        }

        // Handle immediate responses (rate limit fail, error, timeout)
        if (preResult.skipUpstream) {
            logEntry.actionsApplied = actionsApplied;
            logEntry.chaosDetails = actionsApplied.join(' → ');

            if (preResult.immediateResponse) {
                // Rate limit, drop rate, or error response
                logEntry.statusCode = preResult.immediateResponse.statusCode;
                logEntry.responseTime = Date.now() - startTime;
                addLog(logEntry);
                broadcast({ type: 'new-log', log: logEntry });

                // Set any custom headers (e.g., Retry-After for rate limiting)
                if (preResult.immediateResponse.headers) {
                    for (const [key, value] of Object.entries(preResult.immediateResponse.headers)) {
                        res.set(key, value);
                    }
                }

                res
                    .status(preResult.immediateResponse.statusCode)
                    .set('Content-Type', preResult.immediateResponse.contentType)
                    .send(preResult.immediateResponse.body);
                return;
            } else {
                // ---------------------------------------------------------------
                // Timeout chaos: hang without responding, then destroy socket
                // ---------------------------------------------------------------
                // This simulates a real network timeout. We do NOT send any HTTP
                // headers or body - we just hold the connection open for the
                // configured duration, then forcibly destroy the socket.

                const timeoutMs = preResult.timeoutConfig?.durationMs ?? 8000;
                const startTimeout = Date.now();

                // Log immediately with status 'timeout' - responseTime will be updated later
                logEntry.statusCode = 'timeout';
                logEntry.responseTime = timeoutMs; // Expected duration
                addLog(logEntry);
                broadcast({ type: 'new-log', log: logEntry });

                // Schedule socket destruction after the timeout duration
                const destroyTimer = setTimeout(() => {
                    // Destroy the underlying TCP socket without sending any HTTP response.
                    // This mimics how a real timeout appears to the client.
                    const sock = req.socket;
                    if (sock && !sock.destroyed) {
                        sock.destroy();
                    }
                }, timeoutMs);

                // Cleanup: clear the timer if client disconnects early
                // This prevents timer leaks if client aborts before timeout completes
                const cleanup = () => {
                    clearTimeout(destroyTimer);
                };

                req.on('close', cleanup);
                req.on('aborted', cleanup);
                res.on('finish', cleanup);
                res.on('close', cleanup);

                return;
            }
        }
    } else {
        actionsApplied.push('chaos:disabled');
    }

    // -------------------------------------------------------------------------
    // Proxy to Upstream (Step 5)
    // -------------------------------------------------------------------------

    const forwardHeaders = filterRequestHeaders(req.headers);
    const fetchOptions: RequestInit & { duplex?: string } = {
        method: req.method,
        headers: forwardHeaders,
        duplex: 'half',
    };

    if (!['GET', 'HEAD'].includes(req.method) && req.rawBody && req.rawBody.length > 0) {
        fetchOptions.body = req.rawBody;
    }

    actionsApplied.push('upstream:request');

    let upstreamResponse: Response;
    let responseBuffer: ArrayBuffer;

    try {
        const fetchResponse = await fetch(targetUrl.toString(), fetchOptions);
        responseBuffer = await fetchResponse.arrayBuffer();
        actionsApplied.push(`upstream:${fetchResponse.status}`);

        // We need to pass the fetch response data through
        upstreamResponse = fetchResponse as unknown as Response;

        // Get post-proxy effects
        const matchedRule = config.enabled
            ? runPreProxyPipeline(req.path, req.method).matchedRule
            : null;
        const postEffects = getPostProxyEffects(matchedRule);

        // -----------------------------------------------------------------------
        // Step 6: Latency delay (before sending response)
        // -----------------------------------------------------------------------

        if (postEffects.delayMs > 0) {
            actionsApplied.push(...postEffects.actionsApplied);
            await delay(postEffects.delayMs);
        }

        // -----------------------------------------------------------------------
        // Step 7: Corrupt JSON (only if upstream returned JSON)
        // -----------------------------------------------------------------------

        let finalBody: Buffer | string = Buffer.from(responseBuffer);
        const contentType = fetchResponse.headers.get('content-type') || '';

        if (postEffects.corruptResponse && contentType.includes('application/json')) {
            const bodyText = Buffer.from(responseBuffer).toString('utf-8');
            const corrupted = corruptJsonBody(bodyText);
            finalBody = corrupted.body;
            actionsApplied.push(corrupted.action);
        }

        // Log completion
        logEntry.statusCode = fetchResponse.status;
        logEntry.responseTime = Date.now() - startTime;
        logEntry.actionsApplied = actionsApplied;
        logEntry.chaosDetails = actionsApplied.filter(a => !a.startsWith('upstream:')).join(' → ');
        addLog(logEntry);
        broadcast({ type: 'new-log', log: logEntry });

        // Forward response headers
        fetchResponse.headers.forEach((value, key) => {
            if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
                res.setHeader(key, value);
            }
        });

        res.status(fetchResponse.status).send(finalBody);

    } catch (err) {
        const error = err as Error & { cause?: Error & { code?: string } };
        let message = 'Failed to reach upstream server';
        let details = error.message;

        if (error.cause) {
            const code = error.cause.code;
            if (code === 'ECONNREFUSED') {
                message = 'Connection refused by upstream server';
                details = `${targetUrl.host} is not accepting connections`;
            } else if (code === 'ENOTFOUND') {
                message = 'DNS resolution failed';
                details = `Could not resolve hostname: ${targetUrl.hostname}`;
            } else if (code === 'ETIMEDOUT' || code === 'ESOCKETTIMEDOUT') {
                message = 'Upstream request timed out';
                details = `No response from ${targetUrl.host}`;
            }
        }

        actionsApplied.push(`upstream:error:${error.cause?.code || 'unknown'}`);

        logEntry.statusCode = 502;
        logEntry.responseTime = Date.now() - startTime;
        logEntry.actionsApplied = actionsApplied;
        logEntry.chaosDetails = `Proxy error: ${message}`;
        addLog(logEntry);
        broadcast({ type: 'new-log', log: logEntry });

        sendErrorResponse(res, 502, message, details);
    }
}
