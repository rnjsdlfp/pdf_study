const state = {
  documents: [],
  currentDocument: null,
  pages: [],
  currentPage: 1,
  selectedText: "",
  selectedRange: null,
  zoom: 1,
  showKoreanSidebar: false,
  analysisTab: "analysis",
  analysis: [],
  analysisJobs: new Map(),
  selectionJobs: [],
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
const APP_BUILD_VERSION = "20260703-selection-popup";
let discoveryCheckedAt = 0;
let discoveryPromise = null;
let discoveryForcedOnce = false;
let discoveredDirectApiBase = "";
let statusErrorShown = false;
let selectionTimer = null;

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
  selectionPopup: document.getElementById("selectionPopup"),
  explainButton: document.getElementById("explainButton"),
  factCheckButton: document.getElementById("factCheckButton"),
  translateButton: document.getElementById("translateButton"),
  summarySection: document.getElementById("summarySection"),
  termsSection: document.getElementById("termsSection"),
  translationSection: document.getElementById("translationSection"),
  questionsSection: document.getElementById("questionsSection"),
  selectionJobsSection: document.getElementById("selectionJobsSection"),
  analysisTabButton: document.getElementById("analysisTabButton"),
  translationTabButton: document.getElementById("translationTabButton"),
  analysisContent: document.getElementById("analysisContent"),
  translationContent: document.getElementById("translationContent"),
  analysisProgress: document.getElementById("analysisProgress"),
  analysisProgressTitle: document.getElementById("analysisProgressTitle"),
  analysisProgressPercent: document.getElementById("analysisProgressPercent"),
  analysisProgressBar: document.getElementById("analysisProgressBar"),
  analysisProgressMeta: document.getElementById("analysisProgressMeta"),
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

  els.uploadForm.addEventListener("dragover", (event) => {
    event.preventDefault();
    els.uploadForm.classList.add("dragging");
  });
  els.uploadForm.addEventListener("dragleave", () => els.uploadForm.classList.remove("dragging"));
  els.uploadForm.addEventListener("drop", (event) => {
    event.preventDefault();
    els.uploadForm.classList.remove("dragging");
    const file = [...event.dataTransfer.files].find((item) => item.type === "application/pdf" || /\.pdf$/i.test(item.name));
    if (file) {
      uploadPdf(file);
    }
  });

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

  els.readerSurface.addEventListener("mouseup", scheduleSelectionPopup);
  els.readerSurface.addEventListener("pointerup", scheduleSelectionPopup);
  els.readerSurface.addEventListener("keyup", scheduleSelectionPopup);
  document.addEventListener("selectionchange", scheduleSelectionPopup);
  document.addEventListener("mousedown", (event) => {
    if (!els.selectionPopup.contains(event.target)) {
      hideSelectionPopup();
    }
  });

  els.explainButton.addEventListener("click", () => createSelectionJob("explain"));
  els.factCheckButton.addEventListener("click", () => createSelectionJob("fact_check"));
  els.analysisTabButton.addEventListener("click", () => setAnalysisTab("analysis"));
  els.translationTabButton.addEventListener("click", () => setAnalysisTab("translation"));
  els.translateButton.addEventListener("click", () => {
    state.showKoreanSidebar = !state.showKoreanSidebar;
    renderAnalysisPanel();
  });
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
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
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
    setStatus(els.tunnelStatus, status.cloudflare_tunnel_ok, status.cloudflare_tunnel_ok ? "Tunnel online" : "Tunnel offline", true);
    const running = status.queue.running || 0;
    const queued = status.queue.queued || 0;
    const queueText = running || queued ? `Queue ${running} running / ${queued} queued` : "Queue idle";
    setStatus(els.queueStatus, running || queued, queueText, true);
  } catch (error) {
    setStatus(els.serverStatus, false, "MacBook offline");
    els.serverStatus.title = `Status check failed: ${error.message || error}\nAPI: /api/system/status\nBuild: ${APP_BUILD_VERSION}`;
    console.error("Codex Reader status check failed", error);
    if (!statusErrorShown) {
      statusErrorShown = true;
      toast(`Status check failed: ${error.message || error}`);
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
    toast(error.message);
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
  state.showKoreanSidebar = false;
  state.analysisTab = "analysis";
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
      state.selectionJobs = [];
      els.documentTitle.textContent = "No document selected";
    }
    await loadDocuments();
    if (!state.currentDocument) {
      renderReader();
      renderAnalysisPanel();
    }
  } catch (error) {
    toast(error.message);
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
    toast(error.message);
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
    toast(error.message);
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
    const text = page?.text || doc.status_message || "No extracted text available.";
    const highlighted = highlight(escapeHtml(cleanDisplayText(text)), escapeHtml(els.searchInput.value.trim()));
    els.readerSurface.innerHTML = `
      <div class="page-label">PDF text - page ${state.currentPage}</div>
      <div class="page-text" data-page="${state.currentPage}">${highlighted}</div>
    `;
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
        end_page: state.currentDocument.page_count || 1
      })
    });
    if (payload.job) {
      state.analysisJobs.set(payload.job.id, payload.job);
      renderAnalysisPanel();
    }
    toast(scope === "page" ? "Page analysis queued with Codex CLI." : "Document analysis queued with Codex CLI.");
    watchJob(payload.job.id);
  } catch (error) {
    toast(error.message);
  }
}

