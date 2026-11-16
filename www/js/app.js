/* ============================================================
   Navo — player logic (shared by Windows/Electron and Android/Capacitor)
   ============================================================ */
(() => {
'use strict';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const NAVO = window.navo || null;               // Electron bridge (desktop only)
const IS_DESKTOP = !!NAVO;
document.documentElement.classList.add(IS_DESKTOP ? 'is-desktop' : 'is-mobile');

const EQ_FREQS = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
const EQ_PRESETS = {
  'Oddiy':    [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass':     [7, 6, 5, 3, 1, 0, 0, 0, 0, 0],
  'Pop':      [-1, 1, 3, 4, 3, 1, 0, 1, 2, 2],
  'Rok':      [5, 4, 2, 0, -1, 0, 2, 3, 4, 4],
  'Jazz':     [3, 2, 1, 2, -1, -1, 0, 1, 2, 3],
  'Klassik':  [4, 3, 2, 1, 0, 0, 0, 2, 3, 4],
  'Vokal':    [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  'Elektron': [5, 4, 1, 0, -2, 1, 0, 2, 4, 5],
};
const AUDIO_EXT = ['mp3','flac','wav','ogg','oga','opus','m4a','mp4','aac','webm','weba','wma','ape','wv','aiff','aif','aifc','amr','awb','3gp','mka','ac3','eac3','dts','m4b','caf','tta','mpc','au','snd','spx','mp2','mpga','dsf','dff','alac'];
const AUDIO_SET = new Set(AUDIO_EXT);
const LOSSLESS = new Set(['flac','wav','aiff','aif','aifc','ape','wv','alac','dsf','dff','tta']);
const VIEW_TITLES = { library: 'Kutubxona', top: 'Top', favorites: 'Sevimlilar', queue: 'Navbat', eq: 'Sozlamalar' };

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const icon = n => `<svg class="i"><use href="#i-${n}"/></svg>`;
const extOf = name => (String(name).split('.').pop() || '').toLowerCase();
const baseName = name => String(name).replace(/^.*[\\/]/, '').replace(/\.[^.]+$/, '');
function fmtTime(s) {
  if (!isFinite(s) || s < 0) s = 0;
  s = Math.floor(s);
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}` : `${m}:${String(ss).padStart(2, '0')}`;
}
function hashStr(str) {
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const c = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 2654435761); h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(36) + (h1 >>> 0).toString(36);
}
function shuffleArr(a) { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }
const sleep = ms => new Promise(r => setTimeout(r, ms));
function loadImage(src) {
  return new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = src; });
}

/* ---------- IndexedDB ---------- */
const DB = {
  db: null,
  open() {
    return new Promise((res, rej) => {
      const r = indexedDB.open('navo', 2);
      r.onupgradeneeded = () => {
        const d = r.result;
        for (const s of ['blobs', 'art', 'thumbs', 'lyrics']) if (!d.objectStoreNames.contains(s)) d.createObjectStore(s);
        if (!d.objectStoreNames.contains('tracks')) d.createObjectStore('tracks', { keyPath: 'id' });
      };
      r.onsuccess = () => { this.db = r.result; res(); };
      r.onerror = () => rej(r.error);
    });
  },
  store(name, mode = 'readonly') { return this.db.transaction(name, mode).objectStore(name); },
  wrap(req) { return new Promise((res, rej) => { req.onsuccess = () => res(req.result); req.onerror = () => rej(req.error); }); },
  all(name) { return this.wrap(this.store(name).getAll()); },
  allKeys(name) { return this.wrap(this.store(name).getAllKeys()); },
  get(name, key) { return this.wrap(this.store(name).get(key)); },
  put(name, val, key) { return this.wrap(key === undefined ? this.store(name, 'readwrite').put(val) : this.store(name, 'readwrite').put(val, key)); },
  del(name, key) { return this.wrap(this.store(name, 'readwrite').delete(key)); },
};

/* ---------- state ---------- */
const S = {
  tracks: new Map(),
  order: [],
  thumbs: new Map(),
  visible: [],
  view: 'library',
  query: '',
  sort: 'added',
  queue: [], qIndex: -1, unshuffled: null, source: 'Kutubxona',
  shuffle: false, repeat: 'off',
  volume: 0.85, muted: false,
  eq: { on: true, gains: EQ_PRESETS['Oddiy'].slice(), preset: 'Oddiy' },
  currentId: null, playing: false,
  lastTime: 0,
  lite: null, viz: true, bass: true, netCovers: true, compact: false,
  fx: { speed: 1, reverb: 0, d8: false, preset: 'Oddiy' },
  fxStyle: 'auto',
};

function loadSettings() {
  try {
    const s = JSON.parse(localStorage.getItem('navo.state') || '{}');
    Object.assign(S, {
      sort: s.sort || 'added', shuffle: !!s.shuffle, repeat: s.repeat || 'off',
      volume: typeof s.volume === 'number' ? s.volume : 0.85, muted: !!s.muted,
      queue: Array.isArray(s.queue) ? s.queue : [], qIndex: typeof s.qIndex === 'number' ? s.qIndex : -1,
      unshuffled: Array.isArray(s.unshuffled) ? s.unshuffled : null,
      currentId: s.currentId || null, lastTime: s.lastTime || 0, source: s.source || 'Kutubxona',
      compact: s.compact === true,
      lite: typeof s.lite === 'boolean' ? s.lite : null, viz: s.viz !== false, bass: s.bass !== false, netCovers: s.netCovers !== false,
      fx: s.fx && typeof s.fx.speed === 'number' ? s.fx : { speed: 1, reverb: 0, d8: false, preset: 'Oddiy' },
      fxStyle: s.fxStyle || 'auto',
    });
    if (s.eq && Array.isArray(s.eq.gains) && s.eq.gains.length === EQ_FREQS.length) S.eq = s.eq;
  } catch { /* ignore */ }
}
let persistTimer = 0;
/* Compact layout (desktop): the sidebar shrinks to an icon rail and the
   now-playing panel closes, leaving the library and the player bar. */
function setCompact(on, quiet) {
  S.compact = !!on;
  document.documentElement.classList.toggle('compact', S.compact);
  const b = $('#collapseBtn');
  if (b) { b.setAttribute('aria-pressed', S.compact); b.title = S.compact ? 'Panellarni ochish (Ctrl+B)' : 'Panellarni yig\'ish (Ctrl+B)'; }
  if (!quiet) persist();
}
/* ---------- Mini player (desktop): small always-on-top window ---------- */
let miniOn = false;
async function setMini(on) {
  if (!IS_DESKTOP || !NAVO.miniMode || on === miniOn) return;
  miniOn = on;
  if (on) closeFull();
  document.documentElement.classList.toggle('mini', on);
  await NAVO.miniMode(on);
}

/* ---------- Updates and "what's new" ---------- */
// Android: navigating to an outside address makes Capacitor hand it to the phone's browser
function openOutside(url) { location.href = url; }
const RELEASES = 'https://github.com/Javohir877/navo/releases/latest/download/';
const NEWS = {
  '1.0.5': [
    "Panellar yig'ilganda bass to'lqinlari menyudagi kichik muqovadan chiqadi",
  ],
  '1.0.4': [
    'Mini pleyer: kichik oyna boshqa oynalar ustida turadi (Ctrl+Shift+M yoki pleyerdagi tugma)',
    'Panellarni yig\'ish: sarlavha yonidagi tugma yoki Ctrl+B — faqat kutubxona va pleyer qoladi',
    'Navo yangi versiya chiqqanini o\'zi aytadi',
    'Muqova va qo\'shiq matni ko\'proq joydan qidiriladi, phonk nomlari ham tushuniladi',
    'Concert Hall effekti, tezkor tugmalar ro\'yxati (?) va kamroq RAM',
  ],
};
const verNum = v => String(v || '0').replace(/^v/, '').split('.').map(n => parseInt(n, 10) || 0);
const verGt = (a, b) => { const x = verNum(a), y = verNum(b); for (let i = 0; i < 3; i++) { if ((x[i] || 0) !== (y[i] || 0)) return (x[i] || 0) > (y[i] || 0); } return false; };
let appVer = '';
async function getAppVersion() {
  if (appVer) return appVer;
  try {
    if (IS_DESKTOP) appVer = await NAVO.appVersion();
    else { const A = window.capacitorApp && window.capacitorApp.App; if (A) appVer = (await A.getInfo()).version; }
  } catch { /* */ }
  return appVer || '1.0.5';
}
function updateUrl() {
  if (!IS_DESKTOP) return RELEASES + 'Navo.apk';
  const ua = navigator.userAgent;
  return RELEASES + (/Linux/i.test(ua) ? 'Navo.AppImage' : 'Navo-Setup.exe');
}
function openUpdate() {
  const url = updateUrl();
  if (IS_DESKTOP) NAVO.openRelease(url); else openOutside(url);
  toast('Yuklab olingach, eski Navo ustidan o\'rnating — qo\'shiqlaringiz saqlanib qoladi', true);
  setTimeout(() => hideToast(0), 7000);
}
async function checkUpdate(manual) {
  const cur = await getAppVersion();
  $('#aboutState').textContent = 'Tekshirilmoqda…';
  let j = null;
  try { j = await httpJson('https://api.github.com/repos/Javohir877/navo/releases/latest'); } catch { /* offline */ }
  try { localStorage.setItem('navo.updAt', String(Date.now())); } catch { /* */ }
  const latest = j && j.tag_name ? j.tag_name.replace(/^v/, '') : '';
  if (!latest) { $('#aboutState').textContent = 'Tekshirib bo\'lmadi — internetni tekshiring'; if (manual) toast('Yangilanishni tekshirib bo\'lmadi'); return; }
  if (verGt(latest, cur)) {
    $('#aboutState').textContent = `Yangi versiya bor: ${latest}`;
    let skip = ''; try { skip = localStorage.getItem('navo.updSkip') || ''; } catch { /* */ }
    if (manual || skip !== latest) showUpdateCard(latest);
  } else {
    $('#aboutState').textContent = 'Sizda eng so\'nggi versiya';
    if (manual) toast('Sizda eng so\'nggi versiya ✓');
  }
}
function showUpdateCard(latest) {
  $('#ucTitle').textContent = `Navo ${latest} chiqdi`;
  $('#ucSub').textContent = 'Yangi imkoniyatlar va tuzatishlar';
  const c = $('#updateCard');
  c.dataset.ver = latest;
  c.classList.remove('hidden');
}
async function showNewsIfUpdated() {
  const cur = await getAppVersion();
  $('#aboutVer').textContent = cur;
  let seen = null; try { seen = localStorage.getItem('navo.seenVer'); } catch { /* */ }
  try { localStorage.setItem('navo.seenVer', cur); } catch { /* */ }
  // first run ever: no "what's new"; after an update: show what changed
  // seenVer is new in 1.0.4, so someone who already has songs is coming from an older version
  const updated = seen ? verGt(cur, seen) : S.tracks.size > 0;
  if (updated && NEWS[cur]) {
    $('#newsTitle').textContent = `Navo ${cur} — yangi nima bor`;
    $('#newsList').innerHTML = NEWS[cur].map(x => `<li>${esc(x)}</li>`).join('');
    $('#newsModal').classList.remove('hidden');
  }
  let last = 0; try { last = +localStorage.getItem('navo.updAt') || 0; } catch { /* */ }
  if (Date.now() - last > 6 * 3600e3) setTimeout(() => checkUpdate(false), 8000);
  else $('#aboutState').textContent = 'Yaqinda tekshirilgan';
}
function openKeys() { $('#keysModal').classList.remove('hidden'); }
function closeKeys() { $('#keysModal').classList.add('hidden'); }

function persist() {
  clearTimeout(persistTimer);
  persistTimer = setTimeout(() => {
    try {
      localStorage.setItem('navo.state', JSON.stringify({
        sort: S.sort, shuffle: S.shuffle, repeat: S.repeat, volume: S.volume, muted: S.muted,
        queue: S.queue, qIndex: S.qIndex, unshuffled: S.unshuffled, currentId: S.currentId,
        lastTime: audio.currentTime || S.lastTime, source: S.source, eq: S.eq, lite: S.lite, compact: S.compact, viz: S.viz, bass: S.bass, netCovers: S.netCovers, fx: S.fx, fxStyle: S.fxStyle,
      }));
    } catch { /* storage full or blocked */ }
  }, 300);
}

/* ---------- toast ---------- */
let toastTimer = 0;
function toast(msg, sticky = false) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  if (!sticky) toastTimer = setTimeout(() => el.classList.remove('show'), 2600);
}
function hideToast(delay = 1200) { clearTimeout(toastTimer); toastTimer = setTimeout(() => $('#toast').classList.remove('show'), delay); }

/* ============================================================
   Audio engine
   ============================================================ */
const audio = new Audio();
audio.preload = 'auto';
let actx = null, srcNode = null, analyser = null, preamp = null, filters = [], freqData = null, bassAn = null, bassData = null;

function ensureGraph() {
  if (actx) return;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return;
  try {
    actx = new AC({ latencyHint: 'playback' });
    srcNode = actx.createMediaElementSource(audio);
    preamp = actx.createGain();
    filters = EQ_FREQS.map((f, i) => {
      const b = actx.createBiquadFilter();
      b.type = i === 0 ? 'lowshelf' : i === EQ_FREQS.length - 1 ? 'highshelf' : 'peaking';
      b.frequency.value = f;
      b.Q.value = 1.1;
      b.gain.value = 0;
      return b;
    });
    analyser = actx.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.78;
    freqData = new Uint8Array(analyser.frequencyBinCount);
    // Separate, fast-reacting analyser for the low end (kick / 808 detection).
    bassAn = actx.createAnalyser();
    bassAn.fftSize = 2048;
    bassAn.smoothingTimeConstant = 0.25;
    bassData = new Uint8Array(bassAn.frequencyBinCount);
    // Audio effects: reverb (dry/wet), 8D (auto-panner driven by an LFO — no JS per frame)
    fxDry = actx.createGain();
    fxWet = actx.createGain(); fxWet.gain.value = 0;
    convolver = actx.createConvolver();
    convolver.buffer = roomIR = makeImpulse(actx, 3.2, 2.6); irMode = 'room';
    preDelay = actx.createDelay(0.2); preDelay.delayTime.value = 0.01;
    wetTone = actx.createBiquadFilter(); wetTone.type = 'lowpass'; wetTone.frequency.value = 16000; wetTone.Q.value = 0.5;
    fxMix = actx.createGain();
    panner = actx.createStereoPanner ? actx.createStereoPanner() : null;
    lfo = actx.createOscillator(); lfo.frequency.value = 0.11;
    lfoDepth = actx.createGain(); lfoDepth.gain.value = 0;
    let node = srcNode.connect(preamp);
    filters.forEach(f => { node = node.connect(f); });
    node.connect(fxDry).connect(fxMix);
    node.connect(preDelay).connect(convolver).connect(wetTone).connect(fxWet).connect(fxMix);
    let out = fxMix;
    if (panner) { lfo.connect(lfoDepth).connect(panner.pan); lfo.start(); out = fxMix.connect(panner); }
    out.connect(bassAn);
    bassAn.connect(analyser);
    analyser.connect(actx.destination);
    applyEq();
    applyFx();
  } catch (e) {
    console.warn('WebAudio unavailable', e);
    actx = null; analyser = null;
  }
}
function applyEq() {
  if (!actx) return;
  const t = actx.currentTime;
  const gains = S.eq.on ? S.eq.gains : EQ_FREQS.map(() => 0);
  filters.forEach((f, i) => f.gain.setTargetAtTime(gains[i], t, 0.04));
  const maxBoost = Math.max(0, ...gains);
  preamp.gain.setTargetAtTime(Math.pow(10, (-maxBoost * 0.7) / 20), t, 0.04);
}
/* ---------- audio effects: Slowed + Reverb, Nightcore, 8D ---------- */
let fxDry = null, fxWet = null, convolver = null, fxMix = null, panner = null, lfo = null, lfoDepth = null;
let preDelay = null, wetTone = null, roomIR = null, hallIR = null, irMode = 'room', irSwap = 0;
const FX_PRESETS = {
  'Oddiy':           { speed: 1,    reverb: 0,    d8: false },
  'Slowed + Reverb': { speed: 0.85, reverb: 0.4,  d8: false },
  'Concert Hall':    { speed: 0.84, reverb: 0.6,  d8: false, hall: true },
  'Slowed':          { speed: 0.82, reverb: 0.12, d8: false },
  'Sped up':         { speed: 1.15, reverb: 0,    d8: false },
  'Nightcore':       { speed: 1.25, reverb: 0.05, d8: false },
  '8D audio':        { speed: 1,    reverb: 0.25, d8: true },
};
function makeImpulse(ctx, seconds, decay) {
  const rate = ctx.sampleRate, len = Math.floor(rate * seconds), pre = Math.floor(rate * 0.02);
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    for (let i = pre; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - (i - pre) / (len - pre), decay);
  }
  return buf;
}
/* Concert hall: 45 ms pre-delay, a cluster of early wall reflections, then a long
   (~4.5 s RT60) diffuse tail that gets darker as it decays, like air and seats absorbing highs. */
function makeHallImpulse(ctx) {
  const rate = ctx.sampleRate, seconds = 5.2, len = Math.floor(rate * seconds), rt60 = 4.4;
  const buf = ctx.createBuffer(2, len, rate);
  for (let ch = 0; ch < 2; ch++) {
    const d = buf.getChannelData(ch);
    // early reflections: different on each side for width
    for (let k = 0; k < 14; k++) {
      const t = 0.008 + Math.random() * 0.085, i = Math.floor(t * rate);
      d[i] += (Math.random() < 0.5 ? -1 : 1) * (0.9 - k * 0.05) * Math.exp(-t * 9);
    }
    // diffuse tail, faded in over ~60 ms, low-passed more and more over time
    let lp = 0;
    const start = Math.floor(0.025 * rate), fadeIn = 0.06 * rate;
    for (let i = start; i < len; i++) {
      const t = i / rate, env = Math.pow(10, (-3 * t) / rt60) * Math.min(1, (i - start) / fadeIn);
      const a = Math.min(0.92, 0.18 + t * 0.2);           // one-pole low-pass: brighter early, warm late
      lp = lp * a + (Math.random() * 2 - 1) * (1 - a);
      d[i] += lp * env * (1.6 + t * 0.5);
    }
    const fade = Math.floor(rate * 0.3);                    // no click at the very end
    for (let i = 0; i < fade; i++) d[len - 1 - i] *= i / fade;
  }
  return buf;
}
function setReverbRoom(hall) {
  const want = hall ? 'hall' : 'room';
  if (!convolver || irMode === want) return false;
  irMode = want;
  const t = actx.currentTime, id = ++irSwap;
  fxWet.gain.setTargetAtTime(0, t, 0.03);                   // fade the old tail out, then swap (no click)
  setTimeout(() => {
    if (id !== irSwap) return;
    convolver.buffer = hall ? (hallIR || (hallIR = makeHallImpulse(actx))) : roomIR;
    const n = actx.currentTime;
    preDelay.delayTime.setTargetAtTime(hall ? 0.045 : 0.01, n, 0.01);
    wetTone.frequency.setTargetAtTime(hall ? 5200 : 16000, n, 0.01);
    fxWet.gain.setTargetAtTime(S.fx.reverb * (hall ? 0.75 : 0.85), n, 0.12);
  }, 160);
  return true;
}
function applyFx() {
  const f = S.fx;
  audio.preservesPitch = false;           // slowed / nightcore sound "real" with pitch following speed
  audio.defaultPlaybackRate = f.speed;
  audio.playbackRate = f.speed;
  if (actx && fxWet) {
    const t = actx.currentTime;
    if (!setReverbRoom(!!f.hall)) fxWet.gain.setTargetAtTime(f.reverb * (f.hall ? 0.75 : 0.85), t, 0.08);
    fxDry.gain.setTargetAtTime(1 - f.reverb * (f.hall ? 0.45 : 0.35), t, 0.08);
    if (lfoDepth) lfoDepth.gain.setTargetAtTime(f.d8 ? 0.9 : 0, t, 0.2);
  }
  const name = f.preset || 'Maxsus';
  applyStyle();
  $$('.fx-btn').forEach(b => b.classList.toggle('on', name !== 'Oddiy'));
  syncFxUi();
}
function setFxPreset(name) {
  S.fx = { ...FX_PRESETS[name], preset: name };
  applyFx(); persist();
  toast(name === 'Oddiy' ? 'Effektlar o\'chirildi' : `${name} yoqildi ✨`);
}
function syncFxUi() {
  const sp = $('#fxSpeed'); if (!sp) return;
  sp.value = S.fx.speed; setFill(sp);
  $('#fxSpeedOut').textContent = S.fx.speed.toFixed(2) + 'x';
  const rv = $('#fxReverb'); rv.value = Math.round(S.fx.reverb * 100); setFill(rv);
  $('#fxReverbOut').textContent = Math.round(S.fx.reverb * 100) + '%';
  $('#fx8d').checked = S.fx.d8;
  $('#fxState').textContent = S.fx.preset || 'Maxsus';
  $$('#fxPresets .preset').forEach(b => b.classList.toggle('active', b.dataset.fx === S.fx.preset));
}
function openFxMenu(x, y) {
  showMenu('<div class="menu-title">Audio effektlar</div>' + Object.keys(FX_PRESETS).map(n =>
    `<button data-m="${n}" class="${S.fx.preset === n ? 'sel' : ''}">${icon(S.fx.preset === n ? 'check' : 'sparkle')}${n}</button>`).join(''),
  x, y, setFxPreset);
}

function applyVolume() {
  audio.volume = S.muted ? 0 : S.volume;
  $$('.volume').forEach(r => { r.value = Math.round(S.volume * 100); setFill(r); });
  $$('.vol-ico use').forEach(u => u.setAttribute('href', S.muted || S.volume === 0 ? '#i-mute' : '#i-volume'));
}
function setFill(r) {
  const min = +r.min || 0, max = +r.max || 100;
  r.style.setProperty('--p', `${((r.value - min) / (max - min)) * 100}%`);
}

const cur = () => S.tracks.get(S.currentId);
let loadToken = 0, objUrl = null, errorStreak = 0;

async function srcFor(t, force = false) {
  if (IS_DESKTOP) return NAVO.mediaUrl(t.path, force);
  const blob = await DB.get('blobs', t.id);
  if (!blob) return null;
  if (objUrl) URL.revokeObjectURL(objUrl);
  objUrl = URL.createObjectURL(blob);
  return objUrl;
}

async function loadIndex(i, autoplay = true, startAt = 0) {
  const id = S.queue[i];
  const t = S.tracks.get(id);
  if (!t) return;
  const tok = ++loadToken;
  S.qIndex = i;
  S.currentId = id;
  t._forced = false;
  updateNowPlaying(t);
  const src = await srcFor(t);
  if (tok !== loadToken) return;
  if (!src) { toast('Fayl topilmadi'); return; }
  audio.src = src;
  if (S.bass) prepareBeats(t);
  if (startAt > 0) audio.addEventListener('loadedmetadata', () => { try { audio.currentTime = startAt; } catch { /* */ } }, { once: true });
  if (autoplay) play();
  persist();
}

async function play() {
  if (!S.currentId) {
    const ids = S.visible.length ? S.visible : S.order;
    if (ids.length) return playList(ids, 0);
    return;
  }
  if (!audio.src) return loadIndex(S.qIndex, true, S.lastTime);
  ensureGraph();
  if (actx && actx.state === 'suspended') { try { await actx.resume(); } catch { /* */ } }
  try { await audio.play(); } catch (e) { if (e.name !== 'AbortError') console.warn(e); }
}
function pause() { audio.pause(); }
function toggle() { (audio.paused ? play : pause)(); }

function playList(ids, index, source) {
  if (!ids.length) return;
  S.queue = ids.slice();
  S.unshuffled = null;
  S.source = source || VIEW_TITLES[S.view] || 'Kutubxona';
  if (S.shuffle) {
    S.unshuffled = S.queue.slice();
    const first = S.queue.splice(index, 1)[0];
    shuffleArr(S.queue).unshift(first);
    index = 0;
  }
  loadIndex(index, true);
  renderNext();
}

function next(auto = false) {
  if (!S.queue.length) return;
  if (auto && sleepT.eot) {
    Object.assign(sleepT, { eot: false }); syncSleep();
    audio.currentTime = 0; audio.pause();
    toast('Uyqu taymeri: musiqa to\'xtatildi. Yaxshi dam oling 🌙');
    return;
  }
  if (auto && S.repeat === 'one') { audio.currentTime = 0; play(); return; }
  let i = S.qIndex + 1;
  if (i >= S.queue.length) {
    if (S.repeat === 'all' || !auto) i = 0;
    else { audio.pause(); audio.currentTime = 0; return; }
  }
  loadIndex(i, true);
}
function prev() {
  if (audio.currentTime > 3) { audio.currentTime = 0; return; }
  let i = S.qIndex - 1;
  if (i < 0) i = S.repeat === 'all' ? S.queue.length - 1 : 0;
  loadIndex(i, true);
}
function seekTo(sec) { if (isFinite(audio.duration)) audio.currentTime = Math.max(0, Math.min(audio.duration - 0.05, sec)); }

function toggleShuffle() {
  S.shuffle = !S.shuffle;
  const id = S.currentId;
  if (S.queue.length) {
    if (S.shuffle) {
      S.unshuffled = S.queue.slice();
      const rest = S.queue.filter(x => x !== id);
      S.queue = id ? [id, ...shuffleArr(rest)] : shuffleArr(rest);
      S.qIndex = id ? 0 : -1;
    } else if (S.unshuffled) {
      S.queue = S.unshuffled.filter(x => S.tracks.has(x));
      S.unshuffled = null;
      S.qIndex = Math.max(0, S.queue.indexOf(id));
    }
  }
  toast(S.shuffle ? 'Aralash ijro yoqildi' : 'Aralash ijro o\'chirildi');
  syncModes(); renderNext(); if (S.view === 'queue') renderList(); persist();
}
function cycleRepeat() {
  S.repeat = S.repeat === 'off' ? 'all' : S.repeat === 'all' ? 'one' : 'off';
  toast({ off: 'Takrorlash o\'chirildi', all: 'Hammasini takrorlash', one: 'Bitta qo\'shiqni takrorlash' }[S.repeat]);
  syncModes(); persist();
}

/* audio events */
audio.addEventListener('play', () => { S.playing = true; syncPlayState(); startLoop(); });
audio.addEventListener('pause', () => { S.playing = false; syncPlayState(); persist(); });
audio.addEventListener('waiting', () => $$('.play-btn').forEach(b => b.classList.add('loading')));
audio.addEventListener('playing', () => { errorStreak = 0; $$('.play-btn').forEach(b => b.classList.remove('loading')); });
audio.addEventListener('canplay', () => $$('.play-btn').forEach(b => b.classList.remove('loading')));
audio.addEventListener('ended', () => next(true));
audio.addEventListener('loadedmetadata', () => {
  const t = cur();
  if (t && isFinite(audio.duration) && audio.duration > 0 && Math.abs((t.duration || 0) - audio.duration) > 1) {
    t.duration = audio.duration;
    DB.put('tracks', stripTrack(t)).catch(() => {});
    const row = $(`.row[data-id="${CSS.escape(t.id)}"] .dur`);
    if (row) row.textContent = fmtTime(t.duration);
  }
  updateProgress(true);
  updatePositionState();
});
let lastPersist = 0;
audio.addEventListener('timeupdate', () => {
  if (!S.playing) updateProgress();
  const now = Date.now();
  if (now - lastPersist > 5000) { lastPersist = now; persist(); }
});
audio.addEventListener('error', () => {
  const t = cur();
  if (!t || !audio.getAttribute('src')) return;
  $$('.play-btn').forEach(b => b.classList.remove('loading'));
  // Desktop: retry through the ffmpeg converter (e.g. ALAC inside .m4a)
  if (IS_DESKTOP && !t._forced) {
    t._forced = true;
    srcFor(t, true).then(src => { audio.src = src; play(); });
    return;
  }
  errorStreak++;
  toast(IS_DESKTOP ? `"${t.title}" ochilmadi — fayl ko'chirilgan yoki buzilgan bo'lishi mumkin`
                   : `"${t.title}" — bu format telefoningizda qo'llab-quvvatlanmaydi`);
  if (errorStreak < 4 && S.queue.length > 1) setTimeout(() => next(true), 1200);
});

/* ============================================================
   Now playing / palette
   ============================================================ */
function hueOf(str) { let h = 0; for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) % 360; return h; }
function placeholderArt(t) {
  // stays inside Navo's own indigo -> violet -> magenta range, so covers-less songs still look like one set
  const h = 232 + hueOf((t.title || '') + (t.artist || '')) % 112, h2 = h + 28;
  return 'data:image/svg+xml;utf8,' + encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 400"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="hsl(${h},62%,52%)"/><stop offset="1" stop-color="hsl(${h2},70%,22%)"/></linearGradient><radialGradient id="r" cx=".28" cy=".22" r=".85"><stop offset="0" stop-color="#fff" stop-opacity=".26"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></radialGradient></defs><rect width="400" height="400" fill="url(#g)"/><rect width="400" height="400" fill="url(#r)"/><g fill="none" stroke="rgba(255,255,255,.8)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" transform="translate(128 128) scale(6)"><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></g></svg>`);
}
function hsl(h, s, l) { return `hsl(${Math.round(h)}, ${Math.round(s * 100)}%, ${Math.round(l * 100)}%)`; }
function hslToRgb(h, s, l) {
  h /= 360;
  const f = n => { const k = (n + h * 12) % 12; const a = s * Math.min(l, 1 - l); return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
  return [f(0) * 255, f(8) * 255, f(4) * 255].map(Math.round);
}
function rgbToHsl(r, g, b) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
  if (max === min) return [0, 0, l];
  const d = max - min, s = l > .5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s, l];
}
function setPalette(hues, sats = [0.8, 0.8, 0.8]) {
  const root = document.documentElement.style;
  root.setProperty('--c1', hsl(hues[0], Math.max(.55, sats[0]), .55));
  root.setProperty('--c2', hsl(hues[1], Math.max(.55, sats[1]), .55));
  root.setProperty('--c3', hsl(hues[2], Math.max(.5, sats[2]), .5));
  const [r, g, b] = hslToRgb(hues[0], Math.min(1, Math.max(.7, sats[0])), .72);
  root.setProperty('--accent', `rgb(${r}, ${g}, ${b})`);
  root.setProperty('--accent-rgb', `${r}, ${g}, ${b}`);
  vizColors = [hsl(hues[0], Math.max(.55, sats[0]), .55), `rgb(${r}, ${g}, ${b})`, hsl(hues[1], Math.max(.55, sats[1]), .55)];
  fxRGB = [hslToRgb(hues[0], Math.max(.6, sats[0]), .62).join(', '), `${r}, ${g}, ${b}`, hslToRgb(hues[1], Math.max(.6, sats[1]), .62).join(', ')];
}
function paletteFromImage(img) {
  const N = 28, c = document.createElement('canvas');
  c.width = c.height = N;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.drawImage(img, 0, 0, N, N);
  const d = g.getImageData(0, 0, N, N).data;
  const bins = Array.from({ length: 18 }, () => ({ w: 0, s: 0 }));
  let total = 0;
  for (let i = 0; i < d.length; i += 4) {
    const [h, s, l] = rgbToHsl(d[i], d[i + 1], d[i + 2]);
    const w = s * s * Math.max(0, 1 - Math.abs(l - .5) * 1.8);
    if (w <= 0.01) continue;
    const b = bins[Math.floor(h / 20) % 18];
    b.w += w; b.s += s * w; total += w;
  }
  const ranked = bins.map((b, i) => ({ h: i * 20 + 10, w: b.w, s: b.w ? b.s / b.w : 0 })).sort((a, b) => b.w - a.w);
  if (total < 2) return null; // basically grayscale art
  const picks = [ranked[0]];
  for (const r of ranked) {
    if (picks.length >= 3) break;
    if (r.w > 0 && picks.every(p => Math.min(Math.abs(p.h - r.h), 360 - Math.abs(p.h - r.h)) >= 40)) picks.push(r);
  }
  while (picks.length < 3) picks.push({ h: (picks[0].h + 40 * picks.length) % 360, s: picks[0].s });
  return { hues: picks.map(p => p.h), sats: picks.map(p => p.s) };
}

