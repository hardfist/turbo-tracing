const express = require('express');
const fs = require('fs/promises');
const http = require('http');
const multer = require('multer');
const path = require('path');
const WebSocket = require('ws');
const config = require('./config');
const { ensureDir } = require('./fs-utils');
const { mirrorViewer, viewerDir } = require('./viewer');
const { releaseStatus } = require('./release');
const { SessionManager } = require('./session-manager');

async function main() {
  await ensureDir(config.dataDir);
  await mirrorViewer();

  const app = express();
  const server = http.createServer(app);
  const sessions = new SessionManager();
  const upload = multer({
    dest: path.join(config.dataDir, 'incoming'),
    limits: { fileSize: config.maxUploadBytes, files: 1 },
  });

  app.disable('x-powered-by');

  app.get('/healthz', async (_req, res) => {
    let release;
    try { release = await releaseStatus(); } catch (error) { release = { error: error.message }; }
    res.json({ ok: true, release });
  });

  app.get('/api/release', async (_req, res) => {
    try {
      res.json(await releaseStatus());
    } catch (error) {
      res.status(500).json({ error: error.message });
    }
  });

  app.post('/api/upload', upload.single('trace'), async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'missing multipart field: trace' });
      return;
    }
    try {
      const session = await sessions.createSession(req.file);
      res.json({ sessionId: session.id, session });
    } catch (error) {
      if (req.file && req.file.path) {
        await fs.rm(req.file.path, { force: true }).catch(() => {});
      }
      res.status(500).json({ error: error.message });
    }
  });

  app.get('/api/sessions/:id', (req, res) => {
    const session = sessions.getSession(req.params.id);
    if (!session) {
      res.status(404).json({ error: 'unknown session' });
      return;
    }
    res.json(sessions.publicSession(session));
  });

  app.delete('/api/sessions/:id', async (req, res) => {
    res.json({ deleted: await sessions.destroySession(req.params.id) });
  });

  app.use('/upload-layer.js', express.static(path.join(config.rootDir, 'public', 'upload-layer.js'), { etag: true }));
  app.use(express.static(viewerDir, { etag: true, fallthrough: true }));

  app.use((req, res) => {
    res.status(404).json({ error: 'not found', path: req.path });
  });

  const wss = new WebSocket.Server({ noServer: true });
  server.on('upgrade', (req, socket, head) => {
    const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
    const match = url.pathname.match(/^\/ws\/([^/]+)$/);
    if (!match) {
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (browserSocket) => {
      sessions.proxyWebSocket(decodeURIComponent(match[1]), browserSocket);
    });
  });

  server.listen(config.port, config.host, () => {
    console.log(`turbopack tracing viewer listening on http://${config.host}:${config.port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
