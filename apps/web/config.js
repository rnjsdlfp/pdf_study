const LOCAL_MACBOOK_API_BASE = "http://127.0.0.1:3001";
const API_BASE_STORAGE_KEY = "codexReaderApiBaseV2";
const DISCOVERY_URL = "https://pdf-study-discovery.jirehkwon.workers.dev";

function normalizeApiBase(value) {
  return String(value || "").replace(/\/$/, "");
}

function readApiBaseOverride() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = normalizeApiBase(params.get("apiBase"));
  if (fromQuery) {
    localStorage.setItem(API_BASE_STORAGE_KEY, fromQuery);
    return fromQuery;
  }

  const stored = normalizeApiBase(localStorage.getItem(API_BASE_STORAGE_KEY));
  return stored || normalizeApiBase(window.CODEX_READER_API_BASE || "");
}

function defaultApiBase() {
  if (window.location.hostname.endsWith(".pages.dev")) {
    return LOCAL_MACBOOK_API_BASE;
  }
  return "";
}

function defaultApiBaseCandidates() {
  const configuredTunnel = normalizeApiBase(window.CODEX_READER_TUNNEL_API_BASE || "");
  if (window.location.hostname.endsWith(".pages.dev")) {
    return [configuredTunnel, LOCAL_MACBOOK_API_BASE].filter(Boolean);
  }
  return [""];
}

window.CODEX_READER_CONFIG = {
  apiBase: readApiBaseOverride() || defaultApiBase(),
  apiBaseCandidates: defaultApiBaseCandidates(),
  discoveryUrl: window.CODEX_READER_DISCOVERY_URL || DISCOVERY_URL
};
