# Cloudflare Deployment Notes

## Default: Quick Tunnel

The repository uses Cloudflare Quick Tunnel by default:

```bash
./★CodexReader\ Tunnel.command
```

The launcher starts the local API at `http://127.0.0.1:3001`, starts a temporary `https://*.trycloudflare.com` tunnel, waits for `/health`, registers the tunnel URL with the discovery Worker, then opens:

```text
https://pdf-study.pages.dev/?apiBase=<temporary tunnel URL>
```

This default mode does not need a custom domain or DNS record. The tunnel URL changes when the tunnel restarts.

Quick Tunnel mode also does not require `npx wrangler login`. The launcher sets `NPM_CONFIG_CACHE` to `~/Library/Application Support/CodexReader/npm-cache` so root-owned files in `~/.npm` do not block the app.

## Discovery Worker

```text
Worker: https://pdf-study-discovery.jirehkwon.workers.dev
KV namespace: TUNNEL_KV
```

The Worker stores the latest validated Quick Tunnel URL. The frontend calls `/current` before trying the MacBook API, so other devices can open `https://pdf-study.pages.dev/` directly after the MacBook Tunnel launcher is running.

## Optional: Named Tunnel

Use a named tunnel only after choosing a project-owned domain, for example:

```text
reader-api.your-project-domain.com
```

Then set these environment variables on the MacBook before launching:

```bash
export CODEX_READER_TUNNEL_MODE=named
export CODEX_READER_TUNNEL_ID="<cloudflare tunnel id>"
export CODEX_READER_TUNNEL_URL="https://reader-api.your-project-domain.com"
```

The required DNS record would be:

```text
Type: CNAME
Name: reader-api
Target: <tunnel-id>.cfargotunnel.com
Proxy status: Proxied
```

## Access

Before treating this as private production traffic, create Cloudflare Access applications for:

- `pdf-study.pages.dev` or a custom Pages domain
- the chosen API tunnel hostname, if using named tunnel mode

Allow only the owner's email or identity provider group.

## Pages

Deploy Pages from inside `apps/web` so Wrangler uploads the Pages Functions bundle:

```bash
npm run deploy:pages
```

The deployed frontend reads its API origin from `apps/web/config.js`.

- On `pdf-study.pages.dev`, the frontend first calls the same-origin `/api/*` Pages Function, which proxies to the latest validated MacBook tunnel.
- The discovery Worker proxy and direct tunnel URL remain fallbacks.
- A custom API hostname can still be provided with `?apiBase=https://...`.