// Draw the cover tiny, blurred & tinted once; upscaled by the GPU it looks like a heavy blur for free.
function softBackdrop(img, filter) {
  const S1 = 96, c = document.createElement('canvas');
  c.width = c.height = S1;
  const g = c.getContext('2d');
  g.filter = filter;
  g.drawImage(img, -8, -8, S1 + 16, S1 + 16);
  return c.toDataURL('image/jpeg', 0.9);
}

let artToken = 0;
async function updateNowPlaying(t) {
  document.documentElement.classList.add('has-track');
  $$('.cur-title').forEach(e => { e.textContent = t.title; });
  $$('.cur-artist').forEach(e => { e.textContent = t.artist || 'Noma\'lum ijrochi'; });
  const info = [(t.ext || '').toUpperCase(), t.sampleRate ? `${(t.sampleRate / 1000).toFixed(1).replace('.0', '')} kHz` : '', t.bitsPerSample ? `${t.bitsPerSample}-bit` : '', t.bitrate ? `${Math.round(t.bitrate / 1000)} kbps` : ''].filter(Boolean).join(' · ');
  $$('.cur-info').forEach(e => { e.textContent = info; });
  $('#tbTrack').textContent = `${t.title}${t.artist ? ' — ' + t.artist : ''}`;
  applyStyle();
  document.title = `${t.title} — Navo`;
  syncFav();
  markPlaying();
  renderNext();
  nativeUpdate();
  if (ly.open) loadLyrics(t);

  const tok = ++artToken;
  let art = t.artKey ? await DB.get('art', t.artKey).catch(() => null) : null;
  if (tok !== artToken) return;
  const hasArt = !!art;
  if (!art) art = placeholderArt(t);
  $$('.cur-art').forEach(img => { img.src = art; });
  // Backgrounds use a pre-blurred tiny copy of the cover: no live CSS blur -> much smoother.
  let img = null;
  try { img = await loadImage(art); } catch { /* */ }
  if (tok !== artToken) return;
  const soft = img ? softBackdrop(img, 'blur(5px) saturate(1.8) brightness(.62)') : art;
  const bg = $('#bgArt');
  bg.style.backgroundImage = `url("${soft}")`;
  bg.classList.toggle('on', hasArt);
  $('#fpBg').style.backgroundImage = `url("${soft}")`;
  syncNowCard();

  let pal = null;
  if (hasArt && img) { try { pal = paletteFromImage(img); } catch { /* */ } }
  if (tok !== artToken) return;
  if (pal) setPalette(pal.hues, pal.sats);
  else { const h = 232 + hueOf((t.title || '') + (t.artist || '')) % 112; setPalette([h, h + 28, (h + 150) % 360]); }
  updateMediaSession(t, hasArt ? art : null);
}

function updateMediaSession(t, art) {
  if (!('mediaSession' in navigator)) return;
  try {
    navigator.mediaSession.metadata = new MediaMetadata({
      title: t.title, artist: t.artist || '', album: t.album || '',
      artwork: art ? [{ src: art, sizes: '600x600', type: 'image/jpeg' }] : [],
    });
  } catch { /* */ }
}
function updatePositionState() {
  if (!('mediaSession' in navigator) || !navigator.mediaSession.setPositionState) return;
  try { if (isFinite(audio.duration)) navigator.mediaSession.setPositionState({ duration: audio.duration, position: Math.min(audio.currentTime, audio.duration), playbackRate: 1 }); } catch { /* */ }
}
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession;
  const h = (a, f) => { try { ms.setActionHandler(a, f); } catch { /* */ } };
  h('play', play); h('pause', pause);
  h('previoustrack', prev); h('nexttrack', () => next());
  h('seekto', e => seekTo(e.seekTime));
  h('seekbackward', e => seekTo(audio.currentTime - (e.seekOffset || 10)));
  h('seekforward', e => seekTo(audio.currentTime + (e.seekOffset || 10)));
}

/* ---------- Android: foreground service + notification controls ---------- */
const NativeMedia = (!IS_DESKTOP && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.capacitorExports)
  ? window.capacitorExports.registerPlugin('NavoMedia') : null;
function nativeUpdate() {
  if (!NativeMedia) return;
  const t = cur();
  if (!t) { NativeMedia.stop().catch(() => {}); return; }
  NativeMedia.update({ title: t.title, artist: t.artist || 'Navo', playing: S.playing }).catch(() => {});
}
if (NativeMedia) {
  NativeMedia.addListener('action', e => {
    const a = e && e.action;
    if (a === 'toggle') toggle();
    else if (a === 'next') next();
    else if (a === 'prev') prev();
  });
}

/* ---------- UI sync ---------- */
function syncPlayState() {
  nativeUpdate();
  document.documentElement.classList.toggle('is-paused', !S.playing);
  if (IS_DESKTOP && NAVO.setPlaying) NAVO.setPlaying(S.playing);
  $$('.play-btn use').forEach(u => u.setAttribute('href', S.playing ? '#i-pause' : '#i-play'));
  $('#trackList').classList.toggle('paused', !S.playing);
  $$('.row.playing').forEach(r => r.classList.toggle('paused', !S.playing));
  if ('mediaSession' in navigator) navigator.mediaSession.playbackState = S.playing ? 'playing' : 'paused';
}
function syncModes() {
  $$('.shuffle-btn').forEach(b => b.classList.toggle('on', S.shuffle));
  $$('.repeat-btn').forEach(b => { b.classList.toggle('on', S.repeat !== 'off'); $('use', b).setAttribute('href', S.repeat === 'one' ? '#i-repeat-one' : '#i-repeat'); });
}
function syncFav() {
  const t = cur();
  $$('.fav-btn').forEach(b => { b.classList.toggle('on', !!(t && t.fav)); $('use', b).setAttribute('href', t && t.fav ? '#i-heart-fill' : '#i-heart'); });
}
let seeking = false;
function updateProgress(force = false) {
  if (seeking && !force) return;
  const d = audio.duration, c = audio.currentTime;
  const ok = isFinite(d) && d > 0;
  const v = ok ? Math.round((c / d) * 1000) : 0;
  $$('.seek').forEach(r => { r.value = v; setFill(r); });
  $$('.t-cur').forEach(e => { e.textContent = fmtTime(c); });
  $$('.t-dur').forEach(e => { e.textContent = ok ? fmtTime(d) : (cur() ? fmtTime(cur().duration) : '0:00'); });
  $('.mini-prog').style.setProperty('--p', `${v / 10}%`);
}
function markPlaying() {
  $$('.row.playing').forEach(r => {
    r.classList.remove('playing', 'paused');
    const n = $('.num', r); if (n) n.textContent = +r.dataset.i + 1;
  });
  if (!S.currentId) return;
  const r = $(`.row[data-id="${CSS.escape(S.currentId)}"]`);
  if (r) {
    r.classList.add('playing');
    r.classList.toggle('paused', !S.playing);
    $('.num', r).innerHTML = '<span class="eqbars"><i></i><i></i><i></i></span>';
  }
}

