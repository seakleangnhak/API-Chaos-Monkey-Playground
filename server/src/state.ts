/**
 * In-Memory State Storage
 * 
 * Stores all application state in memory. State is lost on server restart.
 * For a production tool, this is acceptable as rules are typically
 * reconfigured per testing session.
 */

import { ChaosRule, RequestLog, ProxyConfig } from './types.js';

// ============================================================================
// State Containers
// ============================================================================

/**
 * Proxy configuration - target URL and master enable switch.
 */
let proxyConfig: ProxyConfig = {
    targetUrl: '',
    enabled: true,
};

/**
 * Chaos rules - indexed by ID for fast lookup.
 */
const chaosRules: Map<string, ChaosRule> = new Map();

/**
 * Request logs - kept in memory with a max size to prevent memory issues.
 */
const requestLogs: RequestLog[] = [];
const MAX_LOGS = 1000;

// ============================================================================
// Config Operations
// ============================================================================

export function getConfig(): ProxyConfig {
    return { ...proxyConfig };
}

export function updateConfig(updates: Partial<ProxyConfig>): ProxyConfig {
    proxyConfig = { ...proxyConfig, ...updates };
    return getConfig();
}

// ============================================================================
// Rule Operations
// ============================================================================

export function getRules(): ChaosRule[] {
    return Array.from(chaosRules.values());
}

export function getRule(id: string): ChaosRule | undefined {
    const rule = chaosRules.get(id);
    return rule ? { ...rule } : undefined;
}

export function createRule(rule: ChaosRule): ChaosRule {
    chaosRules.set(rule.id, { ...rule });
    return getRule(rule.id)!;
}

export function updateRule(id: string, updates: Partial<ChaosRule>): ChaosRule | undefined {
    const existing = chaosRules.get(id);
    if (!existing) return undefined;

    const updated = { ...existing, ...updates, id }; // Prevent ID change
    chaosRules.set(id, updated);
    return { ...updated };
}

export function deleteRule(id: string): boolean {
    return chaosRules.delete(id);
}

// ============================================================================
// Log Operations
// ============================================================================

export function getLogs(limit?: number): RequestLog[] {
    const logs = [...requestLogs].reverse(); // Most recent first
    return limit ? logs.slice(0, limit) : logs;
}

export function addLog(log: RequestLog): void {
    requestLogs.push(log);

    // Trim old logs if we exceed the max
    if (requestLogs.length > MAX_LOGS) {
        requestLogs.splice(0, requestLogs.length - MAX_LOGS);
    }
}

export function clearLogs(): void {
    requestLogs.length = 0;
}
