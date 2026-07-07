const fs = require('fs/promises');
const net = require('net');
const path = require('path');
const { spawn } = require('child_process');
const { nanoid } = require('nanoid');
const WebSocket = require('ws');
const config = require('./config');
const { ensureDir } = require('./fs-utils');
const { resolveTraceServerBinary } = require('./release');

function getFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      server.close(() => resolve(address.port));
    });
  });
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

class SessionManager {
  constructor() {
    this.sessions = new Map();
    this.uploadDir = path.join(config.dataDir, 'uploads');
    this.sweepTimer = setInterval(() => this.sweep(), Math.min(config.sessionTtlMs, 5 * 60 * 1000));
    this.sweepTimer.unref();
  }

  async createSession(uploadedFile) {
    await ensureDir(this.uploadDir);
    const sessionId = nanoid(12);
    const storedName = `${sessionId}-${path.basename(uploadedFile.originalname || 'trace.bin').replace(/[^a-zA-Z0-9._-]/g, '_')}`;
    const tracePath = path.join(this.uploadDir, storedName);
    await fs.rename(uploadedFile.path, tracePath);
    const session = await this.startTraceServer({
      sessionId,
      tracePath,
      fileName: uploadedFile.originalname || storedName,
      size: uploadedFile.size,
      createdAt: Date.now(),
    });
    return this.publicSession(session);
  }

  async startTraceServer({ sessionId, tracePath, fileName, size, createdAt }) {
    const port = await getFreePort();
    const binary = await resolveTraceServerBinary();
    const child = spawn(binary.binPath, [tracePath, String(port)], {
      cwd: this.uploadDir,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, RUST_BACKTRACE: process.env.RUST_BACKTRACE || '1' },
    });

    const logs = [];
    const pushLog = (chunk) => {
      logs.push(chunk.toString());
      if (logs.length > 80) logs.shift();
    };
    child.stdout.on('data', pushLog);
    child.stderr.on('data', pushLog);

    const now = Date.now();
    const session = {
      id: sessionId,
      port,
      tracePath,
      fileName,
      size,
      child,
      createdAt: createdAt || now,
      lastUsedAt: now,
      binary,
      logs,
    };
    this.sessions.set(sessionId, session);

    child.once('exit', (code, signal) => {
      session.exitedAt = Date.now();
      session.exitCode = code;
      session.exitSignal = signal;
    });

    // Give the Rust server a short head start. It continues ingesting the trace in the background.
    await wait(300);
    if (child.exitCode !== null) {
      const logText = logs.join('');
      await this.destroySession(sessionId);
      throw new Error(`turbo-trace-server exited early (${child.exitCode}): ${logText.slice(-2000)}`);
    }