/* ============================================================
   Visualizer
   ============================================================ */
const vizState = new Map();
const fpArtEl = $('#fpArt'), fpGlowEl = $('.fp-glow');
let vizColors = ['#6d5cff', '#a597ff', '#ff4f9a'];
const vizCanvases = () => [$('#npViz'), $('#fpViz'), document.getElementById('mViz')].filter(Boolean);
function clearViz() { for (const cv of vizCanvases()) { const g = cv.getContext('2d'); g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, cv.width, cv.height); } }
/* ============================================================
   Bass engine — runs every frame (60 fps), time-based smoothing.
   level : how loud the low end is right now (the cover "breathes")
   punch : sudden jump in bass (kick / 808 hit)
   BAMM  : a strong hit -> shock ring + flash + tiny shake
   Everything animates only transform/opacity, so it stays smooth.
   ============================================================ */
let bassAvg = 0, bassSlow = 0, prevE = 0, level = 0, punch = 0, lastBoom = 0, lastTs = 0, lastPulseOut = -1;
// live collections: covers created later (mobile now-playing card) pulse too
const bassArts = document.getElementsByClassName('bass-art'), bassGlows = document.getElementsByClassName('bass-glow');
const fpBgEl = $('#fpBg'), fpBodyEl = $('.fp-body'), fpFlashEl = $('.fp-flash');
const lerpK = (dt, tau) => 1 - Math.exp(-dt / tau);
function bassEnergy() {
  if (!bassAn || !S.playing) return 0;
  bassAn.getByteFrequencyData(bassData);
  // bin width ≈ 23 Hz at 48 kHz -> bins 2..7 ≈ 45–165 Hz (kick + 808 body)
  let e = 0, peak = 0;
  for (let i = 2; i <= 7; i++) { e += bassData[i]; if (bassData[i] > peak) peak = bassData[i]; }
  return (e / 6 * 0.6 + peak * 0.4) / 255;
}
/* ============================================================
   Beat map — every bass hit of the song found ahead of time, so the
   effects land on the exact frame the kick / 808 is heard.
   ============================================================ */
const beatCache = new Map();        // track id -> { times, str }
let beatMap = null, beatFor = null, beatIdx = 0;
function hitBeat(s, ts, big) {
  if (window.__beatLog) window.__beatLog.push(audio.currentTime);
  const level2 = big === null ? (s >= FXP.boomTh ? 1 : 0) : big;   // 0 small, 1 BAMM, 2 MEGA (drop)
  // every hit: the cover breathes a little (scaled by how hard it hits)
  punch = Math.max(punch, Math.min(1, s * (level2 ? 0.95 : 0.4) * Math.min(1.2, FXP.punch)));
  if (FXP.ripple) {                                      // calm music: only soft ripples
    if (level2 && ts - lastBoom > 1400) { lastBoom = ts; gentleRipple(s); }
    return;
  }
  if (level2 === 2 && ts - lastBoom > 200) { lastBoom = ts; boom(1, true); }   // the drop: everything at once
  else if (level2 === 1 && ts - lastBoom > FXP.minGap) { lastBoom = ts; boom(Math.max(0.5, s)); }
  else edgeKick = Math.max(edgeKick, s * 0.3 * FXP.edge);
}
/* Smooth media clock: some Android WebViews update currentTime only every ~250 ms,
   which made the effects arrive in bursts. Interpolate between updates instead. */
const mclock = { ct: -1, at: 0 };
function mediaTime() {
  const ct = audio.currentTime, now = performance.now();
  if (ct !== mclock.ct || audio.paused) { mclock.ct = ct; mclock.at = now; return ct; }
  return ct + Math.min(0.5, (now - mclock.at) / 1000) * (audio.playbackRate || 1);
}
// How late the sound reaches the speakers (phones are slower, Bluetooth even more)
function audioLatency() {
  const fallback = IS_DESKTOP ? 0.02 : 0.09;
  if (!actx) return fallback;
  const o = actx.outputLatency;
  return (typeof o === 'number' && o > 0 ? o : fallback) + (actx.baseLatency || 0);
}
function seekBeat() {
  if (!beatMap) return;
  const now = mediaTime() - audioLatency(), t = beatMap.times;
  let lo = 0, hi = t.length;
  while (lo < hi) { const m = (lo + hi) >> 1; if (t[m] < now) lo = m + 1; else hi = m; }
  beatIdx = lo;
}
async function trackBytes(t) {
  if (IS_DESKTOP) { const r = await fetch(NAVO.mediaUrl(t.path)); return r.ok ? r.arrayBuffer() : null; }
  const b = await DB.get('blobs', t.id);
  return b ? b.arrayBuffer() : null;
}
/* The whole beat analysis is one self-contained function, so it can run inside a
   Web Worker (no UI freeze on phones) — or inline as a fallback. */
function beatCore(c0, c1, sr) {
  function estimateBpm(times, str) {
    const hist = new Float32Array(111);                    // 70..180 BPM
    for (let i = 1; i < times.length; i++) {
      for (let j = i - 1; j >= Math.max(0, i - 4); j--) {
        const d = times[i] - times[j];
        if (d < 0.25 || d > 2) continue;
        let bpm = 60 / d;
        while (bpm < 70) bpm *= 2;
        while (bpm >= 180) bpm /= 2;
        const w = (str[i] + str[j]) * (j === i - 1 ? 1 : 0.5);
        const b = Math.round(bpm) - 70;
        for (let k = -1; k <= 1; k++) if (b + k >= 0 && b + k < 111) hist[b + k] += w * (k ? 0.5 : 1);
      }
    }
    let best = 0; for (let b = 1; b < 111; b++) if (hist[b] > hist[best]) best = b;
    return best + 70;
  }
  function classifyStyle(times, str, dur, bassRatio, rms) {
    const n = times.length, density = n / Math.max(1, dur);
    let strongN = 0; for (let i = 0; i < n; i++) if (str[i] > 0.6) strongN++;
    const strong = strongN / Math.max(1, dur);
    const bpm = n > 8 ? estimateBpm(times, str) : 0;
    let style;
    if (density < 0.7 || rms < 0.045 || (bassRatio < 0.1 && density < 1.6)) style = 'calm';
    else if (bassRatio > 0.3 && strong > 0.9) style = 'phonk';
    else if (bpm >= 70 && bpm <= 108 && bassRatio > 0.16) style = 'rap';
    else if (bpm >= 114 && bpm <= 140 && density > 1.6) style = 'electro';
    else if (bassRatio > 0.34 && density > 1.2) style = 'phonk';
    else style = 'pop';
    return { style, bpm, density: +density.toFixed(2), bass: +bassRatio.toFixed(2), rms: +rms.toFixed(3) };
  }

  const len = c0.length;
  const HOP = Math.max(32, Math.round(sr * 0.0058)), hopSec = HOP / sr;
  const a = Math.exp(-2 * Math.PI * 160 / sr);              // 2-pole low-pass ~160 Hz
  const nF = Math.floor(len / HOP), E = new Float32Array(nF);
  let lp = 0, lp2 = 0, k = 0, totE = 0, bassE = 0;
  for (let f = 0; f < nF; f++) {
    let s = 0;
    for (let j = 0; j < HOP; j++, k++) {
      const x = c1 ? (c0[k] + c1[k]) * 0.5 : c0[k];
      lp = a * lp + (1 - a) * x; lp2 = a * lp2 + (1 - a) * lp;
      s += lp2 * lp2;
      totE += x * x;
    }
    E[f] = s / HOP;
  }
  const per = Math.round(1 / hopSec), blocks = Math.ceil(nF / per), bMax = new Float32Array(blocks);
  for (let f = 0; f < nF; f++) { const b = (f / per) | 0; if (E[f] > bMax[b]) bMax[b] = E[f]; }
  let gMax = 0; for (let b = 0; b < blocks; b++) gMax = Math.max(gMax, bMax[b]);
  // smooth over ~23 ms (one period of a 45 Hz 808) so the bass wave itself doesn't look like new hits
  const W = 4, Es = new Float32Array(nF);
  for (let f = 0, acc = 0; f < nF; f++) { acc += E[f]; if (f >= W) acc -= E[f - W]; Es[f] = acc / Math.min(W, f + 1); }
  const L = new Float32Array(nF); for (let f = 0; f < nF; f++) L[f] = Math.log(Es[f] + 1e-10);
  const times = [], peaks = [];
  const refr = Math.round(0.11 / hopSec), back = 10, lead = (W / 2) * hopSec;
  let last = -1e9;
  for (let f = back; f < nF - 8; f++) {
    let mn = L[f - 1]; for (let j = 2; j <= back; j++) if (L[f - j] < mn) mn = L[f - j];
    if (L[f] - mn < 1.1 || f - last < refr) continue;       // needs a sharp rise (~4.8 dB in ~60 ms)
    let pk = Es[f]; for (let j = 1; j <= 8; j++) if (Es[f + j] > pk) pk = Es[f + j];
    const b = (f / per) | 0;
    const ref = Math.max(bMax[b], b > 0 ? bMax[b - 1] : 0, b + 1 < blocks ? bMax[b + 1] : 0);
    if (pk < ref * 0.22 || pk < gMax * 0.02) continue;
    times.push(Math.max(0, f * hopSec - lead)); peaks.push(pk); last = f;
  }
  // linear strength vs the song's loud hits: quiet intros / breakdowns stay weak
  const sorted = peaks.slice().sort((x, y) => x - y);
  const ref95 = sorted[Math.floor(sorted.length * 0.95)] || gMax || 1;
  const str = new Float32Array(peaks.length);
  for (let i = 0; i < peaks.length; i++) str[i] = Math.min(1, peaks[i] / ref95);
  // sections, like a phonk edit: where the bass is really ON (the drop)
  const bl = Math.max(1, Math.round(0.5 / hopSec)), nB = Math.ceil(nF / bl), bMean = new Float32Array(nB);
  for (let f = 0; f < nF; f++) bMean[(f / bl) | 0] += Es[f] / bl;
  const sec = new Float32Array(nB);
  for (let b = 0; b < nB; b++) { let s = 0, c = 0; for (let q = -3; q <= 3; q++) if (b + q >= 0 && b + q < nB) { s += bMean[b + q]; c++; } sec[b] = s / c; }
  const p90 = Array.from(sec).sort((x, y) => x - y)[Math.floor(nB * 0.9)] || 1;
  const energyAt = tt => tt < 0 ? 0 : sec[Math.min(nB - 1, (tt / (bl * hopSec)) | 0)] / p90;
  // big: 0 = small punch only, 1 = BAMM on the beat, 2 = MEGA (the drop / bass coming back)
  const bpm0 = times.length > 8 ? estimateBpm(times, str) : 120;
  const beatGap = Math.max(0.38, (60 / bpm0) * 0.92);
  const big = new Uint8Array(str.length);
  let lastBigI = -1, lastMega = -99;
  for (let i = 0; i < str.length; i++) {
    const tt = times[i];
    if (energyAt(tt) < 0.55 || str[i] < 0.4) continue;
    if (tt > 1.5 && energyAt(tt - 1.2) < 0.42 && tt - lastMega > 4) { big[i] = 2; lastMega = tt; lastBigI = i; continue; }
    if (lastBigI >= 0 && tt - times[lastBigI] < beatGap) {
      if (big[lastBigI] === 1 && str[i] > str[lastBigI]) { big[lastBigI] = 0; big[i] = 1; lastBigI = i; }
      continue;
    }
    big[i] = 1; lastBigI = i;
  }
  for (let f = 0; f < nF; f++) bassE += E[f] * HOP;
  const t32 = Float32Array.from(times);
  return { times: t32, str, big, style: classifyStyle(t32, str, len / sr, bassE / (totE || 1), Math.sqrt(totE / (len || 1))) };
}
let beatWorker = null, beatJob = 0;
const beatJobs = new Map();
function getBeatWorker() {
  if (beatWorker !== null) return beatWorker;
  try {
    const src = `${beatCore.toString()}
      onmessage = e => { const { id, c0, c1, sr } = e.data;
        try { const r = beatCore(c0, c1, sr); postMessage({ id, r }, [r.times.buffer, r.str.buffer, r.big.buffer]); }
        catch (err) { postMessage({ id, err: String(err) }); } };`;
    const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
    beatWorker = new Worker(url);
    URL.revokeObjectURL(url);
    beatWorker.onmessage = e => { const j = beatJobs.get(e.data.id); if (j) { beatJobs.delete(e.data.id); e.data.err ? j.rej(new Error(e.data.err)) : j.res(e.data.r); } };
    beatWorker.onerror = () => { beatJobs.forEach(j => j.rej(new Error('worker'))); beatJobs.clear(); beatWorker = false; };
  } catch { beatWorker = false; }
  return beatWorker;
}
let beatIdle = 0;
function runBeatCore(c0, c1, sr) {
  clearTimeout(beatIdle);
  beatIdle = setTimeout(() => { if (beatWorker && !beatJobs.size) { beatWorker.terminate(); beatWorker = null; } }, 30000);
  const w = getBeatWorker();
  if (!w) return Promise.resolve(beatCore(c0, c1, sr));      // fallback: same code, main thread
  return new Promise((res, rej) => {
    const id = ++beatJob;
    beatJobs.set(id, { res, rej });
    const bufs = [c0.buffer]; if (c1) bufs.push(c1.buffer);
    w.postMessage({ id, c0, c1, sr }, bufs);
  });
}
async function analyzeBeats(t) {
  if (!t) return null;
  if (beatCache.has(t.id)) return beatCache.get(t.id);
  if ((t.duration || 0) > 15 * 60) return null;             // skip hour-long mixes
  const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext;
  if (!OAC) return null;
  const bytes = await trackBytes(t);
  if (!bytes) return null;
  const ab = await new OAC(1, 1, 11025).decodeAudioData(bytes); // decoding is off-thread; low rate = 4x less work
  // copy the channels so they can be handed to the worker
  const c0 = new Float32Array(ab.getChannelData(0));
  const c1 = ab.numberOfChannels > 1 ? new Float32Array(ab.getChannelData(1)) : null;
  const res = await runBeatCore(c0, c1, ab.sampleRate);
  beatCache.set(t.id, res);
  if (beatCache.size > 24) beatCache.delete(beatCache.keys().next().value);
  return res;
}

const FX_STYLES = {
  calm:    { label: 'Sokin',    boomTh: 2,    minGap: 1400, waves: 1, kind: 'soft',  dur: 2400, sparks: 0,    punch: 0.35, shake: 0,   flash: 0,   edge: 0.45, rays: 0.4, ripple: true },
  rap:     { label: 'Rep',      boomTh: 0.5,  minGap: 560,  waves: 1, kind: 'crisp', dur: 650,  sparks: 0.25, punch: 1.35, shake: 0.6, flash: 0,   edge: 1,    rays: 0.7 },
  phonk:   { label: 'Phonk',    boomTh: 0.5,  minGap: 450,  waves: 3, kind: '',      dur: 1150, sparks: 1.2,  punch: 1,    shake: 1,   flash: 1,   edge: 1,    rays: 1.4 },
  electro: { label: 'Elektron', boomTh: 0.5,  minGap: 440,  waves: 2, kind: '',      dur: 900,  sparks: 0.8,  punch: 0.75, shake: 0,   flash: 0.7, edge: 1,    rays: 2 },
  pop:     { label: 'Pop',      boomTh: 0.55, minGap: 520,  waves: 2, kind: '',      dur: 1000, sparks: 0.6,  punch: 0.8,  shake: 0,   flash: 0.4, edge: 0.8,  rays: 1 },
};
let FXP = FX_STYLES.pop, detectedStyle = null;
function applyStyle() {
  const key = S.fxStyle && S.fxStyle !== 'auto' ? S.fxStyle : (detectedStyle && detectedStyle.style) || 'pop';
  FXP = FX_STYLES[key] || FX_STYLES.pop;
  try { const a = raysEl.getAnimations()[0]; if (a) a.playbackRate = FXP.rays; } catch { /* */ }
  const lab = $('#styleState');
  if (lab) lab.textContent = (S.fxStyle === 'auto' ? 'Avto · ' : '') + FXP.label +
    (detectedStyle && detectedStyle.bpm ? ` · ~${detectedStyle.bpm} BPM` : '');
  $$('#stylePresets .preset').forEach(b => b.classList.toggle('active', b.dataset.style === (S.fxStyle || 'auto')));
  const mLab = $('.m-now-meta small');
  if (mLab) mLab.textContent = `Hozir ijroda · ${FXP.label}`;
  const fx = S.fx.preset && S.fx.preset !== 'Oddiy' ? ` · ${S.fx.preset}` : '';
  $('#fpSource').textContent = `${S.source || 'Kutubxona'}${fx} · ${FXP.label}`;
}

let beatToken = 0;
async function prepareBeats(t) {
  const tok = ++beatToken;
  beatMap = null; beatFor = null;
  if (!beatCache.has(t && t.id)) { detectedStyle = null; applyStyle(); }
  try {
    const res = await analyzeBeats(t);
    if (tok !== beatToken || !res) return;
    beatMap = res; beatFor = t.id; seekBeat();
    detectedStyle = res.style || null; applyStyle();
    if (res.style) document.documentElement.dataset.style = JSON.stringify(res.style);
    if (res.big) {
      const mega = [], b = res.big;
      let bamm = 0; for (let i = 0; i < b.length; i++) { if (b[i] === 1) bamm++; if (b[i] === 2) mega.push(+res.times[i].toFixed(1)); }
      document.documentElement.dataset.bstat = JSON.stringify({ hits: b.length, bamm, mega: mega.length, dropsAt: mega.slice(0, 8) });
    }
    document.documentElement.dataset.beats = res.times.length;
    // pre-analyse the next song so it is in sync from its first hit
    const nextT = S.tracks.get(S.queue[S.qIndex + 1]);
    if (nextT) setTimeout(() => analyzeBeats(nextT).catch(() => {}), 1500);
  } catch (e) { console.warn('beat analysis failed', e); }
}
audio.addEventListener('seeked', seekBeat);


