const { createConfig } = require("./config");
const { createRuntimePaths, ensureRuntimeDirs } = require("./runtime");
const { createLogger } = require("./logger");
const { JsonStore } = require("./store");
const { EventHub } = require("./eventHub");
const { CodexAdapter } = require("./codexAdapter");
const { createWorker } = require("./worker");
const { createApp } = require("./server");

async function startServer(overrides = {}) {
  const config = createConfig(overrides);
  const paths = createRuntimePaths(config.runtimeHome);
  ensureRuntimeDirs(paths);

  const logger = createLogger(paths.logsDir, "server");
  const store = new JsonStore(paths.storeFile);
  const eventHub = new EventHub();
  const codexAdapter = new CodexAdapter(config, logger);
  const worker = createWorker({ store, eventHub, codexAdapter, logger, maxConcurrency: config.maxCodexConcurrency });
  const app = createApp({ config, paths, store, eventHub, codexAdapter, worker, logger });

  worker.start();

  await new Promise((resolve, reject) => {
    app.once("error", reject);
    app.listen(config.port, config.host, resolve);
  });

  logger.info(`Codex Reader server listening on http://${config.host}:${config.port}`, {
    runtimeHome: config.runtimeHome
  });

  return {
    app,
    worker,
    config,
    paths,
    close: () =>
      new Promise((resolve) => {
        worker.stop();
        app.close(resolve);
      })
  };
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  startServer
};
