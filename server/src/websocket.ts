/**
 * WebSocket Server
 * 
 * Provides real-time updates to the UI when new requests are logged.
 * Uses the ws library for WebSocket support.
 */

import { WebSocketServer, WebSocket } from 'ws';
import { Server } from 'http';

let wss: WebSocketServer | null = null;

/**
 * Initialize the WebSocket server, attached to an existing HTTP server.
 */
export function initWebSocket(server: Server): void {
    wss = new WebSocketServer({ server, path: '/ws' });

    wss.on('connection', (ws: WebSocket) => {
        console.log('[WebSocket] Client connected');

        // Send a welcome message
        ws.send(JSON.stringify({ type: 'connected', message: 'WebSocket connected' }));

        ws.on('close', () => {
            console.log('[WebSocket] Client disconnected');
        });

        ws.on('error', (error: Error) => {
            console.error('[WebSocket] Error:', error.message);
        });
    });

    console.log('[WebSocket] Server initialized on /ws');
}

/**
 * Broadcast a message to all connected WebSocket clients.
 */
export function broadcast(data: unknown): void {
    if (!wss) return;

    const message = JSON.stringify(data);

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}
