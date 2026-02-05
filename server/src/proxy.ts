/**
 * Proxy Middleware - Improved Implementation
 * 
 * A production-quality HTTP proxy that:
 * - Preserves method, path, query string, and body for all methods
 * - Filters hop-by-hop headers per RFC 7230
 * - Streams upstream responses (no buffering)
 * - Preserves content-encoding (gzip, br, deflate)
 * - Returns clear JSON errors on failure
 * 
 * Uses Node 18+ native fetch (undici) for HTTP client.
 */

import { Request, Response, NextFunction, Router } from 'express';
import { Readable } from 'stream';
import { getConfig, addLog } from './state.js';
import { findMatchingRule, applyChaos, delay } from './chaos-engine.js';
import { RequestLog } from './types.js';
import { broadcast } from './websocket.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Hop-by-hop headers that MUST NOT be forwarded by proxies.
 * Per RFC 7230 Section 6.1 and RFC 2616 Section 13.5.1
 */
const HOP_BY_HOP_HEADERS = new Set([
    'connection',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
    'host',                    // Must be set to target host
    'content-length',          // Will be set by undici based on body
]);

/**
 * Response headers that should not be forwarded to the client.
 * - transfer-encoding: Node handles chunked encoding automatically
 * - connection: Hop-by-hop, managed by Express
 */
const SKIP_RESPONSE_HEADERS = new Set([
    'transfer-encoding',
    'connection',
    'keep-alive',
]);

/**
 * Maximum time (ms) to keep a "timeout" chaos connection open.
 * After this duration, the socket is destroyed to prevent resource leaks.
 */
const TIMEOUT_CHAOS_MAX_DURATION_MS = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Router Setup
// ============================================================================

export const proxyRouter = Router();

/**
 * Collect raw body for all requests without parsing.
 * This preserves the original Content-Type and body format.
 */
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

// Handle all HTTP methods on all paths
proxyRouter.all('*', proxyHandler);

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Generate a unique request ID for logging.
 */
function generateRequestId(): string {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Filter hop-by-hop headers from incoming request headers.
 * Also handles Connection header's listed headers.
 * 
 * @param headers - Express request headers object
 * @returns Clean headers object safe to forward
 */
function filterRequestHeaders(
    headers: Record<string, string | string[] | undefined>
): Record<string, string> {
    const filtered: Record<string, string> = {};

    // Get additional headers listed in Connection header (per RFC 7230)
    const connectionHeader = headers['connection'];
    const connectionTokens = new Set<string>();
    if (typeof connectionHeader === 'string') {
        connectionHeader.split(',').forEach(token => {
            connectionTokens.add(token.trim().toLowerCase());
        });
    }

    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();

        // Skip standard hop-by-hop headers
        if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;

        // Skip headers listed in Connection header
        if (connectionTokens.has(lowerKey)) continue;

        // Convert arrays to comma-separated string (e.g., multiple cookies)
        if (typeof value === 'string') {
            filtered[key] = value;
        } else if (Array.isArray(value)) {
            filtered[key] = value.join(', ');
        }
    }

    return filtered;
}

/**
 * Clone headers for logging (shallow copy with array handling).
 */
function cloneHeadersForLog(
    headers: Record<string, string | string[] | undefined>
): Record<string, string> {
    const cloned: Record<string, string> = {};
    for (const [key, value] of Object.entries(headers)) {
        if (typeof value === 'string') {
            cloned[key] = value;
        } else if (Array.isArray(value)) {
            cloned[key] = value.join(', ');
        }
    }
    return cloned;
}

/**
 * Send a JSON error response with consistent shape.
 */
function sendErrorResponse(
    res: Response,
    status: number,
    message: string,
    details?: string
): void {
    res.status(status).json({
        error: true,
        message,
        ...(details && { details }),
    });
}

/**
 * Convert a Web ReadableStream to Node.js Readable stream.
 * This enables streaming the upstream response without buffering.
 */
function webStreamToNodeStream(webStream: ReadableStream<Uint8Array>): Readable {
    const reader = webStream.getReader();

    return new Readable({
        async read() {
            try {
                const { done, value } = await reader.read();
                if (done) {
                    this.push(null);
                } else {
                    this.push(Buffer.from(value));
                }
            } catch (err) {
                this.destroy(err instanceof Error ? err : new Error(String(err)));
            }
        },
        destroy(err, callback) {
            reader.cancel(err?.message).finally(() => callback(err));
        },
    });
}

// ============================================================================
// Main Proxy Handler
// ============================================================================

/**
 * Main proxy handler - forwards requests to target with chaos injection.
 * 
 * Edge cases handled:
 * 1. No target URL configured → 503 with clear message
 * 2. Upstream connection refused → 502 with ECONNREFUSED details
 * 3. Upstream timeout → 502 with timeout details
 * 4. DNS resolution failure → 502 with ENOTFOUND details
 * 5. Invalid target URL → 502 with URL parse error
 * 6. Empty body for GET/HEAD → No body sent (correct per HTTP spec)
 * 7. Compressed responses → Passed through as-is (content-encoding preserved)
 * 8. Streaming responses → Piped directly (no buffering, memory-efficient)
 */
