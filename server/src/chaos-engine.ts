/**
 * Chaos Engine
 * 
 * Core logic for matching requests to rules and applying chaos effects.
 * Designed to be deterministic where possible (seeded randomness for
 * reproducible testing scenarios).
 */

import { ChaosRule, ChaosType, HttpMethod } from './types.js';
import { getRules } from './state.js';

// ============================================================================
// Rule Matching
// ============================================================================

/**
 * Find the first enabled rule that matches the given request.
 * Rules are checked in order of creation.
 */
export function findMatchingRule(path: string, method: string): ChaosRule | null {
    const rules = getRules();

    for (const rule of rules) {
        if (!rule.enabled) continue;
        if (!matchesMethod(rule.methods, method)) continue;
        if (!matchesPath(rule.pathPattern, path)) continue;

        return rule;
    }

    return null;
}

/**
 * Check if the request method matches the rule's method filter.
 */
function matchesMethod(allowedMethods: HttpMethod[], requestMethod: string): boolean {
    if (allowedMethods.includes('*')) return true;
    return allowedMethods.includes(requestMethod.toUpperCase() as HttpMethod);
}

/**
 * Check if the request path matches the rule's path pattern.
 * Pattern is treated as a regex.
 */
function matchesPath(pattern: string, path: string): boolean {
    try {
        const regex = new RegExp(pattern);
        return regex.test(path);
    } catch {
        // Invalid regex - treat as literal string match
        return path.includes(pattern);
    }
}

// ============================================================================
// Chaos Effects
// ============================================================================

/**
 * Result of applying chaos to a request.
 */
export interface ChaosResult {
    shouldBlock: boolean;       // If true, don't forward to target
    delayMs: number;            // Delay in milliseconds before proceeding
    errorResponse?: {           // If set, return this error instead of forwarding
        statusCode: number;
        body: string;
        contentType: string;
    };
    description: string;        // Human-readable description for logging
}

/**
 * Apply the chaos effect defined by the rule.
 */
export function applyChaos(rule: ChaosRule): ChaosResult {
    switch (rule.chaosType) {
        case 'latency':
            return applyLatency(rule);
        case 'error':
            return applyError(rule);
        case 'timeout':
            return applyTimeout();
        case 'corrupt':
            return applyCorruption();
        case 'rate-limit':
            return applyRateLimit(rule);
        default:
            return { shouldBlock: false, delayMs: 0, description: 'Unknown chaos type' };
    }
}

/**
 * Add latency to the request.
 */
function applyLatency(rule: ChaosRule): ChaosResult {
    let delayMs: number;

    if (rule.latencyMs !== undefined) {
        // Fixed delay
        delayMs = rule.latencyMs;
    } else {
        // Random delay between min and max
        const min = rule.latencyMinMs ?? 100;
        const max = rule.latencyMaxMs ?? 1000;
        delayMs = Math.floor(Math.random() * (max - min + 1)) + min;
    }

    return {
        shouldBlock: false,
        delayMs,
        description: `Added ${delayMs}ms latency`,
    };
}

/**
 * Return an error response instead of forwarding.
 */
function applyError(rule: ChaosRule): ChaosResult {
    const statusCode = rule.errorStatusCode ?? 500;
    const message = rule.errorMessage ?? 'Chaos Monkey Error';

    return {
        shouldBlock: true,
        delayMs: 0,
        errorResponse: {
            statusCode,
            body: JSON.stringify({
                error: true,
                message,
                chaosMonkey: true,
            }),
            contentType: 'application/json',
        },
        description: `Returned ${statusCode} error`,
    };
}

/**
 * Never respond (simulate timeout).
 */
function applyTimeout(): ChaosResult {
    return {
        shouldBlock: true,
        delayMs: 0,
        // No error response - the request just hangs
        description: 'Request will timeout (no response)',
    };
}

/**
 * Return a corrupted/malformed response.
 */
function applyCorruption(): ChaosResult {
    // Generate intentionally malformed JSON
    const corruptedBody = '{"data": [1, 2, 3, "incomplete...';

    return {
        shouldBlock: true,
        delayMs: 0,
        errorResponse: {
            statusCode: 200, // Looks successful but body is broken
            body: corruptedBody,
            contentType: 'application/json',
        },
        description: 'Returned corrupted JSON response',
    };
}

/**
 * Randomly fail a percentage of requests.
 */
function applyRateLimit(rule: ChaosRule): ChaosResult {
    const failRate = rule.failRate ?? 50;
    const shouldFail = Math.random() * 100 < failRate;

    if (shouldFail) {
        return {
            shouldBlock: true,
            delayMs: 0,
            errorResponse: {
                statusCode: 503,
                body: JSON.stringify({
                    error: true,
                    message: 'Service temporarily unavailable (rate limited by Chaos Monkey)',
                    chaosMonkey: true,
                }),
                contentType: 'application/json',
            },
            description: `Rate limit triggered (${failRate}% fail rate)`,
        };
    }

    return {
        shouldBlock: false,
        delayMs: 0,
        description: `Rate limit passed (${failRate}% fail rate)`,
    };
}

// ============================================================================
// Utility
// ============================================================================

/**
 * Create a delay promise.
 */
export function delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
}
