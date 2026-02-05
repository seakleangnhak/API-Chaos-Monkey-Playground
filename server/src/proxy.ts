/**
 * Proxy Middleware
 * 
 * Express middleware that intercepts requests to /proxy/* and forwards them
 * to the configured target URL, with chaos effects applied as configured.
 */

import { Request, Response, NextFunction } from 'express';
import { getConfig, addLog } from './state.js';
import { findMatchingRule, applyChaos, delay } from './chaos-engine.js';
import { RequestLog } from './types.js';
import { broadcast } from './websocket.js';

/**
 * Generate a unique ID for request logging.
 */
function generateId(): string {
    return `${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Proxy middleware - handles all requests under /proxy/*
 */
export async function proxyMiddleware(
    req: Request,
    res: Response,
    next: NextFunction
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

    // Create log entry
    const logEntry: RequestLog = {
        id: generateId(),
        timestamp: new Date().toISOString(),
        method: req.method,
        path: targetPath,
        headers: req.headers as Record<string, string>,
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
                // Timeout - don't respond at all
                // Add log entry but don't send response
                logEntry.chaosDetails = 'Simulating timeout - no response sent';
                addLog(logEntry);
                broadcast({ type: 'new-log', log: logEntry });

                // Keep the connection open indefinitely (until client timeout)
                // Note: In a real scenario, you might want to close after a very long time
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

        // Prepare headers (remove host to avoid conflicts)
        const forwardHeaders: Record<string, string> = {};
        for (const [key, value] of Object.entries(req.headers)) {
            if (key.toLowerCase() !== 'host' && typeof value === 'string') {
                forwardHeaders[key] = value;
            }
        }

        // Forward the request
        const fetchOptions: RequestInit = {
            method: req.method,
            headers: forwardHeaders,
        };

        // Include body for methods that support it
        if (['POST', 'PUT', 'PATCH'].includes(req.method) && req.body) {
            fetchOptions.body = JSON.stringify(req.body);
            forwardHeaders['Content-Type'] = 'application/json';
        }

        const response = await fetch(targetUrl.toString(), fetchOptions);

        // Get response body
        const responseText = await response.text();

        // Log completion
        logEntry.statusCode = response.status;
        logEntry.responseTime = Date.now() - startTime;
        addLog(logEntry);
        broadcast({ type: 'new-log', log: logEntry });

        // Forward response headers
        response.headers.forEach((value, key) => {
            // Skip headers that shouldn't be forwarded
            if (!['content-encoding', 'transfer-encoding', 'content-length'].includes(key.toLowerCase())) {
                res.set(key, value);
            }
        });

        // Send response
        res.status(response.status).send(responseText);

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
