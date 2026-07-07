(() => {
  const basePath = window.__TRACE_BASE_PATH || '';
  const params = new URLSearchParams(window.location.search);
  const session = params.get('session');

  const root = document.createElement('div');
  root.id = 'trace-upload-layer';
  root.innerHTML = `
    <style>
      #trace-upload-layer { position: fixed; z-index: 2147483647; left: 18px; bottom: 18px; font-family: ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; color: #111827; }
      #trace-upload-card { width: min(460px, calc(100vw - 36px)); border: 1px solid rgba(17, 24, 39, .12); border-radius: 16px; box-shadow: 0 18px 60px rgba(15, 23, 42, .2); background: rgba(255, 255, 255, .96); backdrop-filter: blur(10px); overflow: hidden; }
      #trace-upload-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 14px; border-bottom: 1px solid rgba(17, 24, 39, .08); font-weight: 650; font-size: 14px; }
      #trace-upload-body { padding: 14px; font-size: 13px; color: #4b5563; line-height: 1.45; }
      #trace-drop-zone { margin-top: 10px; border: 1px dashed #9ca3af; border-radius: 12px; padding: 16px; text-align: center; background: #f9fafb; cursor: pointer; }
      #trace-drop-zone.dragging { border-color: #2563eb; background: #eff6ff; color: #1d4ed8; }
      #trace-upload-actions { display: flex; align-items: center; gap: 10px; margin-top: 12px; }
      #trace-upload-button, #trace-upload-close { border: 0; border-radius: 10px; padding: 8px 12px; font-weight: 650; cursor: pointer; }
      #trace-upload-button { color: white; background: #111827; }
      #trace-upload-close { color: #4b5563; background: #f3f4f6; }
      #trace-upload-status { margin-top: 10px; font-size: 12px; white-space: pre-wrap; }
      #trace-file-input { display: none; }
    </style>
    <div id="trace-upload-card">
      <div id="trace-upload-header">
        <span>Turbopack trace viewer</span>
        <button id="trace-upload-close" type="button">收起</button>
      </div>
      <div id="trace-upload-body">
        <div>${session ? `当前 session: <code>${session}</code>` : '把 <code>trace-turbopack.bin</code> / tracing 文件拖到这里，上传后会自动打开 viewer。'}</div>
        <div id="trace-drop-zone">拖拽 tracing 文件到此处，或点击选择文件</div>
        <div id="trace-upload-actions">
          <button id="trace-upload-button" type="button">选择文件</button>
          <span>支持大文件；文件只保存在本服务临时目录。</span>
        </div>
        <input id="trace-file-input" type="file" />
        <div id="trace-upload-status"></div>
      </div>
    </div>
  `;

  document.documentElement.appendChild(root);

  const zone = root.querySelector('#trace-drop-zone');
  const input = root.querySelector('#trace-file-input');
  const button = root.querySelector('#trace-upload-button');
  const status = root.querySelector('#trace-upload-status');
  const close = root.querySelector('#trace-upload-close');
  let collapsed = false;

  close.addEventListener('click', () => {
    collapsed = !collapsed;
    root.querySelector('#trace-upload-body').style.display = collapsed ? 'none' : 'block';
    close.textContent = collapsed ? '展开' : '收起';
  });

  async function upload(file) {
    if (!file) return;
    status.textContent = `上传中: ${file.name} (${Math.round(file.size / 1024 / 1024)} MiB)`;
    const body = new FormData();
    body.append('trace', file, file.name);
    try {
      const res = await fetch(`${basePath}/api/upload`, { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${res.status} ${res.statusText}`);
      status.textContent = `已创建 session ${data.sessionId}，正在打开 viewer...`;
      window.location.href = `${basePath}/?session=${encodeURIComponent(data.sessionId)}`;
    } catch (error) {
      status.textContent = `上传失败: ${error.message}`;
    }
  }

  button.addEventListener('click', () => input.click());
  zone.addEventListener('click', () => input.click());
  input.addEventListener('change', () => upload(input.files && input.files[0]));

  for (const eventName of ['dragenter', 'dragover']) {
    window.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.add('dragging');
    });
  }
  for (const eventName of ['dragleave', 'drop']) {
    window.addEventListener(eventName, (event) => {
      event.preventDefault();
      zone.classList.remove('dragging');
    });
  }
  window.addEventListener('drop', (event) => {
    const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
    upload(file);
  });
})();

// Fallback renderer for mirrored deployments where the original Next/RSC viewer
// shell loads but does not hydrate its trace canvas. It speaks the same
// turbo-trace-server WebSocket protocol and draws a simple flame chart.
(() => {
  const basePath = window.__TRACE_BASE_PATH || '';
  const params = new URLSearchParams(window.location.search);
  const session = params.get('session');
  if (!session || window.__TRACE_FALLBACK_RENDERER_STARTED) return;
  window.__TRACE_FALLBACK_RENDERER_STARTED = true;

  const state = {
    rows: new Map(),
    connected: false,
    status: 'connecting',
    maxX: 100000000000,
  };

  const canvas = document.createElement('canvas');
  canvas.id = 'trace-fallback-canvas';
  canvas.style.cssText = 'position:fixed;left:0;right:0;top:53px;bottom:24px;width:100vw;height:calc(100vh - 77px);z-index:20;background:white;display:block;';
  document.documentElement.appendChild(canvas);

  const badge = document.createElement('div');
  badge.id = 'trace-fallback-status';
  badge.style.cssText = 'position:fixed;right:18px;bottom:18px;z-index:2147483646;background:rgba(17,24,39,.92);color:white;border-radius:10px;padding:8px 10px;font:12px ui-sans-serif,system-ui;box-shadow:0 8px 30px rgba(0,0,0,.2)';
  badge.textContent = 'Trace fallback: connecting…';
  document.documentElement.appendChild(badge);

  function colorFor(text) {
    let hash = 0;
    for (let i = 0; i < text.length; i++) hash = ((hash << 5) - hash + text.charCodeAt(i)) | 0;
    const hue = Math.abs(hash) % 360;
    return `hsl(${hue} 70% 72%)`;
  }

  function resize() {
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    draw();
  }

  function draw() {
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.width / dpr;
    const h = canvas.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, w, h);

    const rowHeight = 18;
    const labelCutoff = 32;
    const rows = [...state.rows.entries()].sort((a, b) => a[0] - b[0]);
    if (!rows.length) {
      ctx.fillStyle = '#6b7280';
      ctx.font = '14px ui-sans-serif, system-ui';
      ctx.fillText(state.connected ? 'Parsing trace… waiting for spans' : 'Connecting to trace session…', 24, 32);
      return;
    }

    let maxX = 1;
    for (const [, spans] of rows) {
      for (const span of spans) maxX = Math.max(maxX, (span.x || 0) + (span.w || 0));
    }
    const drawMaxX = maxX || 1;

    ctx.font = '11px ui-sans-serif, system-ui';
    ctx.textBaseline = 'middle';
    for (const [y, spans] of rows) {
      const top = y * rowHeight;
      if (top > h) continue;
      for (const span of spans) {
        const x = ((span.x || 0) / drawMaxX) * w;
        const sw = Math.max(1, ((span.w || 0) / drawMaxX) * w);
        ctx.fillStyle = colorFor(span.cat || span.t || 'span');
        ctx.fillRect(x, top + 1, sw, rowHeight - 2);
        ctx.strokeStyle = 'rgba(0,0,0,.18)';
        ctx.strokeRect(x, top + 1, sw, rowHeight - 2);
        if (sw > labelCutoff) {
          ctx.fillStyle = '#111827';
          const text = span.t || span.cat || span.id || '';
          ctx.save();
          ctx.beginPath();
          ctx.rect(x + 2, top + 1, sw - 4, rowHeight - 2);
          ctx.clip();
          ctx.fillText(text, x + 4, top + rowHeight / 2);
          ctx.restore();
        }
      }
    }
  }

  function sendViewRect(ws) {
    const rect = canvas.getBoundingClientRect();
    ws.send(JSON.stringify({
      type: 'view-rect',
      viewRect: {
        x: 0,
        y: 0,
        width: Math.max(state.maxX || 0, 100000000000),
        height: Math.max(20, Math.ceil(rect.height / 18)),
        horizontalPixels: Math.max(1, Math.ceil(rect.width)),
        query: '',
        viewMode: 'aggregated',
        valueMode: 'duration',
      },
    }));
  }

  function connect() {
    const proto = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${proto}//${window.location.host}${basePath}/ws/${encodeURIComponent(session)}`);
    let interval;
    ws.addEventListener('open', () => {
      state.connected = true;
      badge.textContent = `Trace fallback: connected (${session})`;
      sendViewRect(ws);
      interval = setInterval(() => {
        if (ws.readyState === WebSocket.OPEN) sendViewRect(ws);
      }, 2000);
      draw();
    });
    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        if (message.type === 'view-line') {
          const spans = message.spans || [];
          if (!(spans.length === 1 && spans[0].t === 'No time info in trace')) {
            state.rows.set(message.y, spans);
          }
          draw();
        } else if (message.type === 'view-lines-count') {
          badge.textContent = `Trace fallback: ${message.count || state.rows.size} rows`;
        }
      } catch (error) {
        console.warn('Trace fallback parse error', error);
      }
    });
    ws.addEventListener('close', () => {
      clearInterval(interval);
      state.connected = false;
      badge.textContent = 'Trace fallback: disconnected, retrying…';
      setTimeout(connect, 1500);
    });
    ws.addEventListener('error', () => {
      badge.textContent = 'Trace fallback: WebSocket error';
    });
  }

  window.addEventListener('resize', resize);
  resize();
  setTimeout(connect, 500);
})();
