function parseMultipart(buffer, boundary) {
  if (!boundary) {
    throw new Error("Missing multipart boundary.");
  }

  const delimiter = Buffer.from(`--${boundary}`);
  const parts = splitBuffer(buffer, delimiter);
  const fields = {};
  const files = {};

  for (let part of parts) {
    if (part.length === 0 || part.equals(Buffer.from("--\r\n")) || part.equals(Buffer.from("--"))) {
      continue;
    }

    if (part.slice(0, 2).toString() === "\r\n") {
      part = part.slice(2);
    }
    if (part.slice(-2).toString() === "\r\n") {
      part = part.slice(0, -2);
    }
    if (part.slice(-2).toString() === "--") {
      part = part.slice(0, -2);
    }

    const headerEnd = part.indexOf(Buffer.from("\r\n\r\n"));
    if (headerEnd === -1) {
      continue;
    }

    const headerText = part.slice(0, headerEnd).toString("utf8");
    const content = part.slice(headerEnd + 4);
    const headers = parseHeaders(headerText);
    const disposition = headers["content-disposition"] || "";
    const name = firstQuoted(disposition, "name");
    const filename = firstQuoted(disposition, "filename");

    if (!name) {
      continue;
    }

    if (filename) {
      files[name] = {
        fieldName: name,
        filename,
        contentType: headers["content-type"] || "application/octet-stream",
        buffer: content
      };
    } else {
      fields[name] = content.toString("utf8");
    }
  }

  return { fields, files };
}

function parseHeaders(text) {
  const headers = {};
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(":");
    if (index === -1) {
      continue;
    }
    headers[line.slice(0, index).trim().toLowerCase()] = line.slice(index + 1).trim();
  }
  return headers;
}

function firstQuoted(value, name) {
  const match = String(value || "").match(new RegExp(`${name}="([^"]*)"`));
  return match ? match[1] : "";
}

function splitBuffer(buffer, delimiter) {
  const parts = [];
  let start = 0;
  let index;

  while ((index = buffer.indexOf(delimiter, start)) !== -1) {
    parts.push(buffer.slice(start, index));
    start = index + delimiter.length;
  }
  parts.push(buffer.slice(start));
  return parts;
}

module.exports = {
  parseMultipart,
  splitBuffer
};
