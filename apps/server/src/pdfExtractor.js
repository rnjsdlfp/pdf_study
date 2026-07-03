const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");
const zlib = require("zlib");
const { sha256 } = require("../../../packages/shared/src");

function extractPdf(buffer, options = {}) {
  const pageCount = Math.max(countPages(buffer), 1);
  const pymupdf = extractWithPyMuPDF4LLM(buffer, options);
  if (pymupdf.ok) {
    return buildExtractionResult({
      pageTexts: pymupdf.pages.map((page) => page.text),
      pageCount: pymupdf.pageCount || pymupdf.pages.length || pageCount,
      extractor: "PyMuPDF4LLM"
    });
  }

  const extractedText = normalizeText(extractTextFromStreams(buffer));
  const cleaned = stripPdfBoilerplate(extractedText);
  const text = isLikelyExtractedText(cleaned.text) ? cleaned.text : "";
  return buildExtractionResult({
    pageTexts: splitIntoPages(text, pageCount),
    pageCount,
    extractor: "legacy",
    removedCount: cleaned.removedCount,
    fallbackReason: pymupdf.reason
  });
}

function buildExtractionResult({ pageTexts, pageCount, extractor, removedCount = 0, fallbackReason = "" }) {
  const normalizedPages = pageTexts.map((pageText) => stripPdfBoilerplate(normalizeText(pageText || "")));
  const pages = normalizedPages.map((page) => page.text);
  while (pages.length < pageCount) {
    pages.push("");
  }
  const text = pages.join("\n\n").trim();
  const totalRemoved = normalizedPages.reduce((sum, page) => sum + page.removedCount, removedCount);
  const confidence = text.length > 500 ? "high" : text.length > 20 ? "medium" : "none";

  if (text.length === 0) {
    return {
      pageCount,
      status: "needs_ocr",
      statusMessage:
        extractor === "legacy" && fallbackReason
          ? `PDF uploaded, but no selectable text was found. PyMuPDF4LLM was unavailable (${fallbackReason}).`
          : "PDF uploaded, but no selectable text was found. OCR is required for this file.",
      pages: Array.from({ length: pageCount }, (_, index) => ({
        page_number: index + 1,
        text: "",
        text_hash: sha256(""),
        extraction_confidence: "none"
      }))
    };
  }

  return {
    pageCount: Math.max(pageCount, pages.length),
    status: "ready",
    statusMessage: readyStatusMessage(extractor, totalRemoved, fallbackReason),
    pages: pages.map((pageText, index) => ({
      page_number: index + 1,
      text: pageText,
      text_hash: sha256(pageText),
      extraction_confidence: confidence
    }))
  };
}

function readyStatusMessage(extractor, removedCount, fallbackReason) {
  const parts = [`Ready to analyze (${extractor}).`];
  if (removedCount > 0) {
    parts.push(`Removed ${removedCount} boilerplate section(s).`);
  }
  if (extractor === "legacy" && fallbackReason) {
    parts.push(`PyMuPDF4LLM fallback reason: ${fallbackReason}.`);
  }
  return parts.join(" ");
}

