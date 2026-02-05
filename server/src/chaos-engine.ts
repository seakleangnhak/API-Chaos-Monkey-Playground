/**
 * Chaos Engine - Pipeline-Based Implementation
 * 
 * Implements chaos injection as an explicit ordered pipeline:
 * 1. Match rules (first match wins)
 * 2. Drop rate / Token bucket check
 * 3. Timeout (hang then close)
 * 4. Forced error (return errorStatusCode)
 * 5. [Proxy to upstream - handled by proxy.ts]
 * 6. Latency delay (before sending response)
 * 7. Corrupt JSON (only if upstream returned JSON)
 * 
 * Each step produces an action string added to actionsApplied array.
 */

import { ChaosRule, ChaosType, HttpMethod } from './types.js';
import { getRules } from './state.js';

// ============================================================================
// Token Bucket State
// ============================================================================

/**
 * Token bucket state per key (method + ruleId).
 * Tokens refill at `rps` rate up to `burst` capacity.
 */
interface TokenBucket {
    tokens: number;
    lastRefill: number; // Unix timestamp in ms
    rps: number;
    burst: number;
}

/**
 * In-memory storage for token buckets, keyed by "method:ruleId".
 */
const tokenBuckets = new Map<string, TokenBucket>();

/**
 * Get or create a token bucket for a given key.
 */
function getOrCreateBucket(key: string, rps: number, burst: number): TokenBucket {
    let bucket = tokenBuckets.get(key);

    if (!bucket) {
        bucket = {
            tokens: burst, // Start with full bucket
            lastRefill: Date.now(),
            rps,
            burst,
        };
        tokenBuckets.set(key, bucket);
    }

    // Update config if changed (allows dynamic rule updates)
    bucket.rps = rps;
    bucket.burst = burst;

    return bucket;
}

/**
 * Try to consume a token from the bucket.
 * Returns { allowed: true } if token consumed, or { allowed: false, retryAfter: seconds }.
 */
function tryConsumeToken(bucket: TokenBucket): { allowed: true } | { allowed: false; retryAfter: number } {
    const now = Date.now();
    const elapsed = (now - bucket.lastRefill) / 1000; // seconds

    // Refill tokens based on elapsed time
    const tokensToAdd = elapsed * bucket.rps;
    bucket.tokens = Math.min(bucket.burst, bucket.tokens + tokensToAdd);
    bucket.lastRefill = now;

    if (bucket.tokens >= 1) {
        bucket.tokens -= 1;
        return { allowed: true };
    }

    // Calculate how long until a token is available
    const tokensNeeded = 1 - bucket.tokens;
    const retryAfter = Math.ceil(tokensNeeded / bucket.rps);

    return { allowed: false, retryAfter: Math.max(1, retryAfter) };
}

// ============================================================================
// Types
// ============================================================================

export interface PreProxyResult {
    /** Should we skip the upstream request entirely? */
    skipUpstream: boolean;

    /** If skipping, what response to send? (null = timeout/hang) */
    immediateResponse: {
        statusCode: number;
        body: string;
        contentType: string;
        headers?: Record<string, string>;
    } | null;

    /** If timeout chaos, how long to hang before destroying socket */
    timeoutConfig?: {
        durationMs: number;
    };

    /** Actions applied so far */
    actionsApplied: string[];

    /** The matched rule, if any */
    matchedRule: ChaosRule | null;
}

/**
 * Result of applying post-proxy chaos (after upstream response).
 */
export interface PostProxyResult {
    /** Delay to apply before sending response to client */
    delayMs: number;

    /** Should we corrupt the response body? */
    corruptResponse: boolean;

    /** Actions applied in post phase */
    actionsApplied: string[];
}

/**
 * Corrupted response result.
 */
export interface CorruptionResult {
    body: string;
    action: string;
}

// ============================================================================
// Rule Matching
// ============================================================================

