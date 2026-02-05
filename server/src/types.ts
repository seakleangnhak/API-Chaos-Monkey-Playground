/**
 * Chaos Monkey Type Definitions
 * 
 * These types define the core data structures used throughout the proxy server.
 */

// ============================================================================
// Chaos Rule Types
// ============================================================================

/**
 * The type of chaos to apply to matching requests.
 * - latency: Adds a random delay between minMs and maxMs
 * - error: Returns an HTTP error response
 * - timeout: Never responds (simulates connection timeout)
 * - corrupt: Returns malformed JSON
 * - rate-limit: Fails a percentage of requests
 */
export type ChaosType = 'latency' | 'error' | 'timeout' | 'corrupt' | 'rate-limit';

/**
 * HTTP methods that can be matched by a rule.
 */
export type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | '*';

/**
 * A chaos rule defines when and how to inject failures.
 */
export interface ChaosRule {
    id: string;
    name: string;
    enabled: boolean;

    // Matching criteria
    pathPattern: string;       // Regex pattern to match request path
    methods: HttpMethod[];     // HTTP methods to match, '*' means all

    // Chaos configuration
    chaosType: ChaosType;

    // Type-specific parameters
    latencyMs?: number;        // For 'latency': fixed delay in ms
    latencyMinMs?: number;     // For 'latency': min random delay
    latencyMaxMs?: number;     // For 'latency': max random delay
    errorStatusCode?: number;  // For 'error': HTTP status code to return
    errorMessage?: string;     // For 'error': error message body
    failRate?: number;         // For 'rate-limit': percentage (0-100) of requests to fail
}

// ============================================================================
// Request Logging Types
// ============================================================================

/**
 * A logged request with details about the chaos applied.
 */
export interface RequestLog {
    id: string;
    timestamp: string;         // ISO 8601 timestamp

    // Request details
    method: string;
    path: string;
    headers: Record<string, string>;

    // Response details (if completed)
    statusCode?: number;
    responseTime?: number;     // Total time including artificial delays

    // Chaos details
    chaosApplied: boolean;
    chaosType?: ChaosType;
    chaosRuleId?: string;
    chaosRuleName?: string;
    chaosDetails?: string;     // Human-readable description of chaos applied
}

// ============================================================================
// Proxy Configuration
// ============================================================================

/**
 * Global proxy configuration.
 */
export interface ProxyConfig {
    targetUrl: string;         // Base URL to proxy requests to
    enabled: boolean;          // Master switch for chaos injection
}

// ============================================================================
// API Response Types
// ============================================================================

export interface ApiResponse<T> {
    success: boolean;
    data?: T;
    error?: string;
}
