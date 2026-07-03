const zlib = require("zlib");
const { sha256 } = require("../../../packages/shared/src");

function extractPdf(buffer) {
  const pageCount = Math.max(countPages(buffer), 1);
  const text = normalizeText(extractTextFromStreams(buffer));
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
    statusMessage: "Ready to analyze",
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
  normalizeText
};
