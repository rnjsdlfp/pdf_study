# Cloudflare Deployment Notes

## Current Tunnel

```text
Cloudflare account: Jirehkwon@gmail.com's Account
Tunnel name: codex-reader
Tunnel ID: 7b63dd79-b0f5-410c-a5f1-16f3b86e7ca2
API hostname: reader-api.futurecontext.net
Local service: http://127.0.0.1:3001
```

The Tunnel ingress is configured in Cloudflare:

```text
reader-api.futurecontext.net -> http://127.0.0.1:3001
```

The remaining DNS record is:

```text
Type: CNAME
Name: reader-api
Target: 7b63dd79-b0f5-410c-a5f1-16f3b86e7ca2.cfargotunnel.com
Proxy status: Proxied
```

This repository includes a macOS launcher:

```bash
./★CodexReader\ Tunnel.command
```

It starts the local server if needed, starts the Cloudflare Tunnel with Wrangler, waits for `https://reader-api.futurecontext.net/health`, then opens:

```text
https://pdf-study.pages.dev/?apiBase=https%3A%2F%2Freader-api.futurecontext.net
```

On the first MacBook run, authenticate Wrangler once:

```bash
npx wrangler login
```

## Target Routes

```text
app.yourdomain.com
  -> Cloudflare Pages static web build

reader-api.futurecontext.net
  -> Cloudflare Tunnel
  -> http://127.0.0.1:3001 on the MacBook
```

## Access

Create two Cloudflare Access applications before treating this as private production traffic:

- `pdf-study.pages.dev` or a custom Pages domain
- `reader-api.futurecontext.net`

Allow only the owner's email or identity provider group. Keep Access enforcement on both the app and API hostnames.

## Tunnel

Current ingress:

```yaml
ingress:
  - hostname: reader-api.futurecontext.net
    service: http://127.0.0.1:3001
  - service: http_status:404
```

## Pages

This MVP serves the web UI from the local Node server too. For Pages deployment, publish `apps/web` as static assets.

The deployed frontend reads its API origin from `apps/web/config.js`. The default Pages API is:

```text
https://pdf-study.pages.dev/?apiBase=https://reader-api.futurecontext.net
```

If you deploy before the Tunnel hostname is ready, the UI still loads, but API-backed actions will only work after `apiBase` points at the Access-protected Tunnel hostname.

## Current MVP Limit

Cloudflare Access JWT cryptographic verification is represented as a server switch, but issuer/audience key validation still needs to be wired after the real Access app IDs are known.
