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
3. Confirm Codex CLI:

```bash
codex --version
codex exec --help
```

4. Install launchd:

```bash
./infra/macos/install-launchd.sh
```

5. Configure Cloudflare Tunnel from `infra/cloudflare/README.md`.

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