/* ============================================================
   Phone effect mode: phones choked on the full-screen layers, so on
   Android only the visible cover moves (one small element) and a hit
   adds a thin ring around it. Nothing full-screen, no blur, no glow.
   ============================================================ */
const PHONE_FX = !IS_DESKTOP;
if (PHONE_FX) document.documentElement.classList.add('phone-fx');
function visibleCover() {
  if ($('#fullPlayer').classList.contains('open')) return ly.open ? null : fpArtEl;
  const m = $('.m-now .bass-art');
  if (m && m.offsetParent) { const r = m.getBoundingClientRect(); if (r.bottom > 0 && r.top < innerHeight - 150) return m; }
  return $('.p-art');
}
let phoneCover = null;
function phonePulse(p) {
  const el = visibleCover();
  if (phoneCover && phoneCover !== el) phoneCover.style.transform = '';
  phoneCover = el;
  if (el) el.style.transform = p > 0.002 ? `scale(${(1 + p * 0.04).toFixed(3)})` : '';
}
function phoneBoom(s, mega) {
  const el = visibleCover();
  if (!el) return;
  const ring = el.parentElement && el.parentElement.querySelector('.boom-ring');
  if (ring) { stopAnims(ring); ring.animate(RING_KF, { duration: mega ? 700 : 520, easing: 'cubic-bezier(.15,.75,.3,1)' }); }
}

function bassPulse(dt, ts) {
  const e = bassEnergy();
  bassAvg += (e - bassAvg) * lerpK(dt, 1400);       // long-term average (song loudness)
  bassSlow += (e - bassSlow) * lerpK(dt, 90);
  const rise = e - prevE; prevE = e;

  // continuous breathing, normalised to the song's own bass level
  const lvTarget = Math.max(0, Math.min(1, (bassSlow - bassAvg * 0.75) / Math.max(0.12, bassAvg * 0.7)));
  level += (lvTarget - level) * lerpK(dt, lvTarget > level ? 45 : 220);

  const bm = beatMap && beatFor === S.currentId ? beatMap : null;
  if (bm) {
    // Frame-exact: fire on the pre-analysed hits, compensating the audio output latency.
    const heard = mediaTime() - audioLatency();
    punch *= 1 - lerpK(dt, 150);                      // decay after each hit
    // fire only the newest passed hit: never a burst of several at once
    let fire = -1;
    while (beatIdx < bm.times.length && bm.times[beatIdx] <= heard) {
      if (heard - bm.times[beatIdx] < 0.12) fire = beatIdx;
      beatIdx++;
    }
    if (fire >= 0 && S.playing) hitBeat(bm.str[fire], ts, bm.big ? bm.big[fire] : null);
  } else {
    // Fallback until the song is analysed: real-time detection.
    const pTarget = Math.max(0, Math.min(1, (e - bassAvg * 1.08) * 4));
    punch += (pTarget - punch) * lerpK(dt, pTarget > punch ? 25 : 160);
    if (S.playing && e > 0.5 && (rise > 0.07 || e > bassAvg * 1.3) && ts - lastBoom > 140) {
      lastBoom = ts;
      boom(Math.min(1, (e - 0.4) * 2));
    }
  }
  const p = Math.min(1, level * 0.45 + punch * 0.75);
  applyPulse(p, level);
  // window edges breathe with the bass and flare on every hit
  edgeKick *= 1 - lerpK(dt, 280);
  const eo = Math.min(0.85, level * 0.2 + p * 0.22 + edgeKick * 0.55);
  if (Math.abs(eo - lastEdge) > 0.004) { lastEdge = eo; edgeEl.style.opacity = eo < 0.005 ? '0' : eo.toFixed(3); }
  return p > 0.004 || level > 0.004 || eo > 0.005;
}
function applyPulse(p, lv = 0) {
  if (Math.abs(p - lastPulseOut) < 0.002) return;
  lastPulseOut = p;
  if (PHONE_FX) { phonePulse(p); return; }
  const s = p > 0.002 ? `scale(${(1 + p * 0.055).toFixed(4)})` : '';
  Array.prototype.forEach.call(bassArts, el => { el.style.transform = s; });
  fpArtEl.style.transform = p > 0.002 ? `scale(${(1 + p * 0.04).toFixed(4)})` : '';
  if (S.liteOn) return;
  const gs = `scale(${(1 + p * 0.32).toFixed(4)})`;
  const go = (p * 0.95).toFixed(3);
  Array.prototype.forEach.call(bassGlows, el => { el.style.opacity = go; el.style.transform = gs; });
  fpGlowEl.style.opacity = (0.3 + p * 0.65).toFixed(3);
  fpGlowEl.style.transform = `scale(${(1 + p * 0.3).toFixed(4)})`;
  // the blurred cover behind everything in the full player moves with the bass
  fpBgEl.style.transform = `scale(${(1.15 + p * 0.09 + lv * 0.04).toFixed(4)})`;
  // light rays behind the cover glow with the low end
  raysEl.style.opacity = (0.12 + lv * 0.45 + p * 0.45).toFixed(3);
}
const RING_KF = [
  { transform: 'scale(0.96)', opacity: 0.95 },
  { transform: 'scale(1.6)', opacity: 0 },
];
let boomCount = 0, boomMega = false;
function boom(strength, mega = false) {
  const s = Math.max(0.35, strength);
  boomMega = mega;
  document.documentElement.dataset.booms = ++boomCount;
  if (PHONE_FX) { phoneBoom(s, mega); return; }
  const fpOpen = $('#fullPlayer').classList.contains('open');
  // shock rings around every visible cover
  $$('.boom-ring').forEach(r => {
    if (!r.offsetParent && !(fpOpen && r.closest('#fullPlayer'))) return;
    stopAnims(r); r.animate(RING_KF, { duration: 620 + s * 200, easing: 'cubic-bezier(.15,.75,.3,1)' });
  });
  edgeKick = Math.max(edgeKick, s * FXP.edge);
  fxBurst(s);
  coverPunch(s * FXP.punch);
  // glare sweep across the cover on strong hits
  if (s > 0.45 && performance.now() - lastGlare > 850) {
    lastGlare = performance.now();
    $$('.glare').forEach(gl => {
      if (!gl.offsetParent && !(fpOpen && gl.closest('#fullPlayer'))) return;
      gl.animate(GLARE_KF, { duration: 720, easing: 'cubic-bezier(.3,.6,.3,1)' });
    });
  }
  if (S.liteOn) return;
  if (fpOpen) {
    const fl = mega ? 1 : FXP.flash, sh = mega ? Math.max(1, FXP.shake) : FXP.shake;
    if (fl) fpFlashEl.animate([{ opacity: 0 }, { opacity: (mega ? 0.8 : 0.55 * s) * fl, offset: 0.15 }, { opacity: 0 }], { duration: mega ? 700 : 480, easing: 'ease-out' });
    if (!sh) return;
    const k = (3 + s * 4) * sh * (mega ? 1.6 : 1);
    fpBodyEl.animate([
      { transform: 'translate(0,0)' },
      { transform: `translate(${-k}px, ${k * 0.6}px)` },
      { transform: `translate(${k * 0.8}px, ${-k * 0.5}px)` },
      { transform: `translate(${-k * 0.4}px, ${k * 0.3}px)` },
      { transform: 'translate(0,0)' },
    ], { duration: 260, easing: 'ease-out' });
  }
}

/* ---------- FX layer: shock waves + sparks over the whole window ----------
   Pooled DOM elements animated with the Web Animations API (transform/opacity only),
   so the browser runs them on the compositor thread — smooth even if JS is busy. */
const edgeEl = $('#edgeGlow');
const GLARE_KF = [
  { transform: 'translateX(0) skewX(-18deg)', opacity: 0 },
  { opacity: 1, offset: 0.25 },
  { transform: 'translateX(480%) skewX(-18deg)', opacity: 0 },
];
let edgeKick = 0, lastEdge = -1, lastGlare = 0;
let fxRGB = ['109, 92, 255', '165, 151, 255', '255, 79, 154'];
const WAVE_PX = 360;          // waves are small textures scaled up on the GPU
// Two layers, both BEHIND the cover: the main window's one sits between the background
// and the panels; the full player's one sits between its backdrop and the cover.
function makePool(layer) {
  const p = { layer, waves: [], sparks: [], wi: 0, si: 0 };
  for (let i = 0; i < 6; i++) { const d = document.createElement('i'); d.className = 'fx-wave'; layer.appendChild(d); p.waves.push(d); }
  for (let i = 0; i < 64; i++) { const d = document.createElement('i'); d.className = 'fx-spark'; layer.appendChild(d); p.sparks.push(d); }
  return p;
}
const poolMain = makePool($('#fxLayer')), poolFull = makePool($('#fpFxLayer'));
const raysEl = $('.fp-rays');
function fxOrigin() {
  const fpOpen = $('#fullPlayer').classList.contains('open');
  const np = $('.np-art');
  const mArt = $('.m-now .bass-art');
  const mVisible = mArt && mArt.offsetParent && (() => { const r = mArt.getBoundingClientRect(); return r.bottom > 40 && r.top < innerHeight - 160; })();
  // in rail mode the now-playing panel is folded away (still laid out, just invisible),
  // so the waves come from the small cover at the bottom of the rail instead
  const sideArt = S.compact && $('.side-now img');
  const npShown = np.offsetParent && !S.compact;
  let el = fpOpen ? fpArtEl : npShown ? np : (sideArt && sideArt.offsetParent) ? sideArt : (mVisible ? mArt : $('.p-art'));
  if (fpOpen && ly.open) el = $('.ly-line.on') || $('#lyrics');
  const r = el.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2, size: Math.max(el === sideArt ? 110 : 40, r.width, r.height), fp: fpOpen };
}
function fxWave(pool, o, far, s, delay, kind, dur) {
  const w = pool.waves[pool.wi++ % pool.waves.length];
  stopAnims(w);
  w.className = 'fx-wave' + (kind ? ' ' + kind : '');
  w.style.left = (o.x - WAVE_PX / 2) + 'px';
  w.style.top = (o.y - WAVE_PX / 2) + 'px';
  // starts hidden right under the cover's edge, then bursts outwards from behind it
  const s0 = (o.size * 0.82) / WAVE_PX, s1 = (far * 2.1) / WAVE_PX;
  const peak = Math.min(1, 0.6 + s * 0.4);
  // size: fast burst out from behind the cover, then glides
  w.animate([{ transform: `scale(${s0})` }, { transform: `scale(${s1})` }],
    { duration: dur, delay, easing: 'cubic-bezier(.1,.72,.22,1)', fill: 'backwards' });
  // brightness: flashes on, holds while it travels, fades out at the edges
  w.animate([
    { opacity: 0 }, { opacity: peak, offset: 0.05 }, { opacity: peak * 0.75, offset: 0.45 }, { opacity: 0 },
  ], { duration: dur, delay, easing: 'linear', fill: 'backwards' });
}
function fxBurst(s) {
  const o = fxOrigin();
  const pool = o.fp ? poolFull : poolMain;
  const W = innerWidth, H = innerHeight;
  const far = Math.hypot(Math.max(o.x, W - o.x), Math.max(o.y, H - o.y));
  const waves = Math.min(IS_DESKTOP ? 3 : 2, boomMega ? 3 : FXP.waves);
  fxWave(pool, o, far, s, 0, boomMega ? '' : FXP.kind, boomMega ? 1300 : FXP.dur);
  if (waves > 1 && s > 0.45) fxWave(pool, o, far * 0.75, s * 0.8, 90, 'alt', FXP.dur * 0.88);
  if (waves > 2 && s > 0.8) fxWave(pool, o, far * 0.5, s * 0.6, 180, 'soft', FXP.dur * 0.8);
  const n = Math.round((S.liteOn ? 6 : 10 + s * 16) * (boomMega ? Math.max(1.4, FXP.sparks * 1.5) : FXP.sparks) * (IS_DESKTOP ? 1 : 0.55));
  const reach = 90 + o.size * 0.6;
  for (let i = 0; i < n; i++) {
    const d = pool.sparks[pool.si++ % pool.sparks.length];
    stopAnims(d);
    const a = Math.random() * Math.PI * 2;
    const sx = o.x + Math.cos(a) * o.size * 0.5, sy = o.y + Math.sin(a) * o.size * 0.5;
    const dist = reach * (0.4 + Math.random() * 0.9);
    const k = 0.6 + Math.random() * 0.9;
    d.style.left = sx + 'px'; d.style.top = sy + 'px';
    d.style.setProperty('--sc', fxRGB[i % 3]);
    d.animate([
      { transform: `translate(-50%,-50%) translate(0,0) scale(${k})`, opacity: 1 },
      { transform: `translate(-50%,-50%) translate(${Math.cos(a) * dist}px, ${Math.sin(a) * dist}px) scale(${k * 0.3})`, opacity: 0 },
    ], { duration: 650 + Math.random() * 650, easing: 'cubic-bezier(.1,.75,.3,1)' });
  }
}
// Calm music: a slow, soft ripple from behind the cover instead of a BAMM
function gentleRipple(s) {
  if (PHONE_FX) { phoneBoom(s * 0.5, false); return; }
  const o = fxOrigin();
  const far = Math.hypot(Math.max(o.x, innerWidth - o.x), Math.max(o.y, innerHeight - o.y));
  fxWave(o.fp ? poolFull : poolMain, o, far * 0.8, 0.35 + s * 0.3, 0, 'soft', 2600);
  edgeKick = Math.max(edgeKick, s * 0.3);
}
// Spring "kick" of the cover on every hit (compositor animation, lands on the beat frame)
function coverPunch(s) {
  const k = 1 + 0.035 + s * 0.05;
  const kf = [
    { transform: 'scale(1)' },
    { transform: `scale(${k})`, offset: 0.22 },
    { transform: `scale(${1 - (k - 1) * 0.18})`, offset: 0.55 },
    { transform: 'scale(1)' },
  ];
  const opts = { duration: 300, easing: 'cubic-bezier(.2,.8,.3,1)', composite: 'add' };
  const fpOpen = $('#fullPlayer').classList.contains('open');
  if (fpOpen && !ly.open) { stopAnims(fpArtEl); fpArtEl.animate(kf, opts); }
  else Array.from(bassArts).forEach(el => { if (el.offsetParent) { stopAnims(el); el.animate(kf, opts); } });
}
// a pooled element that is reused must not stack animations on top of each other
function stopAnims(el) { const a = el.getAnimations(); for (let i = 0; i < a.length; i++) a[i].cancel(); }
function fxDraw() { return false; } // all effects run on the compositor now
let loopOn = false, idleFrames = 0;
function startLoop() { if (!loopOn) { loopOn = true; idleFrames = 0; requestAnimationFrame(tick); } }
let lastProg = 0, lastDraw = 0;
let vizMoving = false;
function tick(ts) {
  const dt = Math.min(64, Math.max(1, ts - (lastTs || ts - 16)));
  lastTs = ts;
  if (S.playing && ts - lastProg > 250) { lastProg = ts; updateProgress(); }
  lyricsTick();
  if (!S.viz && !S.bass && !(ly.open && S.playing)) { loopOn = false; lastTs = 0; clearViz(); applyPulse(0); fxDraw(0); edgeEl.style.opacity = '0'; lastEdge = -1; return; }

  // bass effect: every frame for smoothness
  const bassMoving = S.bass ? bassPulse(dt, ts) : (applyPulse(0), false);
  const fxMoving = fxDraw(dt);

  // spectrum bars: ~30 fps is plenty
  if (S.viz && (!PHONE_FX || ts - lastDraw >= 32)) {   // desktop: every frame (monitor Hz); phone: ~30 fps
    vizDt = Math.min(64, ts - lastDraw);
    lastDraw = ts;
    if (analyser && S.playing) analyser.getByteFrequencyData(freqData);
    const fpOpen = $('#fullPlayer').classList.contains('open');
    vizMoving = false;
    for (const cv of vizCanvases()) {
      if (!cv.offsetParent && !(cv.id === 'fpViz' && fpOpen)) continue;
      if (drawViz(cv, ts)) vizMoving = true;
    }
  } else if (!S.viz) { vizMoving = false; if (ts - lastDraw >= 32) { lastDraw = ts; clearViz(); } }

  if (!S.playing && !bassMoving && !vizMoving && !fxMoving) idleFrames++; else idleFrames = 0;
  if (idleFrames > 40) { loopOn = false; lastTs = 0; return; }
  requestAnimationFrame(tick);
}
let vizDt = 16;
function drawViz(cv, ts) {
  const kUp = lerpK(vizDt, 28), kDown = lerpK(vizDt, 140);
  const dpr = PHONE_FX ? 1 : Math.min(1.25, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return false;
  if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
  const g = cv.getContext('2d');
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  const barW = cv.id === 'fpViz' ? 4 : 3.2, gap = cv.id === 'fpViz' ? 3.5 : 2.6;
  const n = Math.max(8, Math.floor((w + gap) / (barW + gap)));
  let st = vizState.get(cv);
  if (!st || st.length !== n) { st = new Float32Array(n); vizState.set(cv, st); }
  const bins = freqData ? freqData.length * 0.72 : 0;
  let moving = false;
  const grad = g.createLinearGradient(0, 0, w, 0);
  grad.addColorStop(0, vizColors[0]);
  grad.addColorStop(0.5, vizColors[1]);
  grad.addColorStop(1, vizColors[2]);
  g.fillStyle = grad;
  g.beginPath();
  const mid = h / 2;
  for (let k = 0; k < n; k++) {
    let v;
    if (analyser && S.playing) {
      const a = Math.floor(Math.pow(k / n, 1.6) * bins) + 1;
      const bEnd = Math.max(a + 1, Math.floor(Math.pow((k + 1) / n, 1.6) * bins) + 1);
      let s = 0; for (let j = a; j < bEnd; j++) s += freqData[j]; v = s / ((bEnd - a) * 255);
      v = Math.pow(v, 1.4) * (0.75 + k / n * 0.6);
    } else if (S.playing) {
      v = 0.25 + 0.2 * Math.sin(ts / 300 + k * 0.5) * Math.sin(ts / 900 + k * 0.17);
    } else v = 0;
    st[k] += (v - st[k]) * (v > st[k] ? kUp : kDown);
    if (st[k] > 0.004) moving = true;
    const bh = Math.max(2, st[k] * h * 0.95);
    // all bars go into ONE path -> a single fill call per frame
    g.rect(k * (barW + gap), mid - bh / 2, barW, bh);
  }
  g.fill();
  return moving;
}

/* ============================================================
   Library rendering
   ============================================================ */
function sortedIds(ids) {
  const T = id => S.tracks.get(id);
  const cmp = (a, b) => (a || '').localeCompare(b || '', 'uz', { sensitivity: 'base', numeric: true });
  switch (S.sort) {
    case 'title': return ids.sort((a, b) => cmp(T(a).title, T(b).title));
    case 'artist': return ids.sort((a, b) => cmp(T(a).artist, T(b).artist) || cmp(T(a).album, T(b).album) || (T(a).trackNo || 0) - (T(b).trackNo || 0));
    case 'album': return ids.sort((a, b) => cmp(T(a).album, T(b).album) || (T(a).trackNo || 0) - (T(b).trackNo || 0) || cmp(T(a).title, T(b).title));
    default: return ids.sort((a, b) => (T(b).addedAt || 0) - (T(a).addedAt || 0));
  }
}
function computeVisible() {
  let ids;
  if (S.view === 'queue') ids = S.queue.filter(id => S.tracks.has(id));
  else if (S.view === 'top') {
    const T = id => S.tracks.get(id);
    ids = S.order.filter(id => (T(id).plays || 0) > 0)
      .sort((a, b) => (T(b).plays - T(a).plays) || ((T(b).listened || 0) - (T(a).listened || 0)) || ((T(b).lastPlayed || 0) - (T(a).lastPlayed || 0)))
      .slice(0, 100);
  }
  else if (S.view === 'favorites') ids = sortedIds(S.order.filter(id => S.tracks.get(id).fav));
  else ids = sortedIds(S.order.slice());
  const q = S.query.trim().toLowerCase();
  if (q) ids = ids.filter(id => { const t = S.tracks.get(id); return `${t.title} ${t.artist} ${t.album}`.toLowerCase().includes(q); });
  return ids;
}
// Real cover thumbnail, or a colourful generated one (cached per colour) for songs without a picture.
const phCache = new Map();
function thumbFor(t) {
  const th = t.artKey && S.thumbs.get(t.artKey);
  if (th) return th;
  const k = hueOf((t.title || '') + (t.artist || ''));
  if (!phCache.has(k)) phCache.set(k, placeholderArt(t));
  return phCache.get(k);
}
const thumbDiv = t => `<div class="thumb" style="background-image:url('${thumbFor(t)}')"></div>`;
function rowHTML(t, i) {
  const top = S.view === 'top';
  return `<div class="row" data-id="${esc(t.id)}" data-i="${i}"${i < 16 ? ` style="--d:${i}"` : ''}>` +
    `<div class="num${top ? ' rank' + (i < 3 ? ' r' + (i + 1) : '') : ''}">${i + 1}</div>` +
    thumbDiv(t) +
    `<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || 'Noma\'lum ijrochi')}</div></div>` +
    `<div class="alb">${esc(t.album || '—')}</div>` +
    (top ? `<div><span class="plays">${t.plays} marta</span></div>`
         : `<div><span class="chip${LOSSLESS.has(t.ext) ? ' hq' : ''}">${esc((t.ext || '?').toUpperCase())}</span></div>`) +
    `<div class="dur">${t.duration ? fmtTime(t.duration) : '--:--'}</div>` +
    `<div class="acts"><button class="icon-btn sm fav${t.fav ? ' on' : ''}" data-a="fav" title="Sevimli">${icon(t.fav ? 'heart-fill' : 'heart')}</button>` +
    `<button class="icon-btn sm" data-a="more" title="Ko'proq">${icon('more')}</button></div></div>`;
}
function renderList() {
  const isEq = S.view === 'eq';
  $('#viewList').classList.toggle('hidden', isEq);
  $('#viewEq').classList.toggle('hidden', !isEq);
  $('.top-tools').classList.toggle('hidden', isEq);
  $('#viewTitle').textContent = VIEW_TITLES[S.view];
  if (isEq) { $('#viewCount').textContent = ''; return; }

  const ids = computeVisible();
  S.visible = ids;
  const total = ids.reduce((s, id) => s + (S.tracks.get(id).duration || 0), 0);
  $('#viewCount').textContent = ids.length ? `${ids.length} ta qo'shiq · ${fmtTime(total)}` : '';
  $('#cntLibrary').textContent = S.order.length || '';
  const favN = S.order.filter(id => S.tracks.get(id).fav).length;
  $('#cntFav').textContent = favN || '';

  const list = $('#trackList'), empty = $('#empty');
  renderTopHero(ids);
  $('.list-head span:nth-child(5)').textContent = S.view === 'top' ? 'Tinglangan' : 'Format';
  if (!ids.length) {
    list.innerHTML = '';
    list.classList.add('hidden');
    $('.list-head').classList.add('hidden');
    empty.classList.remove('hidden');
    const q = S.query.trim();
    const [title, text, showAdd] =
      q ? ['Hech narsa topilmadi', `"${q}" bo'yicha natija yo'q.`, false]
      : S.view === 'top' ? ['Top hali bo\'sh', 'Qo\'shiqlarni tinglang — 30 soniyadan ko\'p eshitilgan har bir qo\'shiq hisoblanadi va eng ko\'p tinglanganlar shu yerda chiqadi.', false]
      : S.view === 'favorites' ? ['Sevimlilar bo\'sh', 'Yoqqan qo\'shiqlaringizdagi ♥ tugmasini bosing — ular shu yerda paydo bo\'ladi.', false]
      : S.view === 'queue' ? ['Navbat bo\'sh', 'Kutubxonadan biror qo\'shiqni ijro eting.', false]
      : ['Kutubxona bo\'sh', IS_DESKTOP ? 'Fayl yoki butun papkani qo\'shing, yoki ularni oynaga sudrab tashlang. MP3, FLAC, WAV, M4A, OGG, WMA, APE va boshqalar.' : 'Telefoningizdagi musiqa fayllarini tanlang — MP3, FLAC, WAV, M4A, OGG, OPUS va boshqalar.', true];
    $('#emptyTitle').textContent = title;
    $('#emptyText').textContent = text;
    $('#emptyActions').classList.toggle('hidden', !showAdd);
    return;
  }
  empty.classList.add('hidden');
  list.classList.remove('hidden');
  $('.list-head').classList.add('hidden');      // the header now lives inside the list (sticky)
  const head = `<div class="list-head in"><span>#</span><span></span><span>Nomi</span><span>Albom</span><span>${S.view === 'top' ? 'Tinglangan' : 'Format'}</span><span class="r">Vaqt</span><span></span></div>`;
  list.innerHTML = nowCardHTML() + carouselsHTML() + head + ids.map((id, i) => rowHTML(S.tracks.get(id), i)).join('');
  markPlaying();
}
/* ---------- library carousels: "Siz uchun" + "Yaqinda qo'shilgan" ---------- */
const carouselSets = {};
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 18 ? 'Xayrli kun' : 'Xayrli kech';
}
function carouselsHTML() {
  if (S.view !== 'library' || S.query.trim() || S.order.length < 4) return '';
  const T = id => S.tracks.get(id);
  const recent = S.order.slice().sort((a, b) => (T(b).addedAt || 0) - (T(a).addedAt || 0)).slice(0, 14);
  const top = S.order.filter(id => (T(id).plays || 0) > 0)
    .sort((a, b) => (T(b).plays - T(a).plays) || ((T(b).lastPlayed || 0) - (T(a).lastPlayed || 0))).slice(0, 14);
  carouselSets.top = top; carouselSets.recent = recent;
  const section = (key, title, sub, ids) => ids.length < 3 ? '' :
    `<section class="shelf"><div class="shelf-head"><div><h3>${title}</h3><small>${sub}</small></div>` +
    `<div class="shelf-nav"><button class="round-btn sm" data-shelf="${key}" data-dir="-1">${icon('prev')}</button>` +
    `<button class="round-btn sm" data-shelf="${key}" data-dir="1">${icon('next')}</button></div></div>` +
    `<div class="shelf-row" data-row="${key}">` + ids.map((id, i) => {
      const t = T(id);
      return `<div class="card" data-sec="${key}" data-i="${i}" data-cid="${esc(id)}">` +
        `<div class="card-art" style="background-image:url('${thumbFor(t)}')"><span class="card-play">${icon('play')}</span></div>` +
        `<div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || 'Noma\'lum ijrochi')}</div></div>`;
    }).join('') + `</div></section>`;
  return `<div class="greet">${greeting()}</div>` +
    section('top', 'Siz uchun', 'Eng ko\'p tinglaganlaringiz', top) +
    section('recent', 'Yaqinda qo\'shilgan', 'Yangi qo\'shiqlaringiz', recent);
}