function scheduleSelectionPopup() {
  window.clearTimeout(selectionTimer);
  selectionTimer = window.setTimeout(handleSelection, 80);
}

function handleSelection() {
  const selection = window.getSelection();
  const text = selection ? selection.toString().replace(/\s+/g, " ").trim() : "";
  if (!selection || text.length < 8 || !isReaderSelection(selection)) {
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = selectionRect(range);
  if (!rect) {
    return;
  }
  state.selectedText = text.slice(0, 4000);
  state.selectedRange = range.cloneRange();
  const estimatedWidth = window.innerWidth < 520 ? window.innerWidth - 24 : 310;
  const top = Math.max(72, rect.top - 48);
  const left = Math.min(window.innerWidth - estimatedWidth - 12, Math.max(12, rect.left));
  els.selectionPopup.style.top = `${top}px`;
  els.selectionPopup.style.left = `${left}px`;
  els.selectionPopup.hidden = false;
}

function isReaderSelection(selection) {
  const anchorInReader = selection.anchorNode && els.readerSurface.contains(selection.anchorNode);
  const focusInReader = selection.focusNode && els.readerSurface.contains(selection.focusNode);
  if (anchorInReader || focusInReader) {
    return true;
  }
  if (selection.rangeCount === 0) {
    return false;
  }
  return els.readerSurface.contains(selection.getRangeAt(0).commonAncestorContainer);
}

function selectionRect(range) {
  const rects = [...range.getClientRects()].filter((rect) => rect.width > 0 && rect.height > 0);
  if (rects.length > 0) {
    return rects[0];
  }
  const rect = range.getBoundingClientRect();
  return rect.width > 0 && rect.height > 0 ? rect : null;
}

function hideSelectionPopup() {
  els.selectionPopup.hidden = true;
}

async function createSelectionJob(type) {
  if (!state.currentDocument || !state.selectedText) {
    return;
  }
  try {
    const page = state.pages.find((item) => item.page_number === state.currentPage);
    const surroundingText = surrounding(page?.text || "", state.selectedText);
    const selectionPayload = await api("/api/selections", {
      method: "POST",
      body: JSON.stringify({
        document_id: state.currentDocument.id,
        page_number: state.currentPage,
        selection_text: state.selectedText,
        surrounding_text: surroundingText,
        rects: []
      })
    });
    const jobPayload = await api(`/api/selections/${selectionPayload.selection.id}/jobs`, {
      method: "POST",
      body: JSON.stringify({ type })
    });
    hideSelectionPopup();
    window.getSelection()?.removeAllRanges();
    toast(type === "fact_check" ? "Fact-check queued." : "Explain queued.");
    watchJob(jobPayload.job.id);
    await refreshPanels();
  } catch (error) {
    toast(error.message);
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
    if (payload.job && !payload.job.selection_id) {
      state.analysisJobs.set(payload.job.id, payload.job);
      renderAnalysisPanel();
    }
    if (payload.job && ["done", "failed", "failed_schema", "cancelled"].includes(payload.job.status)) {
      source.close();
      state.eventSources.delete(jobId);
      await refreshPanels();
    } else if (payload.job?.selection_id) {
      await refreshSelectionJobs();
    }
    pollStatus();
  });
  source.onerror = () => {
    source.close();
    state.eventSources.delete(jobId);
  };
}

