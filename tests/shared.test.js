const test = require("node:test");
const assert = require("node:assert/strict");
const {
  makeCacheKey,
  validateSelectionText,
  sanitizeFilename,
  normalizeFactCheckResult
} = require("../packages/shared/src");
const { decodePdfToken, normalizeText } = require("../apps/server/src/pdfExtractor");
const { parseCodexJson } = require("../apps/server/src/codexAdapter");
const { isPidAlive } = require("../apps/mac-runner/CodexReaderRunner");

test("cache keys are stable across object key order", () => {
  const a = makeCacheKey({ type: "page", payload: { page: 1, doc: "x" } });
  const b = makeCacheKey({ payload: { doc: "x", page: 1 }, type: "page" });
  assert.equal(a, b);
});

test("selection validation enforces length and trimming", () => {
  assert.equal(validateSelectionText("     ").ok, false);
  assert.equal(validateSelectionText("short").ok, false);
  const valid = validateSelectionText("  this is long enough  ");
  assert.equal(valid.ok, true);
  assert.equal(valid.text, "this is long enough");
});

test("filename sanitization strips traversal characters", () => {
  assert.equal(sanitizeFilename("../secret.pdf"), ".._secret.pdf");
  assert.equal(sanitizeFilename("a/b\\c.pdf"), "a_b_c.pdf");
});

test("fact-check normalization fills required fields", () => {
  const normalized = normalizeFactCheckResult({ verdict: "weird", sources: [{}] }, "2026-07-03");
  assert.equal(normalized.verdict, "unclear");
  assert.equal(normalized.confidence, "low");
  assert.equal(normalized.sources[0].accessed_date, "2026-07-03");
});

test("PDF string decoder handles escapes", () => {
  assert.equal(decodePdfToken("(Hello\\nWorld\\0501\\051)"), "Hello\nWorld(1)");
  assert.equal(normalizeText("a   b\n\n\nc"), "a b\n\nc");
});

test("Codex JSON parser finds final JSON object", () => {
  const parsed = parseCodexJson('{"type":"event"}\n{"message":"result: {\\"ok\\":true}"}');
  assert.equal(parsed.ok, true);
});

test("current process is not treated as duplicate runner", () => {
  assert.equal(isPidAlive(process.pid), false);
});
