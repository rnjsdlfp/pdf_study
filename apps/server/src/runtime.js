const fs = require("fs");
const path = require("path");

function createRuntimePaths(runtimeHome) {
  const dataDir = path.join(runtimeHome, "data");
  return {
    home: runtimeHome,
    dataDir,
    uploadsDir: path.join(dataDir, "uploads"),
    extractedDir: path.join(dataDir, "extracted"),
    analysisCacheDir: path.join(dataDir, "analysis-cache"),
    jobsDir: path.join(dataDir, "jobs"),
    logsDir: path.join(runtimeHome, "logs"),
    runDir: path.join(runtimeHome, "run"),
    storeFile: path.join(dataDir, "reader-store.json"),
    runnerLockFile: path.join(runtimeHome, "run", "runner.lock"),
    runnerPidFile: path.join(runtimeHome, "run", "runner.pid")
  };
}

function ensureRuntimeDirs(paths) {
  [
    paths.home,
    paths.dataDir,
    paths.uploadsDir,
    paths.extractedDir,
    paths.analysisCacheDir,
    paths.jobsDir,
    paths.logsDir,
    paths.runDir
  ].forEach((dir) => fs.mkdirSync(dir, { recursive: true }));
}

function assertInside(parent, child) {
  const parentResolved = path.resolve(parent);
  const childResolved = path.resolve(child);
  const relative = path.relative(parentResolved, childResolved);

  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`Path escapes runtime directory: ${childResolved}`);
  }

  return childResolved;
}

module.exports = {
  createRuntimePaths,
  ensureRuntimeDirs,
  assertInside
};
