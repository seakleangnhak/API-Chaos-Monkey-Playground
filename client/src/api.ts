/**
 * API Client
 * 
 * Functions for communicating with the backend REST API.
 */

import { ApiResponse, ChaosRule, ProxyConfig, RequestLog } from './types';

const API_BASE = '/api';

// ============================================================================
// Generic Fetch Helper
// ============================================================================

async function apiFetch<T>(
    endpoint: string,
    options?: RequestInit
): Promise<ApiResponse<T>> {
    try {
        const response = await fetch(`${API_BASE}${endpoint}`, {
            headers: {
                'Content-Type': 'application/json',
            },
            ...options,
        });
        return await response.json();
    } catch (error) {
        return {
            success: false,
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

// ============================================================================
// Config API
// ============================================================================

export async function getConfig(): Promise<ApiResponse<ProxyConfig>> {
    return apiFetch<ProxyConfig>('/config');
}

export async function updateConfig(config: Partial<ProxyConfig>): Promise<ApiResponse<ProxyConfig>> {
    return apiFetch<ProxyConfig>('/config', {
        method: 'PUT',
        body: JSON.stringify(config),
    });
}

// ============================================================================
// Rules API
// ============================================================================

export async function getRules(): Promise<ApiResponse<ChaosRule[]>> {
    return apiFetch<ChaosRule[]>('/rules');
}

export async function createRule(rule: Omit<ChaosRule, 'id'>): Promise<ApiResponse<ChaosRule>> {
    return apiFetch<ChaosRule>('/rules', {
        method: 'POST',
        body: JSON.stringify(rule),
    });
}

export async function updateRule(id: string, updates: Partial<ChaosRule>): Promise<ApiResponse<ChaosRule>> {
    return apiFetch<ChaosRule>(`/rules/${id}`, {
        method: 'PUT',
        body: JSON.stringify(updates),
    });
}

export async function deleteRule(id: string): Promise<ApiResponse<void>> {
    return apiFetch<void>(`/rules/${id}`, {
        method: 'DELETE',
    });
}

// ============================================================================
// Logs API
// ============================================================================

export async function getLogs(limit?: number): Promise<ApiResponse<RequestLog[]>> {
    const query = limit ? `?limit=${limit}` : '';
    return apiFetch<RequestLog[]>(`/logs${query}`);
}

export async function clearLogs(): Promise<ApiResponse<void>> {
    return apiFetch<void>('/logs', {
        method: 'DELETE',
    });
}
