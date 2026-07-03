const fs = require("fs");
const path = require("path");
const { randomUUID } = require("crypto");
const { JOB_STATUS } = require("../../../packages/shared/src");

function nowIso() {
  return new Date().toISOString();
}

function emptyData() {
  return {
    meta: {
      storage: "json",
      schema_version: 1,
      created_at: nowIso(),
      updated_at: nowIso()
    },
    documents: {},
    pages: {},
    selections: {},
    jobs: {},
    analysis_cache: {},
    sources: {}
  };
}

class JsonStore {
  constructor(storeFile) {
    this.storeFile = storeFile;
    this.data = emptyData();
    this.load();
  }

  load() {
    fs.mkdirSync(path.dirname(this.storeFile), { recursive: true });

    if (!fs.existsSync(this.storeFile)) {
      this.save();
      return;
    }

    const raw = fs.readFileSync(this.storeFile, "utf8");
    this.data = raw.trim() ? { ...emptyData(), ...JSON.parse(raw) } : emptyData();
  }

  save() {
    this.data.meta.updated_at = nowIso();
    const tmp = `${this.storeFile}.${process.pid}.${randomUUID().replace(/-/g, "")}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2));
    try {
      fs.renameSync(tmp, this.storeFile);
    } catch (error) {
      if (error.code !== "EPERM" && error.code !== "EACCES") {
        throw error;
      }
      fs.copyFileSync(tmp, this.storeFile);
      fs.rmSync(tmp, { force: true });
    }
  }

  createId(prefix) {
    return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 18)}`;
  }

