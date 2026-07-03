const { sha256 } = require("../../../packages/shared/src");

async function extractWebpage(url) {
  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("Only http and https webpages are supported.");
  }

  const response = await fetch(parsed.toString(), {
    headers: {
      "User-Agent": "CodexReader/0.1 (+local research reader)"
    }
  });

  if (!response.ok) {
    throw new Error(`Webpage fetch failed with HTTP ${response.status}.`);
  }

  const html = await response.text();
  const title = decodeEntities(firstMatch(html, /<title[^>]*>([\s\S]*?)<\/title>/i) || parsed.hostname);
  const article = extractReadableText(html);
  const text = normalizeArticleText(article || htmlToText(html));

  if (!text) {
    throw new Error("No readable text was found in the webpage.");
  }

  return {
    title,
    source_type: "webpage",
    url: parsed.toString(),
    page_count: 1,
    status: "ready",
    status_message: "Ready to analyze",
    pages: [
      {
        page_number: 1,
        text,
        text_hash: sha256(text),
        extraction_confidence: "medium"
      }
    ]
  };
}

function extractReadableText(html) {
  const main =
    firstMatch(html, /<article[^>]*>([\s\S]*?)<\/article>/i) ||
    firstMatch(html, /<main[^>]*>([\s\S]*?)<\/main>/i) ||
    firstMatch(html, /<body[^>]*>([\s\S]*?)<\/body>/i);
  return htmlToText(main || html);
}

function htmlToText(html) {
  return decodeEntities(
    String(html || "")
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
      .replace(/<(h[1-6]|p|li|blockquote|section|div|br)\b[^>]*>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
  );
}

function decodeEntities(value) {
  const named = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: '"',
    apos: "'",
    nbsp: " "
  };

  return String(value || "")
    .replace(/&([a-z]+);/gi, (_, name) => named[name.toLowerCase()] || `&${name};`)
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([\da-f]+);/gi, (_, code) => String.fromCodePoint(Number.parseInt(code, 16)));
}

function normalizeArticleText(value) {
  return String(value || "")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function firstMatch(value, regex) {
  const match = String(value || "").match(regex);
  return match ? match[1] : "";
}

module.exports = {
  extractWebpage,
  htmlToText,
  decodeEntities,
  normalizeArticleText
};
