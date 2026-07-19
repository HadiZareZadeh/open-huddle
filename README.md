# Video Call

A self-hosted, lightweight small-group video meeting application — a simplified Google Meet alternative. Create a meeting link, share it, and connect with mesh WebRTC (up to 8 participants) with no accounts required.

## Features

- **Instant meetings** — Create unique room links with 12-character secure IDs
- **Reusable links** — Meeting links persist and can be reused after everyone leaves; they expire 7 days after last use
- **Display names** — Participants choose a name on the pre-join screen (stored locally for convenience)
- **Host approval lobby** — Optional “require host approval to join” when creating a meeting
- **Pre-join device setup** — Camera preview, microphone/camera/speaker selection
- **WebRTC video calling** — Mesh P2P audio/video (up to 8 participants) with self-hosted coturn STUN/TURN
- **Real-time chat** — In-meeting messaging via Socket.IO (session-only, no persistence)
- **Lock meeting** — Host can prevent new participants from joining
- **Copy invite link** — One-click clipboard copy
- **Noise suppression** — Toggle echo cancellation, noise suppression, auto gain
- **Background blur** — Client-side TensorFlow.js BodyPix segmentation
- **Security** — Helmet, CORS, rate limiting, input validation, XSS sanitization
- **Production ready** — native coturn + nginx + systemd on Linux (Docker optional)

## Architecture

```
┌─────────────┐     HTTPS/WSS      ┌─────────────┐
│   Browser   │ ◄────────────────► │    Nginx    │
│  (React +   │                    │   (proxy)   │
│   WebRTC)   │                    └──────┬──────┘
└──────┬──────┘                           │
       │                                  ▼
       │ Mesh P2P media (WebRTC)   ┌─────────────┐
       │                           │   Express   │
       └──────────────────────────►│  + Socket.IO│
                                   │  (signaling)│
                                   └──────┬──────┘
                                          │
                                   ┌──────▼──────┐
                                   │   coturn    │
                                   │   (TURN)    │
                                   └─────────────┘
```

### Components

| Layer | Technology | Role |
|-------|-----------|------|
| Frontend | React, Vite, Tailwind | UI, media capture, mesh WebRTC peer connections |
| Signaling | Socket.IO | SDP/ICE exchange, chat, room state |
| Backend | Express, TypeScript | REST API, room management, security |
| Storage | SQLite | Persistent meeting links (7-day expiry) |
| Media relay | coturn | Self-hosted STUN/TURN for NAT traversal (no third-party ICE) |
| Proxy | Nginx | HTTPS termination, WebSocket upgrade, rate limiting |

### Room Model

Meeting links are stored in SQLite and expire 7 days after last use. Active call state (participants, chat, lock) lives in memory for the duration of a session.

```typescript
// Persisted in SQLite
{
  id: string;              // 12-char secure random ID
  requireApproval: boolean; // host must approve new joiners (optional at create time)
  createdAt: Date;
  lastUsedAt: Date;
}

// expiresAt in API responses = lastUsedAt + 7 days

// In-memory during an active session
{
  locked: boolean;
  participants: Map;       // max MAX_PARTICIPANTS (default 8)
  pendingJoinRequests: Map;  // lobby queue when requireApproval is enabled
  rejoinGraceUntil: Map;     // recently disconnected names can rejoin without approval
  lastActivity: Date;
  chatMessages: [];          // session-only, max 200 messages
}
```

The first participant to join becomes the **host** (can lock the meeting and approve/deny join requests). When host approval is enabled, subsequent joiners wait in a lobby until the host accepts or rejects them. Recently disconnected participants can rejoin without approval for a short grace period (`REJOIN_GRACE_MS`, default 30 seconds).

Empty active sessions are removed from memory after 1 hour of inactivity. Expired links are deleted from the database automatically.

During development, the database schema is refreshed automatically on startup when the table structure changes (existing meeting rows are dropped). To reset manually, delete `./data/meetings.db` and restart the server.

## Prerequisites

- Node.js 20+
- npm 10+
- **coturn** (`turnserver`) for STUN/TURN:
  - Ubuntu/Debian/WSL: `sudo apt install coturn`
  - macOS: `brew install coturn`
