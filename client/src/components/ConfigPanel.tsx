/**
 * ConfigPanel Component
 * 
 * Allows users to configure the target API URL and enable/disable chaos.
 */

import { useState, useEffect } from 'react';
import { ProxyConfig } from '../types';
import * as api from '../api';

interface Props {
    onConfigChange?: (config: ProxyConfig) => void;
}

export function ConfigPanel({ onConfigChange }: Props) {
    const [config, setConfig] = useState<ProxyConfig>({ targetUrl: '', enabled: true });
    const [saving, setSaving] = useState(false);
    const [inputUrl, setInputUrl] = useState('');

    // Load initial config
    useEffect(() => {
        api.getConfig().then((res) => {
            if (res.success && res.data) {
                setConfig(res.data);
                setInputUrl(res.data.targetUrl);
            }
        });
    }, []);

    const handleSave = async () => {
        setSaving(true);
        const res = await api.updateConfig({ targetUrl: inputUrl });
        if (res.success && res.data) {
            setConfig(res.data);
            onConfigChange?.(res.data);
        }
        setSaving(false);
    };

    const handleToggle = async () => {
        const newEnabled = !config.enabled;
        const res = await api.updateConfig({ enabled: newEnabled });
        if (res.success && res.data) {
            setConfig(res.data);
            onConfigChange?.(res.data);
        }
    };

    return (
        <div className="panel">
            <div className="panel-header">
                <span className="panel-title">⚙️ Configuration</span>
                <label className="toggle">
                    <input
                        type="checkbox"
                        className="toggle-input"
                        checked={config.enabled}
                        onChange={handleToggle}
                    />
                    <span className="toggle-slider" />
                </label>
            </div>
            <div className="panel-content">
                <div className="form-group">
                    <label className="form-label">Target API URL</label>
                    <input
                        type="url"
                        className="form-input form-input--mono"
                        placeholder="https://api.example.com"
                        value={inputUrl}
                        onChange={(e) => setInputUrl(e.target.value)}
                    />
                </div>
                <div className="form-group">
                    <label className="form-label" style={{ marginBottom: '8px' }}>Proxy Endpoint</label>
                    <code style={{
                        display: 'block',
                        padding: '8px 12px',
                        background: 'var(--color-bg-primary)',
                        borderRadius: 'var(--radius-md)',
                        fontSize: 'var(--font-size-sm)',
                        color: 'var(--color-text-secondary)'
                    }}>
                        http://localhost:3001/proxy/*
                    </code>
                </div>
                <button
                    className="btn btn--primary"
                    onClick={handleSave}
                    disabled={saving}
                    style={{ width: '100%' }}
                >
                    {saving ? 'Saving...' : 'Save Configuration'}
                </button>
            </div>
        </div>
    );
}
