const zlib = require("zlib");
const { sha256 } = require("../../../packages/shared/src");

function extractPdf(buffer) {
  const pageCount = Math.max(countPages(buffer), 1);
  const extractedText = normalizeText(extractTextFromStreams(buffer));
  const cleaned = stripPdfBoilerplate(extractedText);
  const text = cleaned.text;
  const pages = splitIntoPages(text, pageCount);
  const confidence = text.length > 500 ? "medium" : text.length > 20 ? "low" : "none";

  if (text.length === 0) {
    return {
      pageCount,
      status: "needs_ocr",
      statusMessage: "PDF uploaded, but no selectable text was found. OCR is required for this file.",
      pages: Array.from({ length: pageCount }, (_, index) => ({
        page_number: index + 1,
        text: "",
        text_hash: sha256(""),
        extraction_confidence: "none"
      }))
    };
  }

  return {
    pageCount: pages.length,
    status: "ready",
    statusMessage:
      cleaned.removedCount > 0
        ? `Ready to analyze. Removed ${cleaned.removedCount} boilerplate section(s).`
        : "Ready to analyze",
    pages: pages.map((pageText, index) => ({
      page_number: index + 1,
      text: pageText,
      text_hash: sha256(pageText),
      extraction_confidence: confidence
    }))
  };
}

function countPages(buffer) {
  const ascii = buffer.toString("latin1");
  const matches = ascii.match(/\/Type\s*\/Page\b/g);
  return matches ? matches.length : 1;
}

function extractTextFromStreams(buffer) {
  const bytes = buffer.toString("latin1");
  const streamRegex = /<<[\s\S]*?>>\s*stream\r?\n([\s\S]*?)\r?\nendstream/g;
  const chunks = [];
  let match;

  while ((match = streamRegex.exec(bytes))) {
    const dictionaryStart = Math.max(0, match.index);
    const dictionary = bytes.slice(dictionaryStart, match.index + Math.min(250, match[0].length));
    const raw = Buffer.from(match[1], "latin1");
    let stream = raw;

    if (/\/FlateDecode\b/.test(dictionary)) {
      try {
        stream = zlib.inflateSync(raw);
      } catch {
        continue;
      }
    }

    const text = extractTextOperators(stream.toString("latin1"));
    if (text) {
      chunks.push(text);
    }
  }

  if (chunks.length === 0) {
    return extractLooseStrings(bytes);
  }

  return chunks.join("\n\n");
}

function extractTextOperators(content) {
  const chunks = [];
  const textBlocks = content.match(/BT[\s\S]*?ET/g) || [content];

  for (const block of textBlocks) {
    let match;
    const simpleString = /(\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>)\s*Tj/g;
    while ((match = simpleString.exec(block))) {
      chunks.push(decodePdfToken(match[1]));
    }

    const arrayString = /\[([\s\S]*?)\]\s*TJ/g;
    while ((match = arrayString.exec(block))) {
      const parts = [];
      const tokenRegex = /\((?:\\.|[^\\)])*\)|<[\da-fA-F\s]+>/g;
      let token;
      while ((token = tokenRegex.exec(match[1]))) {
        parts.push(decodePdfToken(token[0]));
      }
      chunks.push(parts.join(""));
    }
  }

  return chunks.join(" ");
}

function extractLooseStrings(content) {
  const chunks = [];
  const tokenRegex = /\((?:\\.|[^\\)]){6,}\)/g;
  let match;
  while ((match = tokenRegex.exec(content))) {
    const value = decodePdfToken(match[0]);
    if (/[A-Za-z가-힣]{3}/.test(value)) {
      chunks.push(value);
    }
  }
  return chunks.join(" ");
}

function decodePdfToken(token) {
  if (!token) {
    return "";
  }

  if (token.startsWith("<")) {
    const hex = token.slice(1, -1).replace(/\s+/g, "");
    if (!hex || hex.length % 2 !== 0) {
      return "";
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

function normalizeText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .replace(/[ \t]+/g, " ")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
  normalizeText,
  stripPdfBoilerplate,
  isBoilerplateParagraph
};
