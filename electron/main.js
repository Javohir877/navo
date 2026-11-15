// Navo — Electron main process (Windows desktop build)
const { app, BrowserWindow, ipcMain, dialog, protocol, net, nativeImage, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const fsp = fs.promises;
const crypto = require('crypto');
const { spawn } = require('child_process');
const { Readable } = require('stream');
const { pathToFileURL } = require('url');

const WWW = path.join(__dirname, '..', 'www');
const ICON = path.join(__dirname, '..', 'build', 'icon.png');

// Formats Chromium decodes natively; everything else goes through ffmpeg.
const NATIVE = new Set(['mp3', 'wav', 'ogg', 'oga', 'opus', 'flac', 'm4a', 'mp4', 'aac', 'webm', 'weba', 'mpga']);
const AUDIO_EXT = ['mp3', 'flac', 'wav', 'ogg', 'oga', 'opus', 'm4a', 'mp4', 'aac', 'webm', 'weba', 'wma', 'ape', 'wv',
  'aiff', 'aif', 'aifc', 'amr', 'awb', '3gp', 'mka', 'ac3', 'eac3', 'dts', 'm4b', 'caf', 'tta', 'mpc', 'au', 'snd',
  'spx', 'mp2', 'mpga', 'dsf', 'dff', 'alac'];
const AUDIO_SET = new Set(AUDIO_EXT);
const MIME = { mp3: 'audio/mpeg', mpga: 'audio/mpeg', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  flac: 'audio/flac', m4a: 'audio/mp4', mp4: 'audio/mp4', aac: 'audio/aac', webm: 'audio/webm', weba: 'audio/webm' };

app.setAppUserModelId('uz.navo.player');
// Dev screenshot runs use their own profile so they never touch the real library / running app.
if (process.env.NAVO_SHOT) app.setPath('userData', path.join(app.getPath('temp'), 'navo-devshot'));
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');
// Use the GPU even on drivers Chromium is unsure about — blur is very slow in software.
app.commandLine.appendSwitch('ignore-gpu-blocklist');
app.commandLine.appendSwitch('enable-gpu-rasterization');
app.commandLine.appendSwitch('enable-zero-copy');
app.commandLine.appendSwitch('force_high_performance_gpu');
// Frames follow the monitor's refresh rate (vsync): 60, 120, 144, 240 Hz — whatever the screen does.

protocol.registerSchemesAsPrivileged([{
  scheme: 'navo',
  privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true },
}]);

let win = null;
const extOf = p => path.extname(p).slice(1).toLowerCase();
const audioPathsFromArgv = argv => argv.slice(1).filter(a => !a.startsWith('-') && AUDIO_SET.has(extOf(a)) && fs.existsSync(a));
let launchPaths = audioPathsFromArgv(process.argv);

/* ---------- single instance / open-with ---------- */
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const paths = audioPathsFromArgv(argv);
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
      if (paths.length) win.webContents.send('open-paths', paths);
    }
  });
}

/* ---------- ffmpeg transcoding for exotic formats ---------- */
/* ffmpeg is NOT shipped inside the installer (it would add ~83 MB). It is only needed for
   rare formats (WMA, APE, DSD, ...), so it is fetched once, on first use, into the app's
   data folder. In development the copy from the ffmpeg-static package is used. */
const FFMPEG_TAG = 'b6.1.1';
const ffExe = process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg';
const ffLocal = () => path.join(app.getPath('userData'), 'codec', ffExe);
let ffReady = null;
function ffmpegBin() {
  if (ffReady) return ffReady;
  ffReady = (async () => {
    if (fs.existsSync(ffLocal())) return ffLocal();
    try {                                   // dev / unpacked builds
      const p = require('ffmpeg-static');
      if (p && fs.existsSync(p)) return p;
    } catch { /* not bundled */ }
    const arch = process.arch === 'arm64' ? 'arm64' : 'x64';
    const url = `https://github.com/eugeneware/ffmpeg-static/releases/download/${FFMPEG_TAG}/ffmpeg-${process.platform}-${arch}.gz`;
    if (win) win.webContents.send('scan-progress', { phase: 'codec' });
    const r = await net.fetch(url);
    if (!r.ok) throw new Error('codec download failed: ' + r.status);
    const gz = Buffer.from(await r.arrayBuffer());
    const bin = require('zlib').gunzipSync(gz);
    fs.mkdirSync(path.dirname(ffLocal()), { recursive: true });
    const tmp = ffLocal() + '.part';
    fs.writeFileSync(tmp, bin, { mode: 0o755 });
    fs.renameSync(tmp, ffLocal());
    if (win) win.webContents.send('scan-progress', { phase: 'codec-done' });
    return ffLocal();
  })().catch(e => { ffReady = null; throw e; });
  return ffReady;
}
const cacheDir = path.join(app.getPath('temp'), 'navo-cache');
const pending = new Map();

