const path = require('path');

const rootDir = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'var'));

function normalizeBasePath(value) {
  if (!value) return '';
  let base = value.trim();
  if (!base || base === '/') return '';
  if (!base.startsWith('/')) base = `/${base}`;
  return base.replace(/\/+$/, '');
}

module.exports = {
  rootDir,
  dataDir,
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 3000),
  viewerUrl: process.env.TRACE_VIEWER_URL || 'https://trace.nextjs.org/',
  bundlerDiffRepo: process.env.BUNDLER_DIFF_REPO || 'hardfist/bundler-diff',
  releaseTag: process.env.TRACE_SERVER_RELEASE_TAG || 'turbopack-cli-main',
  releaseAsset: process.env.TRACE_SERVER_ASSET || 'turbo-trace-server-linux-x64.tar.gz',
  localTraceServerBin: process.env.TURBO_TRACE_SERVER_BIN || '',
  sessionTtlMs: Number(process.env.SESSION_TTL_MS || 60 * 60 * 1000),
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES || 1024 * 1024 * 1024),
  basePath: normalizeBasePath(process.env.PUBLIC_BASE_PATH || process.env.BASE_PATH || ''),
};
