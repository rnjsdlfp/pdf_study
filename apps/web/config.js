window.CODEX_READER_CONFIG = {
  apiBase:
    localStorage.getItem("codexReaderApiBase") ||
    window.CODEX_READER_API_BASE ||
    ""
};
