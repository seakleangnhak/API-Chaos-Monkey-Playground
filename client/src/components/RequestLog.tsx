/**
 * RequestLog Component
 * 
 * Real-time display of proxied requests with WebSocket updates.
 */

import { useState, useEffect, useRef } from 'react';
import { RequestLog as RequestLogType } from '../types';
import * as api from '../api';

export function RequestLog() {
    const [logs, setLogs] = useState<RequestLogType[]>([]);
    const [connected, setConnected] = useState(false);
    const wsRef = useRef<WebSocket | null>(null);

    // Load initial logs and set up WebSocket
    useEffect(() => {
        // Load existing logs
        api.getLogs(100).then((res) => {
            if (res.success && res.data) {
                setLogs(res.data);
            }
        });

        // Connect to WebSocket for real-time updates
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        const ws = new WebSocket(wsUrl);
        wsRef.current = ws;

        ws.onopen = () => {
            setConnected(true);
        };

        ws.onclose = () => {
            setConnected(false);
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'new-log' && data.log) {
                    setLogs((prev) => [data.log, ...prev].slice(0, 100));
                }
            } catch {
                // Ignore parse errors
            }
        };

        return () => {
            ws.close();
        };
    }, []);

    const handleClear = async () => {
        await api.clearLogs();
        setLogs([]);
    };

    const getMethodClass = (method: string) => {
        return `badge badge--method badge--method-${method.toLowerCase()}`;
    };

    const getStatusClass = (status?: number | 'timeout') => {
        if (!status) return 'badge badge--status';
        if (status === 'timeout') return 'badge badge--status badge--status-error';
        return status >= 400
            ? 'badge badge--status badge--status-error'
            : 'badge badge--status badge--status-success';
    };

    const formatTime = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleTimeString();
    };

    return (
        <div className="panel" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div className="panel-header">
                <span className="panel-title">📋 Request Log</span>
                <div className="flex items-center gap-md">
                    <div className="connection-status">
                        <span className={`status-dot ${connected ? 'status-dot--connected' : ''}`} />
                        <span>{connected ? 'Live' : 'Disconnected'}</span>
                    </div>
                    <button className="btn btn--small" onClick={handleClear}>
                        Clear
                    </button>
                </div>
            </div>
            <div className="panel-content panel-content--no-padding" style={{ flex: 1, overflow: 'hidden' }}>
                {logs.length === 0 ? (
                    <div className="empty-state">
                        <div className="empty-state-icon">📭</div>
                        <p>No requests logged yet.</p>
                        <p style={{ fontSize: 'var(--font-size-sm)' }}>
                            Send requests to the proxy to see them here.
                        </p>
                    </div>
                ) : (
                    <div className="log-list">
                        {logs.map((log) => (
                            <div
                                key={log.id}
                                className={`log-item ${log.chaosApplied ? 'log-item--chaos' : ''}`}
                            >
                                <span className={getMethodClass(log.method)}>
                                    {log.method}
                                </span>
                                <span className="log-path" title={log.path}>
                                    {log.path}
                                </span>
                                {log.statusCode && (
                                    <span className={getStatusClass(log.statusCode)}>
                                        {log.statusCode}
                                    </span>
                                )}
                                <div style={{ textAlign: 'right' }}>
                                    {log.chaosApplied && (
                                        <div className="log-chaos">
                                            🐵 {log.chaosDetails}
                                        </div>
                                    )}
                                    <div className="log-time">
                                        {log.responseTime && `${log.responseTime}ms · `}
                                        {formatTime(log.timestamp)}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
}