async function proxyHandler(
    req: Request & { rawBody?: Buffer },
    res: Response,
    _next: NextFunction
): Promise<void> {
    const config = getConfig();
    const startTime = Date.now();
    const requestId = generateRequestId();

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
        // Combine target base URL with request path
        targetUrl = new URL(req.path, config.targetUrl);

        // Preserve query string from original request
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
    };

    // -------------------------------------------------------------------------
    // Apply chaos if enabled and matching rule exists
    // -------------------------------------------------------------------------

    if (config.enabled) {
        const matchingRule = findMatchingRule(req.path, req.method);

        if (matchingRule) {
            const chaos = applyChaos(matchingRule);

            logEntry.chaosApplied = true;
            logEntry.chaosType = matchingRule.chaosType;
            logEntry.chaosRuleId = matchingRule.id;
            logEntry.chaosRuleName = matchingRule.name;
            logEntry.chaosDetails = chaos.description;

            // Apply latency
            if (chaos.delayMs > 0) {
                await delay(chaos.delayMs);
            }

            // Handle blocking chaos types
            if (chaos.shouldBlock) {
                if (chaos.errorResponse) {
                    // Error/corrupt chaos - return fake error
                    logEntry.statusCode = chaos.errorResponse.statusCode;
                    logEntry.responseTime = Date.now() - startTime;
                    addLog(logEntry);
                    broadcast({ type: 'new-log', log: logEntry });

                    res
                        .status(chaos.errorResponse.statusCode)
                        .set('Content-Type', chaos.errorResponse.contentType)
                        .send(chaos.errorResponse.body);
                    return;
                } else {
                    // Timeout chaos - don't respond, schedule cleanup
                    logEntry.chaosDetails = 'Simulating timeout (no response)';
                    addLog(logEntry);
                    broadcast({ type: 'new-log', log: logEntry });

                    const cleanupTimer = setTimeout(() => {
                        if (!res.headersSent && req.socket && !req.socket.destroyed) {
                            req.socket.destroy();
                        }
                    }, TIMEOUT_CHAOS_MAX_DURATION_MS);

                    req.on('close', () => clearTimeout(cleanupTimer));
                    return;
                }
            }
        }
    }

    // -------------------------------------------------------------------------
    // Prepare upstream request
    // -------------------------------------------------------------------------

    const forwardHeaders = filterRequestHeaders(req.headers);

    const fetchOptions: RequestInit & { duplex?: string } = {
        method: req.method,
        headers: forwardHeaders,
        duplex: 'half', // Required for streaming request body in Node.js
    };

    // Include body for methods that can have one
    // Note: GET/HEAD should not have a body per HTTP spec
    if (!['GET', 'HEAD'].includes(req.method) && req.rawBody && req.rawBody.length > 0) {
        fetchOptions.body = req.rawBody;
    }

    // -------------------------------------------------------------------------
    // Execute upstream request and stream response
    // -------------------------------------------------------------------------

    try {
        const upstreamResponse = await fetch(targetUrl.toString(), fetchOptions);

        // Log completion
        logEntry.statusCode = upstreamResponse.status;
        logEntry.responseTime = Date.now() - startTime;
        addLog(logEntry);
        broadcast({ type: 'new-log', log: logEntry });

        // Forward response headers (preserving content-encoding for gzip/br/deflate)
        upstreamResponse.headers.forEach((value, key) => {
            const lowerKey = key.toLowerCase();
            if (!SKIP_RESPONSE_HEADERS.has(lowerKey)) {
                res.setHeader(key, value);
            }
        });

        // Set status code
        res.status(upstreamResponse.status);

        // Stream response body if present
        if (upstreamResponse.body) {
            const nodeStream = webStreamToNodeStream(upstreamResponse.body);
            nodeStream.pipe(res);

            // Handle stream errors
            nodeStream.on('error', (err) => {
                if (!res.headersSent) {
                    sendErrorResponse(res, 502, 'Stream error', err.message);
                } else {
                    res.end();
                }
            });
        } else {
            // No body (e.g., 204 No Content, 304 Not Modified)
            res.end();
        }

    } catch (err) {
        // -----------------------------------------------------------------------
        // Handle upstream errors with detailed messages
        // -----------------------------------------------------------------------

        const error = err as Error & { code?: string; cause?: Error };
        let message = 'Failed to reach upstream server';
        let details = error.message;

        // Provide specific error messages for common failure modes
        if (error.cause) {
            const cause = error.cause as Error & { code?: string };
            if (cause.code === 'ECONNREFUSED') {
                message = 'Connection refused by upstream server';
                details = `${targetUrl.host} is not accepting connections`;
            } else if (cause.code === 'ENOTFOUND') {
                message = 'DNS resolution failed';
                details = `Could not resolve hostname: ${targetUrl.hostname}`;
            } else if (cause.code === 'ETIMEDOUT' || cause.code === 'ESOCKETTIMEDOUT') {
                message = 'Upstream request timed out';
                details = `No response from ${targetUrl.host}`;
            } else if (cause.code === 'ECONNRESET') {
                message = 'Connection reset by upstream server';
                details = `${targetUrl.host} closed the connection unexpectedly`;
            } else if (cause.code === 'CERT_HAS_EXPIRED' || cause.code?.startsWith('UNABLE_TO_VERIFY')) {
                message = 'SSL/TLS certificate error';
                details = cause.message;
            }
        }

        logEntry.statusCode = 502;
        logEntry.responseTime = Date.now() - startTime;
        logEntry.chaosDetails = `Proxy error: ${message}`;
        addLog(logEntry);
        broadcast({ type: 'new-log', log: logEntry });

        sendErrorResponse(res, 502, message, details);
    }
}
