const fs = require("fs");
const path = require("path");

function createLogger(logsDir, name) {
  fs.mkdirSync(logsDir, { recursive: true });
  const file = path.join(logsDir, `${name}.log`);

  function write(level, message, meta) {
    const entry = {
      time: new Date().toISOString(),
      level,
      message,
      meta: meta ? redact(meta) : undefined
    };
    const line = `${JSON.stringify(entry)}\n`;
    fs.appendFile(file, line, () => {});

    if (level === "error") {
      console.error(`[${name}] ${message}`);
    } else {
      console.log(`[${name}] ${message}`);
    }
  }

  return {
    info: (message, meta) => write("info", message, meta),
    warn: (message, meta) => write("warn", message, meta),
    error: (message, meta) => write("error", message, meta)
  };
}

function redact(value) {
  if (!value || typeof value !== "object") {
    return value;
  }

  if (Array.isArray(value)) {
    return value.map(redact);
  }

  const next = {};
  for (const [key, item] of Object.entries(value)) {
    if (/text|content|body|token|authorization|password/i.test(key)) {
      next[key] = "[redacted]";
    } else {
      next[key] = redact(item);
    }
  }
  return next;
}

module.exports = {
  createLogger,
  redact
};
