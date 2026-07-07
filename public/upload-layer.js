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
