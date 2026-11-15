// Renders www/img/logo.svg into PNG icons for Windows (build/) and Android (android/.../res).
// Run with: npx electron scripts/make-icons.js
const { app, BrowserWindow } = require('electron');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'www', 'img', 'logo.svg'), 'utf8');

// Adaptive-icon foreground: just the white bars, centred in the 66% safe zone.
const fgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><g transform="translate(22 22)"><g fill="#fff"><rect x="11.5" y="26" width="5" height="12" rx="2.5"/><rect x="20.5" y="18" width="5" height="28" rx="2.5"/><rect x="29.5" y="11" width="5" height="42" rx="2.5"/><rect x="38.5" y="20" width="5" height="24" rx="2.5"/><rect x="47.5" y="27" width="5" height="10" rx="2.5"/></g></g></svg>`;
const bgSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 108 108"><defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7a6bff"/><stop offset=".55" stop-color="#ff5fa2"/><stop offset="1" stop-color="#ffb35c"/></linearGradient></defs><rect width="108" height="108" fill="url(#lg)"/></svg>`;
const roundSvg = svg.replace('rx="18" fill="url(#lg)"', 'rx="32" fill="url(#lg)"').replace('rx="18" fill="url(#sh)"', 'rx="32" fill="url(#sh)"');

const jobs = [
  { svg, size: 512, out: 'build/icon.png' },
  { svg, size: 256, out: 'build/icon-256.png' },
];
// Taskbar thumbnail buttons (white glyphs)
const glyph = d => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="#fff" d="${d}"/></svg>`;
const thumbs = {
  play: 'M8 5.6v12.8a1 1 0 0 0 1.52.85l10.4-6.4a1 1 0 0 0 0-1.7L9.52 4.75A1 1 0 0 0 8 5.6z',
  pause: 'M7 5h3.5a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5H7a.5.5 0 0 1-.5-.5v-13A.5.5 0 0 1 7 5zm6.5 0H17a.5.5 0 0 1 .5.5v13a.5.5 0 0 1-.5.5h-3.5a.5.5 0 0 1-.5-.5v-13a.5.5 0 0 1 .5-.5z',
  next: 'M5.5 6.1v11.8a.9.9 0 0 0 1.4.75L15.5 13v5a1 1 0 0 0 2 0V6a1 1 0 0 0-2 0v5L6.9 5.35a.9.9 0 0 0-1.4.75z',
  prev: 'M18.5 6.1v11.8a.9.9 0 0 1-1.4.75L8.5 13v5a1 1 0 0 1-2 0V6a1 1 0 0 1 2 0v5l8.6-5.65a.9.9 0 0 1 1.4.75z',
};
for (const [n, d] of Object.entries(thumbs)) jobs.push({ svg: glyph(d), size: 32, out: `electron/icons/${n}.png` });
const dens = { mdpi: 1, hdpi: 1.5, xhdpi: 2, xxhdpi: 3, xxxhdpi: 4 };
const res = path.join(root, 'android', 'app', 'src', 'main', 'res');
if (fs.existsSync(res)) {
  for (const [d, k] of Object.entries(dens)) {
    jobs.push({ svg, size: 48 * k, out: `android/app/src/main/res/mipmap-${d}/ic_launcher.png` });
    jobs.push({ svg: roundSvg, size: 48 * k, out: `android/app/src/main/res/mipmap-${d}/ic_launcher_round.png` });
    jobs.push({ svg: fgSvg, size: 108 * k, out: `android/app/src/main/res/mipmap-${d}/ic_launcher_foreground.png` });
    jobs.push({ svg: bgSvg, size: 108 * k, out: `android/app/src/main/res/mipmap-${d}/ic_launcher_background.png` });
  }
}

app.whenReady().then(async () => {
  const w = new BrowserWindow({ show: false, webPreferences: { offscreen: true } });
  await w.loadURL('data:text/html,<html><body></body></html>');
  for (const j of jobs) {
    const data = await w.webContents.executeJavaScript(`new Promise(r => {
      const img = new Image();
      img.onload = () => { const c = document.createElement('canvas'); c.width = c.height = ${j.size};
        c.getContext('2d').drawImage(img, 0, 0, ${j.size}, ${j.size}); r(c.toDataURL('image/png')); };
      img.src = 'data:image/svg+xml;base64,' + ${JSON.stringify(Buffer.from(j.svg).toString('base64'))};
    })`);
    const out = path.join(root, j.out);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, Buffer.from(data.split(',')[1], 'base64'));
    console.log('icon:', j.out);
  }
  app.quit();
});