  listDocuments() {
    return Object.values(this.data.documents).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  findDocumentByHash(fileHash) {
    return Object.values(this.data.documents).find((doc) => doc.file_hash && doc.file_hash === fileHash);
  }

  createDocument(document, pages) {
    const id = document.id || this.createId("doc");
    const createdAt = nowIso();
    const record = {
      id,
      source_type: document.source_type,
      title: document.title || document.original_filename || "Untitled",
      file_hash: document.file_hash || "",
      url: document.url || "",
      original_filename: document.original_filename || "",
      local_path: document.local_path || "",
      page_count: document.page_count || pages.length || 1,
      status: document.status || "ready",
      status_message: document.status_message || "",
      created_at: createdAt,
      updated_at: createdAt
    };

    this.data.documents[id] = record;
    pages.forEach((page, index) => {
      const pageNumber = page.page_number || index + 1;
      this.data.pages[`${id}:${pageNumber}`] = {
        id: this.createId("page"),
        document_id: id,
        page_number: pageNumber,
        text: page.text || "",
        text_hash: page.text_hash || "",
        extraction_confidence: page.extraction_confidence || "medium",
        created_at: createdAt,
        updated_at: createdAt
      };
    });
    this.save();
    return record;
  }

  updateDocument(id, patch) {
    const existing = this.data.documents[id];
    if (!existing) {
      return null;
    }
    this.data.documents[id] = { ...existing, ...patch, updated_at: nowIso() };
    this.save();
    return this.data.documents[id];
  }

  replaceDocumentPages(id, patch, pages) {
    const existing = this.data.documents[id];
    if (!existing) {
      return null;
    }

    const updatedAt = nowIso();
    this.data.documents[id] = {
      ...existing,
      ...patch,
      page_count: patch.page_count || pages.length || existing.page_count || 1,
      updated_at: updatedAt
    };

    for (const key of Object.keys(this.data.pages)) {
      if (this.data.pages[key].document_id === id) {
        delete this.data.pages[key];
      }
    }

    const removedJobIds = new Set();
    for (const key of Object.keys(this.data.selections)) {
      if (this.data.selections[key].document_id === id) {
        delete this.data.selections[key];
      }
    }
    for (const key of Object.keys(this.data.jobs)) {
      if (this.data.jobs[key].document_id === id) {
        removedJobIds.add(key);
        delete this.data.jobs[key];
      }
    }
    for (const key of Object.keys(this.data.analysis_cache)) {
      if (this.data.analysis_cache[key].document_id === id) {
        delete this.data.analysis_cache[key];
      }
    }
    for (const key of Object.keys(this.data.sources)) {
      if (removedJobIds.has(this.data.sources[key].job_id)) {
        delete this.data.sources[key];
      }
    }

    pages.forEach((page, index) => {
      const pageNumber = page.page_number || index + 1;
      this.data.pages[`${id}:${pageNumber}`] = {
        id: this.createId("page"),
        document_id: id,
        page_number: pageNumber,
        text: page.text || "",
        text_hash: page.text_hash || "",
        extraction_confidence: page.extraction_confidence || "medium",
        created_at: updatedAt,
        updated_at: updatedAt
      };
    });

    this.save();
    return this.data.documents[id];
  }

  getDocument(id) {
    return this.data.documents[id] || null;
  }

  getPages(documentId) {
    return Object.values(this.data.pages)
      .filter((page) => page.document_id === documentId)
      .sort((a, b) => a.page_number - b.page_number);
  }

  getPage(documentId, pageNumber) {
    return this.data.pages[`${documentId}:${Number(pageNumber)}`] || null;
  }

  deleteDocument(id) {
    const document = this.data.documents[id];
    if (!document) {
      return false;
    }

    delete this.data.documents[id];
    for (const key of Object.keys(this.data.pages)) {
      if (this.data.pages[key].document_id === id) {
        delete this.data.pages[key];
      }
    }
    for (const key of Object.keys(this.data.selections)) {
      if (this.data.selections[key].document_id === id) {
        delete this.data.selections[key];
      }
    }
    for (const key of Object.keys(this.data.jobs)) {
      if (this.data.jobs[key].document_id === id) {
        delete this.data.jobs[key];
      }
    }
    for (const key of Object.keys(this.data.analysis_cache)) {
      if (this.data.analysis_cache[key].document_id === id) {
        delete this.data.analysis_cache[key];
      }
    }
    this.save();
    return true;
  }

  createSelection(selection) {
    const id = this.createId("sel");
    const createdAt = nowIso();
    const record = {
      id,
      document_id: selection.document_id,
      page_number: Number(selection.page_number || 1),
      selection_text: selection.selection_text,
      surrounding_text: selection.surrounding_text || "",
      rects_json: selection.rects_json || "[]",
      created_at: createdAt
    };
    this.data.selections[id] = record;
    this.save();
    return record;
  }

  getSelection(id) {
    return this.data.selections[id] || null;
  }

  createJob(job) {
    const id = this.createId("job");
    const createdAt = nowIso();
    const record = {
      id,
      document_id: job.document_id || "",
      selection_id: job.selection_id || "",
      type: job.type,
      status: JOB_STATUS.QUEUED,
      payload_json: JSON.stringify(job.payload || {}),
      result_json: "",
      error: "",
      locked_by: "",
      lease_expires_at: "",
      heartbeat_at: "",
      attempts: 0,
      max_attempts: job.max_attempts || 2,
      cache_key: job.cache_key || "",
      cache_hit: false,
      created_at: createdAt,
      updated_at: createdAt
    };
    this.data.jobs[id] = record;
    this.save();
    return record;
  }

  getJob(id) {
    return this.data.jobs[id] || null;
  }

  listJobsForDocument(documentId) {
    return Object.values(this.data.jobs)
      .filter((job) => job.document_id === documentId)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  listSelectionJobs(documentId) {
    return Object.values(this.data.jobs)
      .filter((job) => job.document_id === documentId && job.selection_id)
      .map((job) => ({
        ...job,
        selection: this.data.selections[job.selection_id] || null
      }))
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  listAnalysisJobs(documentId) {
    return Object.values(this.data.jobs)
      .filter((job) => job.document_id === documentId && !job.selection_id)
      .sort((a, b) => b.created_at.localeCompare(a.created_at));
  }

  claimNextJob(workerId, leaseMs) {
    const now = Date.now();
    const jobs = Object.values(this.data.jobs).sort((a, b) => a.created_at.localeCompare(b.created_at));
    const job = jobs.find((candidate) => {
      if (candidate.status === JOB_STATUS.QUEUED) {
        return true;
      }
      if (candidate.status === JOB_STATUS.RUNNING && candidate.lease_expires_at) {
        return Date.parse(candidate.lease_expires_at) < now && candidate.attempts < candidate.max_attempts;
      }
      return false;
    });

    if (!job) {
      return null;
    }

    job.status = JOB_STATUS.RUNNING;
    job.locked_by = workerId;
    job.lease_expires_at = new Date(now + leaseMs).toISOString();
    job.heartbeat_at = nowIso();
    job.attempts += 1;
    job.updated_at = nowIso();
    this.save();
    return { ...job };
  }

  heartbeat(jobId, workerId, leaseMs) {
    const job = this.data.jobs[jobId];
    if (!job || job.locked_by !== workerId) {
      return null;
    }
    job.heartbeat_at = nowIso();
    job.lease_expires_at = new Date(Date.now() + leaseMs).toISOString();
    job.updated_at = nowIso();
    this.save();
    return { ...job };
  }

  completeJob(jobId, result, options = {}) {
    const job = this.data.jobs[jobId];
    if (!job) {
      return null;
    }
    job.status = JOB_STATUS.DONE;
    job.result_json = JSON.stringify(result);
    job.error = "";
    job.locked_by = "";
    job.lease_expires_at = "";
    job.heartbeat_at = nowIso();
    job.cache_hit = Boolean(options.cacheHit);
    job.updated_at = nowIso();
    this.save();
    return { ...job };
  }

  failJob(jobId, error, terminalStatus = JOB_STATUS.FAILED) {
    const job = this.data.jobs[jobId];
    if (!job) {
      return null;
    }

    if (terminalStatus === JOB_STATUS.FAILED && job.attempts < job.max_attempts) {
      job.status = JOB_STATUS.QUEUED;
    } else {
      job.status = terminalStatus;
    }
    job.error = String(error && error.message ? error.message : error || "Job failed");
    job.locked_by = "";
    job.lease_expires_at = "";
    job.heartbeat_at = nowIso();
    job.updated_at = nowIso();
    this.save();
    return { ...job };
  }

  getCache(cacheKey) {
    const record = this.data.analysis_cache[cacheKey];
    if (!record) {
      return null;
    }
    if (record.expires_at && Date.parse(record.expires_at) < Date.now()) {
      delete this.data.analysis_cache[cacheKey];
      this.save();
      return null;
    }
    return record;
  }

  setCache(cacheKey, record) {
    this.data.analysis_cache[cacheKey] = {
      id: this.createId("cache"),
      cache_key: cacheKey,
      document_id: record.document_id || "",
      selection_id: record.selection_id || "",
      type: record.type,
      result_json: JSON.stringify(record.result || {}),
      expires_at: record.expires_at || "",
      created_at: nowIso()
    };
    this.save();
    return this.data.analysis_cache[cacheKey];
  }

  addSources(jobId, sources) {
    for (const source of sources || []) {
      const id = this.createId("src");
      this.data.sources[id] = {
        id,
        job_id: jobId,
        title: source.title || "",
        url: source.url || "",
        publisher: source.publisher || "",
        published_date: source.published_date || "",
        accessed_date: source.accessed_date || "",
        relevance: source.relevance || "low"
      };
    }
    this.save();
  }

  getAnalysis(documentId) {
    return this.listJobsForDocument(documentId)
      .filter((job) => !job.selection_id && job.status === JOB_STATUS.DONE)
      .map((job) => ({
        ...job,
        result: safeJson(job.result_json)
      }));
  }

  queueStats() {
    const stats = {
      queued: 0,
      running: 0,
      done: 0,
      failed: 0
    };
    for (const job of Object.values(this.data.jobs)) {
      if (job.status === JOB_STATUS.QUEUED) {
        stats.queued += 1;
      } else if (job.status === JOB_STATUS.RUNNING) {
        stats.running += 1;
      } else if (job.status === JOB_STATUS.DONE) {
        stats.done += 1;
      } else if (job.status === JOB_STATUS.FAILED || job.status === JOB_STATUS.FAILED_SCHEMA) {
        stats.failed += 1;
      }
    }
    return stats;
  }
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
}

module.exports = {
  JsonStore,
  nowIso,
  safeJson
};
