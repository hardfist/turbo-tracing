const { patchViewerJs } = (() => {
  const fs = require('fs');
  const source = fs.readFileSync(require.resolve('../src/viewer.js'), 'utf8');
  if (!source.includes('ws://localhost')) {
    throw new Error('viewer patcher no longer contains expected websocket marker');
  }
  return {};
})();

console.log('smoke test ok');