- Linux server for native production (nginx + certbot via setup script)
- Docker optional — only if you prefer container deployment

## Installation

```bash
# Clone and enter project
cd video-call

# Install dependencies
npm install

# Copy environment file
cp .env.example .env
```

## Development Setup

coturn provides both STUN and TURN on port **3478**. The backend builds ICE server config automatically from `TURN_*` variables and issues short-lived TURN credentials via `/api/config/ice`.

### Same machine (localhost)

Install coturn once (see Prerequisites), then:

```bash
# Terminal 1 — start coturn
npm run coturn:dev

# Terminal 2 — app
npm run dev
```

Or in one step:

```bash
npm run dev:with-turn
```

Stop coturn when finished: `npm run coturn:dev:down`

### Local network (share with other devices on Wi-Fi/LAN)

**Windows:** double-click or run:

```bat
run-local.cmd
```

This starts coturn, installs dependencies if needed, enables HTTPS (required for camera/mic on phones), sets `TURN_HOST` to your LAN IP, opens firewall ports, and prints shareable URLs like `https://192.168.1.x:5173`.

- Frontend: https://localhost:5173 (or your LAN IP — use **https**, not http)
- Backend API and Socket.IO: proxied through the Vite dev server on port **5173** (LAN devices do not need port 3001)
- coturn STUN/TURN: `your-lan-ip:3478` (UDP/TCP) plus relay ports **49152–49252/udp**
- On phones/tablets: accept the self-signed certificate warning, then allow camera/microphone access

### Individual services

```bash
npm run coturn:dev      # native coturn (background)
npm run coturn:dev:down # stop native coturn
npm run dev:backend     # Express + Socket.IO on port 3001
npm run dev:frontend    # Vite dev server on port 5173
```

**Windows note:** coturn is not available as a native Windows binary. Install it inside **WSL** (`sudo apt install coturn`); `npm run coturn:dev` will detect and use it automatically.

## Testing

```bash
# Run all tests
npm test

# Backend only
npm run test --workspace=backend

# Frontend only
npm run test --workspace=frontend
```

## Production Build

```bash
npm run build
npm start
```

The backend serves the built frontend from `frontend/dist` in production mode.

## Low-resource servers (1 CPU / 1 GB RAM)

This stack is designed to run on small VPS instances. Media is peer-to-peer (or relayed through coturn), so Node.js only handles signaling — not video streams.

| Component | Typical RAM |
|-----------|-------------|
| Node.js (signaling) | 80–250 MB |
| nginx | 5–25 MB |
| coturn | 20–120 MB |
| SQLite | < 10 MB |

**Recommended deployment:** native Linux (`setup-linux-native.sh`), not Docker. Docker adds ~150–300 MB overhead from the daemon and extra containers.

Production defaults are tuned for small servers:

- **nginx serves static files** — the React build is served directly; only `/api` and `/socket.io` hit Node.js
- **Node heap capped at 256 MB** via `NODE_OPTIONS=--max-old-space-size=256`
- **systemd memory limits** — app 384 MB, coturn 256 MB
- **Smaller coturn relay pool** — ports 49152–49202 (~10 concurrent relayed calls)
- **SQLite page cache** — 8 MB with WAL mode
- **No production source maps** — smaller frontend build

Add **512 MB swap** as an OOM safety net, especially when TURN relay is active:

```bash
sudo fallocate -l 512M /swapfile
sudo chmod 600 /swapfile
sudo mkswap /swapfile
sudo swapon /swapfile
echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab
```

**Capacity on 1 GB:** several concurrent small meetings comfortably; larger meetings or heavy TURN relay use more bandwidth and coturn quota. Direct P2P mesh connections reduce relay load when NAT traversal succeeds.

Optional `.env` tuning:

| Variable | Default | Purpose |
|----------|---------|---------|
| `NODE_OPTIONS` | `--max-old-space-size=256` | Cap Node.js heap |
| `TURN_RELAY_MAX_PORT` | 49202 | Smaller relay port range |
| `TURN_TOTAL_QUOTA` | 20 | Max concurrent TURN allocations |
| `LOG_LEVEL` | info | Set to `warn` to reduce log I/O |

