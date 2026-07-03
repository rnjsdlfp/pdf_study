const { execFile, spawn } = require("child_process");
const fs = require("fs");
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
    const rootHelp = cli.ok ? await commandOk(codexCommand, ["--help"], 5000) : { ok: false, stdout: "", stderr: "" };
    const execHelp = cli.ok ? await commandOk(codexCommand, ["exec", "--help"], 5000) : { ok: false, stdout: "", stderr: "" };
    const searchMode = detectCodexSearchMode(rootHelp, execHelp);
    const auth = inspectCodexAuthEnv();

    this.statusCache = {
      codex_cli_available: cli.ok,
      codex_command: cli.ok ? codexCommand : "",
      codex_version: normalizeWhitespace(cli.stdout || cli.stderr || ""),
      codex_login_ok: cli.ok && (auth.auth_file_ok || auth.auth_env_ok),
      codex_auth_home: auth.home,
      codex_auth_file_ok: auth.auth_file_ok,
      codex_auth_env_ok: auth.auth_env_ok,
      codex_web_search_ok: cli.ok && searchMode !== "none",
      codex_web_search_mode: cli.ok ? searchMode : "none",
      codex_mode: this.config.codexMode,
      last_checked_at: new Date().toISOString()
    };
    this.statusCheckedAt = Date.now();
    return this.statusCache;
  }

  async resolveCodexCommand() {
    if (this.config.codexCommand) {
      return firstCommandWord(this.config.codexCommand) || this.config.codexCommand;
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
      if (this.config.codexMode === "live" || requiresCodexCli(jobType)) {
        throw new Error("Codex CLI not found.");
      }
      return fallbackResult(jobType, context, "Codex CLI was not found; local fallback was used.");
    }

    const prompt = buildPrompt(jobType, {
      ...context,
      codex_web_search_ok: status.codex_web_search_ok
    });
    const args = buildCodexArgs(jobType, {
      ...this.config,
      codexSearchMode: status.codex_web_search_mode
    });

    try {
      const codexCommand = await this.resolveCodexCommand();
      const { stdout, stderr } = await runCodexCommand(codexCommand, args, prompt, {
        timeout: this.config.codexTimeoutMs,
        maxBuffer: 1024 * 1024 * 4,
        env: buildCommandEnv()
      });
      const parsed = parseCodexJson(stdout, stderr);
      if (!parsed) {
        throw new Error(`Codex returned non-JSON output. ${formatCodexOutputError(stdout, stderr)}`.trim());
      }
      return sanitizeCodexResult(parsed);
    } catch (error) {
      this.logger.warn("Codex execution failed; using fallback when allowed.", {
        jobType,
        error: error.message
      });

      if (this.config.codexMode === "live" || requiresCodexCli(jobType)) {
        throw error;
      }

      return fallbackResult(jobType, context, `Codex execution failed: ${error.message}`);
    }
  }
}

function runCodexCommand(command, args, input, options = {}) {
  const timeout = Number(options.timeout || 120000);
  const maxBuffer = Number(options.maxBuffer || 1024 * 1024 * 4);

  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdoutChunks = [];
    const stderrChunks = [];
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      child.kill("SIGTERM");
      reject(new Error(`Codex CLI timed out after ${timeout} ms.`));
    }, timeout);

    function append(chunks, chunk, streamName) {
      chunks.push(chunk);
      const size = chunks.reduce((sum, item) => sum + item.length, 0);
      if (size <= maxBuffer || settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      child.kill("SIGTERM");
      reject(new Error(`Codex CLI ${streamName} exceeded ${maxBuffer} bytes.`));
    }

    child.stdout.on("data", (chunk) => append(stdoutChunks, chunk, "stdout"));
    child.stderr.on("data", (chunk) => append(stderrChunks, chunk, "stderr"));

    child.on("error", (error) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (code, signal) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      const stdout = Buffer.concat(stdoutChunks).toString("utf8");
      const stderr = Buffer.concat(stderrChunks).toString("utf8");
      if (code === 0) {
        resolve({ stdout, stderr });
        return;
      }
      const error = new Error(`Codex CLI exited with code ${code ?? "unknown"}${signal ? ` signal ${signal}` : ""}. ${formatCodexOutputError(stdout, stderr)}`.trim());
      error.stdout = stdout;
      error.stderr = stderr;
      reject(error);
    });

    child.stdin.end(`${input || ""}\n`);
  });
}

