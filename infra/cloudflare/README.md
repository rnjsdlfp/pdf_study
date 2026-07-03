# Cloudflare Deployment Notes

## Default: Quick Tunnel

The repository uses Cloudflare Quick Tunnel by default:

```bash
./★CodexReader\ Tunnel.command
```

The launcher starts the local API at `http://127.0.0.1:3001`, starts a temporary `https://*.trycloudflare.com` tunnel, waits for `/health`, then opens:

```text
https://pdf-study.pages.dev/?apiBase=<temporary tunnel URL>
```

This default mode does not need a custom domain or DNS record. The tunnel URL changes when the tunnel restarts.

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

The deployed frontend reads its API origin from `apps/web/config.js`.

- On the same MacBook, Pages defaults to `http://127.0.0.1:3001`.
- For another device, use the URL opened by `★CodexReader Tunnel.command`.
- A custom API hostname can still be provided with `?apiBase=https://...`.
