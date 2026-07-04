const state = {
  documents: [],
  currentDocument: null,
  pages: [],
  currentPage: 1,
  zoom: 1,
  responseLanguage: "English",
  analysisTab: "analysis",
  analysis: [],
  analysisJobs: new Map(),
  lastError: null,
  resultCharTarget: 400,
  customFollowUpQuestion: "",
  manualJobs: {
    explain: null,
    fact_check: null
  },
  followUpJobs: new Map(),
  manualJobTypes: new Map(),
  eventSources: new Map()
};

let activeApiBase = normalizeApiBase(window.CODEX_READER_CONFIG?.apiBase || "");
const API_BASE_CANDIDATES = uniqueApiBases([
  activeApiBase,
  ...(window.CODEX_READER_CONFIG?.apiBaseCandidates || [])
]);
const API_DISCOVERY_URL = normalizeApiBase(window.CODEX_READER_CONFIG?.discoveryUrl || "");
const APP_API_BASE_STORAGE_KEY = window.CODEX_READER_CONFIG?.apiBaseStorageKey || "codexReaderApiBaseV2";
const FORCE_API_DISCOVERY = Boolean(window.CODEX_READER_CONFIG?.forceDiscovery);
const PREFER_SAME_ORIGIN_API = Boolean(window.CODEX_READER_CONFIG?.preferSameOriginApi);
const APP_BUILD_VERSION = "20260704-queue-followup-persist-v1";
const ACTIVE_PROMPT_VERSION = "2026-07-03-default-followup-style";
const DEFAULT_FOLLOW_UP_QUESTIONS = Object.freeze({
  English: [
    "Find any logical errors or contradictions in the whole content and explain them objectively.",
    "From a Devil's Advocate perspective, rebut the main points of this content one by one.",
    "Explain the whole content simply at a level a middle-school student can understand."
  ],
  Korean: [
    "전체 내용에서 논리적 오류 또는 상충되는 부분을 찾아 객관적으로 설명해주세요",
    "Devil's Advocate 관점에서 이 내용의 주요 내용을 하나하나 반박해주세요",
    "전체 내용을 중학생이 이해할 수 있는 수준으로 쉽게 설명해주세요"
  ]
});
let discoveryCheckedAt = 0;
let discoveryPromise = null;
let discoveryForcedOnce = false;
let discoveredDirectApiBase = "";
let statusErrorShown = false;
let codexLoginErrorShown = false;
const activeToasts = new Map();

const els = {
  documentTitle: document.getElementById("documentTitle"),
  serverStatus: document.getElementById("serverStatus"),
  codexStatus: document.getElementById("codexStatus"),
  tunnelStatus: document.getElementById("tunnelStatus"),
  queueStatus: document.getElementById("queueStatus"),
  analyzePageButton: document.getElementById("analyzePageButton"),
  analyzeDocumentButton: document.getElementById("analyzeDocumentButton"),
  uploadForm: document.getElementById("uploadForm"),
  pdfInput: document.getElementById("pdfInput"),
  pickPdfButton: document.getElementById("pickPdfButton"),
  urlForm: document.getElementById("urlForm"),
  urlInput: document.getElementById("urlInput"),
  documentList: document.getElementById("documentList"),
  prevPageButton: document.getElementById("prevPageButton"),
  nextPageButton: document.getElementById("nextPageButton"),
  pageIndicator: document.getElementById("pageIndicator"),
  searchInput: document.getElementById("searchInput"),
  zoomOutButton: document.getElementById("zoomOutButton"),
  zoomInButton: document.getElementById("zoomInButton"),
  pdfPreview: document.getElementById("pdfPreview"),
  viewerGrid: document.querySelector(".viewer-grid"),
  readerSurface: document.getElementById("readerSurface"),
  resultLengthInput: document.getElementById("resultLengthInput"),
  languageSelect: document.getElementById("languageSelect"),
  summarySection: document.getElementById("summarySection"),
  translationSection: document.getElementById("translationSection"),
  questionsSection: document.getElementById("questionsSection"),
  manualExplainInput: document.getElementById("manualExplainInput"),
  manualExplainButton: document.getElementById("manualExplainButton"),
  manualExplainOutput: document.getElementById("manualExplainOutput"),
  manualFactCheckInput: document.getElementById("manualFactCheckInput"),
  manualFactCheckButton: document.getElementById("manualFactCheckButton"),
  manualFactCheckOutput: document.getElementById("manualFactCheckOutput"),
  customFollowUpInput: document.getElementById("customFollowUpInput"),
  customFollowUpButton: document.getElementById("customFollowUpButton"),
  customFollowUpOutput: document.getElementById("customFollowUpOutput"),
  analysisTabButton: document.getElementById("analysisTabButton"),
  translationTabButton: document.getElementById("translationTabButton"),
  analysisContent: document.getElementById("analysisContent"),
  translationContent: document.getElementById("translationContent"),
  analysisProgress: document.getElementById("analysisProgress"),
  analysisProgressTitle: document.getElementById("analysisProgressTitle"),
  analysisProgressPercent: document.getElementById("analysisProgressPercent"),
  analysisProgressBar: document.getElementById("analysisProgressBar"),
  analysisProgressMeta: document.getElementById("analysisProgressMeta"),
  lastError: document.getElementById("lastError"),
  lastErrorMessage: document.getElementById("lastErrorMessage"),
  lastErrorDismissButton: document.getElementById("lastErrorDismissButton"),
  toastStack: document.getElementById("toastStack")
};

init();

function init() {
  setStatus(els.serverStatus, false, "Connecting", true);
  els.serverStatus.title = `Build: ${APP_BUILD_VERSION}\nStatus API: /api/system/status`;
  bindEvents();
  pollStatus();
  loadDocuments({ silentNetworkError: true });
  setInterval(pollStatus, 5000);
  setInterval(renderAnalysisProgress, 3000);
  setInterval(syncActiveJobs, 5000);
}