## Production Deployment (native Linux, no Docker)

### Windows: `deploy.bat`

From the project root on Windows, run `deploy.bat`. It will:

1. Prompt for server SSH details, **DOMAIN or public IP**, and **CERTBOT_EMAIL**
2. Generate an SSH key on first run (password prompted once)
3. Upload the project and run `scripts/deploy.sh install`

Menu options: fresh install, status, restart, update from repo.

**IP-only (`94.141.97.223`):** uses a **trusted Let's Encrypt IP certificate** (short-lived ~6 days, auto-renewed every 5 days). `CERTBOT_EMAIL` is required.

**Domain:** uses a standard 90-day Let's Encrypt certificate with automatic renewal.

### Linux server: `scripts/deploy.sh`

```bash
cp .env.example .env
# Or let install create .env — set DOMAIN, CERTBOT_EMAIL via environment:

sudo DOMAIN=meet.example.com CERTBOT_EMAIL=you@example.com ./scripts/deploy.sh install
# IP-only:
sudo DOMAIN=203.0.113.10 CERTBOT_EMAIL=you@example.com ./scripts/deploy.sh install
```

Or use the interactive menu:

```bash
sudo ./scripts/deploy.sh
```

Legacy entry point (delegates to `deploy.sh install`):

```bash
sudo ./scripts/setup-linux-native.sh
```

Fresh install is idempotent (safe to re-run) and will:

1. Install Node.js 20, **coturn**, **nginx**, **certbot** (snap upgrade for IP cert support)
2. Add permanent **swap**, configure **UFW** firewall
3. Build the app (`npm ci && npm run build`)
4. Install systemd services, disable conflicting default coturn
5. Request **Let's Encrypt** certificate (domain or short-lived **IP certificate**)
6. Verify health, ICE, frontend, Socket.IO, and meeting creation before finishing

Verify:

```bash
curl https://your-domain-or-ip/api/health
curl https://your-domain-or-ip/api/config/ice
```

Open firewall ports:
- **80/tcp**, **443/tcp** — web + signaling
- **3478/tcp+udp** — STUN/TURN
- **49152–49202/udp** — TURN relay media (smaller range for low-resource servers)

## Optional: Docker Deployment

### 1. Configure environment

```bash
cp .env.example .env
```

Edit `.env` and set:
- `DOMAIN` — your public hostname (e.g. `meet.example.com`)
- `CERTBOT_EMAIL` — email for Let's Encrypt expiry notices
- `TURN_SECRET` — long random secret (shared with coturn via entrypoint)
- `TURN_HOST` — defaults to `DOMAIN` in Docker production (clients reach coturn here)

Production Docker sets `TURN_HOST=${DOMAIN}` automatically. ICE servers are generated at runtime — no manual `ICE_SERVERS` JSON needed.

Use Docker only if you prefer containers over the native setup above. On 1 CPU / 1 GB RAM, native deployment is strongly recommended — Docker runs four containers plus the daemon and uses significantly more memory.

### 2. Issue HTTPS certificates (automated)

Point DNS for your domain to the server, ensure ports **80** and **443** are open, then run:

```bash
chmod +x scripts/init-letsencrypt.sh
./scripts/init-letsencrypt.sh
```

This script:
1. Downloads recommended TLS parameters
2. Creates a temporary self-signed certificate so nginx can start
3. Requests a real Let's Encrypt certificate via the HTTP-01 webroot challenge
4. Reloads nginx with HTTPS enabled

Certificates renew automatically via the `certbot` service (every 12 hours).

For testing, set `CERTBOT_STAGING=1` in `.env` to use Let's Encrypt staging.

### 3. Start services

```bash
docker compose up -d --build
```

Services:
- **app** — Node.js application (port 3001 internal)
- **coturn** — TURN server (host network, port 3478)
- **nginx** — Reverse proxy with HTTPS (ports 80/443)
- **certbot** — Automatic certificate renewal

### 4. Verify

```bash
curl https://your-domain.com/api/health
curl https://your-domain.com/api/config/ice
```

## TURN / STUN Server (coturn)

All WebRTC connectivity uses your **own coturn server** — no Google or other third-party ICE servers. coturn serves both STUN and TURN on the same port.

