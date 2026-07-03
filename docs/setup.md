# Setup

## Local Run

```bash
CODEX_READER_HOME=./.runtime npm run start
```

Open `http://127.0.0.1:3001`.

On Windows PowerShell:

```powershell
$env:CODEX_READER_HOME="./.runtime"
npm run start
```

## Production MacBook Run

1. Keep this source folder in Dropbox or Git.
2. Keep runtime data in `~/Library/Application Support/CodexReader`.
3. Double-click one of these files in Finder:

```text
★CodexReader.command
★ Codex Reader.app
```

The launcher starts the backend in the background and opens `http://127.0.0.1:3001`.

If macOS says the file could not be executed because you do not have access privileges, run this once from Terminal:

```bash
bash ./fix-mac-permissions.sh
```

If macOS blocks the first launch for security reasons, right-click the file and choose `Open`.

When you open `https://pdf-study.pages.dev/`, the web UI connects to the Cloudflare Tunnel API at `https://reader-api.futurecontext.net`.

To force same-Mac local mode:

```text
https://pdf-study.pages.dev/?apiBase=http://127.0.0.1:3001
```

For another device, such as an iPad or a different laptop, use a Cloudflare Tunnel API hostname and open Pages once with:

```text
https://pdf-study.pages.dev/?apiBase=https://reader-api.futurecontext.net
```

4. Confirm Codex CLI:

```bash
codex --version
codex exec --help
```

5. Optional: install launchd for login-time auto-start:

```bash
./infra/macos/install-launchd.sh
```

6. Configure Cloudflare Tunnel from `infra/cloudflare/README.md`, then double-click:

```text
★CodexReader Tunnel.command
```

## Manual Terminal Run

If you prefer Terminal:

```bash
./★CodexReader.command
```

Or:

```bash
npm run start
```

## Runtime Files

The runner creates:

```text
~/Library/Application Support/CodexReader/
  data/
    reader-store.json
    uploads/
    extracted/
    analysis-cache/
    jobs/
  logs/
  run/
```

The current MVP uses `reader-store.json` because this environment has no SQLite driver installed. `infra/macos/reader.schema.sql` defines the SQLite target schema.
