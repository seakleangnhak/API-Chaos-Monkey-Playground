/**
 * Shared TypeScript Types for the UI
 * 
 * Mirrors the server types for type safety across the stack.
 */

export type ChaosType = 'latency' | 'error' | 'timeout' | 'corrupt' | 'rate-limit' | 'token-bucket';
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*';

export interface ChaosRule {
    id: string;
    name: string;
    enabled: boolean;
    pathPattern: string;
    methods: HttpMethod[];
    chaosType: ChaosType;
    latencyMs?: number;
    latencyMinMs?: number;
    latencyMaxMs?: number;
    errorStatusCode?: number;
    errorMessage?: string;
    failRate?: number;
    // Token bucket parameters
    rps?: number;
    burst?: number;
    // Timeout parameters
    timeoutMs?: number;
    jitterMs?: number;
}

export interface RequestLog {
    id: string;
    timestamp: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    statusCode?: number | 'timeout';
    responseTime?: number;
    chaosApplied: boolean;
    chaosType?: ChaosType;
    chaosRuleId?: string;
    chaosRuleName?: string;
    chaosDetails?: string;
    actionsApplied?: string[];
}

export interface ProxyConfig {
    targetUrl: string;
    enabled: boolean;
}

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}

/**
 * A Chaos Scenario is a complete profile of config + rules that can be
 * saved, loaded, imported, exported, or shared via URL.
 */
export interface ChaosScenario {
    name: string;
    description?: string;
    createdAt: string; // ISO timestamp
    config: ProxyConfig;
    rules: ChaosRule[];
}
