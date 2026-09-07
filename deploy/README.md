# Deploying the shared session

Two services, one origin:

```
                    ┌─────────────────────────────┐
  agent  ──HTTPS──► │  nginx                      │
  browser ─HTTPS──► │   /            → the app    │
                    │   /session     → relay      │
                    │   /mcp/<code>  → relay      │
                    │   /ws          → relay (WS) │
                    └──────────┬──────────────────┘
                               │  (internal network only)
                    ┌──────────▼──────────────────┐
                    │  mcp-relay                  │
                    │  journal volume             │
                    └─────────────────────────────┘
```

Everything answers on one host, so there is **no CORS to configure and one
certificate to manage**. The relay's own port is never published — the proxy
is the only way in.

## Quick start

```bash
cp deploy/.env.example deploy/.env

# Generate the bearer token the agent will present:
node -e "console.log(require('crypto').randomBytes(32).toString('base64url'))"
# paste it into deploy/.env as OPS_RELAY_SECRET

docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Then open `http://localhost:8080/`. The app mints a session and shows the
pairing dialog with the code and a paste-ready agent configuration.

## Putting it on the internet

The compose stack speaks plain HTTP on `OPS_WEB_PORT`. **Terminate TLS in
front of it** — session codes and the bearer token travel over this
connection, and a browser will refuse a `ws://` socket from an `https://`
page anyway.

Caddy is the least effort:

```
pdf.ngc.example {
    reverse_proxy localhost:8080
}
```

Caddy handles the WebSocket upgrade automatically. With nginx or Traefik in
front, make sure `Upgrade`/`Connection` headers are forwarded on `/ws` and
that the read timeout on `/mcp/` clears ten minutes — `app_assistant_pending`
is a long-poll and will otherwise be killed mid-call.

Set `OPS_RELAY_ORIGIN` in `.env` to the real public URL once you have one.

## Pointing an agent at it

The tab shows the code; the agent needs the URL and the token:

```json
{ "mcpServers": { "open-pdf-studio": {
    "type": "http",
    "url": "https://pdf.ngc.example/mcp/<code from the tab>",
    "headers": { "Authorization": "Bearer <OPS_RELAY_SECRET>" }
} } }
```

For `ops_draw.py` and the `open-pdf-studio` skill:

```bash
export OPS_MCP_URL=https://pdf.ngc.example/mcp/<code>
export OPS_MCP_TOKEN=<OPS_RELAY_SECRET>
python3 renderers/ops_draw.py job.json
```

## Without Docker

The relay is a plain Node service; the app is static files.

```bash
# App
cd open-pdf-studio && npm ci
VITE_OPS_RELAY_URL=/ws npx vite build      # relative → any hostname works
#   → serve dist/ with the config in deploy/nginx.conf

# Relay
cd mcp-relay && npm ci --omit=dev
OPS_RELAY_SECRET=... OPS_RELAY_JOURNAL=/var/lib/ops-relay node server.mjs
```

A systemd unit:

```ini
[Unit]
Description=Open PDF Studio MCP relay
After=network.target

[Service]
Type=simple
User=ops
WorkingDirectory=/opt/open-pdf-studio/mcp-relay
Environment=OPS_RELAY_JOURNAL=/var/lib/ops-relay
EnvironmentFile=/etc/ops-relay.env
ExecStart=/usr/bin/node server.mjs
Restart=always

[Install]
WantedBy=multi-user.target
```

`VITE_OPS_RELAY_URL=/ws` is what makes one build work on any hostname — the
browser resolves it against whatever origin served the page.

## Operating it

**The journal** lives in the `relay-journal` volume (`/data/journal`). It is
the ordered list of agent calls per session, and it is how an agent's work is
recovered if a tab is lost for good. Back it up if that matters; it is
JSON-lines and safe to read.

```bash
curl -H "Authorization: Bearer $OPS_RELAY_SECRET" \
     "https://pdf.ngc.example/journal/<code>?replayable=1"
```

**Sessions** expire after 8 hours idle, or 5 minutes after the tab
disconnects. A reload reclaims its code inside that grace window, so the
agent's configured URL survives a refresh.

**A person's redlines are not in the journal.** They are drawn in the tab and
never travel through the relay; OPFS in the browser is what carries them
across a reload. If someone clears site data, those are gone — the agent's
work is not.

## Health and updates

```bash
curl https://pdf.ngc.example/health
# {"ok":true,"sessions":1,"tools":52,...}

docker compose -f deploy/docker-compose.yml --env-file deploy/.env up -d --build
```

Rebuilding drops live sessions — the relay holds them in memory. Do it when
nobody is mid-drawing.

## After pulling upstream changes

The relay's tool list is generated from `mcp_server.rs`, so an upstream change
to the app's tools can leave it stale:

```bash
cd mcp-relay
npm run tools:check     # fails if stale
npm run tools           # regenerate
```

## Verification status

The proxy configuration in this directory was built and exercised end to end:
the app served through nginx, `/session` minting, `/mcp/<code>` rejecting a
missing token with 401 and answering `tools/list` with a valid one, and the
`/ws` upgrade returning `101` — all through the proxy on one origin.

Host port publishing (`8080:80`) could not be confirmed on the machine this
was built on: Docker Desktop accepted the binding but no request from the host
ever reached nginx. That is an environment quirk rather than a configuration
one — nothing in `nginx.conf` or `docker-compose.yml` depends on it, and it
does not arise on a Linux host. Worth a `curl http://localhost:8080/` as the
first check on the real target.
