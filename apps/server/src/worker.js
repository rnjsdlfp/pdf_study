const {
  JOB_TYPES,
  JOB_STATUS,
  hasRequiredShape,
  makeCacheKey,
  normalizeFactCheckResult
} = require("../../../packages/shared/src");
const { safeJson } = require("./store");

function createWorker({ store, eventHub, codexAdapter, logger }) {
  const workerId = `worker_${process.pid}_${Math.random().toString(36).slice(2, 8)}`;
  const leaseMs = 5 * 60 * 1000;
  let timer = null;
  let active = false;

  async function tick() {
    if (active) {
      return;
    }
    const job = store.claimNextJob(workerId, leaseMs);
    if (!job) {
      return;
    }

    active = true;
    emit(job.id);

    try {
      await processJob(job);
    } catch (error) {
      logger.error("Job failed.", { jobId: job.id, error: error.message });
      const failed = store.failJob(job.id, error);
      emit(job.id, failed);
    } finally {
      active = false;
    }
  }

  async function processJob(job) {
    const payload = safeJson(job.payload_json) || {};
    const cacheKey = job.cache_key || payload.cache_key || makeCacheKey({ job: job.type, payload });
    const cached = !payload.rerun && store.getCache(cacheKey);

    if (cached) {
      const result = safeJson(cached.result_json) || {};
      const completed = store.completeJob(job.id, { ...result, cache_hit: true }, { cacheHit: true });
      emit(job.id, completed);
      return;
    }

    const context = buildContext(job, payload);
    const rawResult = await codexAdapter.run(job.type, context);
    const result = normalizeResult(job.type, rawResult);

    if (!hasRequiredShape(result, schemaName(job.type))) {
      const failed = store.failJob(job.id, new Error("Schema validation failed."), JOB_STATUS.FAILED_SCHEMA);
      emit(job.id, failed);
      return;
    }

    if (job.type === JOB_TYPES.SELECTION_FACT_CHECK) {
      store.addSources(job.id, result.sources);
    }

    const expiresAt =
      job.type === JOB_TYPES.SELECTION_FACT_CHECK
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : "";

    store.setCache(cacheKey, {
      document_id: job.document_id,
      selection_id: job.selection_id,
      type: job.type,
      result,
      expires_at: expiresAt
    });

    const completed = store.completeJob(job.id, result);
    emit(job.id, completed);
  }

  function buildContext(job, payload) {
    const document = store.getDocument(job.document_id);
    const selection = job.selection_id ? store.getSelection(job.selection_id) : null;
    let text = "";

    if (job.type === JOB_TYPES.PAGE_ANALYSIS) {
      const page = store.getPage(job.document_id, payload.page_number || 1);
      text = page ? page.text : "";
    } else if (job.type === JOB_TYPES.DOCUMENT_ANALYSIS) {
      const pages = store.getPages(job.document_id);
      const start = Number(payload.start_page || 1);
      const end = Number(payload.end_page || pages.length);
      text = pages
        .filter((page) => page.page_number >= start && page.page_number <= end)
        .map((page) => `Page ${page.page_number}\n${page.text}`)
        .join("\n\n");
    } else if (selection) {
      text = selection.selection_text;
    }

    return {
      document_title: document ? document.title : "Untitled",
      source_type: document ? document.source_type : "",
      text,
      selection_text: selection ? selection.selection_text : "",
      surrounding_text: selection ? selection.surrounding_text : ""
    };
  }

  function normalizeResult(jobType, result) {
    if (jobType === JOB_TYPES.SELECTION_FACT_CHECK) {
      return normalizeFactCheckResult(result, new Date().toISOString().slice(0, 10));
    }
    return result;
  }

  function schemaName(jobType) {
    if (jobType === JOB_TYPES.SELECTION_FACT_CHECK) {
      return "fact_check";
    }
    if (jobType === JOB_TYPES.SELECTION_EXPLAIN) {
      return "selection_explain";
    }
    return "analysis";
  }

  function emit(jobId, payload) {
    const latest = payload || store.getJob(jobId);
    eventHub.emit(jobId, {
      job: latest,
      queue: store.queueStats()
    });
  }

  return {
    workerId,
    start() {
      if (timer) {
        return;
      }
      timer = setInterval(tick, 1500);
      timer.unref?.();
      tick();
      logger.info("Worker started.", { workerId });
    },
    stop() {
      if (timer) {
        clearInterval(timer);
        timer = null;
      }
      logger.info("Worker stopped.", { workerId });
    },
    getState() {
      return {
        enabled: Boolean(timer),
        worker_id: workerId,
        max_codex_concurrency: 1,
        active_codex_jobs: active ? 1 : 0
      };
    }
  };
}

module.exports = {
  createWorker
};