/**
 * Find the first enabled rule matching the request.
 * Rules are checked in creation order (first match wins).
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

function matchesMethod(allowed: HttpMethod[], method: string): boolean {
    if (allowed.includes('*')) return true;
    return allowed.includes(method.toUpperCase() as HttpMethod);
}

function matchesPath(pattern: string, path: string): boolean {
    try {
        return new RegExp(pattern).test(path);
    } catch {
        return path.includes(pattern);
    }
}

// ============================================================================
// Pre-Proxy Pipeline (Steps 1-4)
// ============================================================================

/**
 * Run the pre-proxy chaos pipeline.
 * 
 * Order:
 * 1. Match rules
 * 2. Drop rate check (rate-limit) OR Token bucket check (token-bucket)
 * 3. Timeout
 * 4. Forced error
 * 
 * @returns Result indicating whether to skip upstream and what response to send
 */
export function runPreProxyPipeline(path: string, method: string): PreProxyResult {
    const actions: string[] = [];

    // Step 1: Match rules
    const rule = findMatchingRule(path, method);

    if (!rule) {
        actions.push('match:no_rule');
        return {
            skipUpstream: false,
            immediateResponse: null,
            actionsApplied: actions,
            matchedRule: null,
        };
    }

    actions.push(`match:${rule.name}`);

    // Step 2a: Drop rate check (random 429 - legacy "rate-limit" type)
    if (rule.chaosType === 'rate-limit') {
        const failRate = rule.failRate ?? 50;
        const roll = Math.random() * 100;
        const triggered = roll < failRate;

        if (triggered) {
            actions.push(`drop_rate:triggered:${failRate}%`);
            return {
                skipUpstream: true,
                immediateResponse: {
                    statusCode: 429,
                    body: JSON.stringify({
                        error: true,
                        message: 'Too Many Requests (drop rate triggered)',
                        chaosMonkey: true,
                    }),
                    contentType: 'application/json',
                },
                actionsApplied: actions,
                matchedRule: rule,
            };
        } else {
            actions.push(`drop_rate:passed:${failRate}%`);
            return {
                skipUpstream: false,
                immediateResponse: null,
                actionsApplied: actions,
                matchedRule: rule,
            };
        }
    }

    // Step 2b: Token bucket rate limiter (true rate limiting)
    if (rule.chaosType === 'token-bucket') {
        const rps = rule.rps ?? 10;
        const burst = rule.burst ?? rps;
        const bucketKey = `${method}:${rule.id}`;

        const bucket = getOrCreateBucket(bucketKey, rps, burst);
        const result = tryConsumeToken(bucket);

        if (result.allowed) {
            actions.push(`token_bucket:passed`);
            return {
                skipUpstream: false,
                immediateResponse: null,
                actionsApplied: actions,
                matchedRule: rule,
            };
        } else {
            actions.push(`token_bucket:blocked(retry_after=${result.retryAfter})`);
            return {
                skipUpstream: true,
                immediateResponse: {
                    statusCode: 429,
                    body: JSON.stringify({
                        error: true,
                        message: 'Too Many Requests (rate limited)',
                        retryAfter: result.retryAfter,
                        chaosMonkey: true,
                    }),
                    contentType: 'application/json',
                    headers: {
                        'Retry-After': String(result.retryAfter),
                    },
                },
                actionsApplied: actions,
                matchedRule: rule,
            };
        }
    }

    // Step 3: Timeout (hang, don't respond, destroy socket after delay)
    if (rule.chaosType === 'timeout') {
        const DEFAULT_TIMEOUT_MS = 8000;
        const baseTimeout = rule.timeoutMs ?? DEFAULT_TIMEOUT_MS;
        const jitter = rule.jitterMs ?? 0;
        // Apply random jitter: +/- jitterMs
        const jitterOffset = jitter > 0 ? Math.floor(Math.random() * jitter * 2) - jitter : 0;
        const durationMs = Math.max(0, baseTimeout + jitterOffset);

        actions.push(`timeout:triggered(ms=${durationMs})`);
        return {
            skipUpstream: true,
            immediateResponse: null, // null = hang/timeout, no HTTP response
            timeoutConfig: { durationMs },
            actionsApplied: actions,
            matchedRule: rule,
        };
    }

    // Step 4: Forced error
    if (rule.chaosType === 'error') {
        const statusCode = rule.errorStatusCode ?? 500;
        const message = rule.errorMessage ?? 'Internal Server Error';
        actions.push(`error:${statusCode}`);

        return {
            skipUpstream: true,
            immediateResponse: {
                statusCode,
                body: JSON.stringify({
                    error: true,
                    message,
                    chaosMonkey: true,
                }),
                contentType: 'application/json',
            },
            actionsApplied: actions,
            matchedRule: rule,
        };
    }

    // Other chaos types (latency, corrupt) are handled post-proxy
    return {
        skipUpstream: false,
        immediateResponse: null,
        actionsApplied: actions,
        matchedRule: rule,
    };
}