function buildCodexArgs(jobType, config = {}) {
  const searchMode = normalizeCodexSearchMode(config.codexSearchMode, config.codexSearchSupported);
  const useSearch = searchMode !== "none" && shouldUseCodexSearch(jobType);
  const args = useSearch && searchMode === "root" ? ["--search", "exec"] : ["exec"];
  args.push("--json", "--ephemeral", "--sandbox", "read-only");
  if (config.codexSkipGitRepoCheck !== false) {
    args.push("--skip-git-repo-check");
  }
  if (config.codexModel) {
    args.push("--model", String(config.codexModel));
  }
  if (useSearch && searchMode === "exec") {
    args.push("--search");
  }
  return args;
}

function detectCodexSearchMode(rootHelp, execHelp) {
  const execText = `${execHelp?.stdout || ""}\n${execHelp?.stderr || ""}`;
  if (/--search\b/.test(execText)) {
    return "exec";
  }
  const rootText = `${rootHelp?.stdout || ""}\n${rootHelp?.stderr || ""}`;
  if (/--search\b/.test(rootText)) {
    return "root";
  }
  return "none";
}

function normalizeCodexSearchMode(mode, legacySupported) {
  if (mode === "root" || mode === "exec") {
    return mode;
  }
  if (legacySupported === true) {
    return "exec";
  }
  return "none";
}

function shouldUseCodexSearch(jobType) {
  return [
    JOB_TYPES.PAGE_ANALYSIS,
    JOB_TYPES.DOCUMENT_ANALYSIS,
    JOB_TYPES.SELECTION_FACT_CHECK,
    JOB_TYPES.FOLLOW_UP_ANSWER
  ].includes(jobType);
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
  const explicit =
    firstCommandWord(process.env.CODEX_READER_CODEX_COMMAND || "") ||
    firstCommandWord(process.env.CODEX_CLI_COMMAND || "");
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

function firstCommandWord(command) {
  const text = String(command || "").trim();
  if (!text) {
    return "";
  }
  const match = text.match(/^"([^"]+)"|^'([^']+)'|^(\S+)/);
  return match ? match[1] || match[2] || match[3] || "" : "";
}

function codexCommandCandidates(explicit = "") {
  const names = process.platform === "win32" ? ["codex.cmd", "codex.exe", "codex"] : ["codex"];
  const candidates = [
    explicit,
    ...names,
    ...commonBinDirs().flatMap((dir) => names.map((name) => path.join(dir, name))),
    ...bundledCodexCandidates()
  ];
  return uniqueList(candidates);
}

