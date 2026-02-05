/**
 * Proxy Middleware
 * 
 * Express middleware that intercepts requests to /proxy/* and forwards them
 * to the configured target URL, with chaos effects applied as configured.
 */

import { Request, Response, NextFunction, Router } from 'express';
import { getConfig, addLog } from './state.js';
import { findMatchingRule, applyChaos, delay } from './chaos-engine.js';
import { RequestLog } from './types.js';
import { broadcast } from './websocket.js';

// ============================================================================
// Constants
// ============================================================================

/**
 * Hop-by-hop headers that MUST NOT be forwarded by proxies per HTTP/1.1 spec.
 * See RFC 2616 Section 13.5.1 and RFC 7230 Section 6.1
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
    'host',
]);

/**
 * Headers that should not be copied from upstream response to client.
 */
const SKIP_RESPONSE_HEADERS = new Set([
    'content-encoding',
    'transfer-encoding',
    'content-length', // We'll set this based on actual body
]);

/**
 * Maximum time (ms) to keep a "timeout" chaos connection open before cleanup.
 * After this, the socket is destroyed to prevent resource leaks.
 */
const TIMEOUT_CHAOS_MAX_DURATION = 5 * 60 * 1000; // 5 minutes

// ============================================================================
// Router Setup
// ============================================================================

export const proxyRouter = Router();

/**
 * Use raw body parser for proxy routes - preserves original Content-Type.
 * This captures the raw request body as a Buffer without parsing.
 */
proxyRouter.use((req: Request, res: Response, next: NextFunction) => {
    const chunks: Buffer[] = [];

    req.on('data', (chunk: Buffer) => {
        chunks.push(chunk);
    });

    req.on('end', () => {
        // Store raw body on request object
        (req as Request & { rawBody?: Buffer }).rawBody = Buffer.concat(chunks);
        next();
    });

    req.on('error', (err) => {
        next(err);
    });
});

// Handle all methods on all paths
proxyRouter.all('*', proxyMiddleware);

// ============================================================================
// Helpers
// ============================================================================

/**
 * Generate a unique ID for request logging.
 */
function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Filter hop-by-hop headers from request headers before forwarding.
 */
function filterRequestHeaders(headers: Record<string, string | string[] | undefined>): Record<string, string> {
    const filtered: Record<string, string> = {};

    for (const [key, value] of Object.entries(headers)) {
        const lowerKey = key.toLowerCase();

        // Skip hop-by-hop headers
        if (HOP_BY_HOP_HEADERS.has(lowerKey)) continue;

        // Only forward string values (join arrays)
        if (typeof value === 'string') {
            filtered[key] = value;
        } else if (Array.isArray(value)) {
            filtered[key] = value.join(', ');
        }
    }

    return filtered;
}

/**
 * Safely copy headers for logging (convert arrays to strings, clone object).
 */
function cloneHeadersForLog(headers: Record<string, string | string[] | undefined>): Record<string, string> {
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

// ============================================================================
// Main Middleware
// ============================================================================

/**
 * Proxy middleware - handles all requests under /proxy/*
 */
async function proxyMiddleware(
    req: Request & { rawBody?: Buffer },
    res: Response,
    _next: NextFunction
): Promise<void> {
    const config = getConfig();

    // Check if target URL is configured
    if (!config.targetUrl) {
        res.status(503).json({
            error: true,
            message: 'No target URL configured. Set a target URL in the UI first.',
        });
        return;
    }

    // Extract the path after /proxy
    const targetPath = req.path;
    const startTime = Date.now();

    // Create log entry (clone headers to avoid reference issues)
    const logEntry: RequestLog = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        method: req.method,
        path: targetPath,
        headers: cloneHeadersForLog(req.headers),
        chaosApplied: false,
    };

    // Find matching chaos rule
    const matchingRule = config.enabled ? findMatchingRule(targetPath, req.method) : null;

    if (matchingRule) {
        const chaos = applyChaos(matchingRule);

        logEntry.chaosApplied = true;
        logEntry.chaosType = matchingRule.chaosType;
        logEntry.chaosRuleId = matchingRule.id;
        logEntry.chaosRuleName = matchingRule.name;
        logEntry.chaosDetails = chaos.description;

        // Apply delay if specified
        if (chaos.delayMs > 0) {
            await delay(chaos.delayMs);
        }

        // If chaos blocks the request, return the error response
        if (chaos.shouldBlock) {
            if (chaos.errorResponse) {
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
                // Timeout chaos - don't respond, but clean up socket after max duration
                logEntry.chaosDetails = 'Simulating timeout - no response sent';
                addLog(logEntry);
                broadcast({ type: 'new-log', log: logEntry });

                // Schedule socket cleanup to prevent resource leak
                const timeoutCleanup = setTimeout(() => {
                    if (!res.headersSent && req.socket && !req.socket.destroyed) {
                        req.socket.destroy();
                    }
                }, TIMEOUT_CHAOS_MAX_DURATION);

                // Clean up timeout if client disconnects first
                req.on('close', () => {
                    clearTimeout(timeoutCleanup);
                });

                // Don't respond - let the client timeout
                return;
            }
        }
    }

    // Forward request to target
    try {
        const targetUrl = new URL(targetPath, config.targetUrl);

        // Copy query parameters
        const queryString = req.url.split('?')[1];
        if (queryString) {
            targetUrl.search = queryString;
        }

        // Prepare headers (filter hop-by-hop)
        const forwardHeaders = filterRequestHeaders(req.headers);

        // Forward the request
        const fetchOptions: RequestInit = {
            method: req.method,
            headers: forwardHeaders,
        };

        // Include raw body for methods that support it
        if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && req.rawBody && req.rawBody.length > 0) {
            fetchOptions.body = req.rawBody;
            // Content-Type is already in forwardHeaders from original request
        }

        const response = await fetch(targetUrl.toString(), fetchOptions);

        // Get response body
        const responseBuffer = await response.arrayBuffer();

        // Log completion
        logEntry.statusCode = response.status;
        logEntry.responseTime = Date.now() - startTime;
        addLog(logEntry);
        broadcast({ type: 'new-log', log: logEntry });

        // Forward response headers (filter problematic ones)
        response.headers.forEach((value, key) => {
            if (!SKIP_RESPONSE_HEADERS.has(key.toLowerCase())) {
                res.set(key, value);
            }
        });

        // Send response with correct content-length
        res.status(response.status).send(Buffer.from(responseBuffer));

    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';

        logEntry.statusCode = 502;
        logEntry.responseTime = Date.now() - startTime;
        logEntry.chaosDetails = `Proxy error: ${errorMessage}`;
        addLog(logEntry);
        broadcast({ type: 'new-log', log: logEntry });

        res.status(502).json({
            error: true,
            message: `Failed to reach target: ${errorMessage}`,
        });
    }
}
