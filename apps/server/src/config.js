const os = require("os");
const path = require("path");

function parseList(value) {
  return String(value || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parseNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function defaultRuntimeHome() {
  if (process.platform === "darwin") {
    return path.join(os.homedir(), "Library", "Application Support", "CodexReader");
  }

  if (process.platform === "win32") {
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "CodexReader");
  }

  return path.join(os.homedir(), ".local", "share", "CodexReader");
}

function createConfig(overrides = {}) {
  const runtimeHome = path.resolve(
    overrides.runtimeHome || process.env.CODEX_READER_HOME || defaultRuntimeHome()
  );

  const port = parseNumber(overrides.port || process.env.CODEX_READER_PORT, 3001);
  const host = overrides.host || process.env.CODEX_READER_HOST || "127.0.0.1";

  return {
    host,
    port,
    runtimeHome,
    projectRoot: path.resolve(__dirname, "..", "..", ".."),
    webRoot: path.resolve(__dirname, "..", "..", "web"),
    allowedOrigins: parseList(overrides.corsOrigins || process.env.CODEX_READER_CORS_ORIGINS),
    apiToken: overrides.apiToken || process.env.CODEX_READER_API_TOKEN || "",
    codexMode: overrides.codexMode || process.env.CODEX_READER_CODEX_MODE || "auto",
    codexCommand: overrides.codexCommand || process.env.CODEX_READER_CODEX_COMMAND || "",
    codexModel: overrides.codexModel || process.env.CODEX_READER_CODEX_MODEL || "gpt-5.5",
    codexSkipGitRepoCheck:
      String(overrides.codexSkipGitRepoCheck || process.env.CODEX_READER_CODEX_SKIP_GIT_REPO_CHECK || "true") ===
      "true",
    codexTimeoutMs: parseNumber(
      overrides.codexTimeoutMs || process.env.CODEX_READER_CODEX_TIMEOUT_MS,
      360000
    ),
    maxCodexConcurrency: Math.max(
      1,
      Math.min(
        4,
        Math.round(parseNumber(overrides.maxCodexConcurrency || process.env.CODEX_READER_MAX_CODEX_CONCURRENCY, 2))
      )
    ),
    maxUploadBytes:
      parseNumber(overrides.maxUploadMb || process.env.CODEX_READER_MAX_UPLOAD_MB, 200) *
      1024 *
      1024,
    requireAccessJwt:
      String(overrides.requireAccessJwt || process.env.CODEX_READER_REQUIRE_ACCESS_JWT || "false") ===
      "true"
  };
}

module.exports = {
  createConfig,
  defaultRuntimeHome
};
