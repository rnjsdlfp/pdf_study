# Cloudflare Deployment Notes

## Target Routes

```text
app.yourdomain.com
  -> Cloudflare Pages static web build

reader-api.yourdomain.com
  -> Cloudflare Tunnel
  -> http://127.0.0.1:3001 on the MacBook
```

## Access

Create two Cloudflare Access applications:

- `app.yourdomain.com`
- `reader-api.yourdomain.com`

Allow only the owner's email or identity provider group. Keep Access enforcement on both the app and API hostnames.

## Tunnel

Example `cloudflared` ingress:

```yaml
tunnel: codex-reader
credentials-file: /Users/YOU/.cloudflared/codex-reader.json

ingress:
  - hostname: reader-api.yourdomain.com
    service: http://127.0.0.1:3001
  - service: http_status:404
```

## Pages

This MVP serves the web UI from the local Node server too. For Pages deployment, publish `apps/web` as static assets.

The deployed frontend reads its API origin from `apps/web/config.js`.

```js
window.CODEX_READER_CONFIG = {
  apiBase: "https://reader-api.yourdomain.com"
};
```

If you deploy before the Tunnel hostname is ready, the UI still loads, but API-backed actions will only work after `apiBase` points at the Access-protected Tunnel hostname.

## Current MVP Limit

Cloudflare Access JWT cryptographic verification is represented as a server switch, but issuer/audience key validation still needs to be wired after the real Access app IDs are known.
