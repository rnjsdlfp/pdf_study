const test = require("node:test");
const assert = require("node:assert/strict");
const {
  makeCacheKey,
  validateSelectionText,
  sanitizeFilename,
  normalizeFactCheckResult
} = require("../packages/shared/src");
const {
  decodePdfToken,
  decodeWithCMap,
  parseCMap,
  normalizeText,
  isLikelyExtractedText,
  stripPdfBoilerplate,
  isBoilerplateParagraph
} = require("../apps/server/src/pdfExtractor");
const { parseCodexJson, codexCommandCandidates } = require("../apps/server/src/codexAdapter");
const { isPidAlive } = require("../apps/mac-runner/CodexReaderRunner");
const { Readable } = require("node:stream");
const { formatBytes, readBuffer } = require("../apps/server/src/server");

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

test("PDF boilerplate filtering removes disclaimers and keeps content", () => {
  const cleaned = stripPdfBoilerplate(
    [
      "Revenue increased 12 percent in 2026.",
      "",
      "Disclaimer",
      "",
      "This material is for informational purposes only and is not investment advice. No warranty is made."
    ].join("\n")
  );
  assert.equal(cleaned.text, "Revenue increased 12 percent in 2026.");
  assert.equal(cleaned.removedCount, 2);
  assert.equal(isBoilerplateParagraph("Copyright 2026 Example Corp. All rights reserved."), true);
  assert.equal(isBoilerplateParagraph("This section explains warranty obligations in the contract."), false);
});

test("PDF ToUnicode CMap decoding restores encoded glyphs", () => {
  const cmap = parseCMap(
    [
      "1 beginbfchar",
      "<0003><0020>",
      "endbfchar",
      "1 beginbfrange",
      "<0004><0006><0041>",
      "endbfrange"
    ].join("\n")
  );
  assert.equal(decodeWithCMap("0004000500060003", cmap), "ABC ");
  assert.equal(isLikelyExtractedText("endstream\nendobj\n<< /Type /Page >>"), false);
  assert.equal(isLikelyExtractedText("Our Proprietary Data Points to Sharp Inflection"), true);
});

test("Codex JSON parser finds final JSON object", () => {
  const parsed = parseCodexJson('{"type":"event"}\n{"message":"result: {\\"ok\\":true}"}');
  assert.equal(parsed.ok, true);
});

test("Codex command lookup includes explicit and common paths", () => {
  const candidates = codexCommandCandidates("/custom/bin/codex");
  assert.equal(candidates[0], "/custom/bin/codex");
  assert.equal(candidates.includes("codex") || candidates.includes("codex.cmd"), true);
  assert.equal(candidates.some((candidate) => /[\\/]opt[\\/]homebrew[\\/]bin[\\/]codex/.test(candidate)), true);
  if (process.platform === "darwin") {
    assert.equal(candidates.includes("/Applications/Codex.app/Contents/Resources/codex"), true);
  }
});

test("current process is not treated as duplicate runner", () => {
  assert.equal(isPidAlive(process.pid), false);
});

test("oversized request bodies return a 413 without destroying the stream early", async () => {
  const stream = Readable.from([Buffer.alloc(4), Buffer.alloc(4)]);
  await assert.rejects(() => readBuffer(stream, 6), {
    statusCode: 413,
    message: "Request body is too large. Maximum size is 6 bytes."
  });
  assert.equal(formatBytes(200 * 1024 * 1024), "200 MB");
});
