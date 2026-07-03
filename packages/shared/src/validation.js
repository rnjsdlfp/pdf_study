function normalizeWhitespace(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function validateSelectionText(value) {
  const text = normalizeWhitespace(value);

  if (!text) {
    return { ok: false, reason: "Selection is empty." };
  }

  if (text.length < 8) {
    return { ok: false, reason: "Selection must be at least 8 characters." };
  }

  if (text.length > 4000) {
    return { ok: false, reason: "Selection must be 4,000 characters or less." };
  }

  return { ok: true, text };
}

function sanitizeFilename(filename) {
  const base = String(filename || "upload")
    .replace(/[\\/]/g, "_")
    .replace(/[\x00-\x1f\x7f]/g, "")
    .replace(/[^a-zA-Z0-9._ -]/g, "_")
    .trim();

  return base || "upload";
}

function normalizeVerdict(value) {
  const verdicts = new Set(["supported", "contradicted", "unclear", "not_checkable"]);
  return verdicts.has(value) ? value : "unclear";
}

function normalizeConfidence(value) {
  const confidence = new Set(["high", "medium", "low"]);
  return confidence.has(value) ? value : "low";
}

function normalizeFactCheckResult(value, accessedDate) {
  const result = value && typeof value === "object" ? value : {};
  const sources = Array.isArray(result.sources) ? result.sources : [];

  return {
    claim: normalizeWhitespace(result.claim || ""),
    verdict: normalizeVerdict(result.verdict),
    explanation_ko: normalizeWhitespace(result.explanation_ko || result.explanation || ""),
    sources: sources.map((source) => ({
      title: normalizeWhitespace(source.title || "Untitled source"),
      url: normalizeWhitespace(source.url || ""),
      publisher: normalizeWhitespace(source.publisher || ""),
      published_date: normalizeWhitespace(source.published_date || ""),
      accessed_date: normalizeWhitespace(source.accessed_date || accessedDate),
      relevance: ["high", "medium", "low"].includes(source.relevance) ? source.relevance : "low"
    })),
    caveats: Array.isArray(result.caveats)
      ? result.caveats.map(normalizeWhitespace).filter(Boolean)
      : [],
    confidence: normalizeConfidence(result.confidence)
  };
}

module.exports = {
  normalizeWhitespace,
  validateSelectionText,
  sanitizeFilename,
  normalizeFactCheckResult
};
