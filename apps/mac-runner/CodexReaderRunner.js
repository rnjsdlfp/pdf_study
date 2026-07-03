#!/usr/bin/env node

const fs = require("fs");
const http = require("http");
const { randomUUID } = require("crypto");
const { createConfig } = require("../server/src/config");
const { createRuntimePaths, ensureRuntimeDirs } = require("../server/src/runtime");
const { createLogger } = require("../server/src/logger");
const { startServer } = require("../server/src/main");

async function main() {
  const config = createConfig();
  const paths = createRuntimePaths(config.runtimeHome);
  ensureRuntimeDirs(paths);
  const logger = createLogger(paths.logsDir, "runner");

  const existing = await detectExisting(paths, config);
  if (existing.alive) {
    logger.info("Runner already active; not starting a duplicate server.", existing);
    console.log(JSON.stringify({ ok: true, status: "already_running", existing }, null, 2));
    return;
  }

  if (existing.staleLock) {
    logger.warn("Recovered stale runner lock.", existing);
  }

  acquireLock(paths);
  process.env.CODEX_READER_INSTANCE_ID = `runner_${randomUUID().replace(/-/g, "").slice(0, 12)}`;

  const cleanup = () => {
    try {
      if (fs.existsSync(paths.runnerLockFile)) {
        fs.rmSync(paths.runnerLockFile, { force: true });
      }
      if (fs.existsSync(paths.runnerPidFile)) {
        fs.rmSync(paths.runnerPidFile, { force: true });
      }
    } catch {
      // Nothing useful to do during process shutdown.
    }
  };

  process.on("SIGINT", () => {
    cleanup();
    process.exit(0);
  });
  process.on("SIGTERM", () => {
    cleanup();
    process.exit(0);
  });
  process.on("exit", cleanup);

  await startServer();
  logger.info("Runner started.", {
    pid: process.pid,
    instanceId: process.env.CODEX_READER_INSTANCE_ID,
    runtimeHome: config.runtimeHome
  });
}

async function detectExisting(paths, config) {
  const pid = readPid(paths.runnerPidFile);
  const pidAlive = pid ? isPidAlive(pid) : false;
  const health = await getHealth(config.host, config.port);

  if (pidAlive || health.ok) {
    return {
      alive: true,
      pid,
      pid_alive: pidAlive,
      health_ok: health.ok,
      health: health.payload
    };
  }

  const staleLock = fs.existsSync(paths.runnerLockFile) || fs.existsSync(paths.runnerPidFile);
  if (staleLock) {
    fs.rmSync(paths.runnerLockFile, { force: true });
    fs.rmSync(paths.runnerPidFile, { force: true });
  }

  return {
    alive: false,
    staleLock
  };
}

function acquireLock(paths) {
  const payload = {
    pid: process.pid,
    created_at: new Date().toISOString()
  };
  fs.writeFileSync(paths.runnerLockFile, JSON.stringify(payload, null, 2), { flag: "wx" });
  fs.writeFileSync(paths.runnerPidFile, String(process.pid));
}

function readPid(file) {
  try {
    const value = fs.readFileSync(file, "utf8").trim();
    const pid = Number(value);
    return Number.isInteger(pid) ? pid : null;
  } catch {
    return null;
  }
}

function isPidAlive(pid) {
  if (!pid || pid === process.pid) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function getHealth(host, port) {
  return new Promise((resolve) => {
    const request = http.request(
      {
        host,
        port,
        path: "/health",
        method: "GET",
        timeout: 1000
      },
      (response) => {
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            resolve({ ok: response.statusCode === 200, payload: JSON.parse(Buffer.concat(chunks).toString("utf8")) });
          } catch {
            resolve({ ok: response.statusCode === 200, payload: null });
          }
        });
      }
    );

    request.on("timeout", () => {
      request.destroy();
      resolve({ ok: false, payload: null });
    });
    request.on("error", () => resolve({ ok: false, payload: null }));
    request.end();
  });
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  detectExisting,
  acquireLock,
  isPidAlive
};
