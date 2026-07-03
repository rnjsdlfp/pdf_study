const LOCAL_MACBOOK_API_BASE = "http://127.0.0.1:3001";

function readApiBaseOverride() {
  const params = new URLSearchParams(window.location.search);
  const fromQuery = params.get("apiBase");
  if (fromQuery) {
    localStorage.setItem("codexReaderApiBase", fromQuery);
    return fromQuery;
  }

  return localStorage.getItem("codexReaderApiBase") || window.CODEX_READER_API_BASE || "";
}

function defaultApiBase() {
  if (window.location.hostname.endsWith(".pages.dev")) {
    return LOCAL_MACBOOK_API_BASE;
  }
  return "";
}

window.CODEX_READER_CONFIG = {
  apiBase: readApiBaseOverride() || defaultApiBase()
};
