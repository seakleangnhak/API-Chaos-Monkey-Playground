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

## Chaos Scenarios

Save, load, import, export, and share complete chaos configurations.

### Scenario Structure

```json
{
  "name": "High Latency Test",
  "description": "Simulates slow API responses",
  "createdAt": "2024-01-15T10:30:00Z",
  "config": {
    "targetUrl": "https://jsonplaceholder.typicode.com",
    "enabled": true
  },
  "rules": [
    {
      "id": "rule-1",
      "name": "Slow Posts",
      "enabled": true,
      "pathPattern": "/posts.*",
      "methods": ["*"],
      "chaosType": "latency",
      "latencyMs": 2000
    }
  ]
}
```

### Features

| Feature | Description |
|---------|-------------|
| **Save** | Save current config + rules as a named scenario |
| **Load** | Apply a saved scenario (replaces current state) |
| **Export** | Download scenario as JSON file |
| **Import** | Upload a JSON file to add a scenario |
| **Share** | Generate a URL with embedded scenario data |

### Share Links

Share links use URL-safe base64 encoding in the hash:
```
http://localhost:5173/#scenario=eyJuYW1lIjoiVGVzdC...
```

When someone opens a share link, they're prompted to apply and optionally save the scenario.

## Chaos Types

| Type | Description | Parameters |
|------|-------------|------------|
| **Latency** | Adds delay to responses | `latencyMs` - delay in milliseconds |
| **Error** | Returns HTTP error codes | `errorStatusCode`, `errorMessage` |
| **Timeout** | Hangs then destroys socket | `timeoutMs` (default 8000), `jitterMs` (default 0) |
| **Corrupt** | Returns malformed JSON | - |
| **Drop Rate** | Randomly fails X% of requests with 429 | `failRate` - percentage (0-100) |
| **Token Bucket** | True rate limiter with Retry-After | `rps` (tokens/sec), `burst` (max capacity) |

### Drop Rate vs Token Bucket

**Drop Rate** (legacy `rate-limit`): Simulates random failures by dropping X% of requests. Each request has an independent failRate% chance of returning 429.

```json
{
  "name": "Random 429s",
  "pathPattern": "/api/.*",
  "methods": ["*"],
  "chaosType": "rate-limit",
  "failRate": 30,
  "enabled": true
}
```

**Token Bucket**: True rate limiting using the token bucket algorithm. Tokens refill at `rps` per second up to `burst` capacity. When empty, returns 429 with `Retry-After` header.

```json
{
  "name": "5 RPS limit",
  "pathPattern": "/api/.*",
  "methods": ["*"],
  "chaosType": "token-bucket",
  "rps": 5,
  "burst": 10,
  "enabled": true
}
```

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

## Manual Test: Timeout Chaos

```bash
# Create a timeout rule (8 second hang)
curl -X POST http://localhost:3001/api/rules \
  -H "Content-Type: application/json" \
  -d '{"name": "Timeout Test", "pathPattern": "/posts.*", "chaosType": "timeout", "timeoutMs": 8000, "methods": ["*"], "enabled": true}'

# Test - should hang ~8 seconds then connection drops (curl shows error 52)
time curl -v http://localhost:3001/proxy/posts/1

# Check logs - status should be "timeout"
curl http://localhost:3001/api/logs?limit=1 | jq '.data[0] | {statusCode, actionsApplied}'
# Expected: {"statusCode": "timeout", "actionsApplied": ["match:Timeout Test", "timeout:triggered(ms=8000)"]}
```

## Manual Test: Corrupt JSON

```bash
# Create a corrupt rule
curl -X POST http://localhost:3001/api/rules \
  -H "Content-Type: application/json" \
  -d '{"name": "Corrupt Test", "pathPattern": "/posts.*", "chaosType": "corrupt", "methods": ["*"], "enabled": true}'

# Test - should return corrupted JSON with X-Chaos-Corrupted: 1 header
curl -v http://localhost:3001/proxy/posts/1

# Check response headers
curl -sI http://localhost:3001/proxy/posts/1 | grep -i x-chaos-corrupted
# Expected: X-Chaos-Corrupted: 1

# Check logs
curl http://localhost:3001/api/logs?limit=1 | jq '.data[0].actionsApplied'
# Expected: ["match:Corrupt Test", "upstream:request", "upstream:200", "corrupt_json:removed_key:userId"]
```

## Tech Stack

- **Server**: Node.js + Express + TypeScript
- **Client**: React + Vite + TypeScript
- **Real-time**: WebSocket for live request logs
- **Styling**: Vanilla CSS with CSS custom properties