function extractWithPyMuPDF4LLM(buffer, options = {}) {
  const mode = String(process.env.CODEX_READER_PDF_EXTRACTOR || "auto").toLowerCase();
  if (mode === "legacy" || mode === "js") {
    return { ok: false, reason: "disabled" };
  }

  const script = path.resolve(__dirname, "..", "tools", "pymupdf4llm_extract.py");
  if (!fs.existsSync(script)) {
    return { ok: false, reason: "helper_missing" };
  }

  const cleanup = [];
  let pdfPath = options.filePath || "";
  try {
    if (!pdfPath) {
      pdfPath = path.join(os.tmpdir(), `codex-reader-${process.pid}-${Date.now()}.pdf`);
      fs.writeFileSync(pdfPath, buffer);
      cleanup.push(pdfPath);
    }

    const python = resolvePythonCommand();
    if (!python) {
      return { ok: false, reason: "python_not_found" };
    }

    const args = [script, pdfPath];
    if (String(process.env.CODEX_READER_PDF_FORCE_OCR || "false") === "true") {
      args.push("--force-ocr");
    }
    if (String(process.env.CODEX_READER_PDF_USE_OCR || "true") === "false") {
      args.push("--no-ocr");
    }

    const result = spawnSync(python, args, {
      encoding: "utf8",
      maxBuffer: 1024 * 1024 * 32,
      env: process.env
    });
    const parsed = parseHelperJson(result.stdout);
    if (!parsed || !parsed.ok) {
      return {
        ok: false,
        reason: parsed?.error || normalizeText(result.stderr || result.error?.message || "helper_failed").slice(0, 160)
      };
    }

    const pages = Array.isArray(parsed.pages)
      ? parsed.pages.map((page) => ({
          pageNumber: Number(page.page_number || 0),
          text: normalizeText(page.text || "")
        }))
      : [];
    if (!pages.some((page) => isLikelyExtractedText(page.text))) {
      return { ok: false, reason: "empty_output" };
    }

    return {
      ok: true,
      pageCount: Number(parsed.page_count || pages.length || 1),
      pages
    };
  } catch (error) {
    return { ok: false, reason: error.message };
  } finally {
    for (const file of cleanup) {
      try {
        fs.rmSync(file, { force: true });
      } catch {
        // Best effort cleanup only.
      }
    }
  }
}

function parseHelperJson(stdout) {
  try {
    return JSON.parse(String(stdout || "").trim());
  } catch {
    return null;
  }
}

function resolvePythonCommand() {
  const candidates = [
    process.env.CODEX_READER_PYTHON,
    process.platform === "win32" ? "python.exe" : "python3",
    "python"
  ].filter(Boolean);
  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8",
      timeout: 3000
    });
    if (result.status === 0) {
      return candidate;
    }
  }
  return "";
}

function countPages(buffer) {
  const ascii = buffer.toString("latin1");
  const matches = ascii.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 1;
}

function extractTextFromStreams(buffer) {
  const bytes = buffer.toString("latin1");
  const fontMaps = buildFontCMaps(bytes);
  const streamRegex = /\b(\d+)\s+(\d+)\s+obj\s*((?:(?!\bendobj\b)[\s\S])*?)\s*stream\r?\n([\s\S]*?)\r?\nendstream\s*endobj/g;
  const chunks = [];
  let match;

  while ((match = streamRegex.exec(bytes))) {
    const dictionary = match[3];
    const raw = Buffer.from(match[4], "latin1");
    let stream = raw;

    if (/\/FlateDecode\b/.test(dictionary)) {
      try {
        stream = zlib.inflateSync(raw);
      } catch {
        continue;
      }
    }

    const text = extractTextOperators(stream.toString("latin1"), fontMaps);
    if (text) {
      chunks.push(text);
    }
  }

  if (chunks.length === 0) {
    return extractLooseStrings(bytes);
  }

  return chunks.join("\n\n");
}

function extractTextOperators(content, fontMaps = new Map()) {
  const chunks = [];
  const textBlocks = content.match(/BT[\s\S]*?ET/g) || [content];

  for (const block of textBlocks) {
    let currentFontMap = null;
    let match;
    const operatorRegex =
      /\/([A-Za-z0-9_.-]+)\s+[-+]?(?:\d*\.)?\d+\s+Tf|(\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>)\s*Tj|\[([\s\S]*?)\]\s*TJ/g;

    while ((match = operatorRegex.exec(block))) {
      if (match[1]) {
        currentFontMap = fontMaps.get(match[1]) || null;
        continue;
      }

      if (match[2]) {
        chunks.push(decodePdfToken(match[2], currentFontMap));
        continue;
      }

      if (match[3]) {
        const parts = [];
        const tokenRegex = /\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>/g;
        let token;
        while ((token = tokenRegex.exec(match[3]))) {
          parts.push(decodePdfToken(token[0], currentFontMap));
        }
        chunks.push(parts.join(""));
      }
    }
  }

  return chunks.join(" ");
}

