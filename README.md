# API Chaos Monkey Playground 🐵

A local developer tool for testing API resilience by injecting controlled chaos (latency, errors, timeouts) into HTTP requests.

## Quick Start

### 1. Install Dependencies

```bash
# Install server dependencies
cd server && npm install

# Install client dependencies
cd ../client && npm install
```

### 2. Start the Server

```bash
cd server
npm run dev
```

Server runs at `http://localhost:3001`

### 3. Start the UI

```bash
cd client
npm run dev
```

UI opens at `http://localhost:5173`

### 4. Configure and Test

1. In the UI, set your **Target API URL** (e.g., `https://jsonplaceholder.typicode.com`)
2. Add chaos rules (latency, errors, etc.)
3. Point your application to the proxy: `http://localhost:3001/proxy/your-endpoint`

## Architecture

```
┌─────────────┐      ┌──────────────────────────┐      ┌────────────┐
│  Your App   │ ──►  │  Chaos Proxy (Express)   │ ──►  │ Target API │
│             │      │  localhost:3001/proxy    │      │            │
└─────────────┘      └──────────────────────────┘      └────────────┘
                              ▲
                              │ WebSocket (real-time logs)
                     ┌────────┴─────────┐
                     │   Web UI (React)  │
                     │   localhost:5173  │
                     └───────────────────┘
```

## Chaos Types

| Type | Description | Parameters |
|------|-------------|------------|
| **Latency** | Adds delay to responses | `latencyMs` - delay in milliseconds |
| **Error** | Returns HTTP error codes | `errorStatusCode`, `errorMessage` |
| **Timeout** | Never responds (hangs) | - |
| **Corrupt** | Returns malformed JSON | - |
| **Rate Limit** | Fails X% of requests | `failRate` - percentage (0-100) |

## API Endpoints

### Proxy
- `ANY /proxy/*` - Forwards to target API with chaos applied

### Configuration
- `GET /api/config` - Get proxy config
- `PUT /api/config` - Update target URL / enabled state

### Rules
- `GET /api/rules` - List all rules
- `POST /api/rules` - Create rule
- `PUT /api/rules/:id` - Update rule
- `DELETE /api/rules/:id` - Delete rule

### Logs
- `GET /api/logs` - Get request logs
- `DELETE /api/logs` - Clear logs

## Example Usage

```bash
# Set target to JSONPlaceholder
curl -X PUT http://localhost:3001/api/config \
  -H "Content-Type: application/json" \
  -d '{"targetUrl": "https://jsonplaceholder.typicode.com"}'

# Create a latency rule
curl -X POST http://localhost:3001/api/rules \
  -H "Content-Type: application/json" \
  -d '{"name": "Slow posts", "pathPattern": "/posts.*", "chaosType": "latency", "latencyMs": 2000, "methods": ["*"], "enabled": true}'

# Test the proxy (should be slow!)
curl http://localhost:3001/proxy/posts/1
```

## Tech Stack

- **Server**: Node.js + Express + TypeScript
- **Client**: React + Vite + TypeScript
- **Real-time**: WebSocket for live request logs
- **Styling**: Vanilla CSS with CSS custom properties