function bundledCodexCandidates() {
  if (process.platform !== "darwin") {
    return [];
  }
  const home = os.homedir();
  return [
    "/Applications/Codex.app/Contents/Resources/codex",
    path.join(home, "Applications", "Codex.app", "Contents", "Resources", "codex")
  ];
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

function buildCommandEnv(env = process.env) {
  const auth = inspectCodexAuthEnv(env);
  const home = env.HOME || os.homedir();
  const userProfile = env.USERPROFILE || os.homedir();
  return {
    ...env,
    HOME: home,
    USERPROFILE: userProfile,
    CODEX_HOME: auth.home || env.CODEX_HOME || joinPathIf(home, ".codex"),
    PATH: uniqueList([...commonBinDirs(home, env), env.PATH || ""]).join(path.delimiter)
  };
}

function inspectCodexAuthEnv(env = process.env) {
  const candidates = codexHomeCandidates(env);
  const homeWithAuth = candidates.find((candidate) => fileExists(path.join(candidate, "auth.json")));
  const home = homeWithAuth || candidates[0] || "";
  return {
    home,
    auth_file_ok: Boolean(home && fileExists(path.join(home, "auth.json"))),
    auth_env_ok: hasCodexAuthEnv(env)
  };
}

function codexHomeCandidates(env = process.env) {
  const home = env.HOME || os.homedir();
  const userProfile = env.USERPROFILE || os.homedir();
  return uniqueList([
    env.CODEX_HOME || "",
    joinPathIf(home, ".codex"),
    joinPathIf(userProfile, ".codex"),
    joinPathIf(os.homedir(), ".codex")
  ]);
}

function hasCodexAuthEnv(env = process.env) {
  return ["OPENAI_API_KEY", "CODEX_API_KEY"].some((name) => Boolean(String(env[name] || "").trim()));
}

function joinPathIf(base, ...parts) {
  return base ? path.join(base, ...parts) : "";
}

function fileExists(filePath) {
  try {
    return Boolean(filePath && fs.statSync(filePath).isFile());
  } catch {
    return false;
  }
}

function commonBinDirs(home = os.homedir(), env = process.env) {
  return uniqueList([
    env.CODEX_READER_BIN_DIR || "",
    path.join(home, ".npm-global", "bin"),
    path.join(home, ".local", "bin"),
    path.join(home, ".codex", "bin"),
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
  const text = truncate(context.text || context.selection_text || "", jobType === JOB_TYPES.DOCUMENT_ANALYSIS ? 80000 : 12000);
  const outputLanguage = normalizeOutputLanguage(context.output_language);
  const summaryContext = truncate(context.summary_context || "", 3000) || "No analyzed summary is available yet.";
  const outputStyle = outputStyleInstruction(outputLanguage);
  const webSearchAvailable = context.codex_web_search_ok !== false;

  if (jobType === JOB_TYPES.SELECTION_FACT_CHECK) {
    return [
      "Return JSON only, matching this schema:",
      '{"claim":"string","verdict":"supported|contradicted|unclear|not_checkable","explanation_ko":"string","sources":[{"title":"string","url":"string","publisher":"string","published_date":"string","accessed_date":"' +
        date +
        '","relevance":"high|medium|low"}],"caveats":["string"],"confidence":"high|medium|low"}',
      `Output language: ${outputLanguage}. Write every human-readable string value in ${outputLanguage}, including explanation_ko and caveats, even when a field name contains a language suffix.`,
      outputStyle,
      "Treat the user-provided text as the exact claim or claim bundle to verify. Use the summary and document context only to understand wording, entities, dates, and units.",
      webSearchAvailable
        ? "Use web search. Cite external sources. If the claim cannot be checked, use not_checkable. Use plain text only. Do not use Markdown tables, headings, bold markers, or double-asterisk emphasis markers anywhere in string values."
        : "External web search is unavailable in this Codex CLI environment. Verify from the document context only, use not_checkable when needed, leave sources empty when no external source is available, and mention this limitation in caveats. Use plain text only. Do not use Markdown tables, headings, bold markers, or double-asterisk emphasis markers anywhere in string values.",
      `Document title: ${context.document_title || "Untitled"}`,
      `Automatically extracted summary for context:\n${summaryContext}`,
      `Claim or manual fact-check target:\n${text}`,
      `Document context:\n${truncate(context.surrounding_text || "", 4000)}`
    ].join("\n\n");
  }

  if (jobType === JOB_TYPES.SELECTION_EXPLAIN) {
    return [
      "Return JSON only, matching this schema:",
      '{"explanation_original":"string","explanation_ko":"string","terms":[{"term":"string","definition_original":"string","definition_ko":"string"}],"translation_ko":"string","follow_up_questions":["string"]}',
      `Output language: ${outputLanguage}. Write every human-readable string value in ${outputLanguage}, including explanation_original, explanation_ko, definition fields, translation_ko, and follow_up_questions, even when a field name contains a language suffix.`,
      outputStyle,
      "Explain the exact user-provided target text. Use the summary and surrounding context only to disambiguate the target, connect it to the document, and avoid overexplaining unrelated material.",
      "Do not use web search. Use plain text only. Do not use Markdown tables, headings, bold markers, or double-asterisk emphasis markers anywhere in string values.",
      termSelectionInstruction(5),
      `Document title: ${context.document_title || "Untitled"}`,
      `Automatically extracted summary for context:\n${summaryContext}`,
      `Manual explain target:\n${text}`,
      `Surrounding context:\n${truncate(context.surrounding_text || "", 4000)}`
    ].join("\n\n");
  }

  if (jobType === JOB_TYPES.FOLLOW_UP_ANSWER) {
    return [
      "Return JSON only, matching this schema:",
      '{"question":"string","answer":"string","sources":[{"title":"string","url":"string","publisher":"string","published_date":"string","accessed_date":"' +
        date +
        '","relevance":"high|medium|low"}],"caveats":["string"]}',
      `Output language: ${outputLanguage}. Write every human-readable string value in ${outputLanguage}.`,
      outputStyle,
      webSearchAvailable
        ? "Use web search and the full extracted document text. Answer the clicked follow-up question directly, then connect the answer back to the document's thesis, evidence, and uncertainties."
        : "External web search is unavailable in this Codex CLI environment. Use the full extracted document text only, answer the clicked follow-up question directly, and mention the lack of external web search in caveats.",
      "Use the full extracted text as context and background knowledge, not as a quote dump. Prefer concise reasoning, useful caveats, and external sources that materially improve the answer.",
      "Use plain text only. Do not use Markdown tables, headings, bold markers, or double-asterisk emphasis markers anywhere in string values.",
      `Document title: ${context.document_title || "Untitled"}`,
      `Automatically extracted summary for context:\n${summaryContext}`,
      `Clicked follow-up question:\n${text}`,
      `Full extracted document text:\n${truncate(context.document_text || "", 80000)}`
    ].join("\n\n");
  }

  return [
    "Return JSON only, matching this schema:",
    '{"summary_original":"string","summary_ko":"string","terms":[{"term":"string","definition_original":"string","definition_ko":"string"}],"follow_up_questions_original":["string"],"follow_up_questions_ko":["string"],"follow_up_questions":["string"],"full_text_translation_ko":"string","translation_ko":"string","sources":[]}',
    "Use Codex CLI reasoning for every field. Analyze the source text in the source language for summary_original, definition_original, and follow_up_questions_original. Put Korean only in summary_ko, definition_ko, follow_up_questions_ko, full_text_translation_ko, and translation_ko.",
    `Output language: ${outputLanguage}. Write summary_original, summary_ko, follow_up_questions_original, follow_up_questions_ko, and follow_up_questions in ${outputLanguage}, even when a field name contains a language suffix.`,
    outputStyle,
    "Summary requirement: write the Summary field as 5 to 8 sentences. Keep it concise, but include the central thesis, key evidence, important numbers or dates, assumptions, and main caveats.",
    "translation_ko must be the same value as full_text_translation_ko for backward compatibility. full_text_translation_ko should translate the provided extracted body text, preserving page cues and important numbers. Keep Terms concise and useful for research reading.",
    webSearchAvailable
      ? "Use web search to strengthen Follow-up Questions only: ground the questions in the extracted text, current public context, and plausible counter-evidence. Do not turn follow-up questions into a source list."
      : "External web search is unavailable in this Codex CLI environment. Generate Follow-up Questions from the extracted text only, and focus on internal logic, contradictions, assumptions, and explanation clarity.",
    `Output language for Follow-up Questions: ${outputLanguage}. Write follow_up_questions_original, follow_up_questions_ko, and follow_up_questions in ${outputLanguage}.`,
    followUpQuestionsInstruction(outputLanguage, jobType),
    "Use plain text only. Do not use Markdown tables, headings, bold markers, or double-asterisk emphasis markers anywhere in string values.",
    termSelectionInstruction(10),
    `Analysis scope: ${jobType}`,
    `Document title: ${context.document_title || "Untitled"}`,
    `Text:\n${text}`
  ].join("\n\n");
}

function requiresCodexCli(jobType) {
  return [
    JOB_TYPES.PAGE_ANALYSIS,
    JOB_TYPES.DOCUMENT_ANALYSIS,
    JOB_TYPES.SELECTION_EXPLAIN,
    JOB_TYPES.FOLLOW_UP_ANSWER
  ].includes(jobType);
}

function termSelectionInstruction(targetCount) {
  return [
    `Terms selection criteria: return about ${targetCount} terms when available.`,
    "Prioritize abbreviations, acronyms, tickers, metric names, endpoints, regulatory/commercial shorthand, and genuinely difficult domain-specific words.",
    "Prefer terms that affect interpretation of the document. Exclude generic business words, ordinary verbs/adjectives, boilerplate, and company names unless the abbreviation or ticker itself needs explanation."
  ].join(" ");
}

function normalizeOutputLanguage(value) {
  return /^ko|korean$/i.test(String(value || "")) ? "Korean" : "English";
}

function outputStyleInstruction(outputLanguage) {
  const koreanClause =
    outputLanguage === "Korean"
      ? 'For Korean output, end most points with noun-form endings such as "-함", "-필요", "-가능성", "-근거", "-한계", or "-의미" instead of polite sentence endings.'
      : "For English output, prefer concise itemized phrases and nominal wording where natural.";
  return [
    "Output style: keep the core content concise, clear, and itemized in gaejo-sik style (개조식).",
    "Prefer short point-by-point lines over long paragraphs when a field contains multiple ideas.",
    "For Korean, this means using noun-form sentence endings (명사형 종결어미) where natural.",
    koreanClause
  ].join(" ");
}

function followUpQuestionsInstruction(outputLanguage, jobType) {
  const scopeText =
    jobType === JOB_TYPES.PAGE_ANALYSIS
      ? "Adapt each question to the current page only."
      : "Adapt each question to the full analyzed document.";
  const defaults = defaultFollowUpQuestions(outputLanguage);
  return [
    "Follow-up Questions criteria: return exactly three questions, based on these default question intents.",
    scopeText,
    "Question 1 must ask for objective logical errors, contradictions, or internal tensions.",
    "Question 2 must use a Devil's Advocate perspective to rebut the main points one by one.",
    "Question 3 must ask for a simple middle-school-level explanation of the analyzed content.",
    `Default question wording:\n1. ${defaults[0]}\n2. ${defaults[1]}\n3. ${defaults[2]}`
  ].join(" ");
}

function defaultFollowUpQuestions(outputLanguage = "Korean") {
  if (normalizeOutputLanguage(outputLanguage) === "English") {
    return [
      "Find any logical errors or contradictions in the whole content and explain them objectively.",
      "From a Devil's Advocate perspective, rebut the main points of this content one by one.",
      "Explain the whole content simply at a level a middle-school student can understand."
    ];
  }
  return [
    "전체 내용에서 논리적 오류 또는 상충되는 부분을 찾아 객관적으로 설명해주세요",
    "Devil's Advocate 관점에서 이 내용의 주요 내용을 하나하나 반박해주세요",
    "전체 내용을 중학생이 이해할 수 있는 수준으로 쉽게 설명해주세요"
  ];
}

function sanitizeCodexResult(value) {
  if (typeof value === "string") {
    return stripMarkdownOutputMarkers(value);
  }
  if (Array.isArray(value)) {
    return value.map(sanitizeCodexResult);
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, sanitizeCodexResult(item)]));
  }
  return value;
}