async function transcode(src) {
  const st = await fsp.stat(src);
  const key = crypto.createHash('sha1').update(`${src}|${st.size}|${st.mtimeMs}`).digest('hex');
  const out = path.join(cacheDir, key + '.flac');
  if (fs.existsSync(out)) return out;
  if (pending.has(key)) return pending.get(key);
  const bin = await ffmpegBin();
  if (pending.has(key)) return pending.get(key);
  const job = new Promise((resolve, reject) => {
    fs.mkdirSync(cacheDir, { recursive: true });
    const tmp = out + '.part';
    const p = spawn(bin, ['-v', 'error', '-y', '-i', src, '-vn', '-map', '0:a:0', '-c:a', 'flac',
      '-compression_level', '0', '-f', 'flac', tmp], { windowsHide: true });
    let err = '';
    p.stderr.on('data', d => { err += d; });
    p.on('error', reject);
    p.on('close', code => {
      if (code === 0) { fs.renameSync(tmp, out); resolve(out); }
      else { fs.rm(tmp, { force: true }, () => {}); reject(new Error(err || 'ffmpeg failed')); }
    });
  }).finally(() => pending.delete(key));
  pending.set(key, job);
  return job;
}

function cleanCache() {
  fs.readdir(cacheDir, (e, files) => {
    if (e) return;
    const limit = Date.now() - 3 * 24 * 3600 * 1000;
    for (const f of files) {
      const p = path.join(cacheDir, f);
      fs.stat(p, (er, s) => { if (!er && s.mtimeMs < limit) fs.rm(p, { force: true }, () => {}); });
    }
  });
}

/* ---------- serve a local file with HTTP range support (needed for seeking) ---------- */
async function serveFile(file, req, type) {
  const { size } = await fsp.stat(file);
  const range = req.headers.get('range');
  const headers = { 'Content-Type': type, 'Accept-Ranges': 'bytes', 'Cache-Control': 'no-store' };
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range);
    let start, end;
    if (m && m[1] === '' && m[2] !== '') { start = Math.max(0, size - Number(m[2])); end = size - 1; }
    else { start = m && m[1] ? Number(m[1]) : 0; end = m && m[2] ? Math.min(Number(m[2]), size - 1) : size - 1; }
    if (start >= size || start > end) {
      return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } });
    }
    const body = Readable.toWeb(fs.createReadStream(file, { start, end }));
    return new Response(body, { status: 206, headers: { ...headers, 'Content-Length': String(end - start + 1), 'Content-Range': `bytes ${start}-${end}/${size}` } });
  }
  return new Response(Readable.toWeb(fs.createReadStream(file)), { status: 200, headers: { ...headers, 'Content-Length': String(size) } });
}

async function handleMedia(req, url) {
  const src = url.searchParams.get('p');
  const force = url.searchParams.get('t') === '1';
  if (!src || !AUDIO_SET.has(extOf(src))) return new Response('bad request', { status: 400 });
  if (!fs.existsSync(src)) return new Response('not found', { status: 404 });
  const ext = extOf(src);
  try {
    if (!force && NATIVE.has(ext)) return await serveFile(src, req, MIME[ext] || 'application/octet-stream');
    const out = await transcode(src);
    return await serveFile(out, req, 'audio/flac');
  } catch (e) {
    console.error('media error', e);
    return new Response('decode error', { status: 500 });
  }
}

/* ---------- metadata ---------- */
let mm = null;