function bindEvents() {
  els.pickPdfButton.addEventListener("pointerdown", () => {
    els.pdfInput.value = "";
  });
  els.pickPdfButton.addEventListener("keydown", (event) => {
    if (event.defaultPrevented) {
      return;
    }
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      els.pdfInput.value = "";
      els.pdfInput.click();
    }
  });
  els.pdfInput.addEventListener("change", () => {
    const file = els.pdfInput.files[0];
    if (file) {
      uploadPdf(file);
    }
  });
  window.__CODEX_READER_APP_UPLOAD_HANDLER_ACTIVE = true;

  bindPdfDropTarget(els.uploadForm);
  bindPdfDropTarget(els.pickPdfButton);

  els.urlForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    const url = els.urlInput.value.trim();
    if (!url) {
      return;
    }
    await importWebpage(url);
  });

  els.analyzePageButton.addEventListener("click", () => createAnalysisJob("page"));
  els.analyzeDocumentButton.addEventListener("click", () => createAnalysisJob("document"));
  els.prevPageButton.addEventListener("click", () => setPage(state.currentPage - 1));
  els.nextPageButton.addEventListener("click", () => setPage(state.currentPage + 1));
  els.searchInput.addEventListener("input", renderReader);
  els.zoomOutButton.addEventListener("click", () => setZoom(state.zoom - 0.08));
  els.zoomInButton.addEventListener("click", () => setZoom(state.zoom + 0.08));

  els.manualExplainInput.addEventListener("input", renderManualTools);
  els.manualFactCheckInput.addEventListener("input", renderManualTools);
  els.manualExplainButton.addEventListener("click", () => createManualJob("explain"));
  els.manualFactCheckButton.addEventListener("click", () => createManualJob("fact_check"));
  els.customFollowUpInput?.addEventListener("input", renderCustomFollowUpControls);
  els.customFollowUpButton?.addEventListener("click", createCustomFollowUpJob);
  els.resultLengthInput?.addEventListener("input", () => {
    state.resultCharTarget = resultCharTarget();
  });
  els.languageSelect.addEventListener("change", () => {
    state.responseLanguage = els.languageSelect.value === "Korean" ? "Korean" : "English";
    renderAnalysisPanel();
  });
  els.analysisTabButton.addEventListener("click", () => setAnalysisTab("analysis"));
  els.translationTabButton.addEventListener("click", () => setAnalysisTab("translation"));
  els.lastErrorDismissButton?.addEventListener("click", clearLastError);
}

function bindPdfDropTarget(target) {
  if (!target) {
    return;
  }
  target.addEventListener("dragenter", handlePdfDragEnter);
  target.addEventListener("dragover", handlePdfDragOver);
  target.addEventListener("dragleave", handlePdfDragLeave);
  target.addEventListener("drop", handlePdfDrop);
}

function handlePdfDragEnter(event) {
  if (!isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  setPdfDropActive(true);
}

function handlePdfDragOver(event) {
  if (!isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = "copy";
  }
  setPdfDropActive(true);
}

function handlePdfDragLeave(event) {
  if (!isFileDrag(event)) {
    return;
  }
  if (event.currentTarget?.contains(event.relatedTarget)) {
    return;
  }
  setPdfDropActive(false);
}

function handlePdfDrop(event) {
  if (!isFileDrag(event)) {
    return;
  }
  event.preventDefault();
  event.stopPropagation();
  setPdfDropActive(false);
  const file = pdfFileFromDrop(event.dataTransfer);
  if (!file) {
    toast("Drop a PDF file.");
    return;
  }
  uploadPdf(file);
}

function isFileDrag(event) {
  const types = [...(event.dataTransfer?.types || [])];
  return types.length === 0 || types.includes("Files");
}

function pdfFileFromDrop(dataTransfer) {
  return [...(dataTransfer?.files || [])].find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name || ""));
}

function setPdfDropActive(active) {
  els.uploadForm?.classList.toggle("dragging", active);
  els.pickPdfButton?.classList.toggle("drop-ready", active);
}

