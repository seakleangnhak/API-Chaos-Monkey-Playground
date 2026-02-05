/**
 * Shared TypeScript Types for the UI
 * 
 * Mirrors the server types for type safety across the stack.
 */

export type ChaosType = 'latency' | 'error' | 'timeout' | 'corrupt' | 'rate-limit';
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
}

export interface RequestLog {
    id: string;
    timestamp: string;
    method: string;
    path: string;
    headers: Record<string, string>;
    statusCode?: number;
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