let heroToken = 0;
async function renderTopHero(ids) {
  const hero = $('#topHero');
  const show = S.view === 'top' && ids.length && !S.query.trim();
  hero.classList.toggle('hidden', !show);
  if (!show) return;
  const t = S.tracks.get(ids[0]);
  const all = S.order.map(id => S.tracks.get(id));
  const totalPlays = all.reduce((s, x) => s + (x.plays || 0), 0);
  const totalSecs = all.reduce((s, x) => s + (x.listened || 0), 0);
  const byArtist = new Map();
  all.forEach(x => { if (x.plays && x.artist) byArtist.set(x.artist, (byArtist.get(x.artist) || 0) + x.plays); });
  const topArtist = [...byArtist.entries()].sort((a, b) => b[1] - a[1])[0];
  const mins = Math.round(totalSecs / 60);
  const tok = ++heroToken;
  const art = (t.artKey && await DB.get('art', t.artKey).catch(() => null)) || placeholderArt(t);
  if (tok !== heroToken) return;
  let soft = art;
  try { soft = softBackdrop(await loadImage(art), 'blur(4px) saturate(1.6) brightness(.55)'); } catch { /* */ }
  if (tok !== heroToken) return;
  hero.innerHTML =
    `<div class="hero-bg" style="background-image:url('${soft}')"></div>` +
    `<img src="${art}" alt="">` +
    `<div style="min-width:0"><span class="hero-rank">${icon('flame')}№1 eng ko'p tinglangan</span>` +
    `<h2>${esc(t.title)}</h2><p>${esc(t.artist || 'Noma\'lum ijrochi')}</p>` +
    `<div class="hero-stats"><div><b>${t.plays}</b>marta</div><div><b>${totalPlays}</b>jami tinglash</div>` +
    `<div><b>${mins >= 60 ? Math.floor(mins / 60) + ' soat ' + (mins % 60) + ' daq' : mins + ' daq'}</b>tinglangan vaqt</div>` +
    (topArtist ? `<div><b>${esc(topArtist[0])}</b>top ijrochi</div>` : '') + `</div></div>` +
    `<button class="round-btn big-play" data-act="play-top" title="Topni ijro etish">${icon('play')}</button>`;
}

/* ---------- play statistics (for Top) ---------- */
const listen = { id: null, pos: 0, secs: 0, counted: false, saved: 0 };
function resetListen(id) { Object.assign(listen, { id, pos: 0, secs: 0, counted: false, saved: 0 }); }
audio.addEventListener('timeupdate', () => {
  const t = cur();
  if (!t) return;
  if (listen.id !== t.id) resetListen(t.id);
  const now = audio.currentTime, d = now - listen.pos;
  listen.pos = now;
  if (audio.paused || d <= 0 || d > 2) return;   // ignore seeks / jumps
  listen.secs += d;
  t.listened = (t.listened || 0) + d;
  const need = Math.min(30, (audio.duration || t.duration || 60) * 0.5);
  let dirty = false;
  if (!listen.counted && listen.secs >= need) {
    listen.counted = true;
    t.plays = (t.plays || 0) + 1;
    t.lastPlayed = Date.now();
    dirty = true;
    if (S.view === 'top') renderList();
  }
  if (dirty || listen.secs - listen.saved > 15) { listen.saved = listen.secs; DB.put('tracks', stripTrack(t)).catch(() => {}); }
});
audio.addEventListener('emptied', () => resetListen(null));

function renderNext() {
  const box = $('#npNextList');
  const upcoming = S.queue.slice(S.qIndex + 1, S.qIndex + 7).map(id => S.tracks.get(id)).filter(Boolean);
  if (!upcoming.length) { box.innerHTML = '<div class="np-empty">Navbatda boshqa qo\'shiq yo\'q</div>'; return; }
  box.innerHTML = upcoming.map((t, k) => {
    return `<div class="mini-row" data-q="${S.qIndex + 1 + k}">${thumbDiv(t)}` +
      `<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || 'Noma\'lum ijrochi')}</div></div></div>`;
  }).join('');
}


/* ---------- phone: "Hozir ijroda" card on top of the list ---------- */
const isPhone = () => matchMedia('(max-width: 820px)').matches;
function nowCardHTML() {
  const t = cur();
  if (!t || !isPhone() || S.query.trim() || !['library', 'top', 'favorites'].includes(S.view)) return '';
  const art = $('.p-art') && $('.p-art').getAttribute('src') ? $('.p-art').getAttribute('src') : thumbFor(t);
  return `<div class="m-now" data-act="open-full">` +
    `<div class="m-now-bg" style="background-image:${$('#fpBg').style.backgroundImage || 'none'}"></div>` +
    `<div class="m-now-art"><div class="bass-glow"></div><div class="boom-ring"></div><img class="cur-art bass-art" src="${art}" alt=""></div>` +
    `<div class="m-now-meta"><small>Hozir ijroda · ${esc(FXP.label)}</small><b class="cur-title">${esc(t.title)}</b>` +
    `<span class="cur-artist">${esc(t.artist || 'Noma\'lum ijrochi')}</span><canvas class="viz" id="mViz"></canvas></div></div>`;
}
function syncNowCard() {
  if (!isPhone() || !['library', 'top', 'favorites'].includes(S.view)) return;
  const card = $('.m-now');
  if (!card && cur()) { renderList(); return; }
  if (card) { const bg = $('.m-now-bg', card); if (bg) bg.style.backgroundImage = $('#fpBg').style.backgroundImage; }
}
/* sliding indicator under the active tab */
function moveTabPill() {
  const pill = $('#tabPill'), a = $('#tabbar .tab.active');
  if (!pill || !a) return;
  pill.style.width = a.offsetWidth + 'px';
  pill.style.transform = `translateX(${a.offsetLeft}px)`;
}
window.addEventListener('resize', moveTabPill);

function setView(v) {
  S.view = v;
  $$('[data-view]').forEach(b => b.classList.toggle('active', b.dataset.view === v));
  moveTabPill();
  const lst = $('#trackList'), main = $('#main');
  main.classList.remove('view-enter'); void main.offsetWidth; main.classList.add('view-enter');
  lst.classList.add('stagger'); clearTimeout(setView.t); setView.t = setTimeout(() => lst.classList.remove('stagger'), 900);
  renderList();
  $('#trackList').scrollTop = 0;
  if (v === 'queue' && S.currentId) {
    const r = $(`.row[data-id="${CSS.escape(S.currentId)}"]`);
    if (r) r.scrollIntoView({ block: 'center' });
  }
}

/* ============================================================
   Adding music
   ============================================================ */
function artKeyFor(m) {
  if (m.album) return 'a:' + hashStr(`${m.album}|${m.albumArtist || m.artist || ''}`.toLowerCase());
  return 'i:' + m.id;
}
async function makeArt(dataUrl) {
  const img = await loadImage(dataUrl);
  const draw = (size, q) => {
    const s = Math.min(size, Math.max(img.naturalWidth, img.naturalHeight));
    const c = document.createElement('canvas');
    c.width = c.height = s;
    const g = c.getContext('2d');
    const r = Math.max(s / img.naturalWidth, s / img.naturalHeight);
    const w = img.naturalWidth * r, h = img.naturalHeight * r;
    g.drawImage(img, (s - w) / 2, (s - h) / 2, w, h);
    return c.toDataURL('image/jpeg', q);
  };
  return { full: draw(640, 0.88), thumb: draw(120, 0.78) };
}
function stripTrack(t) { const o = { ...t }; delete o._forced; return o; }

let addSeq = 0;
async function addTrack(m, blob) {
  if (S.tracks.has(m.id)) return false;
  let artKey = null;
  if (m.art) {
    artKey = artKeyFor(m);
    if (!S.thumbs.has(artKey)) {
      try {
        const { full, thumb } = await makeArt(m.art);
        await DB.put('art', full, artKey);
        await DB.put('thumbs', thumb, artKey);
        S.thumbs.set(artKey, thumb);
      } catch { artKey = null; }
    }
  }
  const t = {
    id: m.id, title: m.title || 'Nomsiz', artist: m.artist || '', album: m.album || '', albumArtist: m.albumArtist || '',
    duration: m.duration || 0, ext: m.ext || '', path: m.path || null, artKey, fav: false,
    addedAt: Date.now() * 1000 + (addSeq++ % 1000), year: m.year || null, trackNo: m.trackNo || null,
    sampleRate: m.sampleRate || null, bitrate: m.bitrate || null, bitsPerSample: m.bitsPerSample || null,
  };
  if (blob) await DB.put('blobs', blob, t.id);
  await DB.put('tracks', t);
  S.tracks.set(t.id, t);
  S.order.push(t.id);
  if (!artKey) setTimeout(() => queueCover(t.id), 0);
  return true;
}

async function addDesktopItems(items) {
  if (!items || !items.length) return;
  let added = 0;
  for (let k = 0; k < items.length; k++) {
    if (items.length > 20 && k % 10 === 0) toast(`Kutubxonaga qo'shilmoqda… ${k}/${items.length}`, true);
    if (await addTrack(items[k])) added++;
  }
  finishAdd(added, items.length);
}
function finishAdd(added, total) {
  renderList(); renderNext();
  if (added) toast(`${added} ta qo'shiq qo'shildi ✨`);
  else if (total) toast('Bu qo\'shiqlar allaqachon kutubxonada');
  else toast('Audio fayl topilmadi');
}

function readTags(file) {
  return new Promise(res => {
    if (!window.jsmediatags) return res({});
    try { window.jsmediatags.read(file, { onSuccess: t => res((t && t.tags) || {}), onError: () => res({}) }); }
    catch { res({}); }
  });
}
function probeDuration(url) {
  return new Promise(res => {
    const a = new Audio();
    let done = false;
    const fin = v => { if (done) return; done = true; a.removeAttribute('src'); a.load(); res(v); };
    a.preload = 'metadata';
    a.onloadedmetadata = () => fin(isFinite(a.duration) ? a.duration : 0);
    a.onerror = () => fin(0);
    setTimeout(() => fin(0), 7000);
    a.src = url;
  });
}
function blobToDataUrl(blob) {
  return new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
}
async function importFiles(fileList) {
  const files = Array.from(fileList).filter(f => AUDIO_SET.has(extOf(f.name)) || /^audio\//.test(f.type));
  if (!files.length) { toast('Audio fayl topilmadi'); return; }
  let added = 0;
  const ids = [];
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    toast(`Import qilinmoqda… ${k + 1}/${files.length}`, true);
    const id = 'f_' + hashStr(`${f.name}|${f.size}|${f.lastModified}`);
    ids.push(id);
    if (S.tracks.has(id)) continue;
    const tags = await readTags(f);
    const url = URL.createObjectURL(f);
    const duration = await probeDuration(url);
    URL.revokeObjectURL(url);
    let art = null;
    if (tags.picture && tags.picture.data) {
      try { art = await blobToDataUrl(new Blob([new Uint8Array(tags.picture.data)], { type: tags.picture.format || 'image/jpeg' })); } catch { /* */ }
    }
    const trackNo = tags.track ? parseInt(String(tags.track), 10) || null : null;
    const ok = await addTrack({
      id, title: tags.title || baseName(f.name), artist: tags.artist || '', album: tags.album || '',
      duration, ext: extOf(f.name), art, year: tags.year, trackNo,
    }, f);
    if (ok) added++;
    if (k % 5 === 4) renderList();
  }
  hideToast(0);
  finishAdd(added, files.length);
  return ids;
}

