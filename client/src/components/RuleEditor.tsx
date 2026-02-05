/**
 * RuleEditor Component
 * 
 * Form for creating or editing a chaos rule.
 */

import { useState } from 'react';
import { ChaosRule, ChaosType, HttpMethod } from '../types';

interface Props {
    rule?: ChaosRule;
    onSave: (rule: Omit<ChaosRule, 'id'> | ChaosRule) => void;
    onCancel: () => void;
}

const CHAOS_TYPES: { value: ChaosType; label: string; description: string }[] = [
    { value: 'latency', label: 'Latency', description: 'Add delay to responses' },
    { value: 'error', label: 'Error', description: 'Return HTTP error codes' },
    { value: 'timeout', label: 'Timeout', description: 'Never respond' },
    { value: 'corrupt', label: 'Corrupt', description: 'Return malformed JSON' },
    { value: 'rate-limit', label: 'Drop Rate', description: 'Randomly fail X% of requests (429)' },
    { value: 'token-bucket', label: 'Token Bucket', description: 'True rate limiter (429 + Retry-After)' },
];

const HTTP_METHODS: HttpMethod[] = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

export function RuleEditor({ rule, onSave, onCancel }: Props) {
    const [name, setName] = useState(rule?.name ?? '');
    const [pathPattern, setPathPattern] = useState(rule?.pathPattern ?? '');
    const [methods, setMethods] = useState<HttpMethod[]>(rule?.methods ?? ['*']);
    const [chaosType, setChaosType] = useState<ChaosType>(rule?.chaosType ?? 'latency');
    const [enabled, setEnabled] = useState(rule?.enabled ?? true);

    // Type-specific fields
    const [latencyMs, setLatencyMs] = useState(rule?.latencyMs?.toString() ?? '1000');
    const [errorStatusCode, setErrorStatusCode] = useState(rule?.errorStatusCode?.toString() ?? '500');
    const [errorMessage, setErrorMessage] = useState(rule?.errorMessage ?? 'Internal Server Error');
    const [failRate, setFailRate] = useState(rule?.failRate?.toString() ?? '50');
    const [rps, setRps] = useState(rule?.rps?.toString() ?? '10');
    const [burst, setBurst] = useState(rule?.burst?.toString() ?? '10');

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();

        const ruleData: Omit<ChaosRule, 'id'> = {
            name,
            pathPattern,
            methods,
            chaosType,
            enabled,
        };

        // Add type-specific fields
        if (chaosType === 'latency') {
            ruleData.latencyMs = parseInt(latencyMs, 10);
        } else if (chaosType === 'error') {
            ruleData.errorStatusCode = parseInt(errorStatusCode, 10);
            ruleData.errorMessage = errorMessage;
        } else if (chaosType === 'rate-limit') {
            ruleData.failRate = parseInt(failRate, 10);
        } else if (chaosType === 'token-bucket') {
            ruleData.rps = parseInt(rps, 10);
            ruleData.burst = parseInt(burst, 10);
        }

        if (rule?.id) {
            onSave({ ...ruleData, id: rule.id });
        } else {
            onSave(ruleData);
        }
    };

    const toggleMethod = (method: HttpMethod) => {
        if (method === '*') {
            setMethods(['*']);
        } else {
            const newMethods = methods.filter(m => m !== '*');
            if (newMethods.includes(method)) {
                setMethods(newMethods.filter(m => m !== method));
            } else {
                setMethods([...newMethods, method]);
            }
        }
    };

    return (
        <form onSubmit={handleSubmit}>
            <div className="form-group">
                <label className="form-label">Rule Name</label>
                <input
                    type="text"
                    className="form-input"
                    placeholder="e.g., Slow API responses"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                />
            </div>

            <div className="form-group">
                <label className="form-label">Path Pattern (regex)</label>
                <input
                    type="text"
                    className="form-input form-input--mono"
                    placeholder="e.g., /api/users.*"
                    value={pathPattern}
                    onChange={(e) => setPathPattern(e.target.value)}
                    required
                />
            </div>

            <div className="form-group">
                <label className="form-label">HTTP Methods</label>
                <div className="flex gap-sm" style={{ flexWrap: 'wrap' }}>
                    {HTTP_METHODS.map((method) => (
                        <button
                            key={method}
                            type="button"
                            className={`btn btn--small ${methods.includes(method) ? 'btn--primary' : ''}`}
                            onClick={() => toggleMethod(method)}
                        >
                            {method === '*' ? 'ALL' : method}
                        </button>
                    ))}
                </div>
            </div>

            <div className="form-group">
                <label className="form-label">Chaos Type</label>
                <select
                    className="form-select"
                    value={chaosType}
                    onChange={(e) => setChaosType(e.target.value as ChaosType)}
                >
                    {CHAOS_TYPES.map((type) => (
                        <option key={type.value} value={type.value}>
                            {type.label} - {type.description}
                        </option>
                    ))}
                </select>
            </div>

            {/* Type-specific fields */}
            {chaosType === 'latency' && (
                <div className="form-group">
                    <label className="form-label">Delay (ms)</label>
                    <input
                        type="number"
                        className="form-input"
                        min="0"
                        max="60000"
                        value={latencyMs}
                        onChange={(e) => setLatencyMs(e.target.value)}
                    />
                </div>
            )}

            {chaosType === 'error' && (
                <>
                    <div className="form-group">
                        <label className="form-label">Status Code</label>
                        <input
                            type="number"
                            className="form-input"
                            min="400"
                            max="599"
                            value={errorStatusCode}
                            onChange={(e) => setErrorStatusCode(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Error Message</label>
                        <input
                            type="text"
                            className="form-input"
                            value={errorMessage}
                            onChange={(e) => setErrorMessage(e.target.value)}
                        />
                    </div>
                </>
            )}

            {chaosType === 'rate-limit' && (
                <div className="form-group">
                    <label className="form-label">Drop Rate (%)</label>
                    <input
                        type="number"
                        className="form-input"
                        min="0"
                        max="100"
                        value={failRate}
                        onChange={(e) => setFailRate(e.target.value)}
                    />
                    <p className="form-hint">Randomly returns 429 for X% of requests</p>
                </div>
            )}

            {chaosType === 'token-bucket' && (
                <>
                    <div className="form-group">
                        <label className="form-label">Requests per Second (RPS)</label>
                        <input
                            type="number"
                            className="form-input"
                            min="1"
                            max="1000"
                            value={rps}
                            onChange={(e) => setRps(e.target.value)}
                        />
                    </div>
                    <div className="form-group">
                        <label className="form-label">Burst Capacity</label>
                        <input
                            type="number"
                            className="form-input"
                            min="1"
                            max="1000"
                            value={burst}
                            onChange={(e) => setBurst(e.target.value)}
                        />
                        <p className="form-hint">Max requests allowed in a burst before rate limiting</p>
                    </div>
                </>
            )}

            <div className="form-group">
                <label className="toggle">
                    <input
                        type="checkbox"
                        className="toggle-input"
                        checked={enabled}
                        onChange={(e) => setEnabled(e.target.checked)}
                    />
                    <span className="toggle-slider" />
                    <span style={{ marginLeft: '56px', fontSize: 'var(--font-size-sm)' }}>
                        {enabled ? 'Enabled' : 'Disabled'}
                    </span>
                </label>
            </div>

            <div className="flex gap-sm mt-md">
                <button type="submit" className="btn btn--primary" style={{ flex: 1 }}>
                    {rule ? 'Update Rule' : 'Create Rule'}
                </button>
                <button type="button" className="btn" onClick={onCancel}>
                    Cancel
                </button>
            </div>
        </form>
    );
}
