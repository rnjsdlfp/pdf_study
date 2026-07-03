const crypto = require("crypto");
const { PROMPT_VERSION, SCHEMA_VERSION } = require("./constants");

function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function shortHash(value, length = 16) {
  return sha256(value).slice(0, length);
}

function stableJson(value) {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value);
  }

  if (Array.isArray(value)) {
    return `[${value.map(stableJson).join(",")}]`;
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`)
    .join(",")}}`;
}

function makeCacheKey(parts) {
  return sha256(
    stableJson({
      promptVersion: PROMPT_VERSION,
      schemaVersion: SCHEMA_VERSION,
      ...parts
    })
  );
}

module.exports = {
  sha256,
  shortHash,
  stableJson,
  makeCacheKey
};