    return session;
  }

  async restoreSession(id) {
    if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
    await ensureDir(this.uploadDir);
    const entries = await fs.readdir(this.uploadDir).catch(() => []);
    const storedName = entries.find((name) => name.startsWith(`${id}-`));
    if (!storedName) return null;
    const tracePath = path.join(this.uploadDir, storedName);
    const stat = await fs.stat(tracePath).catch(() => null);
    if (!stat || !stat.isFile()) return null;
    return this.startTraceServer({
      sessionId: id,
      tracePath,
      fileName: storedName.slice(id.length + 1) || storedName,
      size: stat.size,
      createdAt: stat.mtimeMs,
    });
  }

  async getSession(id) {
    let session = this.sessions.get(id);
    if (!session) session = await this.restoreSession(id);
    if (session) session.lastUsedAt = Date.now();
    return session;
  }

  publicSession(session) {
    return {
      id: session.id,
      port: session.port,
      fileName: session.fileName,
      size: session.size,
      createdAt: new Date(session.createdAt).toISOString(),
      lastUsedAt: new Date(session.lastUsedAt).toISOString(),
      release: {
        source: session.binary.source,
        repo: session.binary.repo,
        tag: session.binary.tag,
        assetName: session.binary.assetName,
        releaseUrl: session.binary.releaseUrl,
        sourceCommit: session.binary.sourceCommit,
      },
    };
  }

  async destroySession(id) {
    const session = this.sessions.get(id);
    if (!session) return false;
    this.sessions.delete(id);
    try {
      if (session.child && session.child.exitCode === null) {
        session.child.kill('SIGTERM');
        setTimeout(() => {
          if (session.child.exitCode === null) session.child.kill('SIGKILL');
        }, 3000).unref();
      }
    } catch {}
    try { await fs.rm(session.tracePath, { force: true }); } catch {}
    return true;
  }

  async sweep() {
    const cutoff = Date.now() - config.sessionTtlMs;
    const deletions = [];
    for (const session of this.sessions.values()) {
      if (session.lastUsedAt < cutoff || session.exitCode !== undefined) {
        deletions.push(this.destroySession(session.id));
      }
    }
    await Promise.allSettled(deletions);
  }

  proxyWebSocket(sessionId, browserSocket) {
    const pendingBrowserMessages = [];
    let upstreamReady = null;

    browserSocket.on('message', (data, isBinary) => {
      if (upstreamReady) {
        upstreamReady(data, isBinary);
      } else {
        pendingBrowserMessages.push([data, isBinary]);
      }
    });

    this.getSession(sessionId).then((session) => {
      if (!session) {
        browserSocket.close(1008, 'unknown trace session');
        return;
      }
      this.proxyWebSocketToSession(session, browserSocket, pendingBrowserMessages, (sender) => {
        upstreamReady = sender;
      });
    }).catch((error) => {
      browserSocket.close(1011, `trace session restore failed: ${error.message}`.slice(0, 120));
    });
  }

  proxyWebSocketToSession(session, browserSocket, pendingBrowserMessages, setUpstreamSender) {
    const upstream = new WebSocket(`ws://127.0.0.1:${session.port}`);
    const closeBoth = (code, reason) => {
      try { if (browserSocket.readyState === WebSocket.OPEN) browserSocket.close(code, reason); } catch {}
      try { if (upstream.readyState === WebSocket.OPEN) upstream.close(code, reason); } catch {}
    };

    const sendToUpstream = (data, isBinary) => {
      session.lastUsedAt = Date.now();
      if (upstream.readyState === WebSocket.OPEN) {
        upstream.send(data, { binary: isBinary });
      } else if (upstream.readyState === WebSocket.CONNECTING) {
        pendingBrowserMessages.push([data, isBinary]);
      }
    };
    setUpstreamSender(sendToUpstream);

    upstream.on('open', () => {
      // Seed the trace server with a valid viewport. Some clients send this as
      // their very first frame; if that frame races session restoration, the
      // viewer stays blank. This idempotent request makes the session useful
      // immediately, and later client view-rect frames refine it.
      upstream.send(JSON.stringify({
        type: 'view-rect',
        viewRect: {
          x: 0,
          y: 0,
          width: 1000000,
          height: 80,
          horizontalPixels: 1600,
          query: '',
          viewMode: 'aggregated',
          valueMode: 'duration',
        },
      }));
      while (pendingBrowserMessages.length > 0 && upstream.readyState === WebSocket.OPEN) {
        const [data, isBinary] = pendingBrowserMessages.shift();
        upstream.send(data, { binary: isBinary });
      }
      upstream.on('message', (data, isBinary) => {
        session.lastUsedAt = Date.now();
        if (browserSocket.readyState === WebSocket.OPEN) browserSocket.send(data, { binary: isBinary });
      });
    });

    upstream.on('error', (error) => {
      browserSocket.close(1011, `trace server error: ${error.message}`.slice(0, 120));
    });
    browserSocket.on('error', () => closeBoth(1011, 'browser socket error'));
    browserSocket.on('close', () => closeBoth(1000, 'browser socket closed'));
    upstream.on('close', () => closeBoth(1000, 'trace server socket closed'));
  }
}

module.exports = { SessionManager };
