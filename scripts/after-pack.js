// electron-builder afterPack hook: drop parts of Chromium that Navo never uses,
// to keep the installer small. (DirectX shader compiler = WebGPU only.)
const fs = require('fs');
const path = require('path');

exports.default = async function afterPack(context) {
  if (context.electronPlatformName !== 'win32') return;
  for (const f of ['dxcompiler.dll', 'dxil.dll']) {
    const p = path.join(context.appOutDir, f);
    if (fs.existsSync(p)) { fs.rmSync(p); console.log('  • removed unused', f); }
  }
};