// Album art stored as a separate image next to the music (cover.jpg, folder.png, ...)
const dirCovers = new Map();
function imageToDataUrl(buf) {
  let img = nativeImage.createFromBuffer(buf);
  if (img.isEmpty()) return null;
  if (img.getSize().width > 640) img = img.resize({ width: 640, quality: 'good' });
  return 'data:image/jpeg;base64,' + img.toJPEG(88).toString('base64');
}
async function folderCover(dir) {
  if (dirCovers.has(dir)) return dirCovers.get(dir);
  const job = (async () => {
    try {
      const names = await fsp.readdir(dir);
      const pick = names.find(n => /^(cover|folder|front|album|albumart[^.]*)\.(jpe?g|png)$/i.test(n))
        || names.find(n => /\.(jpe?g|png)$/i.test(n) && /(cover|front|folder|album)/i.test(n));
      return pick ? imageToDataUrl(await fsp.readFile(path.join(dir, pick))) : null;
    } catch { return null; }
  })();
  dirCovers.set(dir, job);
  return job;
}
async function parseTrack(file) {
  if (!mm) mm = await import('music-metadata');
  const id = 'p_' + crypto.createHash('sha1').update(file.toLowerCase()).digest('hex').slice(0, 20);
  const base = { id, path: file, ext: extOf(file), title: path.basename(file, path.extname(file)), artist: '', album: '' };
  try {
    const meta = await mm.parseFile(file, { skipPostHeaders: true });
    const c = meta.common, f = meta.format;
    let art = null;
    const pic = mm.selectCover ? mm.selectCover(c.picture) : (c.picture && c.picture[0]);
    if (pic && pic.data) art = imageToDataUrl(Buffer.from(pic.data));
    if (!art) art = await folderCover(path.dirname(file));
    return {
      ...base,
      title: c.title || base.title,
      artist: c.artist || (c.artists && c.artists.join(', ')) || c.albumartist || '',
      album: c.album || '',
      albumArtist: c.albumartist || '',
      year: c.year || null,
      trackNo: c.track && c.track.no ? c.track.no : null,
      duration: f.duration || 0,
      sampleRate: f.sampleRate || null,
      bitrate: f.bitrate || null,
      bitsPerSample: f.bitsPerSample || null,
      art,
    };
  } catch {
    return { ...base, art: await folderCover(path.dirname(file)) };
  }
}

async function parseMany(files, sender) {
  const out = new Array(files.length);
  let done = 0, i = 0;
  const worker = async () => {
    while (i < files.length) {
      const k = i++;
      out[k] = await parseTrack(files[k]);
      done++;
      if (sender && (done % 5 === 0 || done === files.length)) sender.send('scan-progress', { phase: 'tags', done, total: files.length });
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, files.length) }, worker));
  return out;
}

async function walk(dir, acc, sender) {
  let entries;
  try { entries = await fsp.readdir(dir, { withFileTypes: true }); } catch { return acc; }
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { if (!e.name.startsWith('.') && !e.name.startsWith('$')) await walk(p, acc, sender); }
    else if (AUDIO_SET.has(extOf(e.name))) {
      acc.push(p);
      if (sender && acc.length % 25 === 0) sender.send('scan-progress', { phase: 'scan', found: acc.length });
    }
  }
  return acc;
}

async function expandPaths(paths, sender) {
  const files = [];
  for (const p of paths) {
    try {
      const st = await fsp.stat(p);
      if (st.isDirectory()) await walk(p, files, sender);
      else if (AUDIO_SET.has(extOf(p))) files.push(p);
    } catch { /* skip */ }
  }
  return [...new Set(files)];
}

