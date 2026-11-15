// Copies browser builds of third-party libs into www/vendor (no bundler needed).
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const out = path.join(root, 'www', 'vendor');
fs.mkdirSync(out, { recursive: true });

const files = [
  ['node_modules/jsmediatags/dist/jsmediatags.min.js', 'jsmediatags.min.js'],
  ['node_modules/@capacitor/core/dist/capacitor.js', 'capacitor.js'],
  ['node_modules/@capacitor/app/dist/plugin.js', 'capacitor-app.js'],
];

for (const [src, dst] of files) {
  const from = path.join(root, src);
  if (fs.existsSync(from)) {
    fs.copyFileSync(from, path.join(out, dst));
    console.log('vendor:', dst);
  } else {
    console.warn('vendor: missing', src);
  }
}
