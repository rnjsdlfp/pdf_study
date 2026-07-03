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

When you open `https://pdf-study.pages.dev/` on the same MacBook, the web UI automatically connects to `http://127.0.0.1:3001`.

For development inside this repository, set `CODEX_READER_HOME=./.runtime` so runtime data stays inside the ignored workspace folder.

## What Is Implemented

- Local Node server with no third-party runtime dependencies.
- PDF upload, hashing, local storage, and best-effort text extraction.
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