/* Android: a music file opened from the file manager / "Open with" */
const MIME_EXT = { 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/flac': 'flac', 'audio/x-flac': 'flac', 'audio/wav': 'wav', 'audio/x-wav': 'wav',
  'audio/ogg': 'ogg', 'application/ogg': 'ogg', 'audio/opus': 'opus', 'audio/mp4': 'm4a', 'audio/x-m4a': 'm4a', 'audio/aac': 'aac', 'audio/webm': 'weba', 'audio/amr': 'amr', 'audio/3gpp': '3gp' };
async function openExternal(url) {
  if (!url || !/^(content|file):/i.test(url) || !window.Capacitor) return;
  try {
    toast('Ochilmoqda…', true);
    const r = await fetch(window.Capacitor.convertFileSrc(url));
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const blob = await r.blob();
    let name = decodeURIComponent(url.split('?')[0].split('/').pop() || '').replace(/^.*[:/]/, '');
    if (!AUDIO_SET.has(extOf(name))) name = `${name || 'audio'}.${MIME_EXT[blob.type] || 'mp3'}`;
    const file = new File([blob], name, { type: blob.type || 'audio/mpeg', lastModified: blob.size });
    const ids = await importFiles([file]);
    const id = ids && ids[0];
    if (id && S.tracks.has(id)) {
      setView('library');
      playList(S.visible, Math.max(0, S.visible.indexOf(id)));
    }
  } catch (e) {
    console.warn(e);
    toast("Faylni ochib bo'lmadi");
  }
}

async function addFiles() {
  if (IS_DESKTOP) {
    const items = await NAVO.pickFiles();
    if (items) addDesktopItems(items);
  } else {
    const inp = $('#fileInput');
    inp.value = '';
    inp.click();
  }
}
async function addFolder() {
  if (!IS_DESKTOP) return addFiles();
  const items = await NAVO.pickFolder();
  hideToast(0);
  if (items) addDesktopItems(items);
}

/* ---------- library actions ---------- */
async function toggleFav(id) {
  const t = S.tracks.get(id);
  if (!t) return;
  t.fav = !t.fav;
  await DB.put('tracks', stripTrack(t));
  const r = $(`.row[data-id="${CSS.escape(id)}"] .fav`);
  if (r) { r.classList.toggle('on', t.fav); $('use', r).setAttribute('href', t.fav ? '#i-heart-fill' : '#i-heart'); }
  if (id === S.currentId) syncFav();
  if (S.view === 'favorites') renderList();
  else $('#cntFav').textContent = S.order.filter(x => S.tracks.get(x).fav).length || '';
  toast(t.fav ? 'Sevimlilarga qo\'shildi ♥' : 'Sevimlilardan olib tashlandi');
}
function playNext(id) {
  if (!S.queue.length) { S.queue = [id]; S.qIndex = 0; loadIndex(0, true); return; }
  const at = S.queue.indexOf(id);
  if (at === S.qIndex) return;
  if (at > -1) { S.queue.splice(at, 1); if (at < S.qIndex) S.qIndex--; }
  S.queue.splice(S.qIndex + 1, 0, id);
  renderNext(); if (S.view === 'queue') renderList(); persist();
  toast('Keyingi bo\'lib ijro etiladi');
}
function addToQueue(id) {
  if (!S.queue.length) { S.queue = [id]; S.qIndex = 0; loadIndex(0, true); return; }
  S.queue.push(id);
  renderNext(); if (S.view === 'queue') renderList(); persist();
  toast('Navbatga qo\'shildi');
}
async function removeTrack(id) {
  const t = S.tracks.get(id);
  if (!t) return;
  await DB.del('tracks', id);
  await DB.del('blobs', id).catch(() => {});
  S.tracks.delete(id);
  S.order = S.order.filter(x => x !== id);
  const qi = S.queue.indexOf(id);
  if (qi > -1) { S.queue.splice(qi, 1); if (qi < S.qIndex) S.qIndex--; }
  if (S.unshuffled) S.unshuffled = S.unshuffled.filter(x => x !== id);
  if (id === S.currentId) {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    S.currentId = null; S.playing = false; syncPlayState();
    if (S.queue.length) loadIndex(Math.min(S.qIndex, S.queue.length - 1), false);
  }
  renderList(); renderNext(); persist();
  toast(`"${t.title}" kutubxonadan o'chirildi`);
}