function buildFontCMaps(pdfText) {
  const fontMaps = new Map();
  const cmapCache = new Map();
  const cmapByFontObject = new Map();
  const objectRegex = /\b(\d+)\s+0\s+obj([\s\S]*?)endobj/g;
  let match;

  while ((match = objectRegex.exec(pdfText))) {
    const objectId = match[1];
    const body = match[2];
    if (!/\/Type\s*\/Font\b/.test(body) && !/\/Subtype\s*\/Type0\b/.test(body)) {
      continue;
    }

    const toUnicodeId = /\/ToUnicode\s+(\d+)\s+0\s+R/.exec(body)?.[1];
    if (!toUnicodeId) {
      continue;
    }

    if (!cmapCache.has(toUnicodeId)) {
      cmapCache.set(toUnicodeId, parseCMapStream(pdfText, toUnicodeId));
    }
    const cmap = cmapCache.get(toUnicodeId);
    if (!cmap || cmap.map.size === 0) {
      continue;
    }

    cmapByFontObject.set(objectId, cmap);
    const name = /\/Name\s+\/([A-Za-z0-9_.-]+)/.exec(body)?.[1];
    if (name) {
      fontMaps.set(name, cmap);
    }
  }

  const resourceFontRegex = /\/([A-Za-z0-9_.-]+)\s+(\d+)\s+0\s+R/g;
  while ((match = resourceFontRegex.exec(pdfText))) {
    const cmap = cmapByFontObject.get(match[2]);
    if (cmap && !fontMaps.has(match[1])) {
      fontMaps.set(match[1], cmap);
    }
  }

  return fontMaps;
}

function parseCMapStream(pdfText, objectId) {
  const escapedId = String(objectId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const objectRegex = new RegExp(
    `\\b${escapedId}\\s+0\\s+obj\\s*([\\s\\S]*?)\\s*stream\\r?\\n([\\s\\S]*?)\\r?\\nendstream\\s*endobj`
  );
  const match = objectRegex.exec(pdfText);
  if (!match) {
    return null;
  }

  let stream = Buffer.from(match[2], "latin1");
  if (/\/FlateDecode\b/.test(match[1])) {
    try {
      stream = zlib.inflateSync(stream);
    } catch {
      return null;
    }
  }

  return parseCMap(stream.toString("latin1"));
}

function parseCMap(cmapText) {
  const map = new Map();
  let maxCodeLength = 2;

  for (const section of cmapText.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const pairRegex = /<([\da-fA-F]+)>\s*<([\da-fA-F]+)>/g;
    let pair;
    while ((pair = pairRegex.exec(section[1]))) {
      const source = normalizeHexKey(pair[1]);
      const value = decodeUnicodeHex(pair[2]);
      if (source && value) {
        map.set(source, value);
        maxCodeLength = Math.max(maxCodeLength, source.length);
      }
    }
  }

  for (const section of cmapText.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const rangeRegex = /<([\da-fA-F]+)>\s*<([\da-fA-F]+)>\s*(<[\da-fA-F]+>|\[[^\]]+\])/g;
    let range;
    while ((range = rangeRegex.exec(section[1]))) {
      const start = Number.parseInt(range[1], 16);
      const end = Number.parseInt(range[2], 16);
      const sourceWidth = normalizeHexKey(range[1]).length;
      maxCodeLength = Math.max(maxCodeLength, sourceWidth);
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start || end - start > 2048) {
        continue;
      }

      if (range[3].startsWith("[")) {
        const values = [...range[3].matchAll(/<([\da-fA-F]+)>/g)].map((item) => decodeUnicodeHex(item[1]));
        values.forEach((value, index) => {
          if (value) {
            map.set((start + index).toString(16).toUpperCase().padStart(sourceWidth, "0"), value);
          }
        });
        continue;
      }

      const baseHex = range[3].slice(1, -1);
      const base = Number.parseInt(baseHex, 16);
      if (!Number.isFinite(base) || base + (end - start) > 0x10ffff) {
        continue;
      }
      for (let code = start; code <= end; code += 1) {
        const key = code.toString(16).toUpperCase().padStart(sourceWidth, "0");
        map.set(key, String.fromCodePoint(base + code - start));
      }
    }
  }

  return { map, maxCodeLength };
}

function extractLooseStrings(content) {
  const chunks = [];
  const tokenRegex = /\((?:\\.|[^\\)]){6,}\)/g;
  let match;
  while ((match = tokenRegex.exec(content))) {
    const value = decodePdfToken(match[0]);
    if (/[A-Za-z\uAC00-\uD7A3]{3}/.test(value)) {
      chunks.push(value);
    }
  }
  return chunks.join(" ");
}