function stripMarkdownOutputMarkers(value) {
  return String(value || "")
    .replace(/\*\*/g, "")
    .replace(/^\s{0,3}#{1,6}\s*/gm, "")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function parseCodexJson(stdout, stderr = "") {
  const texts = uniqueList([stdout, stderr, `${stdout || ""}\n${stderr || ""}`]);
  for (const text of texts) {
    const parsed = parseCodexText(text);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

function parseCodexText(value) {
  const text = String(value || "").trim();
  if (!text) {
    return null;
  }

  const direct = tryParseJson(text);
  const directResult = pickCodexResult(direct);
  if (directResult) {
    return directResult;
  }
  if (direct && typeof direct === "object" && !Array.isArray(direct) && !isLikelyCodexEvent(direct)) {
    return direct;
  }

  const parsedObjects = extractJsonObjects(text);
  for (let i = parsedObjects.length - 1; i >= 0; i -= 1) {
    const result = pickCodexResult(parsedObjects[i]);
    if (result) {
      return result;
    }
  }
  if (parsedObjects.length === 1 && !isLikelyCodexEvent(parsedObjects[0])) {
    return parsedObjects[0];
  }

  const lines = text.split(/\r?\n/).filter(Boolean);
  const fragments = [];
  for (const line of lines) {
    const event = tryParseJson(line);
    if (event) {
      fragments.push(...collectCodexTextFragments(event));
    }
  }
  if (fragments.length) {
    const result = parseCodexText(fragments.join(""));
    if (result) {
      return result;
    }
  }

  return null;
}

function pickCodexResult(value, depth = 0) {
  if (!value || depth > 8) {
    return null;
  }
  if (typeof value === "string") {
    return parseCodexText(value);
  }
  if (Array.isArray(value)) {
    for (let i = value.length - 1; i >= 0; i -= 1) {
      const result = pickCodexResult(value[i], depth + 1);
      if (result) {
        return result;
      }
    }
    return null;
  }
  if (typeof value !== "object") {
    return null;
  }
  if (looksLikeCodexResult(value)) {
    return value;
  }

  for (const key of ["output", "result", "final", "response", "message", "text", "content", "data", "item", "payload"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      const result = pickCodexResult(value[key], depth + 1);
      if (result) {
        return result;
      }
    }
  }

  return null;
}

function looksLikeCodexResult(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  return [
    "summary_original",
    "summary_ko",
    "full_text_translation_ko",
    "translation_ko",
    "follow_up_questions",
    "explanation_original",
    "explanation_ko",
    "claim",
    "verdict",
    "answer",
    "question"
  ].some((key) => Object.prototype.hasOwnProperty.call(value, key));
}

function isLikelyCodexEvent(value) {
  return Boolean(
    value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      typeof value.type === "string" &&
      !looksLikeCodexResult(value)
  );
}

function collectCodexTextFragments(value, depth = 0) {
  if (!value || depth > 8) {
    return [];
  }
  if (typeof value === "string") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectCodexTextFragments(item, depth + 1));
  }
  if (typeof value !== "object") {
    return [];
  }

  const fragments = [];
  for (const key of ["delta", "text", "message", "content", "output", "result", "final", "response"]) {
    if (Object.prototype.hasOwnProperty.call(value, key)) {
      fragments.push(...collectCodexTextFragments(value[key], depth + 1));
    }
  }
  return fragments;
}

function extractJsonObjects(text) {
  const source = String(text || "");
  const objects = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let i = 0; i < source.length; i += 1) {
    const char = source[i];
    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) {
        start = i;
      }
      depth += 1;
    } else if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start !== -1) {
        const parsed = tryParseJson(source.slice(start, i + 1));
        if (parsed) {
          objects.push(parsed);
        }
        start = -1;
      }
    }
  }

  return objects;
}