/* ---------- IPC ---------- */
ipcMain.handle('pick-files', async e => {
  const r = await dialog.showOpenDialog(win, {
    title: 'Musiqa fayllarini tanlang',
    properties: ['openFile', 'multiSelections'],
    filters: [{ name: 'Audio', extensions: AUDIO_EXT }, { name: 'Barcha fayllar', extensions: ['*'] }],
  });
  if (r.canceled) return null;
  return parseMany(r.filePaths.filter(p => AUDIO_SET.has(extOf(p))), e.sender);
});
ipcMain.handle('pick-folder', async e => {
  const r = await dialog.showOpenDialog(win, { title: 'Musiqa papkasini tanlang', properties: ['openDirectory', 'multiSelections'] });
  if (r.canceled) return null;
  const files = await expandPaths(r.filePaths, e.sender);
  return parseMany(files, e.sender);
});
ipcMain.handle('parse-paths', async (e, paths) => {
  if (!Array.isArray(paths)) return [];
  const files = await expandPaths(paths.filter(p => typeof p === 'string'), e.sender);
  return parseMany(files, e.sender);
});
ipcMain.handle('gpu-info', () => {
  const st = app.getGPUFeatureStatus();
  return { accelerated: String(st.gpu_compositing || '').startsWith('enabled'), status: st };
});
/* ---------- online cover lookup (iTunes Search API, Deezer fallback) ---------- */
const norm = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft)\.?\b.*$/, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function cleanTitle(t) {
  return String(t || '').replace(/\((?:[^)]*?)(slowed|sped up|speed up|reverb|remix|edit|bass boosted|lyrics?|official|audio|video|текст[^)]*)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*\]/g, ' ').replace(/\b(super\s+)?slowed( \+ reverb)?\b/gi, ' ').replace(/\s+-\s+$/, '').replace(/\s{2,}/g, ' ').trim();
}
function similar(a, b) {
  const A = new Set(norm(a).split(' ').filter(Boolean)), B = new Set(norm(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}
async function fetchImage(url) {
  const r = await net.fetch(url);
  if (!r.ok) return null;
  return imageToDataUrl(Buffer.from(await r.arrayBuffer()));
}
// Cover images for the renderer: only from the music catalogs the cover search uses.
const IMG_HOSTS = ['mzstatic.com', 'dzcdn.net', 'coverartarchive.org', 'archive.org'];
const hostOk = (h, list) => list.some(d => h === d || h.endsWith('.' + d));
ipcMain.handle('fetch-image', async (_e, url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !hostOk(u.hostname, IMG_HOSTS)) throw new Error('blocked host');
  try { return await fetchImage(u.toString()); } catch { return null; }
});
// Opens a Google Images search in the user's browser (nothing else may be opened this way).
ipcMain.handle('open-search', (_e, q, images) => {
  shell.openExternal('https://www.google.com/search?' + (images ? 'tbm=isch&' : '') + 'q=' + encodeURIComponent(String(q || '').slice(0, 200)));
});

// Small JSON fetch for the renderer, limited to the public music APIs the app uses.
const API_HOSTS = new Set(['lrclib.net', 'itunes.apple.com', 'api.deezer.com', 'musicbrainz.org', 'api.lyrics.ovh']);
ipcMain.handle('http-json', async (_e, url) => {
  const u = new URL(url);
  if (u.protocol !== 'https:' || !API_HOSTS.has(u.hostname)) throw new Error('blocked host');
  const r = await net.fetch(u.toString(), { headers: { 'User-Agent': 'Navo/1.0 ( https://github.com/Javohir877/navo )', Accept: 'application/json' }, signal: AbortSignal.timeout(12000) });
  return r.ok ? r.json() : null;
});

/* ---------- Windows taskbar thumbnail buttons (prev / play-pause / next) ---------- */
const thumbIcons = {};
const thumbIcon = n => thumbIcons[n] || (thumbIcons[n] = nativeImage.createFromPath(path.join(__dirname, 'icons', `${n}.png`)));
function setThumbar(playing) {
  if (process.platform !== 'win32' || !win || win.isDestroyed()) return;
  const send = a => win && win.webContents.send('media', a);
  try {
    win.setThumbarButtons([
      { tooltip: 'Oldingi', icon: thumbIcon('prev'), click: () => send('prev') },
      { tooltip: playing ? 'Pauza' : 'Ijro', icon: thumbIcon(playing ? 'pause' : 'play'), click: () => send('toggle') },
      { tooltip: 'Keyingi', icon: thumbIcon('next'), click: () => send('next') },
    ]);
  } catch { /* icons missing */ }
}
ipcMain.on('play-state', (_e, playing) => setThumbar(!!playing));

ipcMain.handle('launch-paths', () => { const p = launchPaths; launchPaths = []; return p; });
ipcMain.handle('show-in-folder', (_e, p) => { if (typeof p === 'string' && fs.existsSync(p)) shell.showItemInFolder(p); });

/* ---------- Windows "Open with" registration (per-user, no admin needed) ---------- */
const ASSOC_EXT = AUDIO_EXT.filter(e => e !== 'mp4' && e !== '3gp' && e !== 'webm');
function registerOpenWith() {
  if (process.platform !== 'win32' || !app.isPackaged || process.env.NAVO_SHOT) return;
  const exe = process.env.PORTABLE_EXECUTABLE_FILE || process.execPath;
  const marker = path.join(app.getPath('userData'), 'assoc.json');
  const sig = JSON.stringify({ exe, n: ASSOC_EXT.length, v: 3 });
  try { if (fs.readFileSync(marker, 'utf8') === sig) return; } catch { /* first run */ }
  const BS = String.fromCharCode(92); // backslash
  const winPath = k => k.split('/').join(BS);
  const q = v => v.split(BS).join(BS + BS).split('"').join(BS + '"');
  const cmd = `"${exe}" "%1"`;
  const icon = `${exe},0`;
  const exeName = path.basename(exe);
  const L = ['Windows Registry Editor Version 5.00', ''];
  const key = (k, vals) => {
    L.push(`[${winPath('HKEY_CURRENT_USER/Software/' + k)}]`);
    for (const [n, v] of vals) L.push(`${n === '@' ? '@' : `"${q(n)}"`}="${q(v)}"`);
    L.push('');
  };
  key('Classes/Navo.Audio', [['@', 'Navo audio fayli'], ['FriendlyTypeName', 'Navo audio fayli']]);
  key('Classes/Navo.Audio/DefaultIcon', [['@', icon]]);
  key('Classes/Navo.Audio/shell/open', [['FriendlyAppName', 'Navo']]);
  key('Classes/Navo.Audio/shell/open/command', [['@', cmd]]);
  key(`Classes/Applications/${exeName}`, [['FriendlyAppName', 'Navo']]);
  key(`Classes/Applications/${exeName}/DefaultIcon`, [['@', icon]]);
  key(`Classes/Applications/${exeName}/shell/open/command`, [['@', cmd]]);
  key(`Classes/Applications/${exeName}/SupportedTypes`, ASSOC_EXT.map(e => [`.${e}`, '']));
  for (const e of ASSOC_EXT) key(`Classes/.${e}/OpenWithProgids`, [['Navo.Audio', '']]);
  key('Navo/Capabilities', [['ApplicationName', 'Navo'], ['ApplicationDescription', 'Chiroyli musiqa pleyeri'], ['ApplicationIcon', icon]]);
  key('Navo/Capabilities/FileAssociations', ASSOC_EXT.map(e => [`.${e}`, 'Navo.Audio']));
  key('RegisteredApplications', [['Navo', winPath('Software/Navo/Capabilities')]]);
  // Windows "Graphics settings": run Navo on the high-performance GPU (e.g. NVIDIA on laptops)
  key('Microsoft/DirectX/UserGpuPreferences', [[process.execPath, 'GpuPreference=2;']]);
  const regFile = path.join(app.getPath('temp'), 'navo-assoc.reg');
  // .reg files must be UTF-16LE with BOM
  fs.writeFileSync(regFile, Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(L.join('\r\n'), 'utf16le')]));
  const p = spawn('reg.exe', ['import', regFile], { windowsHide: true });
  p.on('close', code => {
    fs.rm(regFile, { force: true }, () => {});
    if (code === 0) try { fs.writeFileSync(marker, sig); } catch { /* */ }
  });
}