async function api(path, options = {}) {
  const { uploadRequest = false, ...fetchOptions } = options;
  let lastNetworkError = null;
  const attempted = new Set();

  async function tryApiBase(candidate) {
    if (attempted.has(candidate)) {
      return null;
    }
    attempted.add(candidate);

    let response;
    try {
      response = await fetch(apiUrl(path, candidate), {
        headers: {
          ...(fetchOptions.body && !(fetchOptions.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
          ...(fetchOptions.headers || {})
        },
        ...fetchOptions
      });
    } catch (error) {
      lastNetworkError = error;
      forgetApiBase(candidate);
      return null;
    }

    rememberApiBase(candidate);
    return response;
  }

  for (const candidate of await apiBaseCandidates()) {
    const response = await tryApiBase(candidate);
    if (response) {
      return parseApiResponse(response);
    }
  }

  const refreshedApiBase = await discoverApiBase({ force: true });
  if (refreshedApiBase) {
    const response = await tryApiBase(refreshedApiBase);
    if (response) {
      return parseApiResponse(response);
    }
  }

  throw networkFailureError(lastNetworkError, { uploadRequest });
}

async function parseApiResponse(response) {
  const text = await response.text();
  let payload = {};
  try {
    payload = text ? JSON.parse(text) : {};
  } catch {
    payload = { error: text || "The MacBook server returned an unreadable response." };
  }
  if (!response.ok) {
    throw new Error(readableHttpError(payload, text, response));
  }
  return payload;
}

function readableHttpError(payload, text, response) {
  const raw = String(payload?.error || text || "").trim();
  const title = extractHtmlTitle(raw);
  const detail = title || raw || response.statusText || "Request failed";
  return clipMessage(`Request failed with HTTP ${response.status}: ${detail}`);
}

function extractHtmlTitle(value) {
  const match = String(value || "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return match ? decodeHtmlEntities(match[1]).replace(/\s+/g, " ").trim() : "";
}

function decodeHtmlEntities(value) {
  return String(value || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#039;/g, "'");
}

function clipMessage(value, max = 520) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  return text.length > max ? `${text.slice(0, max - 3).trim()}...` : text;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    ...options
  });
  return parseApiResponse(response);
}

function networkFailureError(error, context = {}) {
  const next = new Error(networkFailureMessage(error, context));
  next.isNetworkError = true;
  return next;
}

function networkFailureMessage(error, context = {}) {
  const message = error?.message || "";
  if (/failed to fetch|networkerror|load failed/i.test(message)) {
    const base = [
      "Could not reach the MacBook server.",
      "On the MacBook, open ★CodexReader.command for local use or ★CodexReader Tunnel.command for other devices.",
      "If you opened this page on another device without the Tunnel launcher URL, 127.0.0.1 points to that device, not the MacBook."
    ];
    if (context.uploadRequest) {
      base.push("If this happened during upload, also check that the PDF is under the upload limit.");
    }
    return base.join(" ");
  }
  return message || "Network request failed.";
}

function apiUrl(path, base = activeApiBase) {
  if (!base) {
    return path;
  }
  return `${base}${path}`;
}

function rememberApiBase(candidate) {
  activeApiBase = candidate;
  if (candidate && window.location.hostname.endsWith(".pages.dev")) {
    localStorage.setItem(APP_API_BASE_STORAGE_KEY, candidate);
  }
}

function forgetApiBase(candidate) {
  if (!candidate) {
    return;
  }
  if (activeApiBase === candidate) {
    activeApiBase = "";
  }
  if (normalizeApiBase(localStorage.getItem(APP_API_BASE_STORAGE_KEY)) === candidate) {
    localStorage.removeItem(APP_API_BASE_STORAGE_KEY);
  }
}

function normalizeApiBase(value) {
  return String(value || "").replace(/\/$/, "");
}

function uniqueApiBases(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = normalizeApiBase(value);
    if (!seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

async function apiBaseCandidates() {
  if (PREFER_SAME_ORIGIN_API) {
    return uniqueApiBases(["", activeApiBase, ...API_BASE_CANDIDATES]);
  }

  const force = FORCE_API_DISCOVERY && !discoveryForcedOnce;
  discoveryForcedOnce = discoveryForcedOnce || force;
  const discovered = await discoverApiBase({ force });
  if (discovered) {
    return uniqueApiBases([discovered, activeApiBase, discoveredDirectApiBase, ...API_BASE_CANDIDATES]);
  }
  return uniqueApiBases([activeApiBase, ...API_BASE_CANDIDATES]);
}

async function discoverApiBase(options = {}) {
  const { force = false } = options;
  if (!API_DISCOVERY_URL || !window.location.hostname.endsWith(".pages.dev")) {
    return "";
  }

  if (!force && discoveryPromise && Date.now() - discoveryCheckedAt < 15000) {
    return discoveryPromise;
  }

  discoveryCheckedAt = Date.now();
  discoveryPromise = fetch(`${API_DISCOVERY_URL}/current`, { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) {
        return "";
      }
      const payload = await response.json();
      const directApiBase = normalizeApiBase(payload?.ok ? payload.apiBase : "");
      const apiBase = normalizeApiBase(payload?.ok ? payload.proxyBase || payload.apiBase : "");
      discoveredDirectApiBase = directApiBase && directApiBase !== apiBase ? directApiBase : "";
      if (apiBase) {
        localStorage.setItem(APP_API_BASE_STORAGE_KEY, apiBase);
      }
      return apiBase;
    })
    .catch(() => "");
  return discoveryPromise;
}

async function pollStatus() {
  try {
    const status = PREFER_SAME_ORIGIN_API ? await fetchJson("/api/system/status") : await api("/api/system/status");
    setStatus(els.serverStatus, true, "MacBook active");
    els.serverStatus.title = `Connected through /api/system/status\nBuild: ${APP_BUILD_VERSION}`;
    statusErrorShown = false;
    if (status.codex_mode === "mock") {
      setStatus(els.codexStatus, false, "Codex mock mode", true);
    } else {
      els.codexStatus.title = status.codex_command
        ? `Codex CLI: ${status.codex_command}${status.codex_model ? `\nModel: ${status.codex_model}` : ""}`
        : "Run ★Install Codex CLI.command on the MacBook.";
      setStatus(
        els.codexStatus,
        status.codex_cli_available,
        status.codex_cli_available ? "Codex ready" : "Codex CLI not found"
      );
    }
    if (status.codex_mode === "mock") {
      codexLoginErrorShown = false;
    } else if (!status.codex_cli_available) {
      codexLoginErrorShown = false;
    } else {
      els.codexStatus.title = [
        `Codex CLI: ${status.codex_command || "found"}`,
        status.codex_model ? `Model: ${status.codex_model}` : "",
        status.codex_login_status ? `Login: ${status.codex_login_status}` : "",
        status.codex_auth_home ? `CODEX_HOME: ${status.codex_auth_home}` : ""
      ]
        .filter(Boolean)
        .join("\n");
      if (status.codex_login_ok === false) {
        setStatus(els.codexStatus, false, "Codex login needed");
        if (!codexLoginErrorShown) {
          codexLoginErrorShown = true;
          reportError(
            new Error(`Codex CLI is not logged in. CODEX_HOME: ${status.codex_auth_home || "unknown"}`),
            "Codex login needed",
            { key: "codex-login-needed" }
          );
        }
      } else {
        codexLoginErrorShown = false;
        setStatus(els.codexStatus, true, status.codex_web_search_ok ? "Codex ready" : "Codex ready, no search");
      }
    }
    setStatus(els.tunnelStatus, status.cloudflare_tunnel_ok, status.cloudflare_tunnel_ok ? "Tunnel online" : "Tunnel offline", true);
    const running = status.queue.running || 0;
    const queued = status.queue.queued || 0;
    const queueText = running || queued ? `Queue ${running} running / ${queued} queued` : "Queue idle";
    setStatus(els.queueStatus, running || queued, queueText, true);
  } catch (error) {
    setStatus(els.serverStatus, false, "MacBook offline");
    els.serverStatus.title = `Status check failed: ${error.message || error}\nAPI: /api/system/status\nBuild: ${APP_BUILD_VERSION}`;
    console.error("Jireh's Deep Study status check failed", error);
    if (!statusErrorShown) {
      statusErrorShown = true;
      reportError(error, "Status check failed", { key: "status-check" });
    }
  }
}

function setStatus(element, ok, text, warnWhenFalse = false) {
  element.classList.remove("ok", "warn", "bad");
  element.classList.add(ok ? "ok" : warnWhenFalse ? "warn" : "bad");
  element.lastChild.textContent = text;
}

async function loadDocuments(options = {}) {
  try {
    const payload = await api("/api/documents");
    state.documents = payload.documents || [];
    renderDocuments();
    if (!state.currentDocument && state.documents.length > 0) {
      await selectDocument(state.documents[0].id);
    }
  } catch (error) {
    if (options.silentNetworkError && error.isNetworkError) {
      return;
    }
    reportError(error, "Documents failed");
  }
}

function renderDocuments() {
  els.documentList.innerHTML = "";
  for (const documentRecord of state.documents) {
    const row = document.createElement("div");
    row.className = `document-row ${state.currentDocument?.id === documentRecord.id ? "active" : ""}`;
    row.innerHTML = `
      <button class="document-open" type="button">
        <div class="document-row-title">${escapeHtml(documentRecord.title)}</div>
        <div class="document-row-meta">${escapeHtml(documentRecord.source_type)} - ${documentRecord.page_count || 1} page</div>
      </button>
      <button class="document-delete" type="button" title="Delete document" aria-label="Delete ${escapeAttribute(documentRecord.title)}">
        <svg viewBox="0 0 24 24"><path d="M3 6h18" /><path d="M8 6V4h8v2" /><path d="M10 11v6" /><path d="M14 11v6" /><path d="M6 6l1 15h10l1-15" /></svg>
      </button>
    `;
    row.querySelector(".document-open").addEventListener("click", () => selectDocument(documentRecord.id));
    row.querySelector(".document-delete").addEventListener("click", (event) =>
      deleteDocument(documentRecord.id, documentRecord.title, event)
    );
    els.documentList.appendChild(row);
  }
}

async function selectDocument(documentId) {
  const payload = await api(`/api/documents/${documentId}`);
  state.currentDocument = payload.document;
  state.pages = payload.pages || [];
  state.currentPage = 1;
  state.responseLanguage = "English";
  els.languageSelect.value = state.responseLanguage;
  state.analysisTab = "analysis";
  resetManualJobs();
  els.documentTitle.textContent = state.currentDocument.title;
  els.analyzePageButton.disabled = false;
  els.analyzeDocumentButton.disabled = false;
  renderDocuments();
  renderReader();
  await refreshPanels();
}

async function deleteDocument(documentId, title, event) {
  event.stopPropagation();
  if (!window.confirm(`Delete "${title}"?`)) {
    return;
  }

  try {
    await api(`/api/documents/${documentId}`, { method: "DELETE" });
    toast("Document deleted.");
    if (state.currentDocument?.id === documentId) {
      state.currentDocument = null;
      state.pages = [];
      state.currentPage = 1;
      state.analysis = [];
      state.analysisJobs = new Map();
      resetManualJobs();
      els.documentTitle.textContent = "No document selected";
    }
    await loadDocuments();
    if (!state.currentDocument) {
      renderReader();
      renderAnalysisPanel();
    }
  } catch (error) {
    reportError(error, "Delete failed");
  }
}

function setPage(pageNumber) {
  if (!state.currentDocument) {
    return;
  }
  state.currentPage = Math.max(1, Math.min(pageNumber, state.currentDocument.page_count || 1));
  renderReader();
}

function setZoom(value) {
  state.zoom = Math.max(0.82, Math.min(value, 1.42));
  document.documentElement.style.setProperty("--reader-scale", state.zoom.toFixed(2));
}

async function uploadPdf(file) {
  try {
    window.__CODEX_READER_APP_LAST_UPLOAD_FILE_SIGNATURE = [file.name, file.size, file.lastModified].join(":");
    toast(`Uploading PDF: ${file.name}`);
    const form = new FormData();
    form.append("file", file);
    const payload = await api("/api/documents", {
      method: "POST",
      body: form,
      uploadRequest: true
    });
    toast(payload.cache_hit ? "Opened cached PDF." : "PDF uploaded.");
    els.pdfInput.value = "";
    await loadDocuments();
    await selectDocument(payload.document.id);
  } catch (error) {
    reportError(error, "Upload failed", { key: `upload:${file?.name || ""}` });
  }
}

async function importWebpage(url) {
  try {
    const payload = await api("/api/webpages", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    els.urlInput.value = "";
    toast("Webpage imported.");
    await loadDocuments();
    await selectDocument(payload.document.id);
  } catch (error) {
    reportError(error, "Webpage import failed");
  }
}

function renderReader() {
  const doc = state.currentDocument;
  if (!doc) {
    els.viewerGrid.classList.remove("pdf-mode");
    els.readerSurface.innerHTML = `
      <div class="empty-state">
        <div class="empty-mark" aria-hidden="true"></div>
        <h1>Ready</h1>
        <p>Upload a PDF or import a webpage.</p>
      </div>
    `;
    els.pdfPreview.classList.remove("active");
    els.pdfPreview.removeAttribute("src");
    els.pageIndicator.textContent = "Page 0 / 0";
    return;
  }

  const page = state.pages.find((item) => item.page_number === state.currentPage) || state.pages[0];
  const pageCount = doc.page_count || state.pages.length || 1;
  els.pageIndicator.textContent = `Page ${state.currentPage} / ${pageCount}`;
  els.prevPageButton.disabled = state.currentPage <= 1;
  els.nextPageButton.disabled = state.currentPage >= pageCount;

  if (doc.source_type === "pdf" && doc.local_path) {
    els.viewerGrid.classList.add("pdf-mode");
    els.pdfPreview.classList.add("active");
    els.pdfPreview.src = `${apiUrl(`/api/documents/${doc.id}/file`)}#page=${state.currentPage}`;
    els.readerSurface.innerHTML = "";
    return;
  } else {
    els.viewerGrid.classList.remove("pdf-mode");
    els.pdfPreview.classList.remove("active");
    els.pdfPreview.removeAttribute("src");
  }

  const text = page?.text || doc.status_message || "No extracted text available.";
  const highlighted = highlight(escapeHtml(text), escapeHtml(els.searchInput.value.trim()));
  els.readerSurface.innerHTML = `
    <div class="page-label">${escapeHtml(doc.source_type)} - ${escapeHtml(doc.status || "ready")}</div>
    <div class="page-text" data-page="${state.currentPage}">${highlighted}</div>
  `;
}

async function createAnalysisJob(scope) {
  if (!state.currentDocument) {
    return;
  }
  try {
    state.analysisTab = "analysis";
    renderAnalysisPanel();
    const payload = await api(`/api/documents/${state.currentDocument.id}/analyze`, {
      method: "POST",
      body: JSON.stringify({
        scope,
        page_number: state.currentPage,
        start_page: 1,
        end_page: state.currentDocument.page_count || 1,
        output_language: state.responseLanguage,
        result_char_target: resultCharTarget()
      })
    });
    if (payload.job) {
      state.analysisJobs.set(payload.job.id, payload.job);
      renderAnalysisPanel();
    }
    toast(scope === "page" ? "Page analysis queued with Codex CLI." : "Document analysis queued with Codex CLI.");
    watchJob(payload.job.id);
  } catch (error) {
    reportError(error, scope === "page" ? "Page analysis failed" : "Document analysis failed");
  }
}

function resetManualJobs() {
  state.manualJobs = {
    explain: null,
    fact_check: null
  };
  state.followUpJobs = new Map();
  state.manualJobTypes = new Map();
  state.customFollowUpQuestion = "";
}

async function createManualJob(type) {
  if (!state.currentDocument) {
    return;
  }

  const input = type === "fact_check" ? els.manualFactCheckInput : els.manualExplainInput;
  const text = input.value.replace(/\s+/g, " ").trim();
  if (text.length < 8) {
    toast(type === "fact_check" ? "Enter a fact-check target first." : "Enter an explain target first.");
    input.focus();
    return;
  }

  try {
    const page = state.pages.find((item) => item.page_number === state.currentPage);
    const surroundingText = surrounding(page?.text || documentText(), text);
    const selectionPayload = await api("/api/selections", {
      method: "POST",
      body: JSON.stringify({
        document_id: state.currentDocument.id,
        page_number: state.currentPage,
        selection_text: text,
        surrounding_text: surroundingText,
        rects: []
      })
    });
    const jobPayload = await api(`/api/selections/${selectionPayload.selection.id}/jobs`, {
      method: "POST",
      body: JSON.stringify({
        type,
        output_language: state.responseLanguage,
        result_char_target: resultCharTarget(),
        rerun: true
      })
    });
    const job = withParsedClientJob({
      ...jobPayload.job,
      selection: selectionPayload.selection
    });
    state.manualJobs[type] = job;
    state.manualJobTypes.set(job.id, type);
    renderManualTools();
    toast(type === "fact_check" ? "Fact-check queued with Codex CLI." : "Explain queued with Codex CLI.");
    watchJob(jobPayload.job.id);
  } catch (error) {
    reportError(error, type === "fact_check" ? "Fact-check failed" : "Explain failed");
  }
}

async function createCustomFollowUpJob() {
  const question = els.customFollowUpInput.value.replace(/\s+/g, " ").trim();
  if (question.length < 8) {
    toast("Enter a follow-up prompt first.");
    els.customFollowUpInput.focus();
    return;
  }
  state.customFollowUpQuestion = question;
  renderCustomFollowUpControls();
  await createFollowUpJob(question);
}

async function createFollowUpJob(question) {
  if (!state.currentDocument || !question) {
    return;
  }

  try {
    const selectionPayload = await api("/api/selections", {
      method: "POST",
      body: JSON.stringify({
        document_id: state.currentDocument.id,
        page_number: state.currentPage,
        selection_text: question,
        surrounding_text: "Follow-up question answer request. Use the full extracted document text on the server.",
        rects: []
      })
    });
    const jobPayload = await api(`/api/selections/${selectionPayload.selection.id}/jobs`, {
      method: "POST",
      body: JSON.stringify({
        type: "follow_up_answer",
        output_language: state.responseLanguage,
        rerun: true
      })
    });
    const job = withParsedClientJob({
      ...jobPayload.job,
      selection: selectionPayload.selection
    });
    const sideJobKey = `follow_up:${question}`;
    state.followUpJobs.set(question, job);
    state.manualJobTypes.set(job.id, sideJobKey);
    renderAnalysisPanel();
    toast("Follow-up question queued with Codex CLI.");
    watchJob(job.id);
  } catch (error) {
    reportError(error, "Follow-up failed", { key: `follow-up:${question}` });
  }
}

function watchJob(jobId) {
  if (state.eventSources.has(jobId)) {
    return;
  }
  const source = new EventSource(apiUrl(`/api/jobs/${jobId}/events`));
  state.eventSources.set(jobId, source);
  source.addEventListener("job", async (event) => {
    const payload = JSON.parse(event.data);
    const job = payload.job ? withParsedClientJob(payload.job) : null;
    const sideJobKey = job ? state.manualJobTypes.get(job.id) : "";
    if (job && sideJobKey) {
      applySideJobUpdate(sideJobKey, job);
      renderSideJobUpdate(sideJobKey);
    } else if (job && !job.selection_id) {
      state.analysisJobs.set(job.id, job);
      renderAnalysisPanel();
    }
    if (job && isTerminalStatus(job.status)) {
      source.close();
      state.eventSources.delete(jobId);
      if (sideJobKey) {
        await refreshSideJob(job.id, sideJobKey);
      } else {
        await refreshPanels();
      }
    }
    pollStatus();
  });
  source.onerror = () => {
    source.close();
    state.eventSources.delete(jobId);
    syncActiveJobs();
  };
}

async function refreshPanels() {
  await refreshAnalysis();
  renderAnalysisPanel();
}

async function refreshAnalysis() {
  if (!state.currentDocument) {
    state.analysis = [];
    state.analysisJobs = new Map();
    return;
  }
  const payload = await api(`/api/documents/${state.currentDocument.id}/analysis`);
  state.analysis = payload.analysis || [];
  if (Array.isArray(payload.jobs)) {
    state.analysisJobs = new Map(payload.jobs.map((job) => [job.id, job]));
  }
}

async function refreshSideJob(jobId, sideJobKey) {
  const payload = await api(`/api/jobs/${jobId}`);
  applySideJobUpdate(sideJobKey, withParsedClientJob(payload.job));
  renderSideJobUpdate(sideJobKey);
}

async function syncActiveJobs() {
  if (!state.currentDocument) {
    return;
  }
  const activeAnalysis = [...state.analysisJobs.values()].some((job) => !job.selection_id && !isTerminalStatus(job.status));
  const activeSideJobs = [
    ...Object.entries(state.manualJobs),
    ...[...state.followUpJobs.entries()].map(([question, job]) => [`follow_up:${question}`, job])
  ].filter(([, job]) => job && !isTerminalStatus(job.status));
  if (!activeAnalysis && activeSideJobs.length === 0) {
    return;
  }

  try {
    if (activeAnalysis) {
      await refreshAnalysis();
      renderAnalysisPanel();
    }
    for (const [sideJobKey, job] of activeSideJobs) {
      await refreshSideJob(job.id, sideJobKey);
    }
  } catch {
    // Status polling already surfaces connection issues; keep progress UI from throwing.
  }
}

function applySideJobUpdate(sideJobKey, job) {
  if (sideJobKey.startsWith("follow_up:")) {
    const question = sideJobKey.slice("follow_up:".length);
    state.followUpJobs.set(question, {
      ...(state.followUpJobs.get(question) || {}),
      ...job
    });
    return;
  }
  state.manualJobs[sideJobKey] = {
    ...(state.manualJobs[sideJobKey] || {}),
    ...job
  };
}

function renderSideJobUpdate(sideJobKey) {
  if (sideJobKey.startsWith("follow_up:")) {
    renderAnalysisPanel();
    return;
  }
  renderManualTools();
}

function renderAnalysisPanel() {
  renderAnalysisTabs();
  renderAnalysisProgress();
  renderManualTools();
  renderCustomFollowUpControls();

  const latestJob = state.analysis[0] || null;
  const latest = latestJob?.result || null;
  const useKorean = state.responseLanguage === "Korean";
  els.summarySection.textContent = cleanDisplayText(useKorean
    ? latest?.summary_ko || latest?.summary_original || latest?.summary || state.currentDocument?.status_message || "Ready to analyze"
    : latest?.summary_original || latest?.summary || latest?.summary_ko || state.currentDocument?.status_message || "Ready to analyze");

  els.questionsSection.innerHTML = "";
  const resultQuestions = useKorean
    ? latest?.follow_up_questions_ko || latest?.follow_up_questions || latest?.follow_up_questions_original || []
    : latest?.follow_up_questions_original || latest?.follow_up_questions || latest?.follow_up_questions_ko || [];
  const useGeneratedQuestions = latest?.prompt_version === ACTIVE_PROMPT_VERSION && resultQuestions.length > 0;
  const baseQuestions = useGeneratedQuestions
    ? mergeQuestions([], resultQuestions)
    : mergeQuestions(DEFAULT_FOLLOW_UP_QUESTIONS[state.responseLanguage], []);
  const questions = mergeQuestions(baseQuestions, [...state.followUpJobs.keys()]);
  if (questions.length === 0) {
    const item = document.createElement("li");
    item.textContent = "Run Analyze Document to generate questions.";
    els.questionsSection.appendChild(item);
  }
  for (const question of questions) {
    const item = document.createElement("li");
    const cleanQuestion = cleanDisplayText(question);
    const button = document.createElement("button");
    button.className = "question-button";
    button.type = "button";
    button.textContent = cleanQuestion;
    button.addEventListener("click", () => createFollowUpJob(cleanQuestion));
    item.appendChild(button);
    const job = state.followUpJobs.get(cleanQuestion);
    if (job) {
      const output = document.createElement("div");
      output.className = "follow-up-answer";
      output.innerHTML = renderFollowUpAnswer(job);
      item.appendChild(output);
    }
    els.questionsSection.appendChild(item);
  }

  els.translationSection.textContent = cleanDisplayText(fullTextTranslation());
}

function mergeQuestions(defaultQuestions, resultQuestions) {
  const seen = new Set();
  const merged = [];
  for (const question of [...(defaultQuestions || []), ...(resultQuestions || [])]) {
    const cleanQuestion = cleanDisplayText(question);
    const key = cleanQuestion.toLowerCase();
    if (!cleanQuestion || seen.has(key)) {
      continue;
    }
    seen.add(key);
    merged.push(cleanQuestion);
  }
  return merged;
}

function renderAnalysisTabs() {
  const translationActive = state.analysisTab === "translation";
  els.analysisContent.hidden = translationActive;
  els.translationContent.hidden = !translationActive;
  els.analysisTabButton.classList.toggle("active", !translationActive);
  els.translationTabButton.classList.toggle("active", translationActive);
  els.analysisTabButton.setAttribute("aria-selected", String(!translationActive));
  els.translationTabButton.setAttribute("aria-selected", String(translationActive));
}

function setAnalysisTab(tab) {
  state.analysisTab = tab === "translation" ? "translation" : "analysis";
  renderAnalysisPanel();
}

function fullTextTranslation() {
  const documentJob = state.analysis.find((job) => job.type === "document_analysis" && job.result);
  const result = (documentJob || state.analysis[0])?.result || null;
  if (!result) {
    return "Run Analyze Document to generate full-text translation.";
  }
  return result.full_text_translation_ko || result.translation_ko || "No full-text translation returned.";
}

function renderAnalysisProgress() {
  const jobs = [...state.analysisJobs.values()].filter((job) => !job.selection_id);
  const latestJob = jobs.sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))[0];
  if (!latestJob) {
    els.analysisProgress.hidden = true;
    return;
  }

  const progress = latestJob.progress || estimateClientProgress(latestJob);
  const percent = Math.max(0, Math.min(100, Number(progress.percent || 0)));
  els.analysisProgress.hidden = false;
  els.analysisProgressTitle.textContent = progressTitle(latestJob);
  els.analysisProgressPercent.textContent = `${percent}%`;
  els.analysisProgressBar.style.width = `${percent}%`;
  els.analysisProgressMeta.textContent = progressMeta(latestJob, progress);
  els.analysisProgress.classList.toggle("done", latestJob.status === "done");
  els.analysisProgress.classList.toggle(
    "failed",
    ["failed", "failed_schema", "cancelled"].includes(latestJob.status)
  );
}

function estimateClientProgress(job) {
  if (job.status === "done") {
    return { percent: 100, label: job.cache_hit ? "Loaded from cache" : "Complete" };
  }
  if (["failed", "failed_schema", "cancelled"].includes(job.status)) {
    return { percent: 100, label: "Failed" };
  }
  if (job.status === "queued") {
    const createdAt = Date.parse(job.created_at || "");
    const elapsedSeconds = Number.isFinite(createdAt) ? Math.max(0, Math.round((Date.now() - createdAt) / 1000)) : 0;
    return { percent: Math.min(18, 8 + Math.floor(elapsedSeconds / 6)), label: "Queued" };
  }
  if (job.status === "running") {
    const startedAt = Date.parse(job.heartbeat_at || job.updated_at || job.created_at || "");
    const elapsedSeconds = Number.isFinite(startedAt) ? Math.max(0, Math.round((Date.now() - startedAt) / 1000)) : 0;
    return { percent: Math.min(92, 28 + Math.floor(elapsedSeconds * 3)), label: "Codex CLI analyzing" };
  }
  return { percent: 0, label: "Waiting" };
}

function progressTitle(job) {
  const scope = job.type === "document_analysis" ? "Document analysis" : "Page analysis";
  if (job.status === "done") {
    return `${scope} complete`;
  }
  if (["failed", "failed_schema", "cancelled"].includes(job.status)) {
    return `${scope} failed`;
  }
  return `${scope} in progress`;
}

function progressMeta(job, progress) {
  const payload = job.payload || parseJson(job.payload_json) || {};
  const pageRange =
    job.type === "document_analysis"
      ? `Pages ${payload.start_page || 1}-${payload.end_page || state.currentDocument?.page_count || 1}`
      : `Page ${payload.page_number || state.currentPage}`;
  if (job.error) {
    return job.error;
  }
  return `${progress.label || "Working"} - ${pageRange} - Codex CLI`;
}

function parseJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

function withParsedClientJob(job) {
  if (!job) {
    return null;
  }
  return {
    ...job,
    payload: job.payload || parseJson(job.payload_json) || {},
    result: job.result || parseJson(job.result_json) || {}
  };
}

function isTerminalStatus(status) {
  return ["done", "failed", "failed_schema", "cancelled"].includes(status);
}

function documentText() {
  return state.pages.map((page) => page.text || "").join("\n\n");
}

function resultCharTarget() {
  const value = Number(els.resultLengthInput?.value || state.resultCharTarget || 400);
  if (!Number.isFinite(value)) {
    return 400;
  }
  return Math.max(100, Math.min(2000, Math.round(value)));
}

function renderManualTools() {
  if (!els.manualExplainButton || !els.manualFactCheckButton) {
    return;
  }
  const hasDocument = Boolean(state.currentDocument);
  els.manualExplainButton.disabled = !hasDocument || els.manualExplainInput.value.trim().length < 8;
  els.manualFactCheckButton.disabled = !hasDocument || els.manualFactCheckInput.value.trim().length < 8;
  els.manualExplainOutput.innerHTML = renderManualJobResult("explain", state.manualJobs.explain);
  els.manualFactCheckOutput.innerHTML = renderManualJobResult("fact_check", state.manualJobs.fact_check);
}

function renderCustomFollowUpControls() {
  if (!els.customFollowUpButton || !els.customFollowUpInput || !els.customFollowUpOutput) {
    return;
  }
  const prompt = els.customFollowUpInput.value.replace(/\s+/g, " ").trim();
  els.customFollowUpButton.disabled = !state.currentDocument || prompt.length < 8;
  const question = state.customFollowUpQuestion;
  const job = question ? state.followUpJobs.get(question) : null;
  if (!job) {
    els.customFollowUpOutput.hidden = true;
    els.customFollowUpOutput.innerHTML = "";
    return;
  }
  els.customFollowUpOutput.hidden = false;
  els.customFollowUpOutput.innerHTML = renderFollowUpAnswer(job);
}

function renderManualJobResult(type, job) {
  if (!job) {
    return `<div class="manual-placeholder">${type === "fact_check" ? "No fact-check result yet." : "No explanation yet."}</div>`;
  }
  const result = job.result || {};
  const status = escapeHtml(job.status || "queued");
  if (!isTerminalStatus(job.status)) {
    const progress = job.progress || estimateClientProgress(job);
    return `
      <span class="job-status ${status}">${status}</span>
      <div>${escapeHtml(progress.label || "Working")} - ${Math.max(0, Math.min(100, Number(progress.percent || 0)))}%</div>
    `;
  }
  if (job.error) {
    return `<span class="job-status ${status}">${status}</span>${renderReadableText(job.error)}`;
  }
  if (type === "fact_check") {
    return `
      <span class="job-status ${status}">${status}</span>
      <strong>${escapeHtml(cleanDisplayText(result.verdict || "unclear"))}</strong>
      ${renderReadableText(result.explanation_ko || "")}
      ${renderManualSources(result.sources || [])}
    `;
  }
  const text = state.responseLanguage === "Korean"
    ? result.explanation_ko || result.explanation_original || ""
    : result.explanation_original || result.explanation_ko || "";
  return `
    <span class="job-status ${status}">${status}</span>
    ${renderReadableText(text || "No explanation returned.")}
  `;
}

function renderFollowUpAnswer(job) {
  if (!job) {
    return "";
  }
  const status = escapeHtml(job.status || "queued");
  if (!isTerminalStatus(job.status)) {
    const progress = job.progress || estimateClientProgress(job);
    return `
      <span class="job-status ${status}">${status}</span>
      <div>${escapeHtml(progress.label || "Working")} - ${Math.max(0, Math.min(100, Number(progress.percent || 0)))}%</div>
    `;
  }
  if (job.error) {
    return `<span class="job-status ${status}">${status}</span>${renderReadableText(job.error)}`;
  }
  const result = job.result || {};
  return `
    <span class="job-status ${status}">${status}</span>
    ${renderReadableText(result.answer || "No answer returned.")}
    ${renderManualSources(result.sources || [])}
  `;
}

function renderManualSources(sources) {
  if (!sources.length) {
    return "";
  }
  const items = sources
    .slice(0, 4)
    .map((source) => {
      const title = cleanDisplayText(source.title || source.url || "Source");
      const url = source.url || "";
      const publisher = cleanDisplayText(source.publisher || "");
      return `
        <li>
          ${
            url
              ? `<a href="${escapeAttribute(url)}" target="_blank" rel="noreferrer">${escapeHtml(title)}</a>`
              : escapeHtml(title)
          }
          ${publisher ? `<span>${escapeHtml(publisher)}</span>` : ""}
        </li>
      `;
    })
    .join("");
  return `<ol class="manual-source-list">${items}</ol>`;
}

function renderReadableText(value) {
  const text = String(value || "")
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  if (!text) {
    return `<div class="readable-text"><p>${escapeHtml("No response returned.")}</p></div>`;
  }

  const lines = text
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  let html = "";
  let openList = "";

  function closeList() {
    if (openList) {
      html += `</${openList}>`;
      openList = "";
    }
  }

  function open(tag) {
    if (openList !== tag) {
      closeList();
      html += `<${tag}>`;
      openList = tag;
    }
  }

  for (const line of lines) {
    const bullet = line.match(/^[-*\u2022]\s+(.+)$/);
    if (bullet) {
      open("ul");
      html += `<li>${renderInlineReadable(bullet[1])}</li>`;
      continue;
    }

    const numbered = line.match(/^\d+[.)]\s+(.+)$/);
    if (numbered) {
      open("ol");
      html += `<li>${renderInlineReadable(numbered[1])}</li>`;
      continue;
    }

    closeList();
    if (isReadableHeading(line)) {
      html += `<h4>${renderInlineReadable(line.replace(/:\s*$/, ""))}</h4>`;
      continue;
    }
    html += `<p>${renderInlineReadableWithLabel(line)}</p>`;
  }
  closeList();
  return `<div class="readable-text">${html}</div>`;
}

