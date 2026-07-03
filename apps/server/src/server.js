const fs = require("fs");
const http = require("http");
const path = require("path");
const { URL } = require("url");
const { createHash } = require("crypto");
const {
  JOB_TYPES,
  makeCacheKey,
  sanitizeFilename,
  validateSelectionText
} = require("../../../packages/shared/src");
const { parseMultipart } = require("./multipart");
const { extractPdf, isLikelyExtractedText } = require("./pdfExtractor");
const { extractWebpage } = require("./webpageExtractor");
const { safeJson } = require("./store");
const { assertInside } = require("./runtime");

function createApp({ config, paths, store, eventHub, codexAdapter, worker, logger }) {
  const serverStartedAt = new Date().toISOString();

  const server = http.createServer(async (request, response) => {
    try {
      await route(request, response);
    } catch (error) {
      logger.error("Request failed.", {
        url: request.url,
        method: request.method,
        error: error.message
      });
      sendJson(response, error.statusCode || 500, {
        error: error.message || "Internal server error"
      });
    }
  });

  async function route(request, response) {
    applyCors(request, response, config);
    if (request.method === "OPTIONS") {
      response.writeHead(204);
      response.end();
      return;
    }

    const url = new URL(request.url, `http://${request.headers.host || "127.0.0.1"}`);

    if (url.pathname === "/health") {
      const status = await buildSystemStatus();
      sendJson(response, 200, {
        ok: true,
        instance_id: process.env.CODEX_READER_INSTANCE_ID || `server_${process.pid}`,
        server_started_at: serverStartedAt,
        ...status
      });
      return;
    }

    if (url.pathname.startsWith("/api/")) {
      requireApiAccess(request, config);
      await routeApi(request, response, url);
      return;
    }

    await serveStatic(response, url.pathname, config.webRoot);
  }

  async function routeApi(request, response, url) {
    if (request.method === "GET" && url.pathname === "/api/system/status") {
      sendJson(response, 200, await buildSystemStatus());
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/documents") {
      sendJson(response, 200, { documents: store.listDocuments() });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/documents") {
      await handlePdfUpload(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/webpages") {
      const body = await readJson(request, config.maxUploadBytes);
      const extracted = await extractWebpage(body.url);
      const document = store.createDocument(
        {
          source_type: "webpage",
          title: extracted.title,
          url: extracted.url,
          file_hash: createHash("sha256").update(extracted.url).digest("hex"),
          page_count: 1,
          status: extracted.status,
          status_message: extracted.status_message
        },
        extracted.pages
      );
      sendJson(response, 201, { document, pages: extracted.pages });
      return;
    }

    const docFile = url.pathname.match(/^\/api\/documents\/([^/]+)\/file$/);
    if (request.method === "GET" && docFile) {
      const document = requireDocument(docFile[1]);
      if (!document.local_path) {
        throw httpError(404, "Document has no local file.");
      }
      const filePath = assertInside(paths.uploadsDir, document.local_path);
      response.writeHead(200, {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${sanitizeFilename(document.original_filename || "document.pdf")}"`
      });
      fs.createReadStream(filePath).pipe(response);
      return;
    }

    const docPage = url.pathname.match(/^\/api\/documents\/([^/]+)\/pages\/(\d+)$/);
    if (request.method === "GET" && docPage) {
      const document = requireDocument(docPage[1]);
      const page = store.getPage(document.id, Number(docPage[2]));
      if (!page) {
        throw httpError(404, "Page not found.");
      }
      sendJson(response, 200, { document, page });
      return;
    }

    const docAnalysis = url.pathname.match(/^\/api\/documents\/([^/]+)\/analysis$/);
    if (request.method === "GET" && docAnalysis) {
      requireDocument(docAnalysis[1]);
      sendJson(response, 200, { analysis: store.getAnalysis(docAnalysis[1]) });
      return;
    }

    const docSelectionJobs = url.pathname.match(/^\/api\/documents\/([^/]+)\/selection-jobs$/);
    if (request.method === "GET" && docSelectionJobs) {
      requireDocument(docSelectionJobs[1]);
      sendJson(response, 200, { jobs: store.listSelectionJobs(docSelectionJobs[1]).map(withParsedJob) });
      return;
    }

    const docAnalyze = url.pathname.match(/^\/api\/documents\/([^/]+)\/analyze$/);
    if (request.method === "POST" && docAnalyze) {
      const document = requireDocument(docAnalyze[1]);
      const body = await readJson(request, 1024 * 1024);
      const scope = body.scope || "page";
      const payload = {
        scope,
        page_number: Number(body.page_number || 1),
        start_page: Number(body.start_page || 1),
        end_page: Number(body.end_page || document.page_count || 1),
        rerun: Boolean(body.rerun)
      };
      const type = scope === "document" || scope === "range" ? JOB_TYPES.DOCUMENT_ANALYSIS : JOB_TYPES.PAGE_ANALYSIS;
      const cacheKey = makeCacheKey({
        type,
        document_id: document.id,
        file_hash: document.file_hash || document.url,
        page_number: payload.page_number,
        start_page: payload.start_page,
        end_page: payload.end_page
      });
      const job = store.createJob({
        document_id: document.id,
        type,
        payload: { ...payload, cache_key: cacheKey },
        cache_key: cacheKey,
        max_attempts: 2
      });
      sendJson(response, 202, { job: withParsedJob(job) });
      return;
    }

    const documentMatch = url.pathname.match(/^\/api\/documents\/([^/]+)$/);
    if (request.method === "GET" && documentMatch) {
      const document = refreshPdfExtractionIfNeeded(requireDocument(documentMatch[1]));
      sendJson(response, 200, { document, pages: store.getPages(document.id) });
      return;
    }

    if (request.method === "DELETE" && documentMatch) {
      const document = requireDocument(documentMatch[1]);
      store.deleteDocument(document.id);
      if (document.local_path && document.local_path.startsWith(paths.uploadsDir)) {
        fs.rm(document.local_path, { force: true }, () => {});
      }
      sendJson(response, 200, { ok: true });
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/selections") {
      const body = await readJson(request, 1024 * 1024);
      const document = requireDocument(body.document_id);
      const validation = validateSelectionText(body.selection_text);
      if (!validation.ok) {
        throw httpError(400, validation.reason);
      }
      const selection = store.createSelection({
        document_id: document.id,
        page_number: body.page_number || 1,
        selection_text: validation.text,
        surrounding_text: body.surrounding_text || "",
        rects_json: JSON.stringify(body.rects || [])
      });
      sendJson(response, 201, { selection });
      return;
    }

    const selectionJob = url.pathname.match(/^\/api\/selections\/([^/]+)\/jobs$/);
    if (request.method === "POST" && selectionJob) {
      const selection = store.getSelection(selectionJob[1]);
      if (!selection) {
        throw httpError(404, "Selection not found.");
      }
      const document = requireDocument(selection.document_id);
      const body = await readJson(request, 1024 * 1024);
      const type =
        body.type === "fact_check" ? JOB_TYPES.SELECTION_FACT_CHECK : JOB_TYPES.SELECTION_EXPLAIN;
      const cacheKey = makeCacheKey({
        type,
        document_id: document.id,
        file_hash: document.file_hash || document.url,
        selection_text: selection.selection_text,
        surrounding_text: selection.surrounding_text
      });
      const job = store.createJob({
        document_id: document.id,
        selection_id: selection.id,
        type,
        payload: { cache_key: cacheKey, rerun: Boolean(body.rerun) },
        cache_key: cacheKey,
        max_attempts: type === JOB_TYPES.SELECTION_FACT_CHECK ? 1 : 2
      });
      sendJson(response, 202, { job: withParsedJob(job) });
      return;
    }

    const jobEvents = url.pathname.match(/^\/api\/jobs\/([^/]+)\/events$/);
    if (request.method === "GET" && jobEvents) {
      const job = store.getJob(jobEvents[1]);
      if (!job) {
        throw httpError(404, "Job not found.");
      }
      eventHub.subscribe(job.id, response, { job: withParsedJob(job), queue: store.queueStats() });
      return;
    }

    const jobMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (request.method === "GET" && jobMatch) {
      const job = store.getJob(jobMatch[1]);
      if (!job) {
        throw httpError(404, "Job not found.");
      }
      sendJson(response, 200, { job: withParsedJob(job) });
      return;
    }

    throw httpError(404, "API route not found.");
  }

  async function handlePdfUpload(request, response) {
    const contentType = request.headers["content-type"] || "";
    const boundary = contentType.match(/boundary=(?:"([^"]+)"|([^;]+))/i);
    if (!/^multipart\/form-data/i.test(contentType) || !boundary) {
      throw httpError(400, "Expected multipart/form-data upload.");
    }

    const body = await readBuffer(request, config.maxUploadBytes);
    const multipart = parseMultipart(body, boundary[1] || boundary[2]);
    const file = multipart.files.file || multipart.files.pdf;

    if (!file) {
      throw httpError(400, "Missing file field.");
    }

    const filename = sanitizeFilename(file.filename);
    if (!/\.pdf$/i.test(filename) && !/application\/pdf/i.test(file.contentType)) {
      throw httpError(400, "Only PDF uploads are supported.");
    }

    const fileHash = createHash("sha256").update(file.buffer).digest("hex");
    const existing = store.findDocumentByHash(fileHash);
    if (existing) {
      sendJson(response, 200, {
        document: existing,
        pages: store.getPages(existing.id),
        cache_hit: true
      });
      return;
    }

    const savedPath = assertInside(paths.uploadsDir, path.join(paths.uploadsDir, `${fileHash}.pdf`));
    fs.writeFileSync(savedPath, file.buffer);

    const extracted = extractPdf(file.buffer, { filePath: savedPath });
    const document = store.createDocument(
      {
        source_type: "pdf",
        title: filename,
        file_hash: fileHash,
        original_filename: filename,
        local_path: savedPath,
        page_count: extracted.pageCount,
        status: extracted.status,
        status_message: extracted.statusMessage
      },
      extracted.pages
    );

    sendJson(response, 201, {
      document,
      pages: extracted.pages
    });
  }

  async function buildSystemStatus() {
    const codex = await codexAdapter.getStatus();
    const tunnel = readTunnelStatus(paths);
    return {
      codex_cli_available: codex.codex_cli_available,
      codex_command: codex.codex_command,
      codex_login_ok: codex.codex_login_ok,
      codex_web_search_ok: codex.codex_web_search_ok,
      codex_mode: codex.codex_mode,
      codex_version: codex.codex_version,
      cloudflare_tunnel_ok: tunnel.ok,
      cloudflare_tunnel_url: tunnel.url,
      queue: store.queueStats(),
      worker: worker.getState(),
      storage: {
        runtime_home: paths.home,
        backend: "json",
        sqlite_ready: false
      }
    };
  }

  function requireDocument(id) {
    const document = store.getDocument(id);
    if (!document) {
      throw httpError(404, "Document not found.");
    }
    return document;
  }

  function refreshPdfExtractionIfNeeded(document) {
    if (document.source_type !== "pdf" || !document.local_path) {
      return document;
    }

    const pages = store.getPages(document.id);
    const currentText = pages.map((page) => page.text || "").join("\n\n");
    if (!currentText && document.status === "needs_ocr") {
      return document;
    }
    if (currentText && isLikelyExtractedText(currentText)) {
      return document;
    }

    try {
      const filePath = assertInside(paths.uploadsDir, document.local_path);
      if (!fs.existsSync(filePath)) {
        return document;
      }

      const extracted = extractPdf(fs.readFileSync(filePath), { filePath });
      return store.replaceDocumentPages(
        document.id,
        {
          page_count: extracted.pageCount,
          status: extracted.status,
          status_message: extracted.statusMessage
        },
        extracted.pages
      ) || document;
    } catch (error) {
      logger.warn("PDF re-extraction skipped.", {
        documentId: document.id,
        error: error.message
      });
      return document;
    }
  }

  return server;
}

function readTunnelStatus(paths) {
  const fallback = { ok: false, url: "" };
  try {
    const file = path.join(paths.runDir, "tunnel-status.json");
    if (!fs.existsSync(file)) {
      return fallback;
    }

    const status = JSON.parse(fs.readFileSync(file, "utf8"));
    const pid = Number(status.pid || 0);
    if (!pid || !isPidAlive(pid)) {
      return { ok: false, url: status.url || "" };
    }
    return { ok: Boolean(status.ok && status.url), url: status.url || "" };
  } catch {
    return fallback;
  }
}

function isPidAlive(pid) {
  if (!pid || pid === process.pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function requireApiAccess(request, config) {
  if (config.apiToken && request.headers["x-codex-reader-token"] !== config.apiToken) {
    throw httpError(401, "Missing or invalid API token.");
  }

  if (config.requireAccessJwt && !request.headers["cf-access-jwt-assertion"]) {
    throw httpError(401, "Cloudflare Access JWT is required.");
  }
}

function applyCors(request, response, config) {
  const origin = request.headers.origin;
  if (!origin) {
    return;
  }

  if (config.allowedOrigins.length === 0 || config.allowedOrigins.includes(origin)) {
    response.setHeader("Access-Control-Allow-Origin", origin);
    response.setHeader("Vary", "Origin");
    response.setHeader("Access-Control-Allow-Methods", "GET,POST,DELETE,OPTIONS");
    response.setHeader("Access-Control-Allow-Headers", "Content-Type,X-Codex-Reader-Token,CF-Access-Jwt-Assertion");
    if (request.headers["access-control-request-private-network"] === "true") {
      response.setHeader("Access-Control-Allow-Private-Network", "true");
    }
  }
}

async function serveStatic(response, pathname, webRoot) {
  const safePath = pathname === "/" ? "/index.html" : pathname;
  const target = path.resolve(webRoot, `.${safePath}`);
  const relative = path.relative(webRoot, target);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw httpError(403, "Forbidden.");
  }

  const file = fs.existsSync(target) && fs.statSync(target).isFile() ? target : path.join(webRoot, "index.html");
  const ext = path.extname(file).toLowerCase();
  const contentType =
    {
      ".html": "text/html; charset=utf-8",
      ".css": "text/css; charset=utf-8",
      ".js": "application/javascript; charset=utf-8",
      ".json": "application/json; charset=utf-8",
      ".svg": "image/svg+xml",
      ".png": "image/png"
    }[ext] || "application/octet-stream";
  response.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(file).pipe(response);
}

function withParsedJob(job) {
  return {
    ...job,
    payload: safeJson(job.payload_json),
    result: safeJson(job.result_json)
  };
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store"
  });
  response.end(JSON.stringify(payload));
}

function httpError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function readJson(request, maxBytes) {
  return readBuffer(request, maxBytes).then((buffer) => {
    if (buffer.length === 0) {
      return {};
    }
    try {
      return JSON.parse(buffer.toString("utf8"));
    } catch {
      throw httpError(400, "Invalid JSON body.");
    }
  });
}

function readBuffer(request, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let sizeError = null;
    request.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        if (!sizeError) {
          sizeError = httpError(413, `Request body is too large. Maximum size is ${formatBytes(maxBytes)}.`);
          chunks.length = 0;
        }
        return;
      }
      if (!sizeError) {
        chunks.push(chunk);
      }
    });
    request.on("end", () => {
      if (sizeError) {
        reject(sizeError);
        return;
      }
      resolve(Buffer.concat(chunks));
    });
    request.on("error", reject);
  });
}

function formatBytes(bytes) {
  if (bytes < 1024 * 1024) {
    return `${bytes} bytes`;
  }
  const mb = bytes / 1024 / 1024;
  return `${Number.isInteger(mb) ? mb : mb.toFixed(1)} MB`;
}

module.exports = {
  createApp,
  formatBytes,
  httpError,
  readBuffer,
  withParsedJob
};
