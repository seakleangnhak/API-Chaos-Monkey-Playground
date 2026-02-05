/**
 * RulesPanel Component
 * 
 * Displays the list of chaos rules and allows adding/editing/deleting rules.
 */

import { useState, useEffect } from 'react';
import { ChaosRule } from '../types';
import * as api from '../api';
import { RuleEditor } from './RuleEditor';

export function RulesPanel() {
    const [rules, setRules] = useState<ChaosRule[]>([]);
    const [editingRule, setEditingRule] = useState<ChaosRule | null>(null);
    const [isCreating, setIsCreating] = useState(false);

    // Load rules on mount
    useEffect(() => {
        loadRules();
    }, []);

    const loadRules = async () => {
        const res = await api.getRules();
        if (res.success && res.data) {
            setRules(res.data);
        }
    };

    const handleCreate = async (ruleData: Omit<ChaosRule, 'id'>) => {
        const res = await api.createRule(ruleData);
        if (res.success) {
            setIsCreating(false);
            loadRules();
        }
    };

    const handleUpdate = async (ruleData: ChaosRule) => {
        const res = await api.updateRule(ruleData.id, ruleData);
        if (res.success) {
            setEditingRule(null);
            loadRules();
        }
    };

    const handleDelete = async (id: string) => {
        if (!confirm('Delete this rule?')) return;
        const res = await api.deleteRule(id);
        if (res.success) {
            loadRules();
        }
    };

    const handleToggle = async (rule: ChaosRule) => {
        await api.updateRule(rule.id, { enabled: !rule.enabled });
        loadRules();
    };

    const getChaosTypeClass = (type: string) => {
        return `badge badge--chaos badge--chaos-${type}`;
    };

    // Show editor if creating or editing
    if (isCreating || editingRule) {
        return (
            <div className="panel">
                <div className="panel-header">
                    <span className="panel-title">
                        {editingRule ? '✏️ Edit Rule' : '➕ New Rule'}
                    </span>
                </div>
                <div className="panel-content">
                    <RuleEditor
                        rule={editingRule ?? undefined}
                        onSave={(data) => {
                            if ('id' in data) {
                                handleUpdate(data);
                            } else {
                                handleCreate(data);
                            }
                        }}
                        onCancel={() => {
                            setIsCreating(false);
                            setEditingRule(null);
                        }}
                    />
                </div>
            </div>
        );
    }

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">🎯 Chaos Rules</span>
                <button className="btn btn--primary btn--small" onClick={() => setIsCreating(true)}>
                    + Add Rule
                </button>
            </div>
            <div className="panel-content panel-content--no-padding">
                {rules.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">🐵</div>
                        <p>No chaos rules yet.</p>
                        <p style={{ fontSize: 'var(--font-size-sm)' }}>
                            Add a rule to start injecting chaos!
                        </p>
                    </div>
                ) : (
                    <ul className="rules-list">
                        {rules.map((rule) => (
                            <li
                                key={rule.id}
                                className={`rule-item ${!rule.enabled ? 'rule-item--disabled' : ''}`}
                            >
                                <label className="toggle">
                                    <input
                                        type="checkbox"
                                        className="toggle-input"
                                        checked={rule.enabled}
                                        onChange={() => handleToggle(rule)}
                                    />
                                    <span className="toggle-slider" />
                                </label>
                                <div className="rule-info">
                                    <div className="rule-name">
                                        {rule.name}
                                        <span className={getChaosTypeClass(rule.chaosType)} style={{ marginLeft: '8px' }}>
                                            {rule.chaosType}
                                        </span>
                                    </div>
                                    <div className="rule-pattern">{rule.pathPattern}</div>
                                </div>
                                <div className="rule-actions">
                                    <button
                                        className="btn btn--small btn--icon"
                                        onClick={() => setEditingRule(rule)}
                                        title="Edit"
                                    >
                                        ✏️
                                    </button>
                                    <button
                                        className="btn btn--small btn--icon btn--danger"
                                        onClick={() => handleDelete(rule.id)}
                                        title="Delete"
                                    >
                                        🗑️
                                    </button>
                                </div>
                            </li>
                        ))}
                    </ul>
                )}
            </div>
        </div>
    );
}
