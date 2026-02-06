/**
 * Scenario Utilities
 * 
 * Functions for managing chaos scenarios: storage, validation, URL encoding.
 */

import { ChaosScenario, ChaosRule, ProxyConfig, ChaosType, HttpMethod } from './types';

const STORAGE_KEY = 'chaos_scenarios';
const VALID_CHAOS_TYPES: ChaosType[] = ['latency', 'error', 'timeout', 'corrupt', 'rate-limit', 'token-bucket'];
const VALID_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', '*'];

// ============================================================================
// Validation
// ============================================================================

/**
 * Validate a ProxyConfig object.
 */
export function validateConfig(config: unknown): config is ProxyConfig {
    if (typeof config !== 'object' || config === null) return false;
    const c = config as Record<string, unknown>;
    return typeof c.targetUrl === 'string' && typeof c.enabled === 'boolean';
}

/**
 * Validate a ChaosRule object.
 */
export function validateRule(rule: unknown): rule is ChaosRule {
    if (typeof rule !== 'object' || rule === null) return false;
    const r = rule as Record<string, unknown>;

    if (typeof r.id !== 'string') return false;
    if (typeof r.name !== 'string') return false;
    if (typeof r.enabled !== 'boolean') return false;
    if (typeof r.pathPattern !== 'string') return false;
    if (!Array.isArray(r.methods)) return false;
    if (!r.methods.every((m: unknown) => VALID_METHODS.includes(m as HttpMethod))) return false;
    if (typeof r.chaosType !== 'string') return false;
    if (!VALID_CHAOS_TYPES.includes(r.chaosType as ChaosType)) return false;

    return true;
}

/**
 * Validate a complete ChaosScenario object.
 * Returns { valid: true } or { valid: false, error: string }.
 */
export function validateScenario(scenario: unknown): { valid: true } | { valid: false; error: string } {
    if (typeof scenario !== 'object' || scenario === null) {
        return { valid: false, error: 'Scenario must be an object' };
    }

    const s = scenario as Record<string, unknown>;

    if (typeof s.name !== 'string' || s.name.trim() === '') {
        return { valid: false, error: 'Scenario name is required' };
    }

    if (s.description !== undefined && typeof s.description !== 'string') {
        return { valid: false, error: 'Scenario description must be a string' };
    }

    if (typeof s.createdAt !== 'string') {
        return { valid: false, error: 'Scenario createdAt is required' };
    }

    if (!validateConfig(s.config)) {
        return { valid: false, error: 'Invalid config in scenario' };
    }

    if (!Array.isArray(s.rules)) {
        return { valid: false, error: 'Scenario rules must be an array' };
    }

    for (let i = 0; i < s.rules.length; i++) {
        if (!validateRule(s.rules[i])) {
            return { valid: false, error: `Invalid rule at index ${i}` };
        }
    }

    return { valid: true };
}

// ============================================================================
// LocalStorage
// ============================================================================

/**
 * Get all saved scenarios from localStorage.
 */
export function getSavedScenarios(): ChaosScenario[] {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (!stored) return [];
        const parsed = JSON.parse(stored);
        if (!Array.isArray(parsed)) return [];
        return parsed.filter((s): s is ChaosScenario => validateScenario(s).valid);
    } catch {
        return [];
    }
}

/**
 * Save a scenario to localStorage.
 * Returns { success: true } or { success: false, error: string }.
 */
export function saveScenario(scenario: ChaosScenario, overwrite = false): { success: true } | { success: false; error: string } {
    const validation = validateScenario(scenario);
    if (!validation.valid) {
        return { success: false, error: validation.error };
    }

    const scenarios = getSavedScenarios();
    const existingIndex = scenarios.findIndex(s => s.name === scenario.name);

    if (existingIndex >= 0 && !overwrite) {
        return { success: false, error: `Scenario "${scenario.name}" already exists` };
    }

    if (existingIndex >= 0) {
        scenarios[existingIndex] = scenario;
    } else {
        scenarios.push(scenario);
    }

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(scenarios));
        return { success: true };
    } catch {
        return { success: false, error: 'Failed to save to localStorage' };
    }
}

/**
 * Delete a scenario by name.
 */
export function deleteScenario(name: string): boolean {
    const scenarios = getSavedScenarios();
    const filtered = scenarios.filter(s => s.name !== name);
    if (filtered.length === scenarios.length) return false;

    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
        return true;
    } catch {
        return false;
    }
}

// ============================================================================
// File Export/Import
// ============================================================================

/**
 * Export a scenario as a downloadable JSON file.
 */
export function exportScenarioToFile(scenario: ChaosScenario): void {
    const json = JSON.stringify(scenario, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);

    const date = new Date().toISOString().slice(0, 10);
    const safeName = scenario.name.replace(/[^a-zA-Z0-9-_]/g, '_');
    const filename = `chaos-scenario-${safeName}-${date}.json`;

    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

/**
 * Import a scenario from a file.
 * Returns a Promise that resolves with the scenario or rejects with error.
 */
export function importScenarioFromFile(file: File): Promise<ChaosScenario> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const text = reader.result as string;
                const parsed = JSON.parse(text);
                const validation = validateScenario(parsed);
                if (!validation.valid) {
                    reject(new Error(validation.error));
                    return;
                }
                resolve(parsed as ChaosScenario);
            } catch (e) {
                reject(new Error('Invalid JSON file'));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

// ============================================================================
// URL Hash Encoding (Share Links)
// ============================================================================

/**
 * Encode a scenario to a URL-safe base64 string.
 */
export function encodeScenarioToUrl(scenario: ChaosScenario): string {
    const json = JSON.stringify(scenario);
    // Use btoa and make URL-safe (replace + with -, / with _, remove =)
    const base64 = btoa(unescape(encodeURIComponent(json)));
    return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/**
 * Decode a scenario from a URL-safe base64 string.
 */
export function decodeScenarioFromUrl(encoded: string): ChaosScenario | null {
    try {
        // Restore standard base64 (add back = padding, replace - with +, _ with /)
        let base64 = encoded.replace(/-/g, '+').replace(/_/g, '/');
        const pad = base64.length % 4;
        if (pad) base64 += '='.repeat(4 - pad);

        const json = decodeURIComponent(escape(atob(base64)));
        const parsed = JSON.parse(json);
        const validation = validateScenario(parsed);
        if (!validation.valid) return null;
        return parsed as ChaosScenario;
    } catch {
        return null;
    }
}

/**
 * Get scenario from current URL hash if present.
 */
export function getScenarioFromUrlHash(): ChaosScenario | null {
    const hash = window.location.hash;
    if (!hash.startsWith('#scenario=')) return null;
    const encoded = hash.slice('#scenario='.length);
    return decodeScenarioFromUrl(encoded);
}

/**
 * Set a scenario in the URL hash for sharing.
 */
export function setScenarioInUrlHash(scenario: ChaosScenario): string {
    const encoded = encodeScenarioToUrl(scenario);
    const url = `${window.location.origin}${window.location.pathname}#scenario=${encoded}`;
    return url;
}

/**
 * Clear the scenario from URL hash.
 */
export function clearUrlHash(): void {
    history.replaceState(null, '', window.location.pathname);
}