/* ---------- context menu ---------- */
function openMenu(id, x, y) {
  const t = S.tracks.get(id);
  if (!t) return;
  closeMenu();
  const m = $('#menu');
  m.innerHTML =
    `<button data-m="play">${icon('play')}Ijro etish</button>` +
    `<button data-m="next">${icon('play-next')}Keyingi bo'lib ijro etish</button>` +
    `<button data-m="queue">${icon('queue')}Navbatga qo'shish</button>` +
    `<button data-m="fav">${icon(t.fav ? 'heart-fill' : 'heart')}${t.fav ? 'Sevimlilardan olib tashlash' : 'Sevimlilarga qo\'shish'}</button>` +
    `<button data-m="edit">${icon('edit')}Nomi va rasmini o'zgartirish</button>` +
    (IS_DESKTOP ? `<button data-m="reveal">${icon('open')}Papkada ko'rsatish</button>` : '') +
    `<hr><button data-m="remove" class="danger">${icon('trash')}Kutubxonadan o'chirish</button>`;
  m.classList.remove('hidden');
  const scrim = document.createElement('div');
  scrim.className = 'menu-scrim';
  scrim.addEventListener('pointerdown', closeMenu);
  scrim.addEventListener('contextmenu', e => { e.preventDefault(); closeMenu(); });
  document.body.appendChild(scrim);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  m.onclick = e => {
    const b = e.target.closest('[data-m]');
    if (!b) return;
    closeMenu();
    const a = b.dataset.m;
    if (a === 'play') { const i = S.visible.indexOf(id); playList(S.visible, Math.max(0, i)); }
    else if (a === 'next') playNext(id);
    else if (a === 'queue') addToQueue(id);
    else if (a === 'fav') toggleFav(id);
    else if (a === 'edit') openEdit(id);
    else if (a === 'reveal') NAVO.showInFolder(t.path);
    else if (a === 'remove') removeTrack(id);
  };
}
/* ---------- online covers for songs that have no picture ---------- */
const normTxt = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '')
  .replace(/\(.*?\)|\[.*?\]/g, ' ').replace(/\b(feat|ft)\.?\b.*$/, ' ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
function cleanTitle(t) {
  t = String(t || '');
  if (!/\s/.test(t) && (t.match(/_/g) || []).length >= 2) t = t.replace(/_+/g, ' ');   // "Song_Name_Artist" file names
  return t
    .replace(/\breverbed\b/gi, ' ')
    .replace(/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\uFE0F\u200d]/gu, ' ')                       // emoji
    .replace(/\((?:[^)]*?)(slowed|sped up|speed up|nightcore|reverb|remix|edit|bass ?boost(ed)?|lyrics?|official|audio|video|visuali[sz]er|phonk|tiktok|version|prod\.?|текст[^)]*)[^)]*\)/gi, ' ')
    .replace(/\[[^\]]*\]|【[^】]*】/g, ' ')
    .replace(/\b(?:super |ultra |mega |extreme |perfectly )?slowed(?: ?(?:\+|&|and) ?reverb)?\b/gi, ' ')
    .replace(/\b(?:sped up|speed up|bass ?boosted|official (?:music )?(?:video|audio)|lyrics? video|1 ?hour|hq|hd|4k)\b/gi, ' ')
    .replace(/\s+[-–—]\s*$/, '').replace(/^\s*[-–—]\s+/, '').replace(/\s{2,}/g, ' ').trim();
}
// Several ways to read a messy name: "Artist - Title", "Title ｜ Artist", "A X B" mashups…
const NAME_SEP = /\s+[-–—]\s+|\s*[|｜⧸•]\s*|\s+\/\s+/;
function queryVariants(title, artist) {
  const t = cleanTitle(title), a = firstArtist(artist), out = [];
  const push = (tt, aa) => {
    tt = cleanTitle(tt); aa = firstArtist(aa);
    if (tt && !out.some(v => v.t === tt && v.a === aa)) out.push({ t: tt, a: aa });
  };
  const parts = t.split(NAME_SEP).map(x => x.trim()).filter(Boolean);
  if (a) push(t, a);
  if (parts.length >= 2) {
    const own = a && parts.find(x => similar(a, x) < 0.5);
    if (own && own !== t) push(own, a);
    push(parts[1], parts[0]); push(parts[0], parts[1]);
  }
  if (!a) push(t, '');
  const head = t.split(/\s+(?:x|×|ft\.?|feat\.?|vs\.?)\s+/i)[0];
  if (head && head !== t) push(head, a);
  if (a) push(parts.length >= 2 ? parts[0] : t, '');       // the artist tag may be an uploader, not the artist
  return out.slice(0, 5);
}
function similar(a, b) {
  const A = new Set(normTxt(a).split(' ').filter(Boolean)), B = new Set(normTxt(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.min(A.size, B.size);
}
const firstArtist = a => String(a || '').split(/,|&| x | feat/i)[0].trim();
// Image URL -> data URL (desktop: main process, phone: native HTTP; both skip CORS)
async function fetchImageData(url) {
  if (IS_DESKTOP) return NAVO.fetchImage(url);
  const H = window.capacitorExports && window.capacitorExports.CapacitorHttp;
  if (!H) return null;
  const r = await H.get({ url, responseType: 'blob', connectTimeout: 8000, readTimeout: 12000 });
  return r.status === 200 && r.data ? 'data:image/jpeg;base64,' + r.data : null;
}
// MusicBrainz asks for at most one request per second
let mbLast = 0;
async function mbGate() { const w = mbLast + 1100 - Date.now(); mbLast = Date.now() + Math.max(0, w); if (w > 0) await sleep(w); }

/* Cover candidates from several catalogs, best match first.
   Apple Music (the catalog Shazam shows covers from; US + RU stores, which also
   carry most Uzbek/CIS releases), Deezer, and MusicBrainz / Cover Art Archive. */
// with no artist to check, the title itself must match closely (not just share a word)
function simStrict(a, b) {
  const A = new Set(normTxt(a).split(' ').filter(Boolean)), B = new Set(normTxt(b).split(' ').filter(Boolean));
  if (!A.size || !B.size) return 0;
  let hit = 0; for (const w of A) if (B.has(w)) hit++;
  return hit / Math.max(A.size, B.size);
}
async function coverCandidates(title, artist, { deep = true } = {}) {
  const vars = queryVariants(title, artist);
  if (!vars.length) return [];
  let all = [];
  for (let i = 0; i < vars.length; i++) {
    const list = await coverSearch(vars[i].t, vars[i].a, deep && i === 0, -i * 0.01);
    all = all.concat(list);
    if (list.some(c => c.ok)) break;
  }
  const seen = new Set();
  return all.sort((x, y) => (y.ok - x.ok) || (y.s - x.s)).filter(c => !seen.has(c.full) && seen.add(c.full));
}
async function coverSearch(t, a, deep, penalty) {
  const term = encodeURIComponent(`${t} ${a}`.trim());
  const out = [];
  const add = (src, tt, aa, thumb, full, bonus = 0) => {
    if (!full) return;
    const st = similar(t, tt), sa = a ? similar(a, aa) : 0.5;
    const ok = a ? st >= 0.6 && sa >= 0.5 : simStrict(t, tt) >= 0.6;
    out.push({ src, title: tt, artist: aa, thumb: thumb || full, full, ok, s: st * 2 + sa + bonus + penalty });
  };
  const it = c => httpJson(`https://itunes.apple.com/search?term=${term}&media=music&entity=song&limit=8&country=${c}`).then(j => {
    for (const x of (j && j.results) || []) if (x.artworkUrl100)
      add('Apple Music', x.trackName, x.artistName, x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/200x200bb.'), x.artworkUrl100.replace(/\/\d+x\d+bb\./, '/600x600bb.'), 0.06);
  }).catch(() => {});
  const dz = httpJson(`https://api.deezer.com/search?q=${term}&limit=8`).then(j => {
    for (const x of (j && j.data) || []) if (x.album) add('Deezer', x.title, x.artist && x.artist.name, x.album.cover_medium, x.album.cover_xl, 0.03);
  }).catch(() => {});
  const jobs = [it('US'), it('RU'), dz];
  if (deep) jobs.push((async () => {
    await mbGate();
    const q = `recording:"${t.replace(/"/g, '')}"` + (a ? ` AND artist:"${a.replace(/"/g, '')}"` : '');
    const url = `https://musicbrainz.org/ws/2/recording/?query=${encodeURIComponent(q)}&fmt=json&limit=6`;
    let j = await httpJson(url).catch(() => null);
    if (!j) { await mbGate(); j = await httpJson(url).catch(() => null); }   // MusicBrainz is often briefly busy (503)
    const seen = new Set();
    for (const r of (j && j.recordings) || []) {
      const ar = (r['artist-credit'] || []).map(c => c.name).join(', ');
      for (const rel of (r.releases || []).slice(0, 2)) {
        if (seen.has(rel.id) || seen.size >= 5) continue;
        seen.add(rel.id);
        add('MusicBrainz', r.title, ar, `https://coverartarchive.org/release/${rel.id}/front-250`, `https://coverartarchive.org/release/${rel.id}/front-500`);
      }
    }
  })().catch(() => {}));
  await Promise.all(jobs);
  const seen = new Set();
  return out.sort((x, y) => (y.ok - x.ok) || (y.s - x.s)).filter(c => !seen.has(c.full) && seen.add(c.full));
}
// Automatic lookup: fast catalogs first; MusicBrainz only when they have nothing
async function findCoverOnline(t) {
  let list = await coverCandidates(t.title, t.artist, { deep: false });
  if (!list.some(c => c.ok)) list = await coverCandidates(t.title, t.artist, { deep: true });
  for (const c of list.filter(c => c.ok).slice(0, 3)) {
    const d = await fetchImageData(c.full).catch(() => null);
    if (d) return d;
  }
  return null;
}

async function setTrackArt(t, dataUrl, prefix) {
  const { full, thumb } = await makeArt(dataUrl);
  const key = prefix + t.id + ':' + Date.now().toString(36);
  await DB.put('art', full, key);
  await DB.put('thumbs', thumb, key);
  S.thumbs.set(key, thumb);
  t.artKey = key;
  const th = $(`.row[data-id="${CSS.escape(t.id)}"] .thumb`);
  if (th) { th.style.backgroundImage = `url('${thumb}')`; th.innerHTML = ''; }
  if (t.id === S.currentId) updateNowPlaying(t);
  renderNext();
}
const COVER_V = 2;   // bump when the search gets better, so earlier misses are tried again
const coverQueue = [];
let coverBusy = false;
function queueCover(id) {
  const t = S.tracks.get(id);
  if (!S.netCovers || !t || t.artKey || t.coverTried === COVER_V || coverQueue.includes(id)) return;
  coverQueue.push(id);
  runCovers();
}
async function runCovers() {
  if (coverBusy) return;
  coverBusy = true;
  while (coverQueue.length && S.netCovers) {
    const t = S.tracks.get(coverQueue.shift());
    if (!t || t.artKey) continue;
    let data = null;
    try { data = await findCoverOnline(t); } catch { /* */ }
    t.coverTried = COVER_V;
    if (data) { try { await setTrackArt(t, data, 'n:'); } catch { /* */ } }
    await DB.put('tracks', stripTrack(t)).catch(() => {});
    await sleep(250);
  }
  coverBusy = false;
}

/* ============================================================
   Synced lyrics (LRCLIB) — karaoke-style in the full player
   ============================================================ */
async function httpJson(url) {
  if (IS_DESKTOP) return NAVO.httpJson(url);
  const H = window.capacitorExports && window.capacitorExports.CapacitorHttp;
  if (!H) return null;
  const r = await H.get({ url, headers: { 'User-Agent': 'Navo/1.0 (music player)' }, responseType: 'json', connectTimeout: 8000, readTimeout: 10000 });
  if (r.status !== 200) return null;
  return typeof r.data === 'string' ? JSON.parse(r.data) : r.data;
}
function lrclibFind(title, artist, dur) {
  const ok = x => x && !x.instrumental && (x.syncedLyrics || x.plainLyrics) &&
    similar(title, x.trackName) >= 0.6 && (!artist || similar(artist, x.artistName) >= 0.5);
  return (async () => {
    let cands = [];
    try { cands = ((await httpJson(`https://lrclib.net/api/search?q=${encodeURIComponent(`${title} ${artist}`.trim())}`)) || []).filter(ok); } catch { /* */ }
    if (!cands.length) {
      try { cands = ((await httpJson(`https://lrclib.net/api/search?track_name=${encodeURIComponent(title)}`)) || []).filter(ok); } catch { /* */ }
    }
    cands.sort((a, b) => (!!b.syncedLyrics - !!a.syncedLyrics) || (Math.abs((a.duration || 0) - dur) - Math.abs((b.duration || 0) - dur)));
    return cands[0] || null;
  })();
}
// iTunes knows the official spelling of a song (Latin vs Cyrillic, missing artist tag…)
async function itunesIdentify(title, artist, dur) {
  for (const c of ['US', 'RU']) {
    const j = await httpJson(`https://itunes.apple.com/search?term=${encodeURIComponent(`${title} ${artist}`.trim())}&media=music&entity=song&limit=8&country=${c}`).catch(() => null);
    const hit = ((j && j.results) || []).find(x => similar(title, x.trackName) >= 0.6 &&
      (!artist || similar(artist, x.artistName) >= 0.5 || (dur && Math.abs(x.trackTimeMillis / 1000 - dur) < 3)));
    if (hit) return { title: cleanTitle(hit.trackName), artist: firstArtist(hit.artistName) };
  }
  return null;
}
async function fetchLyrics(t) {
  const title = cleanTitle(t.title), artist = firstArtist(t.artist);
  if (!title) return { none: true };
  const dur = t.duration || audio.duration || 0;
  const names = queryVariants(t.title, t.artist).slice(0, 3).map(v => ({ title: v.t, artist: v.a }));
  if (!names.length) names.push({ title, artist });
  let best = null;
  for (const n of names) { best = await lrclibFind(n.title, n.artist, dur); if (best) break; }
  if (!best) {
    const id = await itunesIdentify(title, artist, dur);
    if (id && (normTxt(id.title) !== normTxt(title) || normTxt(id.artist) !== normTxt(artist))) {
      names.push(id);
      best = await lrclibFind(id.title, id.artist, dur);
    }
  }
  if (best) return { synced: best.syncedLyrics || null, plain: best.plainLyrics || null, srcDur: best.duration || 0, src: 'LRCLIB' };
  for (const n of names) {
    if (!n.artist) continue;
    const j = await httpJson(`https://api.lyrics.ovh/v1/${encodeURIComponent(n.artist)}/${encodeURIComponent(n.title)}`).catch(() => null);
    const txt = j && typeof j.lyrics === 'string' ? j.lyrics.replace(/\r\n/g, '\n').replace(/^Paroles de la chanson.*\n/i, '').trim() : '';
    if (txt) return { plain: txt, src: 'lyrics.ovh' };
  }
  return { none: true };
}
function parseLrc(text, scale) {
  const out = [];
  for (const raw of String(text).split(/\r?\n/)) {
    const tags = [...raw.matchAll(/\[(\d+):(\d+(?:\.\d+)?)\]/g)];
    if (!tags.length) continue;
    const words = raw.replace(/\[[^\]]*\]/g, '').trim();
    for (const m of tags) out.push({ t: (parseInt(m[1], 10) * 60 + parseFloat(m[2])) * scale, text: words });
  }
  return out.sort((a, b) => a.t - b.t);
}
const ly = { id: null, open: false, lines: null, idx: -2, els: [] };
function toggleLyrics(force) {
  ly.open = typeof force === 'boolean' ? force : !ly.open;
  $('#fullPlayer').classList.toggle('ly-on', ly.open);
  $$('.lyrics-btn').forEach(b => b.classList.toggle('on', ly.open));
  if (ly.open) { loadLyrics(cur()); startLoop(); }
}
function lyMessage(msg) { $('#lyMsg').textContent = msg; }
// Nothing found: let the user look it up on Google or paste the words themselves
function lyNotFound(msg) {
  $('#lyMsg').innerHTML = `<div class="ly-none"><b>${esc(msg)}</b><div class="ly-none-btns">
    <button class="btn btn-ghost sm" data-ly="google"><svg class="i"><use href="#i-search"/></svg>Google'da qidirish</button>
    <button class="btn btn-primary sm" data-ly="paste"><svg class="i"><use href="#i-edit"/></svg>Matnni qo'yish</button></div></div>`;
}
function lyGoogle() {
  const t = cur(); if (!t) return;
  const q = `${firstArtist(t.artist)} ${cleanTitle(t.title)} lyrics`.trim();
  if (IS_DESKTOP) NAVO.openSearch(q, false); else openOutside('https://www.google.com/search?q=' + encodeURIComponent(q));
  toast('Matnni nusxalab, Navo\'da «Matnni qo\'yish» ni bosing');
}
async function openLyEdit() {
  const t = cur(); if (!t) return;
  const rec = await DB.get('lyrics', t.id).catch(() => null);
  $('#lyText').value = rec && rec.src === 'Siz' ? (rec.synced || rec.plain || '') : '';
  $('#lyModal').dataset.id = t.id;
  $('#lyModal').classList.remove('hidden');
  setTimeout(() => $('#lyText').focus(), 50);
}
function closeLyEdit() { $('#lyModal').classList.add('hidden'); }
async function saveLyEdit() {
  const id = $('#lyModal').dataset.id, t = S.tracks.get(id);
  const text = $('#lyText').value.replace(/\r\n/g, '\n').trim();
  closeLyEdit();
  if (!t) return;
  if (!text) { await DB.del('lyrics', id).catch(() => {}); }
  else {
    const timed = /^\s*\[\d{1,2}:\d{2}(?:[.:]\d{1,3})?\]/m.test(text);
    await DB.put('lyrics', timed ? { synced: text, src: 'Siz', at: Date.now() } : { plain: text, src: 'Siz', at: Date.now() }, id).catch(() => {});
  }
  if (ly.id === id) { ly.id = null; loadLyrics(t); }
  toast(text ? 'Matn saqlandi ✓' : 'Matn o\'chirildi');
}
async function loadLyrics(t) {
  if (!t) return;
  if (ly.id === t.id) return;
  ly.id = t.id; ly.lines = null; ly.idx = -2; ly.els = [];
  const box = $('#lyrics'), inner = $('#lyInner');
  box.classList.remove('plain'); inner.innerHTML = ''; inner.style.transform = '';
  lyMessage('Matn qidirilmoqda…');
  let rec = await DB.get('lyrics', t.id).catch(() => null);
  if (!rec || (rec.none && Date.now() - (rec.at || 0) > 3 * 864e5)) {
    try { rec = await fetchLyrics(t); } catch { rec = null; }
    if (rec) { rec.at = Date.now(); DB.put('lyrics', rec, t.id).catch(() => {}); }
  }
  if (ly.id !== t.id) return;
  $('.ly-credit').textContent = rec && !rec.none ? (rec.src || 'LRCLIB') : '';
  if (!rec) return lyNotFound('Internet yo\'q — matnni yuklab bo\'lmadi');
  if (rec.synced) {
    // slowed / sped-up versions: stretch the timings to this file's length
    const dur = t.duration || audio.duration || 0;
    const ratio = rec.srcDur && dur ? dur / rec.srcDur : 1;
    const scale = Math.abs(ratio - 1) > 0.05 && ratio > 0.6 && ratio < 1.7 ? ratio : 1;
    ly.lines = parseLrc(rec.synced, scale);
    inner.innerHTML = ly.lines.map((l, i) => `<div class="ly-line${l.text ? '' : ' gap'}" data-i="${i}">${l.text ? esc(l.text) : '♪ ♪ ♪'}</div>`).join('');
    ly.els = $$('.ly-line', inner);
    lyMessage('');
    lyricsTick(true);
  } else if (rec.plain) {
    box.classList.add('plain');
    inner.innerHTML = rec.plain.split(/\r?\n/).map(s => `<div class="ly-line">${esc(s) || '&nbsp;'}</div>`).join('');
    lyMessage('');
  } else lyNotFound('Bu qo\'shiq uchun matn topilmadi');
}
function lyricsTick(force = false) {
  if (!ly.open || !ly.lines || !ly.lines.length) return;
  const time = mediaTime() + 0.2 - audioLatency();
  let lo = 0, hi = ly.lines.length - 1, idx = -1;
  while (lo <= hi) { const mid = (lo + hi) >> 1; if (ly.lines[mid].t <= time) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
  if (idx === ly.idx && !force) return;
  const prevIdx = ly.idx;
  ly.idx = idx;
  if (prevIdx >= 0 && ly.els[prevIdx]) { ly.els[prevIdx].classList.remove('on'); }
  if (force || Math.abs(idx - prevIdx) > 1) ly.els.forEach((el, i) => { el.classList.toggle('past', i < idx); el.classList.remove('on'); });
  else if (prevIdx >= 0 && ly.els[prevIdx]) ly.els[prevIdx].classList.add('past');
  const el = ly.els[Math.max(0, idx)];
  if (!el) return;
  if (idx >= 0) el.classList.add('on');
  $('#lyInner').style.transform = `translateY(${-(el.offsetTop + el.offsetHeight / 2)}px)`;
}

/* ============================================================
   Sleep timer — fades the music out, then pauses
   ============================================================ */
const sleepT = { end: 0, eot: false, timer: 0, fading: false };
function openSleepMenu(x, y) {
  const opts = [[15, '15 daqiqa'], [30, '30 daqiqa'], [45, '45 daqiqa'], [60, '1 soat'], [90, '1.5 soat'], ['eot', 'Qo\'shiq tugaganda']];
  const active = sleepT.end || sleepT.eot;
  showMenu('<div class="menu-title">Uyqu taymeri</div>' +
    opts.map(([v, l]) => `<button data-m="${v}">${icon('moon')}${l}</button>`).join('') +
    (active ? `<hr><button data-m="0" class="danger">${icon('trash')}Taymerni o'chirish</button>` : ''),
  x, y, v => setSleep(v === 'eot' ? 'eot' : +v));
}
function setSleep(v) {
  clearInterval(sleepT.timer);
  Object.assign(sleepT, { end: 0, eot: false, timer: 0, fading: false });
  if (v === 'eot') { sleepT.eot = true; toast('Joriy qo\'shiq tugagach musiqa to\'xtaydi 🌙'); }
  else if (v > 0) {
    sleepT.end = Date.now() + v * 60000;
    sleepT.timer = setInterval(sleepCheck, 1000);
    toast(`${v >= 60 ? (v / 60) + ' soat' : v + ' daqiqa'}dan keyin musiqa to'xtaydi 🌙`);
  } else toast('Uyqu taymeri o\'chirildi');
  syncSleep();
}
function syncSleep() {
  const on = !!(sleepT.end || sleepT.eot);
  const label = sleepT.eot ? '♪' : sleepT.end ? String(Math.max(1, Math.ceil((sleepT.end - Date.now()) / 60000))) : '';
  $$('.sleep-btn').forEach(b => { b.classList.toggle('on', on); $('.badge', b).textContent = label; });
}
function sleepCheck() {
  const left = sleepT.end - Date.now();
  syncSleep();
  if (left <= 10000 && !sleepT.fading) sleepFade(Math.max(1000, left));
}
function sleepFade(ms) {
  sleepT.fading = true;
  clearInterval(sleepT.timer);
  const start = audio.volume, t0 = Date.now();
  const iv = setInterval(() => {
    const k = Math.min(1, (Date.now() - t0) / ms);
    audio.volume = start * (1 - k);
    if (k >= 1) {
      clearInterval(iv);
      audio.pause();
      Object.assign(sleepT, { end: 0, eot: false, timer: 0, fading: false });
      applyVolume(); syncSleep();
      toast('Uyqu taymeri: musiqa to\'xtatildi. Yaxshi dam oling 🌙');
    }
  }, 100);
}

/* ---------- sort menu (in-app, instead of a browser <select>) ---------- */
const SORTS = [['added', "Yangi qo'shilgan"], ['title', 'Nomi bo\'yicha'], ['artist', 'Ijrochi bo\'yicha'], ['album', 'Albom bo\'yicha']];
// y > 0: menu opens below that point; y < 0: menu opens ABOVE the point -y
function showMenu(html, x, y, onPick) {
  closeMenu();
  const m = $('#menu');
  m.innerHTML = html;
  m.classList.remove('hidden');
  const scrim = document.createElement('div');
  scrim.className = 'menu-scrim';
  scrim.addEventListener('pointerdown', closeMenu);
  scrim.addEventListener('contextmenu', e => { e.preventDefault(); closeMenu(); });
  document.body.appendChild(scrim);
  const r = m.getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px';
  const top = y < 0 ? -y - r.height : y;
  m.style.top = Math.max(8, Math.min(top, innerHeight - r.height - 8)) + 'px';
  m.onclick = e => { const b = e.target.closest('[data-m]'); if (!b) return; closeMenu(); onPick(b.dataset.m); };
}
function openSortMenu(x, y) {
  showMenu('<div class="menu-title">Saralash</div>' + SORTS.map(([k, label]) =>
    `<button data-m="${k}" class="${S.sort === k ? 'sel' : ''}">${icon(S.sort === k ? 'check' : 'sort')}${label}</button>`).join(''),
  x, y, k => { S.sort = k; renderList(); persist(); });
}

/* ---------- edit song (title / artist / album / cover) ---------- */
let editId = null, editArt; // editArt: undefined = unchanged, null = removed, string = new image
async function openEdit(id) {
  const t = S.tracks.get(id);
  if (!t) return;
  closeMenu();
  editId = id; editArt = undefined;
  $('#editTitle').value = t.title || '';
  $('#editArtist').value = t.artist || '';
  $('#editAlbum').value = t.album || '';
  const art = t.artKey ? await DB.get('art', t.artKey).catch(() => null) : null;
  $('#editArt').src = art || placeholderArt(t);
  $('#editModal').classList.remove('hidden');
  if (IS_DESKTOP) setTimeout(() => $('#editTitle').focus(), 50);
}
function closeEdit() { $('#editModal').classList.add('hidden'); editId = null; editArt = undefined; pickRun++; $('#coverPick').classList.add('hidden'); }
async function setEditArtFile(f) {
  try { const d = await blobToDataUrl(f); await loadImage(d); editArt = d; $('#editArt').src = d; markPicked(null); toast('Rasm qo\'yildi ✓'); }
  catch { toast('Bu rasmni ochib bo\'lmadi'); }
}
function markPicked(btn) { $$('#coverGrid .cp-item').forEach(b => b.classList.toggle('on', b === btn)); }
/* Cover picker: every catalog's results as a grid, the user picks one */
let pickRun = 0;
async function openCoverPick() {
  const title = $('#editTitle').value.trim(), artist = $('#editArtist').value.trim();
  if (!title) { toast('Avval qo\'shiq nomini yozing'); return; }
  const run = ++pickRun, box = $('#coverPick'), grid = $('#coverGrid');
  box.classList.remove('hidden');
  $('#coverNote').textContent = 'Apple Music, Deezer va MusicBrainz\'dan qidirilmoqda…';
  grid.innerHTML = '<div class="cp-item sk"></div>'.repeat(8);
  box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  let list = [];
  try { list = await coverCandidates(title, artist); } catch { /* offline */ }
  if (run !== pickRun) return;
  list = list.slice(0, 16);
  if (!list.length) { grid.innerHTML = ''; $('#coverNote').textContent = 'Hech narsa topilmadi. Google\'dan qidirib ko\'ring yoki rasmni o\'zingiz tanlang.'; return; }
  grid.innerHTML = '';
  let shown = 0;
  await Promise.all(list.map(async (c, i) => {
    const btn = document.createElement('button');
    btn.className = 'cp-item sk'; btn.style.order = i; btn.title = `${c.title || ''} — ${c.artist || ''}`;
    grid.append(btn);
    const d = await fetchImageData(c.thumb).catch(() => null);
    if (run !== pickRun) return;
    if (!d) { btn.remove(); return; }
    shown++;
    btn.classList.remove('sk');
    btn.innerHTML = `<img alt="" src="${d}"><span>${esc(c.src)}</span>`;
    btn.addEventListener('click', async () => {
      btn.classList.add('busy');
      const full = c.full === c.thumb ? d : (await fetchImageData(c.full).catch(() => null)) || d;
      btn.classList.remove('busy');
      if (run !== pickRun) return;
      editArt = full; $('#editArt').src = full; markPicked(btn);
    });
  }));
  if (run !== pickRun) return;
  $('#coverNote').textContent = shown ? `${shown} ta muqova topildi — birini tanlang` : 'Rasmlar yuklanmadi. Internetni tekshiring.';
}
async function saveEdit() {
  const t = S.tracks.get(editId);
  if (!t) return closeEdit();
  t.title = $('#editTitle').value.trim() || t.title;
  t.artist = $('#editArtist').value.trim();
  t.album = $('#editAlbum').value.trim();
  if (editArt !== undefined) {
    const old = t.artKey;
    if (editArt) {
      try {
        const { full, thumb } = await makeArt(editArt);
        const key = 'c:' + t.id + ':' + Date.now().toString(36);
        await DB.put('art', full, key);
        await DB.put('thumbs', thumb, key);
        S.thumbs.set(key, thumb);
        t.artKey = key;
      } catch { toast('Rasmni saqlab bo\'lmadi'); }
    } else t.artKey = null;
    // drop the previous custom image (album covers may be shared, so only 'c:' keys)
    if (old && old !== t.artKey && old.startsWith('c:')) {
      DB.del('art', old).catch(() => {}); DB.del('thumbs', old).catch(() => {}); S.thumbs.delete(old);
    }
  }
  await DB.put('tracks', stripTrack(t));
  closeEdit();
  renderList(); renderNext();
  if (t.id === S.currentId) updateNowPlaying(t);
  toast('Saqlandi ✓');
}

function closeMenu() {
  $('#menu').classList.add('hidden');
  $$('.menu-scrim').forEach(s => s.remove());
}

/* ---------- full player ---------- */
// The full player is display:none while closed, so its GPU layers (cover, rays, glow, backdrop) are freed.
let fullHideTimer = 0;
function openFull() {
  if (!S.currentId) return;
  if (miniOn) { setMini(false); return; }
  const fp = $('#fullPlayer');
  clearTimeout(fullHideTimer);
  if (!fp.classList.contains('shown')) { fp.classList.add('shown'); void fp.offsetWidth; }   // reflow so the slide-in still plays
  fp.classList.add('open');
  $('#fullPlayer').setAttribute('aria-hidden', 'false');
  startLoop();
}
function closeFull() {
  const fp = $('#fullPlayer');
  if (!fp.classList.contains('open')) return;
  fp.classList.remove('open');
  clearTimeout(fullHideTimer);
  fullHideTimer = setTimeout(() => { if (!fp.classList.contains('open')) fp.classList.remove('shown'); }, 700);
  $('#fullPlayer').setAttribute('aria-hidden', 'true');
}

/* ============================================================
   Equalizer UI
   ============================================================ */
function buildEq() {
  $('#eqPresets').innerHTML = Object.keys(EQ_PRESETS).map(p => `<button class="preset" data-preset="${p}">${p}</button>`).join('');
  $('#eqBands').innerHTML = EQ_FREQS.map((f, i) =>
    `<div class="band"><output>0</output><input type="range" min="-12" max="12" step="0.5" value="0" data-band="${i}"><label>${f >= 1000 ? f / 1000 + 'k' : f}</label></div>`).join('');
  syncEq();
}
function syncEq() {
  $('#eqOn').checked = S.eq.on;
  $('#eqState').textContent = S.eq.on ? `Yoqilgan · ${S.eq.preset || 'Maxsus'}` : 'O\'chirilgan';
  $('#eqBands').classList.toggle('off', !S.eq.on);
  $$('.preset').forEach(b => b.classList.toggle('active', b.dataset.preset === S.eq.preset));
  $$('.band').forEach((b, i) => {
    const v = S.eq.gains[i];
    $('input', b).value = v;
    $('output', b).textContent = (v > 0 ? '+' : '') + v;
  });
}

/* ============================================================
   Events
   ============================================================ */
function bind() {
  document.addEventListener('click', e => {
    const viewBtn = e.target.closest('[data-view]');
    if (viewBtn) { setView(viewBtn.dataset.view); return; }
    const go = e.target.closest('[data-view-go]');
    if (go) { closeFull(); setView(go.dataset.viewGo); return; }
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    switch (act) {
      case 'toggle': toggle(); break;
      case 'mini': setMini(!miniOn); break;
      case 'expand-rail': if (S.compact) setCompact(false); break;
      case 'next': next(); break;
      case 'prev': prev(); break;
      case 'shuffle': toggleShuffle(); break;
      case 'repeat': cycleRepeat(); break;
      case 'mute': S.muted = !S.muted; applyVolume(); persist(); break;
      case 'add-files': addFiles(); break;
      case 'add-folder': addFolder(); break;
      case 'play-all': if (S.visible.length) { if (S.shuffle) toggleShuffle(); playList(S.visible, 0); } break;
      case 'shuffle-all': if (S.visible.length) { if (!S.shuffle) { S.shuffle = true; syncModes(); } playList(S.visible, Math.floor(Math.random() * S.visible.length)); } break;
      case 'fav-current': if (S.currentId) toggleFav(S.currentId); break;
      case 'edit-current': e.stopPropagation(); if (S.currentId) openEdit(S.currentId); break;
      case 'lyrics': toggleLyrics(); break;
      case 'fx-menu': { const r = actEl.getBoundingClientRect(); openFxMenu(r.left + r.width / 2 - 115, r.top < innerHeight / 2 ? r.bottom + 8 : -(r.top - 8)); break; }
      case 'sleep': { const r = actEl.getBoundingClientRect(); openSleepMenu(r.left + r.width / 2 - 115, r.top < innerHeight / 2 ? r.bottom + 8 : -(r.top - 8)); break; }
      case 'play-top': if (S.visible.length) { if (S.shuffle) toggleShuffle(); playList(S.visible, 0); } break;
      case 'sort-menu': { const r = actEl.getBoundingClientRect(); openSortMenu(r.left, r.bottom + 8); break; }
      case 'open-full': e.stopPropagation(); openFull(); break;
      case 'open-full-mobile': if (matchMedia('(max-width: 820px)').matches) openFull(); break;
      case 'close-full': closeFull(); break;
      case 'fp-queue': closeFull(); setView('queue'); break;
    }
  });

  // track list
  const list = $('#trackList');
  list.addEventListener('click', e => {
    const nav = e.target.closest('[data-shelf]');
    if (nav) {
      const r = $(`.shelf-row[data-row="${nav.dataset.shelf}"]`);
      if (r) r.scrollBy({ left: r.clientWidth * 0.8 * +nav.dataset.dir, behavior: 'smooth' });
      return;
    }
    const card = e.target.closest('.card');
    if (card) {
      const ids = carouselSets[card.dataset.sec] || [];
      const id = card.dataset.cid;
      if (id === S.currentId) { toggle(); return; }
      playList(ids, +card.dataset.i, card.dataset.sec === 'top' ? 'Siz uchun' : 'Yaqinda qo\'shilgan');
      return;
    }
    const row = e.target.closest('.row');
    if (!row) return;
    const id = row.dataset.id;
    const a = e.target.closest('[data-a]');
    if (a) {
      e.stopPropagation();
      if (a.dataset.a === 'fav') toggleFav(id);
      else { const r = a.getBoundingClientRect(); openMenu(id, r.right - 230, r.bottom + 4); }
      return;
    }
    if (id === S.currentId) { toggle(); return; }
    if (S.view === 'queue') { const qi = S.queue.indexOf(id); if (qi > -1) { loadIndex(qi, true); return; } }
    playList(S.visible, +row.dataset.i);
  });
  list.addEventListener('contextmenu', e => {
    const row = e.target.closest('.row');
    if (!row) return;
    e.preventDefault();
    openMenu(row.dataset.id, e.clientX, e.clientY);
  });
  // effect style (auto-detected or chosen)
  $('#stylePresets').innerHTML = [['auto', 'Avto'], ['calm', 'Sokin'], ['rap', 'Rep'], ['phonk', 'Phonk'], ['electro', 'Elektron'], ['pop', 'Pop']]
    .map(([k, l]) => `<button class="preset" data-style="${k}">${l}</button>`).join('');
  $('#stylePresets').addEventListener('click', e => {
    const b = e.target.closest('[data-style]');
    if (!b) return;
    S.fxStyle = b.dataset.style; applyStyle(); persist();
    toast(S.fxStyle === 'auto' ? 'Uslub avtomatik aniqlanadi' : `Effekt uslubi: ${FX_STYLES[S.fxStyle].label}`);
  });

  // audio effects panel
  $('#fxPresets').innerHTML = Object.keys(FX_PRESETS).map(n => `<button class="preset" data-fx="${n}">${n}</button>`).join('');
  $('#fxPresets').addEventListener('click', e => { const b = e.target.closest('[data-fx]'); if (b) setFxPreset(b.dataset.fx); });
  $('#fxSpeed').addEventListener('input', e => { S.fx.speed = +e.target.value; S.fx.preset = 'Maxsus'; applyFx(); persist(); });
  $('#fxReverb').addEventListener('input', e => { S.fx.reverb = e.target.value / 100; S.fx.preset = 'Maxsus'; applyFx(); persist(); });
  $('#fx8d').addEventListener('change', e => { S.fx.d8 = e.target.checked; S.fx.preset = 'Maxsus'; ensureGraph(); applyFx(); persist(); });
  $('#fxReset').addEventListener('click', () => setFxPreset('Oddiy'));
  $('#fxSpeed').addEventListener('dblclick', () => { S.fx.speed = 1; S.fx.preset = 'Maxsus'; applyFx(); persist(); });

  $('#lyInner').addEventListener('click', e => {
    const l = e.target.closest('.ly-line[data-i]');
    if (l && ly.lines) { seekTo(ly.lines[+l.dataset.i].t); if (audio.paused) play(); }
  });
  if (IS_DESKTOP && NAVO.onMedia) NAVO.onMedia(a => (a === 'toggle' ? toggle() : a === 'next' ? next() : a === 'prev' ? prev() : null));
  $('#npNextList').addEventListener('click', e => {
    const r = e.target.closest('.mini-row');
    if (r) loadIndex(+r.dataset.q, true);
  });

  // seek & volume
  $$('.seek').forEach(r => {
    r.addEventListener('input', () => {
      seeking = true; setFill(r);
      if (isFinite(audio.duration)) $$('.t-cur').forEach(el => { el.textContent = fmtTime(r.value / 1000 * audio.duration); });
    });
    r.addEventListener('change', () => { seeking = false; if (isFinite(audio.duration)) seekTo(r.value / 1000 * audio.duration); updatePositionState(); });
  });
  $$('.volume').forEach(r => r.addEventListener('input', () => {
    S.volume = r.value / 100; S.muted = false; applyVolume(); persist();
  }));

  // search / sort
  let st = 0;
  $('#search').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { S.query = e.target.value; renderList(); }, 120); });

  // equalizer
  $('#eqOn').addEventListener('change', e => { S.eq.on = e.target.checked; applyEq(); syncEq(); persist(); });
  $('#eqPresets').addEventListener('click', e => {
    const b = e.target.closest('[data-preset]');
    if (!b) return;
    S.eq.preset = b.dataset.preset; S.eq.gains = EQ_PRESETS[S.eq.preset].slice(); S.eq.on = true;
    applyEq(); syncEq(); persist();
  });
  $('#eqBands').addEventListener('input', e => {
    const i = e.target.dataset.band;
    if (i === undefined) return;
    S.eq.gains[+i] = +e.target.value; S.eq.preset = null;
    applyEq(); syncEq(); persist();
  });
  $('#blurOn').addEventListener('change', e => { S.lite = !e.target.checked; applyLite(); persist(); });
  $('#vizOn').addEventListener('change', e => { S.viz = e.target.checked; startLoop(); persist(); });
  $('#bassOn').addEventListener('change', e => { S.bass = e.target.checked; if (S.bass && cur() && beatFor !== S.currentId) prepareBeats(cur()); startLoop(); persist(); });

  // edit dialog
  $('#editPickArt').addEventListener('click', () => { const i = $('#artInput'); i.value = ''; i.click(); });
  $('#artInput').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) setEditArtFile(f); });
  $('#editFindArt').addEventListener('click', () => openCoverPick());
  $('#coverGoogle').addEventListener('click', () => {
    const q = `${cleanTitle($('#editTitle').value)} ${firstArtist($('#editArtist').value)} cover`.trim();
    if (IS_DESKTOP) { NAVO.openSearch(q, true); toast('Rasmni nusxalang (Copy image) va shu oynada Ctrl+V bosing', true); setTimeout(() => hideToast(0), 6000); }
    else { openOutside('https://www.google.com/search?tbm=isch&q=' + encodeURIComponent(q)); toast('Rasmni yuklab oling va «Rasm tanlash» bilan qo\'shing'); }
  });
  // paste an image (e.g. copied from Google / Spotify in the browser) straight into the dialog
  document.addEventListener('paste', async e => {
    if ($('#editModal').classList.contains('hidden')) return;
    const item = [...(e.clipboardData && e.clipboardData.items || [])].find(i => i.type.startsWith('image/'));
    if (!item) return;
    e.preventDefault();
    setEditArtFile(item.getAsFile());
  });
  $('#netCoversOn').addEventListener('change', e => {
    S.netCovers = e.target.checked; persist();
    if (S.netCovers) S.order.forEach(queueCover);
  });
  $('#editRemoveArt').addEventListener('click', () => { const t = S.tracks.get(editId); editArt = null; if (t) $('#editArt').src = placeholderArt(t); });
  $('#editCancel').addEventListener('click', closeEdit);
  $('#ucGo').addEventListener('click', () => { $('#updateCard').classList.add('hidden'); openUpdate(); });
  $('#ucLater').addEventListener('click', () => { const c = $('#updateCard'); c.classList.add('hidden'); try { localStorage.setItem('navo.updSkip', c.dataset.ver || ''); } catch { /* */ } });
  $('#checkUpdate').addEventListener('click', () => checkUpdate(true));
  $('#newsOk').addEventListener('click', () => $('#newsModal').classList.add('hidden'));
  $('#newsModal').addEventListener('pointerdown', e => { if (e.target.id === 'newsModal') $('#newsModal').classList.add('hidden'); });
  $('#showKeys').addEventListener('click', openKeys);
  $('#keysOk').addEventListener('click', closeKeys);
  $('#keysModal').addEventListener('pointerdown', e => { if (e.target.id === 'keysModal') closeKeys(); });
  if (IS_DESKTOP) {
    $('#collapseBtn').addEventListener('click', () => setCompact(!S.compact));
    // rail mode shows icons only, so every item gets its name as a tooltip
    $$('#sidebar .nav-item, #sidebar .side-btn').forEach(b => { if (!b.title) b.title = b.textContent.trim(); });
    setCompact(S.compact, true);
  }
  $('#lyMsg').addEventListener('click', e => { const b = e.target.closest('[data-ly]'); if (!b) return; b.dataset.ly === 'google' ? lyGoogle() : openLyEdit(); });
  $('.ly-credit').addEventListener('click', openLyEdit);
  $('#lyCancel').addEventListener('click', closeLyEdit);
  $('#lySave').addEventListener('click', saveLyEdit);
  $('#lyGoogle').addEventListener('click', lyGoogle);
  $('#lyModal').addEventListener('pointerdown', e => { if (e.target.id === 'lyModal') closeLyEdit(); });
  $('#editModal').addEventListener('pointerdown', e => { if (e.target.id === 'editModal') closeEdit(); });
  $('#editSave').addEventListener('click', saveEdit);
  $('#editModal').addEventListener('keydown', e => { if (e.key === 'Enter' && e.target.matches('input[type=text]')) saveEdit(); });
  $('#eqReset').addEventListener('click', () => { S.eq = { on: true, gains: EQ_PRESETS['Oddiy'].slice(), preset: 'Oddiy' }; applyEq(); syncEq(); persist(); });

  // mobile file picker
  const inp = $('#fileInput');
  inp.setAttribute('accept', 'audio/*,application/ogg,application/octet-stream');
  inp.addEventListener('change', () => { if (inp.files.length) importFiles(inp.files); });

  // swipe down to close full player
  let y0 = null;
  const fp = $('#fullPlayer');
  fp.addEventListener('touchstart', e => { if (!e.target.closest('input')) y0 = e.touches[0].clientY; }, { passive: true });
  fp.addEventListener('touchend', e => { if (y0 !== null && e.changedTouches[0].clientY - y0 > 110) closeFull(); y0 = null; });

  // keyboard
  document.addEventListener('keydown', e => {
    if (e.target.matches('input[type=search], input[type=text], textarea')) {
      if (e.key === 'Escape') { e.target.blur(); if (!$('#editModal').classList.contains('hidden')) closeEdit(); closeLyEdit(); }
      return;
    }
    if (e.key === ' ' || e.code === 'MediaPlayPause') { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowRight') { e.preventDefault(); e.ctrlKey ? next() : seekTo(audio.currentTime + 5); }
    else if (e.key === 'ArrowLeft') { e.preventDefault(); e.ctrlKey ? prev() : seekTo(audio.currentTime - 5); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); S.volume = Math.min(1, S.volume + 0.05); S.muted = false; applyVolume(); persist(); }
    else if (e.key === 'ArrowDown') { e.preventDefault(); S.volume = Math.max(0, S.volume - 0.05); applyVolume(); persist(); }
    else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) { S.muted = !S.muted; applyVolume(); persist(); }
    else if (e.key.toLowerCase() === 'f' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); $('#search').focus(); }
    else if (e.key.toLowerCase() === 'b' && (e.ctrlKey || e.metaKey) && IS_DESKTOP) { e.preventDefault(); setCompact(!S.compact); }
    else if (e.key.toLowerCase() === 'm' && (e.ctrlKey || e.metaKey) && e.shiftKey && IS_DESKTOP) { e.preventDefault(); setMini(!miniOn); }
    else if (e.key === '?' && IS_DESKTOP) { $('#keysModal').classList.contains('hidden') ? openKeys() : closeKeys(); }
    else if (e.key === 'Escape') { if (!$('#editModal').classList.contains('hidden')) closeEdit(); else if (!$('#keysModal').classList.contains('hidden')) closeKeys(); else if (!$('#newsModal').classList.contains('hidden')) $('#newsModal').classList.add('hidden'); else if (miniOn) setMini(false); else { closeMenu(); closeFull(); } }
    else if (e.key.toLowerCase() === 'l' && S.currentId) { if (!$('#fullPlayer').classList.contains('open')) openFull(); toggleLyrics(); }
  });

  // drag & drop (desktop)
  if (IS_DESKTOP) {
    let dragDepth = 0;
    const dz = $('#dropZone');
    window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; dz.classList.add('show'); } });
    window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; dz.classList.remove('show'); } });
    window.addEventListener('dragover', e => e.preventDefault());
    window.addEventListener('drop', async e => {
      e.preventDefault(); dragDepth = 0; dz.classList.remove('show');
      if (!$('#editModal').classList.contains('hidden')) {
        const f = Array.from(e.dataTransfer.files).find(f => /^image\//.test(f.type));
        if (f) setEditArtFile(f);
        return;
      }
      const paths = Array.from(e.dataTransfer.files).map(f => NAVO.pathForFile(f)).filter(Boolean);
      if (!paths.length) return;
      toast('Fayllar o\'qilmoqda…', true);
      const items = await NAVO.parsePaths(paths);
      hideToast(0);
      addDesktopItems(items);
    });
    NAVO.onProgress(d => {
      if (d.phase === 'codec') { toast('Bu format uchun kodek yuklab olinmoqda (~29 MB, bir martalik)…', true); return; }
      if (d.phase === 'codec-done') { toast('Kodek o\'rnatildi ✓'); return; }
      if (d.phase === 'tags' && (d.total <= 3 || d.done >= d.total)) return; // tiny jobs: no sticky toast
      toast(d.phase === 'scan' ? `Papka skanerlanmoqda… ${d.found} ta fayl` : `Teglar o'qilmoqda… ${d.done}/${d.total}`, true);
    });
    NAVO.onOpenPaths(async paths => {
      const items = await NAVO.parsePaths(paths);
      await addDesktopItems(items);
      const first = items && items[0] && S.tracks.get(items[0].id);
      if (first) { const ids = computeVisible(); playList(ids, Math.max(0, ids.indexOf(first.id))); }
    });
  }

  // Android back button
  const CapApp = window.capacitorApp && window.capacitorApp.App;
  if (!IS_DESKTOP && CapApp) {
    CapApp.addListener('backButton', () => {
      if (!$('#editModal').classList.contains('hidden')) closeEdit();
      else if (!$('#menu').classList.contains('hidden')) closeMenu();
      else if ($('#fullPlayer').classList.contains('open')) closeFull();
      else if (S.view !== 'library') setView('library');
      else CapApp.minimizeApp ? CapApp.minimizeApp() : CapApp.exitApp();
    });
    CapApp.addListener('pause', () => persist());
    CapApp.addListener('appUrlOpen', e => openExternal(e && e.url));
  }

  window.addEventListener('beforeunload', () => {
    try { localStorage.setItem('navo.state', JSON.stringify({ ...JSON.parse(localStorage.getItem('navo.state') || '{}'), lastTime: audio.currentTime || 0 })); } catch { /* */ }
  });
}

