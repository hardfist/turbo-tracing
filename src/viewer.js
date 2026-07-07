const fs = require('fs/promises');
const path = require('path');
const config = require('./config');
const { downloadToFile, ensureDir, pathExists, writeJson, readJson } = require('./fs-utils');

const viewerDir = path.join(config.dataDir, 'viewer-cache');
const metaPath = path.join(viewerDir, 'viewer.json');

function assetPathFromUrl(rawUrl) {
  const url = new URL(rawUrl, config.viewerUrl);
  return url.pathname;
}

function extractStaticAssetPaths(html) {
  const paths = new Set();
  const attrRe = /(?:src|href)=["']([^"']+)["']/g;
  let match;
  while ((match = attrRe.exec(html))) {
    const value = match[1];
    if (value.startsWith('/_next/')) {
      paths.add(assetPathFromUrl(value));
    }
  }
  return [...paths];
}

function patchViewerJs(source) {
  const wsExpression = '"ws://localhost:".concat(u)';
  const replacement = '(()=>{let session=new URLSearchParams(window.location.search).get("session")||"";let proto=window.location.protocol==="https:"?"wss:":"ws:";return proto+"//"+window.location.host+"/ws/"+encodeURIComponent(session)})()';
  if (!source.includes(wsExpression)) {
    return { code: source, patched: false };
  }
  return { code: source.replace(wsExpression, replacement), patched: true };
}

function withBasePath(html) {
  if (!config.basePath) return html;
  return html
    .replace(/(src|href)=(["'])\/_next\//g, `$1=$2${config.basePath}/_next/`)
    .replace(/(href)=(["'])\/favicon\.ico/g, `$1=$2${config.basePath}/favicon.ico`)
    .replace(/(href)=(["'])\/icon\.svg/g, `$1=$2${config.basePath}/icon.svg`);
}

function injectUploadLayer(html) {
  const marker = '</body>';
  const baseScript = `<script>window.__TRACE_BASE_PATH=${JSON.stringify(config.basePath)};</script>`;
  const snippet = `${baseScript}<script src="${config.basePath}/upload-layer.js"></script>`;
  if (html.includes('/upload-layer.js')) return html;
  if (html.includes(marker)) return html.replace(marker, `${snippet}${marker}`);
  return `${html}${snippet}`;
}

async function fetchText(url) {
  const res = await fetch(url, { redirect: 'follow', headers: { 'User-Agent': 'turbopack-tracing-viewer' } });
  if (!res.ok) throw new Error(`fetch failed ${res.status} ${res.statusText}: ${url}`);
  return res.text();
}

async function mirrorViewer({ force = false } = {}) {
  await ensureDir(viewerDir);
  if (!force && await pathExists(metaPath)) {
    try {
      const meta = await readJson(metaPath);
      if (meta.viewerUrl === config.viewerUrl && meta.patchedWebSocket) {
        return meta;
      }
    } catch {
      // Remirror if metadata is bad.
    }
  }

  const root = new URL(config.viewerUrl);
  const html = await fetchText(root.toString());
  const assetPaths = extractStaticAssetPaths(html);
  let patchedWebSocket = false;
  const downloaded = [];

  for (const assetPath of assetPaths) {
    const url = new URL(assetPath, root);
    const dest = path.join(viewerDir, assetPath.replace(/^\//, ''));
    await downloadToFile(url.toString(), dest, { 'User-Agent': 'turbopack-tracing-viewer' });
    if (assetPath.endsWith('.js')) {
      const original = await fs.readFile(dest, 'utf8');
      const patched = patchViewerJs(original);
      if (patched.patched) {
        patchedWebSocket = true;
        await fs.writeFile(dest, patched.code);
      }
    }
    downloaded.push(assetPath);
  }

  if (!patchedWebSocket) {
    throw new Error('Could not patch trace viewer WebSocket URL; trace.nextjs.org bundle shape changed');
  }

  await fs.writeFile(path.join(viewerDir, 'index.html'), injectUploadLayer(withBasePath(html)));
  const meta = {
    viewerUrl: config.viewerUrl,
    mirroredAt: new Date().toISOString(),
    assets: downloaded,
    patchedWebSocket,
  };
  await writeJson(metaPath, meta);
  return meta;
}

module.exports = {
  viewerDir,
  mirrorViewer,
};