The backend generates time-limited TURN credentials (HMAC-SHA1) compatible with coturn's `use-auth-secret` mode. Clients fetch fresh credentials from `GET /api/config/ice`.

### Docker (optional)

If you use `docker compose up` instead of the native setup:

Production (`docker-compose.yml`):
- coturn runs with **host networking** (recommended on Linux)
- `TURN_SECRET` and `TURN_REALM` are injected by `docker/coturn/entrypoint.sh`

Development (`docker-compose.dev.yml`):
- Port-mapped coturn alternative if you cannot install coturn natively

Required `.env` settings:

| Variable | Example | Purpose |
|----------|---------|---------|
| `TURN_SECRET` | long random string | Shared auth secret |
| `TURN_HOST` | `meet.example.com` | Hostname/IP browsers use for STUN/TURN |
| `TURN_PORT` | `3478` | STUN/TURN port |
| `TURN_REALM` | `video-call.local` | coturn realm |
| `TURN_USERNAME` | `video-call` | Credential username prefix |

Optional:
- `TURN_EXTERNAL_IP` — set when coturn is behind NAT (`public/private` or single public IP)
- `TURN_CREDENTIAL_TTL_SEC` — credential lifetime (default 86400)
- `ICE_SERVERS` — manual JSON override (normally leave unset)

Open firewall ports:
- **3478/tcp+udp** — STUN/TURN
- **49152–49252/udp** — TURN relay media

### Native coturn (recommended)

Dev:

```bash
npm run coturn:dev
```

Production Linux:

```bash
sudo ./scripts/setup-linux-native.sh
```

Config is generated from `.env` into `.coturn/turnserver.conf` (dev) or `/etc/coturn/video-call.conf` (production).

## Nginx Configuration

Native production uses `deploy/nginx/video-call.conf.template`.

Docker uses `docker/nginx/templates/default.conf.template`.

Both provide:
- Reverse proxy to Node.js app
- WebSocket upgrade for Socket.IO
- Rate limiting zones
- Automatic HTTP → HTTPS redirect
- Let's Encrypt certificate paths

## Resilience

### Socket reconnection

If the signaling server drops (network blip or container restart), clients automatically:
1. Reconnect the Socket.IO transport (infinite retries with backoff)
2. Re-join the meeting room with the stored session and display name
3. Re-negotiate mesh WebRTC (`iceRestart`) with other participants

If the server restarted during an active call, the in-memory session is lost but the meeting link remains valid until 7 days after it was last used. Participants can rejoin using the same link.

### Background blur (lazy-loaded)

TensorFlow.js and BodyPix are loaded only when background blur is enabled, keeping the initial bundle small. Vite emits them as a separate `body-pix` chunk.

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `NODE_ENV` | development | Environment mode |
| `PORT` | 3001 | Server port |
| `HOST` | 0.0.0.0 | Server bind address |
| `CORS_ORIGINS` | http://localhost:5173 | Comma-separated allowed origins |
| `RATE_LIMIT_WINDOW_MS` | 900000 | Rate limit window (15 min) |
| `RATE_LIMIT_MAX` | 0 (dev) / 100 (prod) | Max API requests per window (`0` = disabled) |
| `ROOM_TTL_MS` | 3600000 | Active session inactivity TTL (1 hour) |
| `ROOM_CLEANUP_INTERVAL_MS` | 300000 | How often inactive sessions are purged (5 min) |
| `MEETING_LINK_TTL_MS` | 604800000 | Link expiry after last use (7 days) |
| `MAX_PARTICIPANTS` | 8 | Maximum participants per meeting (mesh WebRTC) |
| `JOIN_REQUEST_TIMEOUT_MS` | 120000 | Pending lobby requests expire after 2 minutes |
| `REJOIN_GRACE_MS` | 30000 | Rejoin without approval after disconnect (30 sec) |
| `DATABASE_PATH` | ./data/meetings.db | SQLite database file path |
| `TURN_RELAY_MIN_PORT` | 49152 | Start of coturn relay UDP range |
| `TURN_RELAY_MAX_PORT` | 49202 | End of coturn relay UDP range |
| `TURN_TOTAL_QUOTA` | 20 | Max concurrent TURN relay sessions |
| `TURN_HOST` | localhost / DOMAIN | Hostname or IP clients use for STUN/TURN |
| `TURN_SECRET` | — | Shared secret for coturn (required) |
| `TURN_PORT` | 3478 | coturn STUN/TURN port |
| `TURN_TLS_PORT` | 5349 | coturn TLS port |
| `TURN_REALM` | video-call.local | coturn authentication realm |
| `TURN_USERNAME` | video-call | TURN credential username prefix |
| `TURN_EXTERNAL_IP` | — | Public IP when coturn is behind NAT |
| `TURN_CREDENTIAL_TTL_SEC` | 86400 | TURN credential lifetime (seconds) |
| `ICE_SERVERS` | — | Optional manual ICE override (JSON) |
| `LOG_LEVEL` | info | Pino log level |
| `FRONTEND_DIST` | ../frontend/dist | Production frontend build path |
| `VITE_SOCKET_URL` | — | Override Socket.IO URL (frontend) |
| `VITE_BACKEND_PORT` | 3001 | Backend port hint for frontend dev |
| `DOMAIN` | — | Public hostname for HTTPS |
| `CERTBOT_EMAIL` | — | Let's Encrypt notification email |
| `CERTBOT_EXTRA_DOMAINS` | — | Comma-separated SANs for certificates |
| `CERTBOT_STAGING` | 0 | Set to `1` for Let's Encrypt staging |