/* ============================================================
   Boot
   ============================================================ */
function applyLite() {
  S.liteOn = S.lite === null ? !!S.autoLite : S.lite;
  document.documentElement.classList.toggle('lite', S.liteOn);
  $('#blurOn').checked = !S.liteOn;
  $('#vizOn').checked = S.viz;
  $('#bassOn').checked = S.bass;
  $('#netCoversOn').checked = S.netCovers;
  if (S.liteOn) { fpArtEl.style.transform = ''; }
}

async function boot() {
  loadSettings();
  // Weak or software-only GPU -> start in lite mode automatically (user can override).
  if (IS_DESKTOP && NAVO.gpuInfo) { try { S.autoLite = !(await NAVO.gpuInfo()).accelerated; } catch { /* */ } }
  else if (!IS_DESKTOP) S.autoLite = (navigator.deviceMemory || 8) <= 2 || (navigator.hardwareConcurrency || 8) <= 2;
  applyLite();
  applyFx();
  buildEq();
  bind();
  applyVolume();
  syncModes();
  try {
    await DB.open();
    const [tracks, thumbKeys, thumbs] = await Promise.all([DB.all('tracks'), DB.allKeys('thumbs'), DB.all('thumbs')]);
    thumbKeys.forEach((k, i) => S.thumbs.set(k, thumbs[i]));
    tracks.forEach(t => { S.tracks.set(t.id, t); S.order.push(t.id); });
  } catch (e) {
    console.error(e);
    toast('Ma\'lumotlar bazasini ochib bo\'lmadi');
  }
  S.queue = S.queue.filter(id => S.tracks.has(id));
  if (S.unshuffled) S.unshuffled = S.unshuffled.filter(id => S.tracks.has(id));
  setView('library');

  if (S.currentId && S.tracks.has(S.currentId)) {
    let qi = S.queue.indexOf(S.currentId);
    if (qi < 0) { S.queue = computeVisible(); qi = S.queue.indexOf(S.currentId); }
    await loadIndex(qi, false, S.lastTime);
  } else {
    S.currentId = null;
    $$('.cur-art').forEach(img => { img.src = 'img/logo.svg'; });
  }
  updateProgress(true);
  renderNext();
  // find pictures for songs that were added without one
  setTimeout(() => S.order.forEach(queueCover), 1500);
  // intro: let the logo animation play briefly, then reveal the app
  moveTabPill();
  const sp = $('#splash');
  if (sp) setTimeout(() => { sp.classList.add('out'); setTimeout(() => sp.remove(), 700); }, Math.max(0, 650 - performance.now()));

  const CapApp = window.capacitorApp && window.capacitorApp.App;
  if (!IS_DESKTOP && CapApp && CapApp.getLaunchUrl) {
    try { const l = await CapApp.getLaunchUrl(); if (l && l.url) openExternal(l.url); } catch { /* */ }
  }

  if (IS_DESKTOP) {
    const launch = await NAVO.launchPaths();
    if (launch && launch.length) {
      const items = await NAVO.parsePaths(launch);
      await addDesktopItems(items);
      const first = items && items[0] && S.tracks.get(items[0].id);
      if (first) { const ids = computeVisible(); playList(ids, Math.max(0, ids.indexOf(first.id))); }
    }
  }
}

// hooks for the automated checks in electron/main.js (test runs only)
if (IS_DESKTOP && NAVO.devTest) window.__navo = { showUpdateCard, setMini, coverCandidates, fetchLyrics, findCoverOnline, openEdit, closeEdit, loadIndex, openFull, toggleLyrics, openLyEdit, S };
boot().then(() => showNewsIfUpdated()).catch(() => {});
})();
