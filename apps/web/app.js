const state = {
  documents: [],
  currentDocument: null,
  pages: [],
  currentPage: 1,
  selectedText: "",
  selectedRange: null,
  zoom: 1,
  showKoreanTranslation: false,
  analysis: [],
  selectionJobs: [],
  eventSources: new Map()
};

const API_BASE = String(window.CODEX_READER_CONFIG?.apiBase || "").replace(/\/$/, "");

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
  toastStack: document.getElementById("toastStack")
};

init();

function init() {
  bindEvents();
  pollStatus();
  loadDocuments();
  setInterval(pollStatus, 5000);
}

function bindEvents() {
  els.pickPdfButton.addEventListener("click", () => els.pdfInput.click());
  els.pdfInput.addEventListener("change", () => {
    const file = els.pdfInput.files[0];
    if (file) {
      uploadPdf(file);
    }
  });

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

  els.readerSurface.addEventListener("mouseup", handleSelection);
  document.addEventListener("mousedown", (event) => {
    if (!els.selectionPopup.contains(event.target)) {
      hideSelectionPopup();
    }
  });

  els.explainButton.addEventListener("click", () => createSelectionJob("explain"));
  els.factCheckButton.addEventListener("click", () => createSelectionJob("fact_check"));
  els.translateButton.addEventListener("click", () => {
    state.showKoreanTranslation = !state.showKoreanTranslation;
    renderAnalysisPanel();
  });
}

async function api(path, options = {}) {
  const response = await fetch(apiUrl(path), {
    headers: {
      ...(options.body && !(options.body instanceof FormData) ? { "Content-Type": "application/json" } : {}),
      ...(options.headers || {})
    },
    ...options
  });

  const text = await response.text();
  const payload = text ? JSON.parse(text) : {};
  if (!response.ok) {
    throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  }
  return payload;
}

function apiUrl(path) {
  if (!API_BASE) {
    return path;
  }
  return `${API_BASE}${path}`;
}

async function pollStatus() {
  try {
    const status = await api("/api/system/status");
    setStatus(els.serverStatus, true, "MacBook active");
    if (status.codex_mode === "mock") {
      setStatus(els.codexStatus, false, "Codex mock mode", true);
    } else {
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
  } catch {
    setStatus(els.serverStatus, false, "MacBook offline");
  }
}

function setStatus(element, ok, text, warnWhenFalse = false) {
  element.classList.remove("ok", "warn", "bad");
  element.classList.add(ok ? "ok" : warnWhenFalse ? "warn" : "bad");
  element.lastChild.textContent = text;
}

async function loadDocuments() {
  try {
    const payload = await api("/api/documents");
    state.documents = payload.documents || [];
    renderDocuments();
    if (!state.currentDocument && state.documents.length > 0) {
      await selectDocument(state.documents[0].id);
    }
  } catch (error) {
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
  state.showKoreanTranslation = false;
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
    const form = new FormData();
    form.append("file", file);
    const payload = await api("/api/documents", {
      method: "POST",
      body: form
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
    const payload = await api(`/api/documents/${state.currentDocument.id}/analyze`, {
      method: "POST",
      body: JSON.stringify({
        scope,
        page_number: state.currentPage,
        start_page: 1,
        end_page: state.currentDocument.page_count || 1
      })
    });
    toast(scope === "page" ? "Page analysis queued." : "Document analysis queued.");
    watchJob(payload.job.id);
  } catch (error) {
    toast(error.message);
  }
}

function handleSelection() {
  const selection = window.getSelection();
  const text = selection ? selection.toString().replace(/\s+/g, " ").trim() : "";
  if (!selection || text.length < 8 || !els.readerSurface.contains(selection.anchorNode)) {
    return;
  }

  const range = selection.getRangeAt(0);
  const rect = range.getBoundingClientRect();
  state.selectedText = text.slice(0, 4000);
  state.selectedRange = range.cloneRange();
  const estimatedWidth = window.innerWidth < 520 ? window.innerWidth - 24 : 310;
  const top = Math.max(72, rect.top - 48);
  const left = Math.min(window.innerWidth - estimatedWidth - 12, Math.max(12, rect.left));
  els.selectionPopup.style.top = `${top}px`;
  els.selectionPopup.style.left = `${left}px`;
  els.selectionPopup.hidden = false;
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
    if (payload.job && ["done", "failed", "failed_schema", "cancelled"].includes(payload.job.status)) {
      source.close();
      state.eventSources.delete(jobId);
      await refreshPanels();
    } else {
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
    return;
  }
  const payload = await api(`/api/documents/${state.currentDocument.id}/analysis`);
  state.analysis = payload.analysis || [];
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
  const latest = state.analysis[0]?.result || null;
  els.summarySection.textContent =
    latest?.summary_original ||
    latest?.summary ||
    latest?.summary_ko ||
    state.currentDocument?.status_message ||
    "Ready to analyze";

  els.termsSection.innerHTML = "";
  for (const term of latest?.terms || []) {
    const item = document.createElement("div");
    item.className = "term-item";
    item.innerHTML = `<strong>${escapeHtml(term.term || "Term")}</strong>${escapeHtml(
      term.definition_original || term.definition || term.definition_ko || ""
    )}`;
    els.termsSection.appendChild(item);
  }

  const koreanText = latest?.translation_ko || latest?.summary_ko || latest?.explanation_ko || "";
  els.translateButton.disabled = !koreanText;
  els.translateButton.textContent = state.showKoreanTranslation ? "Hide Korean" : "Translate Korean";
  els.translationSection.textContent = state.showKoreanTranslation
    ? koreanText
    : latest
      ? "Showing source language. Use Translate Korean for Korean."
      : "Run Analyze Document to generate translation.";

  els.questionsSection.innerHTML = "";
  const questions = latest?.follow_up_questions || [];
  if (questions.length === 0) {
    const item = document.createElement("li");
    item.textContent = latest ? "No follow-up questions returned." : "Run Analyze Document to generate questions.";
    els.questionsSection.appendChild(item);
  }
  for (const question of questions) {
    const item = document.createElement("li");
    item.textContent = question;
    els.questionsSection.appendChild(item);
  }

  renderSelectionJobs();
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
      <div>${escapeHtml(job.selection?.selection_text || "").slice(0, 180)}</div>
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
    return `<div><strong>${escapeHtml(result.verdict || "unclear")}</strong>${escapeHtml(result.explanation_ko || "")}</div>`;
  }
  return `<div>${escapeHtml(result.explanation_original || result.explanation_ko || result.summary_original || result.summary_ko || "")}</div>`;
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