## API Endpoints

| Method | Path | Description |
|--------|------|-------------|
| POST | `/api/meetings` | Create a meeting (`{ requireApproval?: boolean }`) |
| GET | `/api/meetings/:id` | Get public meeting info (lock state, participant count, expiry) |
| GET | `/api/config/ice` | Get ICE server configuration |
| GET | `/api/health` | Health check |

**POST `/api/meetings`** returns `{ id, url, requiresApproval }`.

**GET `/api/meetings/:id`** returns `{ id, requiresApproval, locked, participantCount, maxParticipants, expiresAt }`.

## Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `join-meeting` | Client → Server | Join with `{ meetingId, displayName }`; may return `pending: true` for lobby |
| `respond-join-request` | Client → Server | Host approves or rejects a lobby request |
| `join-request` | Server → Host | New lobby join request |
| `join-approved` | Server → Client | Guest admitted after host approval |
| `join-denied` | Server → Client | Host rejected the join request |
| `join-request-resolved` | Server → Client | Lobby request closed (approved or rejected) |
| `join-request-cancelled` | Server → Client | Pending request cancelled (guest disconnected) |
| `existing-participants` | Server → Client | List of participants already in the room |
| `signal` | Bidirectional | WebRTC SDP/ICE signaling (mesh, peer-to-peer by socket ID) |
| `chat-message` | Bidirectional | Send/receive chat messages |
| `lock-meeting` | Client → Server | Lock/unlock meeting (host only) |
| `media-state` | Bidirectional | Audio/video toggle notifications |
| `leave-meeting` | Client → Server | Leave the meeting cleanly |
| `participant-joined` | Server → Client | New participant (`socketId`, `displayName`) |
| `participant-left` | Server → Client | Participant disconnect (`socketId`, `displayName`) |
| `meeting-locked` | Server → Client | Lock state change broadcast |

## Security

- **Meeting IDs**: 12-character URL-safe random strings (~71 bits entropy)
- **Display names**: Validated (1–32 chars) and HTML-escaped server-side
- **Host controls**: Only the first joiner (host) can lock the meeting or approve lobby requests
- **Rate limiting**: Express rate limiter on all `/api` routes + Nginx zones (disabled in dev by default)
- **Headers**: Helmet.js security headers
- **XSS**: Chat messages and display names sanitized server-side
- **Validation**: Zod schema validation on all inputs
- **CORS**: Configurable origin whitelist

## Limitations

- Maximum 8 participants per meeting by default (`MAX_PARTICIPANTS`); mesh WebRTC scales as O(n²) peer connections
- Chat messages not persisted (meeting links persist until 7 days after last use)
- Background blur requires modern browser with WebGL
- Docker deployment needs more than 1 GB RAM for comfortable operation

## License

MIT
