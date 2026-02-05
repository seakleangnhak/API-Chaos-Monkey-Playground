/**
 * API Chaos Monkey Playground - Server Entry Point
 * 
 * This server provides:
 * 1. A proxy endpoint (/proxy/*) that forwards requests with chaos effects
 * 2. A REST API (/api/*) for managing configuration and rules
 * 3. A WebSocket endpoint (/ws) for real-time log updates
 */

import express from 'express';
import cors from 'cors';
import { createServer } from 'http';
import { apiRouter } from './api.js';
import { proxyMiddleware } from './proxy.js';
import { initWebSocket } from './websocket.js';

const PORT = process.env.PORT || 3001;

// Create Express app
const app = express();

// Middleware
app.use(cors());
app.use(express.json());

// Health check endpoint
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// API routes for UI
app.use('/api', apiRouter);

// Proxy routes - all requests to /proxy/* get forwarded
app.use('/proxy', proxyMiddleware);

// Create HTTP server (needed for WebSocket)
const server = createServer(app);

// Initialize WebSocket
initWebSocket(server);

// Start server
server.listen(PORT, () => {
    console.log('');
    console.log('🐵 API Chaos Monkey Playground');
    console.log('══════════════════════════════════════════');
    console.log(`   Server:     http://localhost:${PORT}`);
    console.log(`   Proxy:      http://localhost:${PORT}/proxy/*`);
    console.log(`   API:        http://localhost:${PORT}/api`);
    console.log(`   WebSocket:  ws://localhost:${PORT}/ws`);
    console.log('══════════════════════════════════════════');
    console.log('');
    console.log('Configure target URL and chaos rules via the UI,');
    console.log('then point your app to the /proxy endpoint.');
    console.log('');
});
