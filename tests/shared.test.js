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
const {
  parseCodexJson,
  codexCommandCandidates,
  buildCodexArgs,
  buildPrompt,
  firstCommandWord,
  sanitizeCodexResult,
  makeSpecializedTerms
} = require("../apps/server/src/codexAdapter");
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

test("Codex result sanitizer removes markdown emphasis markers", () => {
  const cleaned = sanitizeCodexResult({
    summary_original: "**Sharp inflection** expected",
    terms: [{ term: "**EBITDA**", definition_original: "# earnings metric" }]
  });
  assert.equal(cleaned.summary_original, "Sharp inflection expected");
  assert.equal(cleaned.terms[0].term, "EBITDA");
  assert.equal(cleaned.terms[0].definition_original, "earnings metric");
});

test("fallback terms prefer abbreviations and specialized hard terms", () => {
  const terms = makeSpecializedTerms(
    [
      "Revenue improved while EBITDA, GLP-1 persistence, OW ratings, and cardiometabolic endpoints drove the investment debate.",
      "The company also discussed longitudinal utilization and reimbursement sensitivity."
    ].join(" ")
  ).map((item) => item.term);
  assert.equal(terms[0], "GLP-1");
  assert.equal(terms.includes("EBITDA"), true);
  assert.equal(terms.includes("OW"), true);
  assert.equal(terms.includes("cardiometabolic"), true);
  assert.equal(terms.includes("Revenue"), false);
});

test("Codex command lookup includes explicit and common paths", () => {
  const candidates = codexCommandCandidates("/custom/bin/codex");
  assert.equal(candidates[0], "/custom/bin/codex");
  assert.equal(candidates.includes("codex") || candidates.includes("codex.cmd"), true);
  assert.equal(candidates.some((candidate) => /[\\/]opt[\\/]homebrew[\\/]bin[\\/]codex/.test(candidate)), true);
  assert.equal(candidates.some((candidate) => /[\\/]\.codex[\\/]bin[\\/]codex/.test(candidate)), true);
  if (process.platform === "darwin") {
    assert.equal(candidates.includes("/Applications/Codex.app/Contents/Resources/codex"), true);
  }
});

test("Codex execution args match automation defaults", () => {
  const args = buildCodexArgs("document_analysis", {
    codexModel: "gpt-5.5",
    codexSkipGitRepoCheck: true
  });
  assert.deepEqual(args.slice(0, 8), [
    "exec",
    "--json",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--skip-git-repo-check",
    "--model",
    "gpt-5.5"
  ]);
  assert.equal(args.includes("--search"), true);
  assert.equal(firstCommandWord("codex exec --skip-git-repo-check"), "codex");
});

test("analysis prompt asks Codex for web-informed follow-up prompts", () => {
  const prompt = buildPrompt("document_analysis", {
    document_title: "Example",
    output_language: "Korean",
    text: "A report argues demand growth will accelerate after a product launch."
  });
  assert.match(prompt, /Use web search to strengthen Follow-up Questions only/);
  assert.match(prompt, /Output language for Follow-up Questions: Korean/);
  assert.match(prompt, /thought experiments/);
  assert.doesNotMatch(prompt, /\*\*/);
});

test("manual prompts include summary context and selected output language", () => {
  const prompt = buildPrompt("selection_explain", {
    document_title: "Example",
    output_language: "Korean",
    summary_context: "Demand is expected to accelerate as launch constraints fade.",
    selection_text: "Reit OW PT to $39",
    surrounding_text: "The report reiterates an overweight rating and price target."
  });
  assert.match(prompt, /Output language: Korean/);
  assert.match(prompt, /Automatically extracted summary for context/);
  assert.match(prompt, /Demand is expected to accelerate/);
  assert.doesNotMatch(prompt, /right-sidebar/);
});

test("follow-up answer prompt uses search, full text, and language", () => {
  const args = buildCodexArgs("follow_up_answer", {});
  const prompt = buildPrompt("follow_up_answer", {
    document_title: "Example",
    output_language: "English",
    summary_context: "The document argues demand is inflecting.",
    selection_text: "What evidence would falsify this demand inflection thesis?",
    document_text: "Page 1\nDemand is growing. Page 2\nRisks include reimbursement."
  });
  assert.equal(args.includes("--search"), true);
  assert.match(prompt, /Output language: English/);
  assert.match(prompt, /Full extracted document text/);
  assert.match(prompt, /Use web search/);
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