/* ---------- window ---------- */
function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 380,
    minHeight: 620,
    backgroundColor: '#07070d',
    title: 'Navo',
    icon: fs.existsSync(ICON) ? ICON : undefined,
    show: false,
    titleBarStyle: 'hidden',
    titleBarOverlay: { color: 'rgba(0,0,0,0)', symbolColor: '#f6f5fb', height: 44 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  });
  win.setMenu(null);
  win.once('ready-to-show', () => { if (!process.env.NAVO_SHOT) { win.show(); setThumbar(false); } });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', e => e.preventDefault());
  win.loadURL('navo://app/index.html');
  win.on('closed', () => { win = null; });
  if (process.env.NAVO_SHOT) devScreenshots();
}

// Dev aid: NAVO_SHOT=<file prefix> renders a few screenshots, then quits.
async function devScreenshots() {
  const pfx = process.env.NAVO_SHOT;
  const wait = ms => new Promise(r => setTimeout(r, ms));
  const shot = async name => {
    // hidden windows can return a stale frame; nudge the size to force a fresh paint
    const [w, h] = win.getSize();
    win.setSize(w + 1, h); await wait(60); win.setSize(w, h); await wait(160);
    fs.writeFileSync(`${pfx}-${name}.png`, (await win.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
  };
  win.webContents.setBackgroundThrottling(false);
  win.webContents.setAudioMuted(true); // test runs must never make a sound
  const js = code => win.webContents.executeJavaScript(code, true).catch(e => console.error(e));
  win.webContents.on('console-message', e => { if (e.level === 'error' || e.level === 'warning') console.log('CONSOLE', e.level, e.message); });
  await wait(6000);
  if (process.env.NAVO_CODEC) {
    // packaged-build check: a WMA file must trigger the one-time codec download and then play
    for (let i = 0; i < 40; i++) {
      await wait(1500);
      const st = await js(`document.title + ' | t=' + document.querySelector('.t-cur').textContent + ' | toast=' + document.querySelector('#toast').textContent`);
      console.log('CODEC', i, st, '| codec file:', fs.existsSync(ffLocal()));
      if (/t=0:0[3-9]/.test(st)) break;
    }
    app.quit(); return;
  }
  if (process.env.NAVO_ONLINE) {
    // online cover / lyrics sources check
    win.setSize(1320, 860);
    const r = await js(`(async () => { const { coverCandidates, fetchLyrics, findCoverOnline } = window.__navo;
      const c = await coverCandidates('Metamorphosis', 'Interworld');
      const c2 = await coverCandidates('Sog\\'inib', 'Shahzoda');
      const l1 = await fetchLyrics({ title: 'Yellow', artist: 'Coldplay', duration: 266 });
      const l2 = await fetchLyrics({ title: 'Sog\\'inib', artist: '', duration: 0 });
      const l3 = await fetchLyrics({ title: 'zzqx nonexistent song', artist: 'nobody here', duration: 100 });
      const auto = await findCoverOnline({ title: 'Metamorphosis', artist: 'Interworld' });
      const messy = {};
      for (const [tt, aa] of [['MONTAGEM ALQUIMIA (SLOWED) ｜ h6itam n7san7os', ''], ['Kordhell - Murder In My Mind (Official Audio) 🔥', ''], ['VAI TRAIR (SUPER SLOWED) X BLUE LOCK', 'Levan Smirin'], ['MTG DIABOLICA (Super Slowed)', 'Phonk Channel'], ['180db_ [130] (Super Slowed)', 'Akuran']]) {
        const r = await coverCandidates(tt, aa, { deep: false });
        messy[tt] = r.filter(x => x.ok).slice(0, 2).map(x => x.src + ': ' + x.title + ' / ' + x.artist);
      }
      document.querySelector('[data-fx="Concert Hall"]')?.click();
      await new Promise(r => setTimeout(r, 600));
      const fx = document.querySelector('#fxState').textContent + ' ' + JSON.stringify(window.__navo.S.fx);
      return JSON.stringify({ messy, fx, covers: c.map(x => x.src + (x.ok ? '+' : '-')), uz: c2.slice(0, 6).map(x => x.src + (x.ok ? '+' : '-') + ' ' + x.artist), l1: l1.src + ' ' + !!l1.synced, l2: (l2.src || 'none') + ' ' + !!l2.synced, l3, auto: !!auto && auto.slice(0, 30) });
    })()`);
    console.log('ONLINE', r);
    await js(`__navo.openEdit(__navo.S.order[0]); document.querySelector('#editTitle').value = 'Metamorphosis'; document.querySelector('#editArtist').value = 'Interworld'; document.querySelector('#editFindArt').click()`);
    await wait(9000);
    await js(`document.querySelector('#coverGrid .cp-item:not(.sk)')?.click()`);
    await wait(2500);
    await shot('cover-pick');
    await js(`(async () => { const n = window.__navo; n.closeEdit(); await n.loadIndex(0, false); n.openFull(); n.toggleLyrics(true); })()`);
    await wait(9000);
    await shot('ly-none');
    await js(`__navo.openLyEdit()`);
    await wait(800);
    await shot('ly-edit');
    app.quit(); return;
  }
  if (process.env.NAVO_SITE) {
    // Clean marketing screenshots for the download site
    win.setSize(1440, 900);
    await wait(1500);
    await js(`[...document.querySelectorAll('.row')].find(r => /Neon Drift/.test(r.textContent)).click()`);
    await wait(7000);
    await js(`document.querySelector('.track-list').scrollTop = 0`);
    await shot('library');
    await js(`document.querySelector('[data-act=open-full]').click()`);
    await wait(1800);
    for (let i = 0; i < 40; i++) {   // catch the frame right after a hit
      const b0 = await js(`document.documentElement.dataset.booms || '0'`);
      await wait(30);
      if ((await js(`document.documentElement.dataset.booms || '0'`)) !== b0) break;
    }
    await wait(170);
    await shot('player');
    await js(`document.querySelector('[data-act=close-full]').click(); document.querySelector('[data-view=eq]').click()`);
    await wait(900);
    await shot('settings');
    await js(`document.querySelector('[data-view=library]').click()`);
    win.setSize(420, 900);
    await wait(1200);
    await shot('mobile');
    await js(`document.querySelector('.p-left').click()`);
    await wait(1500);
    await shot('mobile-player');
    app.quit(); return;
  }
  if (process.env.NAVO_STYLES) {
    const n = await js(`document.querySelectorAll('.row').length`);
    for (let i = 0; i < n; i++) {
      await js(`document.querySelectorAll('.row')[${i}].click()`);
      await wait(3000);
      console.log('DIST', await js(`(document.documentElement.dataset.bstat || '?') + ' dur=' + document.querySelector('.t-dur').textContent`));
      console.log('STYLE', await js(`document.title.replace(' — Navo','') + ' => ' + (document.documentElement.dataset.style || '?') + ' | ' + document.querySelector('#fpSource').textContent`));
      await js(`delete document.documentElement.dataset.style`);
    }
    app.quit(); return;
  }
  if (process.env.NAVO_PERF) {
    // Real, visible window: sweep the mouse over the track list while music + bass FX run, measure frames.
    win.setBounds({ x: 40, y: 40, width: +process.env.NAVO_W || 1320, height: +process.env.NAVO_H || 840 });
    win.showInactive();
    await js(`!document.querySelector('.row.playing') && document.querySelector('.row') && document.querySelector('.row').click()`);
    await wait(1500);
    const measure = `new Promise(r => { const t = []; let l = performance.now();
      function f(n) { t.push(n - l); l = n; if (t.length < 240) requestAnimationFrame(f); else {
        t.sort((a, b) => a - b); const avg = t.reduce((a, b) => a + b) / t.length;
        r(JSON.stringify({ fps: (1000 / avg).toFixed(1), p95: t[Math.floor(t.length * .95)].toFixed(1), max: t[t.length - 1].toFixed(1), janky: t.filter(x => x > 25).length })); } }
      requestAnimationFrame(f); })`;
    const run = async label => {
      const p = js(measure);
      for (let i = 0; i < 160; i++) {           // fast mouse sweeps across the rows
        const y = 260 + (i % 40) * 14, x = 500 + (i % 7) * 60;
        win.webContents.sendInputEvent({ type: 'mouseMove', x, y });
        await wait(16);
      }
      console.log('PERF', label, await p);
    };
    const toggle = id => js(`document.querySelector('#${id}').click()`);
    await js(`window.__beatLog = []`);
    console.log('PLAYSTATE', await js(`document.querySelector('.play-btn use').getAttribute('href') + ' rowPlaying=' + !!document.querySelector('.row.playing')`));
    await wait(4000);
    console.log('BEATS', await js(`(() => { const log = window.__beatLog.slice(0, 14);
      const a = document.querySelector('audio') || window.__navoAudio;
      return document.title + ' t=' + document.querySelector('.t-cur').textContent + ' found=' + document.documentElement.dataset.beats + ' booms=' + document.documentElement.dataset.booms + ' fired@ ' + log.map(x => x.toFixed(3)).join(' '); })()`));
    if (process.env.NAVO_PERF === 'beats') {
      await js(`document.querySelector('[data-act=open-full]').click()`);
      await wait(1500);
      for (let i = 0; i < 6; i++) {
        await wait(110);
        console.log('ANIM', await js(`(() => { const w = [...document.querySelectorAll('#fpFxLayer .fx-wave')].map(e => { const a = e.getAnimations()[0]; return a ? (getComputedStyle(e).opacity.slice(0,4) + '@' + getComputedStyle(e).transform.slice(7, 14)) : '-'; }); return w.join(' | ') + ' total=' + document.getAnimations().length; })()`));
      }
      await shot('beatfull');
      app.quit(); return;
    }
    const kill = css => js(`(() => { let s = document.getElementById('perfkill'); if (!s) { s = document.createElement('style'); s.id = 'perfkill'; document.head.appendChild(s); } s.textContent = ${JSON.stringify(css)}; })()`);
    await run('all-on');
    await kill('#edgeGlow{display:none!important}'); await run('no-edge');
    await kill('.bass-glow{display:none!important}'); await run('no-glow');
    await kill('.bass-art{transform:none!important}'); await run('no-artscale');
    await kill('#npViz{display:none!important}'); await run('no-npviz');
    await kill('');
    await toggle('bassOn'); await wait(300); await run('bass-off');
    await toggle('vizOn'); await wait(300); await run('bass+viz-off');
    await js(`document.querySelector('audio') ; document.querySelector('[data-act=toggle]').click()`); await wait(300); await run('paused');
    await js(`document.querySelector('[data-act=toggle]').click()`);
    await toggle('bassOn'); await toggle('vizOn'); await toggle('blurOn'); await wait(300); await run('lite-mode');
    await toggle('blurOn');
    app.quit();
    return;
  }
  if (process.env.NAVO_SHOT_LY) {
    await js(`[...document.querySelectorAll('.row')].find(r => /Gangsta/.test(r.textContent)).click()`);
    await wait(1500);
    await js(`document.querySelector('[data-act=open-full]').click()`);
    await wait(800);
    await js(`document.querySelector('[data-act=lyrics]').click()`);
    await wait(6000);
    await js(`document.querySelector('audio') ; (function(){ const a = [...document.querySelectorAll('.ly-line[data-i]')][12]; a && a.click(); })()`);
    await wait(2500);
    console.log('LY', await js(`document.querySelectorAll('.ly-line').length + ' lines, on=' + (document.querySelector('.ly-line.on') || {}).textContent + ' msg=' + document.querySelector('#lyMsg').textContent`));
    await shot('lyrics');
    await js(`document.querySelector('#fullPlayer [data-act=sleep]').click()`);
    await wait(500);
    await shot('sleep');
    app.quit();
    return;
  }
  await js(`!document.querySelector('.row.playing') && document.querySelector('.row') && document.querySelector('.row').click()`);
  // capture right after a BAMM hit
  const afterBoom = async (name, delay) => {
    const n0 = await js(`document.documentElement.dataset.booms || '0'`);
    for (let i = 0; i < 40; i++) { await wait(25); if (await js(`document.documentElement.dataset.booms || '0'`) !== n0) break; }
    await wait(delay);
    await shot(name);
  };
  await wait(2500);
  await afterBoom('main', 160);
  await js(`document.querySelector('[data-act=open-full]').click()`);
  await wait(1500);
  await afterBoom('full', 140);
  await js(`document.querySelector('[data-act=close-full]').click(); document.querySelector('[data-view=eq]').click()`);
  await wait(500);
  await js(`document.querySelector('[data-fx="Slowed + Reverb"]').click(); document.querySelector('.eq-card').scrollTop = 420`);
  await wait(900);
  await shot('eq');
  console.log('FX', await js(`document.querySelector('audio') ? '' : (document.querySelector('#fxSpeedOut').textContent + ' ' + document.querySelector('#fxReverbOut').textContent)`));
  await wait(6000); // let the song count as "played"
  console.log('TOPCLICK', await js(`(() => { try { document.querySelector('[data-view=top]').click(); return document.querySelector('#viewTitle').textContent + ' rows=' + document.querySelectorAll('.row').length; } catch (e) { return 'ERR ' + e.message; } })()`));
  await wait(1200);
  await shot('top');
  await js(`document.querySelector('[data-view=library]').click()`);
  await wait(600);
  await shot('library');
  const st = await js(`JSON.stringify({booms: document.documentElement.dataset.booms, rows: document.querySelectorAll('.row').length, t: document.querySelector('.t-cur').textContent, title: document.title})`);
  console.log('STATE', st);
  win.setSize(400, 860);
  await js(`document.querySelector('[data-view=library]').click()`);
  await wait(1200);
  await shot('narrow');
  app.quit();
}

app.whenReady().then(() => {
  protocol.handle('navo', req => {
    const url = new URL(req.url);
    if (url.pathname === '/__media') return handleMedia(req, url);
    const rel = decodeURIComponent(url.pathname).replace(/^\/+/, '') || 'index.html';
    const file = path.normalize(path.join(WWW, rel));
    if (!file.startsWith(WWW)) return new Response('forbidden', { status: 403 });
    return net.fetch(pathToFileURL(file).toString());
  });
  createWindow();
  setTimeout(cleanCache, 10000);
  setTimeout(registerOpenWith, 3000);
  app.on('activate', () => { if (!BrowserWindow.getAllWindows().length) createWindow(); });
});

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