function tryParseJson(text) {
  try {
    return JSON.parse(String(text || "").trim());
  } catch {
    return null;
  }
}

function formatCodexOutputError(stdout, stderr) {
  const parts = [];
  const stderrText = normalizeWhitespace(stderr || "");
  const stdoutText = normalizeWhitespace(stdout || "");
  if (stderrText) {
    parts.push(`stderr: ${stderrText.slice(0, 500)}`);
  }
  if (stdoutText) {
    parts.push(`stdout: ${stdoutText.slice(0, 500)}`);
  }
  return parts.join(" ");
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
      terms: makeSpecializedTerms(text),
      translation_ko: makeTranslationNote(text),
      follow_up_questions: makeQuestions(text, true),
      caveats: [caveat]
    };
  }

  if (jobType === JOB_TYPES.FOLLOW_UP_ANSWER) {
    return {
      question: text,
      answer: "Codex CLI follow-up answering was unavailable. Restart the MacBook server and run the question again.",
      sources: [],
      caveats: [caveat]
    };
  }

  return {
    summary_original: makeOriginalSummary(text),
    summary_ko: makeSummary(text),
    terms: makeSpecializedTerms(text),
    full_text_translation_ko: makeTranslationNote(text),
    translation_ko: makeTranslationNote(text),
    follow_up_questions_original: makeQuestions(text, false),
    follow_up_questions_ko: makeQuestions(text, false),
    follow_up_questions: makeQuestions(text, false),
    sources: [],
    caveats: [caveat]
  };
}

