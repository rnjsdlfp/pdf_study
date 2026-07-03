const { execFile } = require("child_process");
const os = require("os");
const path = require("path");
const { promisify } = require("util");
const {
  JOB_TYPES,
  normalizeFactCheckResult,
  normalizeWhitespace
} = require("../../../packages/shared/src");

const execFileAsync = promisify(execFile);

class CodexAdapter {
  constructor(config, logger) {
    this.config = config;
    this.logger = logger;
    this.statusCache = null;
    this.statusCheckedAt = 0;
    this.codexCommand = "";
  }

  async getStatus({ refresh = false } = {}) {
    if (!refresh && this.statusCache && Date.now() - this.statusCheckedAt < 30000) {
      return this.statusCache;
    }

    const codexCommand = await this.resolveCodexCommand();
    const cli = codexCommand ? await commandOk(codexCommand, ["--version"], 3000) : { ok: false, stdout: "", stderr: "" };
    const webSearch = cli.ok ? await commandOk(codexCommand, ["exec", "--help"], 5000) : { ok: false, stdout: "" };

    this.statusCache = {
      codex_cli_available: cli.ok,
      codex_command: cli.ok ? codexCommand : "",
      codex_version: normalizeWhitespace(cli.stdout || cli.stderr || ""),
      codex_login_ok: cli.ok,
      codex_web_search_ok: cli.ok && /--search/.test(webSearch.stdout || ""),
      codex_mode: this.config.codexMode,
      last_checked_at: new Date().toISOString()
    };
    this.statusCheckedAt = Date.now();
    return this.statusCache;
  }

  async resolveCodexCommand() {
    if (this.config.codexCommand) {
      return this.config.codexCommand;
    }
    if (this.codexCommand) {
      return this.codexCommand;
    }
    const resolved = await resolveCodexCommand();
    if (resolved) {
      this.codexCommand = resolved;
    }
    return resolved;
  }

  async run(jobType, context) {
    if (this.config.codexMode === "mock") {
      return fallbackResult(jobType, context, "Mock mode is enabled.");
    }

    const status = await this.getStatus();
    if (!status.codex_cli_available) {
      if (this.config.codexMode === "live") {
        throw new Error("Codex CLI not found.");
      }
      return fallbackResult(jobType, context, "Codex CLI was not found; local fallback was used.");
    }

    const prompt = buildPrompt(jobType, context);
    const args = ["exec", "--json", "--ephemeral", "--sandbox", "read-only"];
    if (jobType === JOB_TYPES.SELECTION_FACT_CHECK) {
      args.push("--search");
    }
    args.push(prompt);

    try {
      const codexCommand = await this.resolveCodexCommand();
      const { stdout, stderr } = await execFileAsync(codexCommand, args, {
        timeout: this.config.codexTimeoutMs,
        maxBuffer: 1024 * 1024 * 4,
        env: buildCommandEnv()
      });
      const parsed = parseCodexJson(stdout);
      if (!parsed) {
        throw new Error(`Codex returned non-JSON output. ${stderr || ""}`.trim());
      }
      return parsed;
    } catch (error) {
      this.logger.warn("Codex execution failed; using fallback when allowed.", {
        jobType,
        error: error.message
      });

      if (this.config.codexMode === "live") {
        throw error;
      }

      return fallbackResult(jobType, context, `Codex execution failed: ${error.message}`);
    }
  }
}

async function commandOk(command, args, timeout) {
  try {
    const result = await execFileAsync(command, args, {
      timeout,
      maxBuffer: 1024 * 1024,
      env: buildCommandEnv()
    });
    return { ok: true, stdout: result.stdout, stderr: result.stderr };
  } catch (error) {
    return { ok: false, stdout: error.stdout || "", stderr: error.stderr || error.message };
  }
}

async function resolveCodexCommand() {
  const explicit = process.env.CODEX_READER_CODEX_COMMAND || "";
  for (const candidate of codexCommandCandidates(explicit)) {
    const status = await commandOk(candidate, ["--version"], 3000);
    if (status.ok) {
      return candidate;
    }
  }

  if (process.platform === "darwin") {
    const shellResolved = await resolveFromLoginShell();
    if (shellResolved) {
      return shellResolved;
    }
  }

  return "";
}

function codexCommandCandidates(explicit = "") {
  const names = process.platform === "win32" ? ["codex.cmd", "codex.exe", "codex"] : ["codex"];
  const candidates = [
    explicit,
    ...names,
    ...commonBinDirs().flatMap((dir) => names.map((name) => path.join(dir, name)))
  ];
  return uniqueList(candidates);
}