function isReadableHeading(line) {
  return /^[^:]{2,72}:\s*$/.test(line) && !/https?:\/\//i.test(line);
}

function renderInlineReadableWithLabel(line) {
  const match = line.match(/^([^:\n]{2,56}):\s+(.+)$/);
  if (match && !/https?:\/\//i.test(match[1]) && match[1].trim().split(/\s+/).length <= 8) {
    return `<strong>${renderInlineReadable(match[1])}:</strong> ${renderInlineReadable(match[2])}`;
  }
  return renderInlineReadable(line);
}

function renderInlineReadable(value) {
  return escapeHtml(String(value || "")).replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
}

function highlight(html, query) {
  if (!query) {
    return html;
  }
  const escaped = query.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return html.replace(new RegExp(escaped, "gi"), (match) => `<mark>${match}</mark>`);
}

function surrounding(text, selection) {
  const index = text.indexOf(selection);
  if (index === -1) {
    return text.slice(0, 1400);
  }
  return text.slice(Math.max(0, index - 700), Math.min(text.length, index + selection.length + 700));
}

function reportError(error, context = "Error", options = {}) {
  const detail = errorMessage(error);
  const message = detail.startsWith(`${context}:`) ? detail : `${context}: ${detail}`;
  state.lastError = {
    message,
    at: new Date().toLocaleTimeString()
  };
  renderLastError();
  console.error(message, error);
  toast(message, {
    type: "error",
    key: options.key || `error:${context}:${detail}`,
    duration: options.duration || 10000
  });
}