function makeOriginalSummary(text) {
  if (!text) {
    return "No extracted text is available.";
  }
  const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).filter(Boolean).slice(0, 8);
  return sentences.join(" ") || text.slice(0, 280);
}

function makeSummary(text) {
  if (!text) {
    return "분석할 추출 텍스트가 없습니다. 스캔 PDF라면 OCR이 필요합니다.";
  }
  const sentences = text.split(/(?<=[.!?。！？])\s+|\n+/).filter(Boolean).slice(0, 8);
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

function makeSpecializedTerms(text) {
  const common = new Set([
    "about",
    "after",
    "also",
    "analysis",
    "business",
    "company",
    "could",
    "document",
    "expected",
    "from",
    "have",
    "into",
    "market",
    "more",
    "other",
    "page",
    "report",
    "research",
    "should",
    "than",
    "that",
    "their",
    "there",
    "this",
    "with",
    "would"
  ]);
  const counts = new Map();
  const words = normalizeWhitespace(text)
    .split(/[^A-Za-z0-9&./-]+/)
    .map((word) => word.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((word) => word.length >= 2 && !/^\d+$/.test(word) && !common.has(word.toLowerCase()));

  for (const word of words) {
    const key = word.toLowerCase();
    const abbreviation = /^[A-Z0-9&/-]{2,10}$/.test(word) && /[A-Z]/.test(word);
    const difficult = word.length >= 9 || /[-/&]/.test(word);
    if (!abbreviation && !difficult) {
      continue;
    }
    const score = (abbreviation ? 12 : 0) + (difficult ? 5 : 0);
    counts.set(key, { term: word, count: (counts.get(key)?.count || 0) + 1, score });
  }

  return [...counts.values()]
    .sort((a, b) => b.score + b.count - (a.score + a.count))
    .slice(0, 10)
    .map((item) => ({
      term: item.term,
      definition_original:
        "Specialized abbreviation, metric, or difficult source-text term. Check the surrounding context for the precise document-specific meaning.",
      definition_ko:
        "문서 이해에 영향을 줄 수 있는 약어, 지표, 또는 난도가 높은 전문용어입니다. 정확한 의미는 주변 문맥을 함께 확인하세요."
    }));
}

function makeTranslationNote(text) {
  if (!text) {
    return "번역할 텍스트가 없습니다.";
  }
  return `로컬 fallback은 전문 번역 대신 의미를 한국어로 정리합니다: ${text.slice(0, 500)}`;
}

function makeQuestions(text, selection) {
  return defaultFollowUpQuestions("Korean");
}

function truncate(value, max) {
  const text = String(value || "");
  return text.length > max ? `${text.slice(0, max)}\n\n[truncated]` : text;
}

module.exports = {
  CodexAdapter,
  buildCodexArgs,
  buildCommandEnv,
  buildPrompt,
  firstCommandWord,
  inspectCodexAuthEnv,
  parseCodexJson,
  codexCommandCandidates,
  requiresCodexCli,
  sanitizeCodexResult,
  stripMarkdownOutputMarkers,
  makeSpecializedTerms,
  defaultFollowUpQuestions,
  fallbackResult
};
