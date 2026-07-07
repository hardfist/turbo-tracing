const fs = require('fs/promises');
const path = require('path');
const { createWriteStream } = require('fs');
const { pipeline } = require('stream/promises');

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function pathExists(file) {
  try {
    await fs.access(file);
    return true;
  } catch {
    return false;
  }
}

async function writeJson(file, value) {
  await ensureDir(path.dirname(file));
  await fs.writeFile(file, JSON.stringify(value, null, 2));
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, 'utf8'));
}

async function downloadToFile(url, file, headers = {}) {
  await ensureDir(path.dirname(file));
  const res = await fetch(url, { headers, redirect: 'follow' });
  if (!res.ok) {
    throw new Error(`download failed ${res.status} ${res.statusText}: ${url}`);
  }
  await pipeline(res.body, createWriteStream(file));
}

module.exports = {
  ensureDir,
  pathExists,
  writeJson,
  readJson,
  downloadToFile,
};