function decodePdfToken(token, cmap = null) {
  if (!token) {
    return "";
  }

  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    if (!hex || hex.length % 2 !== 0) {
      return "";
    }
    if (cmap) {
      return decodeWithCMap(hex, cmap);
    }
    const buffer = Buffer.from(hex, "hex");
    if (buffer.length >= 2 && buffer[0] === 0xfe && buffer[1] === 0xff) {
      let out = "";
      for (let i = 2; i + 1 < buffer.length; i += 2) {
        out += String.fromCharCode(buffer.readUInt16BE(i));
      }
      return out;
    }
    return buffer.toString("utf8").replace(/\u0000/g, "");
  }

  let body = token.slice(1, -1);
  body = body.replace(/\\([nrtbf()\\])/g, (_, escaped) => {
    const map = {
      n: "\n",
      r: "\r",
      t: "\t",
      b: "\b",
      f: "\f",
      "(": "(",
      ")": ")",
      "\\": "\\"
    };
    return map[escaped] || escaped;
  });
  body = body.replace(/\\([0-7]{1,3})/g, (_, octal) =>
    String.fromCharCode(Number.parseInt(octal, 8))
  );
  body = body.replace(/\\\r?\n/g, "");
  return body;
}

function decodeWithCMap(hex, cmap) {
  const clean = normalizeHexKey(hex);
  let out = "";
  let index = 0;
  const maxCodeLength = Math.max(2, cmap.maxCodeLength || 2);

  while (index < clean.length) {
    let matched = false;
    for (let length = maxCodeLength; length >= 2; length -= 2) {
      const key = clean.slice(index, index + length);
      if (key.length !== length) {
        continue;
      }
      if (cmap.map.has(key)) {
        out += cmap.map.get(key);
        index += length;
        matched = true;
        break;
      }
    }

    if (!matched) {
      index += maxCodeLength;
    }
  }

  return out;
}

function normalizeHexKey(value) {
  return String(value || "").replace(/\s+/g, "").toUpperCase();
}

