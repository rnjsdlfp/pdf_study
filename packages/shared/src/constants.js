const PROMPT_VERSION = "2026-07-03-plain-output-specialized-terms";
const SCHEMA_VERSION = "3";

const JOB_TYPES = Object.freeze({
  PAGE_ANALYSIS: "page_analysis",
  DOCUMENT_ANALYSIS: "document_analysis",
  SELECTION_EXPLAIN: "selection_explain",
  SELECTION_FACT_CHECK: "selection_fact_check"
});

const JOB_STATUS = Object.freeze({
  QUEUED: "queued",
  RUNNING: "running",
  DONE: "done",
  FAILED: "failed",
  CANCELLED: "cancelled",
  FAILED_SCHEMA: "failed_schema"
});

module.exports = {
  PROMPT_VERSION,
  SCHEMA_VERSION,
  JOB_TYPES,
  JOB_STATUS
};