async function refreshPanels() {
  await Promise.all([refreshAnalysis(), refreshSelectionJobs()]);
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

async function refreshSelectionJobs() {
  if (!state.currentDocument) {
    state.selectionJobs = [];
    return;
  }
  const payload = await api(`/api/documents/${state.currentDocument.id}/selection-jobs`);
  state.selectionJobs = payload.jobs || [];
  renderSelectionJobs();
}

function renderAnalysisPanel() {
  renderAnalysisTabs();
  renderAnalysisProgress();

  const latestJob = state.analysis[0] || null;
  const latest = latestJob?.result || null;
  const useKorean = state.showKoreanSidebar;
  els.summarySection.textContent = cleanDisplayText(useKorean
    ? latest?.summary_ko || latest?.summary_original || latest?.summary || state.currentDocument?.status_message || "Ready to analyze"
    : latest?.summary_original || latest?.summary || latest?.summary_ko || state.currentDocument?.status_message || "Ready to analyze");

  els.termsSection.innerHTML = "";
  for (const term of latest?.terms || []) {
    const item = document.createElement("div");
    item.className = "term-item";
    const definition = useKorean
      ? term.definition_ko || term.definition_original || term.definition || ""
      : term.definition_original || term.definition || term.definition_ko || "";
    item.innerHTML = `<strong>${escapeHtml(cleanDisplayText(term.term || "Term"))}</strong>${escapeHtml(cleanDisplayText(definition))}`;
    els.termsSection.appendChild(item);
  }
  if (!latest?.terms?.length) {
    els.termsSection.textContent = latest ? "No terms returned." : "Run Analyze Document to generate terms.";
  }

  els.questionsSection.innerHTML = "";
  const questions = useKorean
    ? latest?.follow_up_questions_ko || latest?.follow_up_questions || latest?.follow_up_questions_original || []
    : latest?.follow_up_questions_original || latest?.follow_up_questions || latest?.follow_up_questions_ko || [];
  if (questions.length === 0) {
    const item = document.createElement("li");
    item.textContent = latest ? "No follow-up questions returned." : "Run Analyze Document to generate questions.";
    els.questionsSection.appendChild(item);
  }
  for (const question of questions) {
    const item = document.createElement("li");
    item.textContent = cleanDisplayText(question);
    els.questionsSection.appendChild(item);
  }

  els.translateButton.disabled = !latest;
  els.translateButton.textContent = state.showKoreanSidebar ? "Show Original" : "Translate Korean";
  els.translationSection.textContent = cleanDisplayText(fullTextTranslation());
  renderSelectionJobs();
}

function renderAnalysisTabs() {
  const translationActive = state.analysisTab === "translation";
  els.analysisContent.hidden = translationActive;
  els.translationContent.hidden = !translationActive;
  els.analysisTabButton.classList.toggle("active", !translationActive);
  els.translationTabButton.classList.toggle("active", translationActive);
  els.analysisTabButton.setAttribute("aria-selected", String(!translationActive));
  els.translationTabButton.setAttribute("aria-selected", String(translationActive));
  els.translateButton.hidden = translationActive;
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
    return { percent: 8, label: "Queued" };
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

function renderSelectionJobs() {
  els.selectionJobsSection.innerHTML = "";
  if (state.selectionJobs.length === 0) {
    els.selectionJobsSection.textContent = "No selection jobs";
    return;
  }

  for (const job of state.selectionJobs) {
    const result = job.result || {};
    const item = document.createElement("div");
    item.className = "job-item";
    item.innerHTML = `
      <span class="job-status ${escapeHtml(job.status)}">${escapeHtml(job.status)}</span>
      <strong>${escapeHtml(job.type.replaceAll("_", " "))}</strong>
      <div>${escapeHtml(cleanDisplayText(job.selection?.selection_text || "")).slice(0, 180)}</div>
      ${renderJobResult(job.type, result)}
    `;
    els.selectionJobsSection.appendChild(item);
  }
}

function renderJobResult(type, result) {
  if (!result || Object.keys(result).length === 0) {
    return "";
  }
  if (type === "selection_fact_check") {
    return `<div><strong>${escapeHtml(cleanDisplayText(result.verdict || "unclear"))}</strong>${escapeHtml(cleanDisplayText(result.explanation_ko || ""))}</div>`;
  }
  return `<div>${escapeHtml(cleanDisplayText(result.explanation_original || result.explanation_ko || result.summary_original || result.summary_ko || ""))}</div>`;
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

function toast(message) {
  const item = document.createElement("div");
  item.className = "toast";
  item.textContent = message;
  els.toastStack.appendChild(item);
  setTimeout(() => item.remove(), 4200);
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