function decodeUnicodeHex(hex) {
  const clean = normalizeHexKey(hex);
  if (!clean || clean.length % 4 !== 0) {
    return "";
  }

  let out = "";
  for (let index = 0; index + 3 < clean.length; index += 4) {
    const code = Number.parseInt(clean.slice(index, index + 4), 16);
    if (Number.isFinite(code) && code !== 0) {
      out += String.fromCharCode(code);
    }
  }
  return out;
}

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[\u0001-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\uFFFD/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function isLikelyExtractedText(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return false;
  }

  const internalPdfMarkers = (normalized.match(/\b(?:endobj|endstream|xref|trailer|\/Type\s*\/Page|\/Font|\/XObject)\b/g) || []).length;
  if (internalPdfMarkers >= 2) {
    return false;
  }

  const readableChars = (normalized.match(/[A-Za-z0-9\uAC00-\uD7A3.,:;!?%$()/'" -]/g) || []).length;
  const ratio = readableChars / Math.max(normalized.length, 1);
  return ratio >= 0.55 || /[\uAC00-\uD7A3]{4,}|[A-Za-z]{4,}/.test(normalized);
}

const BOILERPLATE_HEADINGS = [
  /^disclaimer$/i,
  /^important (notice|disclosures?)$/i,
  /^legal notice$/i,
  /^forward-looking statements?$/i,
  /^safe harbor statement$/i,
  /^confidentiality notice$/i,
  /^\uBA74\uCC45(\s*\uACE0\uC9C0)?$/,
  /^\uBC95\uC801\s*\uACE0\uC9C0$/,
  /^\uC8FC\uC758\s*\uC0AC\uD56D$/
];

const BOILERPLATE_PATTERNS = [
  /\bdisclaimer\b/i,
  /\bforward-looking statements?\b/i,
  /\bsafe harbor\b/i,
  /\bno (representations?|warrant(?:y|ies))\b/i,
  /\bwithout (?:any )?warrant(?:y|ies)\b/i,
  /\bfor informational purposes only\b/i,
  /\bnot (?:an? )?(?:investment|legal|tax|financial) advice\b/i,
  /\bdo not (?:copy|distribute|redistribute)\b/i,
  /\bunauthorized (?:use|copying|distribution|disclosure)\b/i,
  /\ball rights reserved\b/i,
  /\bcopyright\b/i,
  /\bconfidential\b/i,
  /\bprivileged\b/i,
  /\bterms and conditions\b/i,
  /\blimitation of liability\b/i,
  /\uBA74\uCC45/,
  /\uBB34\uB2E8\s*\uBC30\uD3EC/,
  /\uBCF5\uC81C\s*\uBC0F\s*\uBC30\uD3EC\s*\uAE08\uC9C0/,
  /\uD22C\uC790\s*\uC870\uC5B8/,
  /\uBC95\uB960\s*\uC790\uBB38/,
  /\uC815\uBCF4\s*\uC81C\uACF5\s*\uBAA9\uC801/
];

function stripPdfBoilerplate(text) {
  const normalized = normalizeText(text);
  if (!normalized) {
    return { text: "", removedCount: 0 };
  }

  const tailStripped = stripTrailingBoilerplate(normalized);
  const paragraphs = tailStripped.text.split(/\n{2,}/);
  const kept = [];
  let removedCount = tailStripped.removedCount;

  for (const paragraph of paragraphs) {
    const trimmed = paragraph.trim();
    if (!trimmed) {
      continue;
    }

    if (isBoilerplateParagraph(trimmed)) {
      removedCount += 1;
      continue;
    }

    kept.push(trimmed);
  }

  return {
    text: kept.join("\n\n").trim(),
    removedCount
  };
}

function stripTrailingBoilerplate(text) {
  const markers = [
    /\n\s*disclaimer\s*\n/i,
    /\n\s*important (?:notice|disclosures?)\s*\n/i,
    /\n\s*legal notice\s*\n/i,
    /\n\s*forward-looking statements?\s*\n/i,
    /\n\s*safe harbor statement\s*\n/i,
    /\n\s*\uBA74\uCC45(?:\s*\uACE0\uC9C0)?\s*\n/,
    /\n\s*\uBC95\uC801\s*\uACE0\uC9C0\s*\n/,
    /\n\s*\uC8FC\uC758\s*\uC0AC\uD56D\s*\n/
  ];

  for (const marker of markers) {
    const match = marker.exec(`\n${text}\n`);
    if (!match) {
      continue;
    }

    const index = Math.max(0, match.index - 1);
    const before = text.slice(0, index).trim();
    const after = text.slice(index).trim();

    if (before.length >= 300 && after.length <= Math.max(2500, before.length * 0.65)) {
      return { text: before, removedCount: 1 };
    }
  }

  return { text, removedCount: 0 };
}

function isBoilerplateParagraph(paragraph) {
  const compact = paragraph.replace(/\s+/g, " ").trim();
  if (!compact) {
    return false;
  }

  if (BOILERPLATE_HEADINGS.some((pattern) => pattern.test(compact))) {
    return true;
  }

  let score = 0;
  for (const pattern of BOILERPLATE_PATTERNS) {
    if (pattern.test(compact)) {
      score += 1;
    }
  }

  if (compact.length <= 160 && score >= 1 && /(disclaimer|notice|copyright|confidential|\uACE0\uC9C0|\uBA74\uCC45)/i.test(compact)) {
    return true;
  }

  return score >= 2;
}

function splitIntoPages(text, pageCount) {
  if (!text) {
    return [""];
  }

  if (pageCount <= 1) {
    return [text];
  }

  const paragraphs = text.split(/\n{2,}/).filter(Boolean);
  const targetLength = Math.ceil(text.length / pageCount);
  const pages = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if (current.length > 0 && current.length + paragraph.length > targetLength && pages.length < pageCount - 1) {
      pages.push(current.trim());
      current = "";
    }
    current += `${paragraph}\n\n`;
  }

  if (current.trim()) {
    pages.push(current.trim());
  }

  while (pages.length < pageCount) {
    pages.push("");
  }

  return pages.slice(0, pageCount);
}

module.exports = {
  extractPdf,
  decodePdfToken,
  decodeWithCMap,
  parseCMap,
  normalizeText,
  isLikelyExtractedText,
  stripPdfBoilerplate,
  isBoilerplateParagraph
};
