const fs = require('fs/promises');
const path = require('path');
const tar = require('tar');
const config = require('./config');
const { downloadToFile, ensureDir, pathExists, readJson, writeJson } = require('./fs-utils');

const releaseDir = path.join(config.dataDir, 'trace-server');
const binPath = path.join(releaseDir, 'turbo-trace-server');
const metaPath = path.join(releaseDir, 'release.json');

function githubHeaders() {
  const headers = {
    Accept: 'application/vnd.github+json',
    'User-Agent': 'turbopack-tracing-viewer',
  };
  if (process.env.GITHUB_TOKEN) {
    headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  }
  return headers;
}

async function fetchRelease() {
  const url = `https://api.github.com/repos/${config.bundlerDiffRepo}/releases/tags/${config.releaseTag}`;
  const res = await fetch(url, { headers: githubHeaders() });
  if (!res.ok) {
    throw new Error(`GitHub release lookup failed ${res.status} ${res.statusText}: ${url}`);
  }
  return res.json();
}

async function resolveTraceServerBinary() {
  if (config.localTraceServerBin) {
    const local = path.resolve(config.localTraceServerBin);
    if (!(await pathExists(local))) {
      throw new Error(`TURBO_TRACE_SERVER_BIN does not exist: ${local}`);
    }
    return {
      binPath: local,
      source: 'local',
      repo: config.bundlerDiffRepo,
      tag: config.releaseTag,
      asset: null,
    };
  }

  if (await pathExists(binPath)) {
    try {
      const meta = await readJson(metaPath);
      if (meta.repo === config.bundlerDiffRepo && meta.tag === config.releaseTag && meta.assetName === config.releaseAsset) {
        return { ...meta, binPath };
      }
    } catch {
      // Re-download if metadata is unreadable.
    }
  }

  const release = await fetchRelease();
  const asset = (release.assets || []).find((item) => item.name === config.releaseAsset);
  if (!asset) {
    const names = (release.assets || []).map((item) => item.name).join(', ') || '(none)';
    throw new Error(`Release ${config.bundlerDiffRepo}@${config.releaseTag} does not contain ${config.releaseAsset}. Available assets: ${names}`);
  }

  await ensureDir(releaseDir);
  const archive = path.join(releaseDir, config.releaseAsset);
  await downloadToFile(asset.browser_download_url, archive, githubHeaders());
  await fs.rm(path.join(releaseDir, 'extract'), { recursive: true, force: true });
  const extractDir = path.join(releaseDir, 'extract');
  await ensureDir(extractDir);
  await tar.x({ file: archive, cwd: extractDir });

  const extractedBin = path.join(extractDir, 'turbo-trace-server');
  if (!(await pathExists(extractedBin))) {
    throw new Error(`${config.releaseAsset} did not contain turbo-trace-server`);
  }
  await fs.copyFile(extractedBin, binPath);
  await fs.chmod(binPath, 0o755);

  let sourceCommit = release.target_commitish;
  const sourceCommitFile = path.join(extractDir, 'source-commit.txt');
  if (await pathExists(sourceCommitFile)) {
    sourceCommit = (await fs.readFile(sourceCommitFile, 'utf8')).trim();
  }

  const meta = {
    source: 'github-release',
    repo: config.bundlerDiffRepo,
    tag: config.releaseTag,
    assetName: asset.name,
    assetUrl: asset.browser_download_url,
    releaseUrl: release.html_url,
    publishedAt: release.published_at,
    sourceCommit,
    downloadedAt: new Date().toISOString(),
  };
  await writeJson(metaPath, meta);
  return { ...meta, binPath };
}

async function releaseStatus() {
  if (config.localTraceServerBin) {
    return resolveTraceServerBinary();
  }
  if (await pathExists(metaPath)) {
    const meta = await readJson(metaPath);
    return { ...meta, binPath, ready: await pathExists(binPath) };
  }
  return {
    source: 'not-downloaded',
    repo: config.bundlerDiffRepo,
    tag: config.releaseTag,
    assetName: config.releaseAsset,
    ready: false,
  };
}

module.exports = {
  resolveTraceServerBinary,
  releaseStatus,
};
