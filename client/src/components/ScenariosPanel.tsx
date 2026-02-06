/**
 * ScenariosPanel Component
 * 
 * Manages chaos scenarios: save, load, delete, import, export, share.
 */

import { useState, useEffect, useRef } from 'react';
import { ChaosScenario } from '../types';
import { getConfig, updateConfig, getRules, createRule, deleteRule } from '../api';
import {
    getSavedScenarios,
    saveScenario,
    deleteScenario,
    exportScenarioToFile,
    importScenarioFromFile,
    getScenarioFromUrlHash,
    setScenarioInUrlHash,
    clearUrlHash,
} from '../scenarios';

interface ScenariosPanelProps {
    onScenarioApplied?: () => void;
}

export function ScenariosPanel({ onScenarioApplied }: ScenariosPanelProps) {
    const [scenarios, setScenarios] = useState<ChaosScenario[]>([]);
    const [selectedScenario, setSelectedScenario] = useState<string>('');
    const [newScenarioName, setNewScenarioName] = useState('');
    const [newScenarioDesc, setNewScenarioDesc] = useState('');
    const [showSaveDialog, setShowSaveDialog] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [shareUrl, setShareUrl] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load saved scenarios on mount
    useEffect(() => {
        setScenarios(getSavedScenarios());
    }, []);

    // Check for URL hash scenario on mount
    useEffect(() => {
        const urlScenario = getScenarioFromUrlHash();
        if (urlScenario) {
            const confirmed = window.confirm(
                `Found shared scenario "${urlScenario.name}" in URL.\n\nApply it now?`
            );
            if (confirmed) {
                applyScenario(urlScenario);
                // Optionally save it
                const save = window.confirm('Save this scenario to your local list?');
                if (save) {
                    handleSaveImportedScenario(urlScenario);
                }
            }
            clearUrlHash();
        }
    }, []);

    const refreshScenarios = () => {
        setScenarios(getSavedScenarios());
    };

    const showMessage = (msg: string, isError = false) => {
        if (isError) {
            setError(msg);
            setSuccess(null);
        } else {
            setSuccess(msg);
            setError(null);
        }
        setTimeout(() => {
            setError(null);
            setSuccess(null);
        }, 3000);
    };

    /**
     * Apply a scenario to the server: update config, replace all rules.
     */
    const applyScenario = async (scenario: ChaosScenario) => {
        setLoading(true);
        try {
            // Update config
            const configResult = await updateConfig(scenario.config);
            if (!configResult.success) {
                throw new Error(configResult.error || 'Failed to update config');
            }

            // Delete all existing rules
            const rulesResult = await getRules();
            if (rulesResult.success && rulesResult.data) {
                for (const rule of rulesResult.data) {
                    await deleteRule(rule.id);
                }
            }

            // Create new rules in order
            for (const rule of scenario.rules) {
                // Remove id to let server generate new ones
                const { id, ...ruleWithoutId } = rule;
                await createRule(ruleWithoutId);
            }

            showMessage(`Scenario "${scenario.name}" applied!`);
            onScenarioApplied?.();
        } catch (e) {
            showMessage(e instanceof Error ? e.message : 'Failed to apply scenario', true);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Save current state as a new scenario.
     */
    const handleSaveCurrentState = async () => {
        if (!newScenarioName.trim()) {
            showMessage('Please enter a scenario name', true);
            return;
        }

        setLoading(true);
        try {
            const configResult = await getConfig();
            const rulesResult = await getRules();

            if (!configResult.success || !rulesResult.success) {
                throw new Error('Failed to fetch current state');
            }

            const scenario: ChaosScenario = {
                name: newScenarioName.trim(),
                description: newScenarioDesc.trim() || undefined,
                createdAt: new Date().toISOString(),
                config: configResult.data!,
                rules: rulesResult.data!,
            };

            const result = saveScenario(scenario);
            if (!result.success) {
                throw new Error(result.error);
            }

            showMessage(`Scenario "${scenario.name}" saved!`);
            setNewScenarioName('');
            setNewScenarioDesc('');
            setShowSaveDialog(false);
            refreshScenarios();
        } catch (e) {
            showMessage(e instanceof Error ? e.message : 'Failed to save scenario', true);
        } finally {
            setLoading(false);
        }
    };

    /**
     * Load selected scenario.
     */
    const handleLoadScenario = () => {
        const scenario = scenarios.find(s => s.name === selectedScenario);
        if (!scenario) {
            showMessage('Please select a scenario', true);
            return;
        }
        applyScenario(scenario);
    };

    /**
     * Delete selected scenario.
     */
    const handleDeleteScenario = () => {
        if (!selectedScenario) {
            showMessage('Please select a scenario', true);
            return;
        }
        if (!window.confirm(`Delete scenario "${selectedScenario}"?`)) return;

        if (deleteScenario(selectedScenario)) {
            showMessage(`Scenario "${selectedScenario}" deleted`);
            setSelectedScenario('');
            refreshScenarios();
        } else {
            showMessage('Failed to delete scenario', true);
        }
    };

    /**
     * Export selected scenario to file.
     */
    const handleExport = () => {
        const scenario = scenarios.find(s => s.name === selectedScenario);
        if (!scenario) {
            showMessage('Please select a scenario', true);
            return;
        }
        exportScenarioToFile(scenario);
        showMessage('Scenario exported!');
    };

    /**
     * Handle file import.
     */
    const handleImport = async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (!file) return;

        try {
            const scenario = await importScenarioFromFile(file);
            handleSaveImportedScenario(scenario);
        } catch (e) {
            showMessage(e instanceof Error ? e.message : 'Failed to import', true);
        }

        // Reset file input
        if (fileInputRef.current) {
            fileInputRef.current.value = '';
        }
    };

    /**
     * Save an imported scenario, handling name conflicts.
     */
    const handleSaveImportedScenario = (scenario: ChaosScenario) => {
        const existing = scenarios.find(s => s.name === scenario.name);
        if (existing) {
            const rename = window.prompt(
                `Scenario "${scenario.name}" already exists. Enter a new name or cancel:`,
                `${scenario.name} (imported)`
            );
            if (!rename) return;
            scenario = { ...scenario, name: rename };
        }

        const result = saveScenario(scenario);
        if (result.success) {
            showMessage(`Scenario "${scenario.name}" imported!`);
            refreshScenarios();
        } else {
            showMessage(result.error, true);
        }
    };

    /**
     * Generate share URL for selected scenario.
     */
    const handleShare = () => {
        const scenario = scenarios.find(s => s.name === selectedScenario);
        if (!scenario) {
            showMessage('Please select a scenario', true);
            return;
        }
        const url = setScenarioInUrlHash(scenario);
        setShareUrl(url);

        // Copy to clipboard
        navigator.clipboard.writeText(url).then(() => {
            showMessage('Share URL copied to clipboard!');
        }).catch(() => {
            showMessage('Share URL generated (copy manually)', false);
        });
    };

    return (
        <div className="card">
            <h2>📦 Scenarios</h2>

            {error && <div className="alert alert--error">{error}</div>}
            {success && <div className="alert alert--success">{success}</div>}

            {/* Scenario selector */}
            <div className="form-group">
                <label>Saved Scenarios</label>
                <select
                    value={selectedScenario}
                    onChange={e => setSelectedScenario(e.target.value)}
                    className="select"
                >
                    <option value="">-- Select a scenario --</option>
                    {scenarios.map(s => (
                        <option key={s.name} value={s.name}>
                            {s.name} ({s.rules.length} rules)
                        </option>
                    ))}
                </select>
            </div>

            {/* Action buttons */}
            <div className="flex gap-xs" style={{ flexWrap: 'wrap' }}>
                <button
                    className="btn btn--small"
                    onClick={handleLoadScenario}
                    disabled={!selectedScenario || loading}
                >
                    Load
                </button>
                <button
                    className="btn btn--small"
                    onClick={handleDeleteScenario}
                    disabled={!selectedScenario || loading}
                >
                    Delete
                </button>
                <button
                    className="btn btn--small"
                    onClick={handleExport}
                    disabled={!selectedScenario || loading}
                >
                    Export
                </button>
                <button
                    className="btn btn--small"
                    onClick={handleShare}
                    disabled={!selectedScenario || loading}
                >
                    Share
                </button>
            </div>

            {/* Share URL display */}
            {shareUrl && (
                <div className="form-group" style={{ marginTop: '8px' }}>
                    <label>Share URL</label>
                    <input
                        type="text"
                        value={shareUrl}
                        readOnly
                        onClick={e => (e.target as HTMLInputElement).select()}
                        style={{ fontSize: '12px' }}
                    />
                </div>
            )}

            <hr style={{ margin: '12px 0', border: 'none', borderTop: '1px solid var(--border)' }} />

            {/* Save / Import */}
            <div className="flex gap-xs">
                <button
                    className="btn btn--small btn--primary"
                    onClick={() => setShowSaveDialog(!showSaveDialog)}
                    disabled={loading}
                >
                    {showSaveDialog ? 'Cancel' : 'Save Current'}
                </button>
                <label className="btn btn--small" style={{ cursor: 'pointer' }}>
                    Import
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleImport}
                        style={{ display: 'none' }}
                    />
                </label>
            </div>

            {/* Save dialog */}
            {showSaveDialog && (
                <div style={{ marginTop: '12px', padding: '12px', background: 'var(--bg-secondary)', borderRadius: '8px' }}>
                    <div className="form-group">
                        <label>Scenario Name *</label>
                        <input
                            type="text"
                            value={newScenarioName}
                            onChange={e => setNewScenarioName(e.target.value)}
                            placeholder="My Chaos Scenario"
                        />
                    </div>
                    <div className="form-group">
                        <label>Description (optional)</label>
                        <input
                            type="text"
                            value={newScenarioDesc}
                            onChange={e => setNewScenarioDesc(e.target.value)}
                            placeholder="Testing high latency..."
                        />
                    </div>
                    <button
                        className="btn btn--primary"
                        onClick={handleSaveCurrentState}
                        disabled={loading || !newScenarioName.trim()}
                    >
                        {loading ? 'Saving...' : 'Save Scenario'}
                    </button>
                </div>
            )}
        </div>
    );
}