async function resolveFromLoginShell() {
  for (const shell of ["/bin/zsh", "/bin/bash"]) {
    try {
      const result = await execFileAsync(shell, ["-lc", "command -v codex"], {
        timeout: 3000,
        maxBuffer: 1024 * 64,
        env: buildCommandEnv()
      });
      const command = String(result.stdout || "").trim().split(/\r?\n/).pop();
      if (command) {
        const status = await commandOk(command, ["--version"], 3000);
        if (status.ok) {
          return command;
        }
      }
    } catch {
      // Keep trying other shells and paths.
    }
  }
  return "";
}

function buildCommandEnv() {
  return {
    ...process.env,
    PATH: uniqueList([...commonBinDirs(), process.env.PATH || ""]).join(path.delimiter)
  };
}

function commonBinDirs() {
  const home = os.homedir();
  return uniqueList([
    process.env.CODEX_READER_BIN_DIR || "",
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".bun", "bin"),
    path.join(home, ".cargo", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/usr/bin",
    "/bin",
    "/usr/sbin",
    "/sbin"
  ]);
}

function uniqueList(values) {
  const seen = new Set();
  const result = [];
  for (const value of values) {
    const normalized = String(value || "").trim();
    if (normalized && !seen.has(normalized)) {
      seen.add(normalized);
      result.push(normalized);
    }
  }
  return result;
}

function buildPrompt(jobType, context) {
  const date = new Date().toISOString().slice(0, 10);
  const text = truncate(context.text || context.selection_text || "", jobType === JOB_TYPES.DOCUMENT_ANALYSIS ? 18000 : 8000);

  if (jobType === JOB_TYPES.SELECTION_FACT_CHECK) {
    return [
      "Return JSON only, matching this schema:",
      '{"claim":"string","verdict":"supported|contradicted|unclear|not_checkable","explanation_ko":"string","sources":[{"title":"string","url":"string","publisher":"string","published_date":"string","accessed_date":"' +
        date +
        '","relevance":"high|medium|low"}],"caveats":["string"],"confidence":"high|medium|low"}',
      "Use web search. Cite external sources. If the claim cannot be checked, use not_checkable.",
      `Document title: ${context.document_title || "Untitled"}`,
      `Claim or selected text:\n${text}`
    ].join("\n\n");
  }

  if (jobType === JOB_TYPES.SELECTION_EXPLAIN) {
    return [
      "Return JSON only, matching this schema:",
      '{"explanation_original":"string","explanation_ko":"string","terms":[{"term":"string","definition_original":"string","definition_ko":"string"}],"translation_ko":"string","follow_up_questions":["string"]}',
      "Use the source document language for explanation_original and definition_original. Put Korean only in explanation_ko, definition_ko, and translation_ko. Do not use web search.",
      `Document title: ${context.document_title || "Untitled"}`,
      `Selected text:\n${text}`,
      `Surrounding context:\n${truncate(context.surrounding_text || "", 4000)}`
    ].join("\n\n");
  }

  return [
    "Return JSON only, matching this schema:",
    '{"summary_original":"string","summary_ko":"string","terms":[{"term":"string","definition_original":"string","definition_ko":"string"}],"translation_ko":"string","follow_up_questions":["string"],"sources":[]}',
    "Analyze the document in the same language as the source text for summary_original and definition_original. Put Korean only in summary_ko, definition_ko, and translation_ko. Do not use web search. Keep output concise and useful for research reading.",
    `Analysis scope: ${jobType}`,
    `Document title: ${context.document_title || "Untitled"}`,
    `Text:\n${text}`
  ].join("\n\n");
}

