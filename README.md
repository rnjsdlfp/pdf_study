# Codex PDF/Web Research Reader

Local-first research reader for PDFs and webpages. The browser UI can be exposed through Cloudflare Pages/Access/Tunnel, while uploads, extracted text, caches, job queues, and Codex CLI execution stay on the always-on MacBook.

## Quick Start

```bash
npm run start
```

Then open:

```text
http://127.0.0.1:3001
```

On macOS, you can also double-click either of these files from Finder:

```text
★CodexReader.command
★ Codex Reader.app
```

The launcher starts the runner in the background, waits for `http://127.0.0.1:3001/health`, then opens the local reader in your browser.

If macOS says the file could not be executed because you do not have access privileges, run this once from Terminal:

```bash
bash ./fix-mac-permissions.sh
```

When you open `https://pdf-study.pages.dev/` on the same MacBook, the web UI connects to `http://127.0.0.1:3001`.

For access from another device, use the Tunnel launcher:

```text
★CodexReader Tunnel.command
```

The Tunnel launcher uses Cloudflare Quick Tunnel by default. It creates a temporary `https://*.trycloudflare.com` API URL, registers it with the discovery Worker, opens Pages with `refreshDiscovery=1`, and does not require a custom DNS record. On Pages, browser API calls go through the same-origin `/api/*` Pages Function first, then fall back to the discovery Worker proxy and direct tunnel URL if needed.

After the MacBook Tunnel launcher is running, other computers can open `https://pdf-study.pages.dev/` directly. The frontend asks the discovery Worker for the latest MacBook tunnel URL before it marks the MacBook offline.

Keep the `★CodexReader Tunnel.command` Terminal window open while using the reader from other devices. If that window shows `[Process completed]` or is closed, the temporary Cloudflare Tunnel has stopped and other devices will show `MacBook offline`.

If the launcher opens an extra tab and one tab says `MacBook offline`, refresh the tab or open `https://pdf-study.pages.dev/?refreshDiscovery=1`. To run the tunnel without opening a browser tab automatically, start it from Terminal with `CODEX_READER_OPEN_BROWSER=false ./★CodexReader\ Tunnel.command`.

The launcher uses app-local caches under `~/Library/Application Support/CodexReader`, so `npx wrangler login` is not required for the default Quick Tunnel flow.

If the status bar says `Codex CLI not found`, run this from Finder:

```text
★Install Codex CLI.command
```

It installs the official `@openai/codex` CLI into `~/.npm-global`, then offers to run `codex login`. The reader launchers already include `~/.npm-global/bin`, `~/.local/bin`, and `~/.codex/bin` in their search path.

The Codex runner mirrors the working `research-wiki` automation style: it runs `codex exec` with `--skip-git-repo-check` and defaults to `CODEX_READER_CODEX_MODEL=gpt-5.5`. You can override the binary path with `CODEX_READER_CODEX_COMMAND=/path/to/codex`; if `CODEX_CLI_COMMAND` is already set in the environment, the reader also uses its first command word as a discovery hint.

For development inside this repository, set `CODEX_READER_HOME=./.runtime` so runtime data stays inside the ignored workspace folder.

## What Is Implemented

- Local Node server with optional Python helpers for richer PDF extraction.
- PDF upload, hashing, local storage, and PyMuPDF4LLM-first text extraction with JavaScript fallback.
- Webpage URL import with readable text extraction.
- Documents, pages, selections, jobs, cache, and source records.
- Lease-based single-worker job queue.
- Codex CLI adapter with structured fallback output.
- SSE job status stream.
- Rational-style web reader UI with status bar, analysis panel, and selection popup.
- Headless runner with runtime directory creation, PID/lock files, stale lock recovery, and duplicate runner detection.
- macOS launchd and Cloudflare setup notes.

## Important Note

This environment does not include a native SQLite driver or `sqlite3` CLI, so the MVP stores runtime state in an atomic JSON data file. A SQLite schema is included in `infra/macos/reader.schema.sql` so the storage adapter can be swapped without changing API or UI surfaces.