function errorMessage(error) {
  return clipMessage(error?.message || error || "Unknown error");
}

function renderLastError() {
  if (!els.lastError || !els.lastErrorMessage) {
    return;
  }
  if (!state.lastError) {
    els.lastError.hidden = true;
    els.lastErrorMessage.textContent = "";
    return;
  }
  els.lastError.hidden = false;
  els.lastErrorMessage.textContent = `${state.lastError.message} (${state.lastError.at})`;
}

function clearLastError() {
  state.lastError = null;
  renderLastError();
}

function toast(message, options = {}) {
  const text = clipMessage(message);
  if (!text || !els.toastStack) {
    return;
  }
  const key = options.key || normalizeToastKey(text);
  const existing = activeToasts.get(key);
  if (existing && existing.element.isConnected) {
    existing.count += 1;
    existing.element.textContent = existing.count > 1 ? `${text} (${existing.count}x)` : text;
    window.clearTimeout(existing.timer);
    existing.timer = window.setTimeout(() => removeToast(key), options.duration || 6000);
    return;
  }

  const item = document.createElement("div");
  item.className = `toast ${options.type || ""}`.trim();
  item.dataset.toastKey = key;
  item.textContent = text;
  els.toastStack.appendChild(item);
  activeToasts.set(key, {
    element: item,
    count: 1,
    timer: window.setTimeout(() => removeToast(key), options.duration || 6000)
  });
  trimToastStack();
}

function removeToast(key) {
  const toastRecord = activeToasts.get(key);
  if (toastRecord) {
    toastRecord.element.remove();
    activeToasts.delete(key);
  }
}

function trimToastStack() {
  while (els.toastStack.children.length > 3) {
    const first = els.toastStack.firstElementChild;
    if (!first) {
      return;
    }
    const key = first.dataset.toastKey || "";
    first.remove();
    if (key) {
      activeToasts.delete(key);
    }
  }
}

function normalizeToastKey(value) {
  return String(value || "").replace(/\s+/g, " ").trim().toLowerCase().slice(0, 240);
}

function cleanDisplayText(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#096;");
}