function parseCodexJson(stdout) {
  const text = String(stdout || "").trim();
  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch {
    // Codex JSON mode can emit JSONL events. Look for text-like fields or a final object.
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      const event = JSON.parse(lines[i]);
      const candidate =
        event.output ||
        event.result ||
        event.final ||
        event.response ||
        event.message ||
        event.text ||
        event.content;
      if (typeof candidate === "string") {
        const parsed = extractJsonObject(candidate);
        if (parsed) {
          return parsed;
        }
      }
      if (candidate && typeof candidate === "object") {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return extractJsonObject(text);
}

function extractJsonObject(text) {
  const source = String(text || "");
  const first = source.indexOf("{");
  const last = source.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) {
    return null;
  }

  try {
    return JSON.parse(source.slice(first, last + 1));
  } catch {
    return null;
  }
}

function fallbackResult(jobType, context, caveat) {
  const text = normalizeWhitespace(context.text || context.selection_text || "");

  if (jobType === JOB_TYPES.SELECTION_FACT_CHECK) {
    return normalizeFactCheckResult(
      {
        claim: text,
        verdict: "not_checkable",
        explanation_ko:
          "현재 실행에서는 웹 검색 기반 검증을 완료하지 못했습니다. Fact-check는 Codex CLI의 웹 검색이 정상 동작할 때 다시 실행하세요.",
        sources: [],
        caveats: [caveat, "외부 출처가 없으므로 이 결과는 사실 검증으로 확정해서 사용할 수 없습니다."],
        confidence: "low"
      },
      new Date().toISOString().slice(0, 10)
    );
  }

  if (jobType === JOB_TYPES.SELECTION_EXPLAIN) {
    return {
      explanation_original: makeOriginalSummary(text),
      explanation_ko: `선택한 문장은 문서 안에서 다음 내용을 말합니다: ${makeSummary(text)}`,
      terms: makeTerms(text),
      translation_ko: makeTranslationNote(text),
      follow_up_questions: makeQuestions(text, true),
      caveats: [caveat]
    };
  }

  return {
    summary_original: makeOriginalSummary(text),
    summary_ko: makeSummary(text),
    terms: makeTerms(text),
    translation_ko: makeTranslationNote(text),
    follow_up_questions: makeQuestions(text, false),
    sources: [],
    caveats: [caveat]
  };
}

function makeOriginalSummary(text) {
  if (!text) {
    return "No extracted text is available.";
  }
  const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).filter(Boolean).slice(0, 3);
  return sentences.join(" ") || text.slice(0, 280);
}

function makeSummary(text) {
  if (!text) {
    return "분석할 추출 텍스트가 없습니다. 스캔 PDF라면 OCR이 필요합니다.";
  }
  const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).filter(Boolean).slice(0, 3);
  return `핵심 내용은 ${sentences.join(" ")}${sentences.length ? "" : text.slice(0, 280)}`;
}

function makeTerms(text) {
  const words = normalizeWhitespace(text)
    .split(/[^A-Za-z0-9가-힣_/-]+/)
    .filter((word) => word.length >= 4 && !/^\d+$/.test(word));
  const counts = new Map();
  for (const word of words) {
    const key = word.toLowerCase();
    counts.set(key, { term: word, count: (counts.get(key)?.count || 0) + 1 });
  }
  return [...counts.values()]
    .sort((a, b) => b.count - a.count)
    .slice(0, 6)
    .map((item) => ({
      term: item.term,
      definition_original: "Repeated source-text term. Check the surrounding PDF context for the exact definition.",
      definition_ko: "문서에서 반복적으로 등장하는 핵심 후보 용어입니다. 정확한 정의는 원문 맥락에서 확인하세요."
    }));
}

function makeTranslationNote(text) {
  if (!text) {
    return "번역할 텍스트가 없습니다.";
  }
  return `로컬 fallback은 전문 번역 대신 의미를 한국어로 정리합니다: ${text.slice(0, 500)}`;
}

function makeQuestions(text, selection) {
  const numberLike = /\d/.test(text);
  const contractLike = /agreement|contract|shall|termination|liability|계약|해지|손해/i.test(text);
  const policyLike = /policy|regulation|law|effective|compliance|정책|법|시행/i.test(text);

  if (contractLike) {
    return [
      "이 조항에서 의무를 지는 당사자는 누구인가?",
      "해지권, 동의권, 손해배상 범위가 어디까지 열려 있는가?",
      "예외 조항이나 통지 기한이 다른 조항과 충돌하지 않는가?"
    ];
  }

  if (policyLike) {
    return [
      "이 문서의 적용 범위와 시행일은 무엇인가?",
      "법적 근거 또는 상위 규정은 무엇인가?",
      "예외 대상이나 과도기 조항이 있는가?"
    ];
  }

  if (numberLike) {
    return [
      "이 수치의 기준일과 산정 방식은 무엇인가?",
      "원문에서 출처 또는 표본 조건을 확인할 수 있는가?",
      "같은 지표를 반박할 수 있는 다른 기준은 무엇인가?"
    ];
  }

  return selection
    ? [
        "이 문장의 핵심 전제는 무엇인가?",
        "앞뒤 문맥과 연결하면 해석이 달라지는가?",
        "이 용어가 문서 앞부분의 정의와 일치하는가?"
      ]
    : [
        "문서 전체의 핵심 주장과 근거는 무엇인가?",
        "중요한 용어가 어디에서 처음 정의되는가?",
        "추가 검증이 필요한 수치나 최신 정보가 있는가?"
      ];
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;
}

module.exports = {
  CodexAdapter,
  buildPrompt,
  parseCodexJson,
  codexCommandCandidates,
  fallbackResult
};