// ============================================================================
// Post-Proxy Pipeline (Steps 6-7)
// ============================================================================

/**
 * Determine post-proxy chaos effects based on the matched rule.
 * 
 * Order:
 * 6. Latency delay
 * 7. Corrupt JSON
 */
export function getPostProxyEffects(rule: ChaosRule | null): PostProxyResult {
    const actions: string[] = [];
    let delayMs = 0;
    let corruptResponse = false;

    if (!rule) {
        return { delayMs: 0, corruptResponse: false, actionsApplied: [] };
    }

    // Step 6: Latency delay
    if (rule.chaosType === 'latency') {
        if (rule.latencyMs !== undefined) {
            delayMs = rule.latencyMs;
        } else {
            const min = rule.latencyMinMs ?? 100;
            const max = rule.latencyMaxMs ?? 1000;
            delayMs = Math.floor(Math.random() * (max - min + 1)) + min;
        }
        actions.push(`latency:${delayMs}ms`);
    }

    // Step 7: Corrupt JSON
    if (rule.chaosType === 'corrupt') {
        corruptResponse = true;
        // Action will be added when we actually corrupt
    }

    return { delayMs, corruptResponse, actionsApplied: actions };
}

/**
 * Corrupt a JSON response body.
 * Only call this if the upstream Content-Type is application/json.
 * 
 * Corruption strategies (randomly chosen):
 * - Remove a key
 * - Truncate the body
 * - Add invalid characters
 * - Break JSON syntax
 */
export function corruptJsonBody(body: string): CorruptionResult {
    const strategies = [
        'truncate',
        'invalid_chars',
        'break_syntax',
        'remove_key',
    ];

    const strategy = strategies[Math.floor(Math.random() * strategies.length)];

    switch (strategy) {
        case 'truncate': {
            // Cut off the last 30-70% of the body
            const cutPoint = Math.floor(body.length * (0.3 + Math.random() * 0.4));
            return {
                body: body.slice(0, cutPoint),
                action: `corrupt_json:truncated_at_${cutPoint}`,
            };
        }

        case 'invalid_chars': {
            // Insert invalid UTF-8 or control characters
            const insertPoint = Math.floor(Math.random() * body.length);
            const corrupted = body.slice(0, insertPoint) + '\x00\xFF\xFE' + body.slice(insertPoint);
            return {
                body: corrupted,
                action: 'corrupt_json:invalid_chars',
            };
        }

        case 'break_syntax': {
            // Remove random brackets, quotes, or colons
            const chars = ['{', '}', '[', ']', '"', ':', ','];
            const charToRemove = chars[Math.floor(Math.random() * chars.length)];
            const idx = body.indexOf(charToRemove);
            if (idx !== -1) {
                const corrupted = body.slice(0, idx) + body.slice(idx + 1);
                return {
                    body: corrupted,
                    action: `corrupt_json:removed_char:${charToRemove}`,
                };
            }
            // Fallback: truncate
            return {
                body: body.slice(0, -10),
                action: 'corrupt_json:truncated_fallback',
            };
        }

        case 'remove_key': {
            // Try to parse and remove a random key
            try {
                const obj = JSON.parse(body);
                if (typeof obj === 'object' && obj !== null) {
                    const keys = Object.keys(obj);
                    if (keys.length > 0) {
                        const keyToRemove = keys[Math.floor(Math.random() * keys.length)];
                        delete obj[keyToRemove];
                        return {
                            body: JSON.stringify(obj),
                            action: `corrupt_json:removed_key:${keyToRemove}`,
                        };
                    }
                }
            } catch {
                // Not valid JSON, fall through
            }
            // Fallback: break syntax
            return {
                body: body.slice(0, -5) + '<<<CORRUPTED>>>',
                action: 'corrupt_json:appended_garbage',
            };
        }

        default:
            return { body, action: 'corrupt_json:none' };
    }
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

/**
 * Clear all token buckets (useful for testing).
 */
export function clearTokenBuckets(): void {
    tokenBuckets.clear();
}
