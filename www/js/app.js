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
const VIEW_TITLES = { home: 'Bosh sahifa', library: 'Kutubxona', top: 'Top', favorites: 'Sevimlilar', queue: 'Navbat', eq: 'Sozlamalar', stats: 'Statistika', history: 'Tinglash tarixi' };
const grpName = v => { try { return decodeURIComponent(String(v).slice(3)); } catch { return String(v).slice(3); } };
const viewTitle = v => String(v).startsWith('mx:') ? ((MIX.get(String(v).slice(3)) || {}).name || 'Miks') : String(v).startsWith('ar:') ? grpName(v) : String(v).startsWith('al:') ? grpName(v).split('\u0001')[0] || 'Albom' : String(v).startsWith('pl:') ? ((PL.list.find(p => p.id === v.slice(3)) || {}).name || 'Pleylist') : (VIEW_TITLES[v] || 'Kutubxona');

/* ---------- helpers ---------- */
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
// search text: no case, no accents, every kind of apostrophe (o' o‘ oʻ o’) the same
const srchTxt = s => String(s || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[‘’ʻʼ`´]/g, "'").replace(/\s+/g, ' ').trim();
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
  fade: 0,
  norm: true,
  anim: true,
  libMode: 'songs',
  sideFilter: 'all',
  backTo: 'library',
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
      fade: typeof s.fade === 'number' ? s.fade : 0,
      norm: s.norm !== false,
      anim: IS_DESKTOP ? s.anim !== false : s.animPhone === true,
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
  '1.3.2': [
    "Ekran o'chganda effektlar (Slowed, Reverb, Concert Hall…) bilan ham ovoz endi qotmaydi: telefon uchun reverb qaytadan yozildi",
    "Ekran o'chiq paytda yangi qo'shiq boshlanganda ortiqcha og'ir ish qilinmaydi — ovoz silliq o'tadi",
    "Batareya tejash rejimidan chiqish: Navo bir marta ruxsat so'raydi (Sozlamalar → Ovoz'da ham bor)",
  ],
  '1.3.1': [
    "Telefonda qo'shiqni tahrirlash oynasi pastdan chiqadigan qulay panelga aylandi",
    "Rasm tanlash: katta Galereya, Internet va O'chirish tugmalari, muqovalar katta to'rda",
    "Tugmalar yangilandi: yengil yaltiroq va me'yorida rangli shu'la",
    "Vizualizator silliq to'lqinga aylandi: yumaloq, tiniq chiziqlar, telefonda ham xira emas",
  ],
  '1.3.0': [
    "Sozlamalar bo'limlarga ajratildi: Ovoz, Effektlar, Ko'rinish, Kutubxona, Ilova — yuqoridagi tugmalar bilan tez o'ting",
    "Ovozni tenglashtirish: baland va past yozilgan qo'shiqlar bir xil balandlikda chalinadi",
    "Tinglash tarixi: oxirgi tinglagan qo'shiqlaringiz, qachon eshitilgani bilan",
    "Qidiruv endi ijrochi, albom va pleylistlarni ham topadi, katta-kichik harf va belgilarga qaramaydi",
    "Zaxira nusxa: pleylistlar, sevimlilar va statistikani faylga saqlab, keyin tiklang",
    "Qo'shiq menyusida «Ijrochiga o'tish» va «Albomga o'tish», saralashda «Ko'p tinglangan» va «Davomiyligi»",
  ],
  '1.2.2': [
    "Phonk uchun yangi effektlar: Super Slowed, Ultra Slowed va Hardstyle",
    "Hardstyle: tezroq, kuchli bass va to'yingan zarbalar — ovoz baribir chegaradan oshmaydi",
  ],
  '1.2.1': [
    "Emojilar o'rniga Navo'ning o'z ikonkalari — har qanday ekranda aniq",
    "«+» tugmalari va boshqa ikonkalar ixchamroq",
    "Kompyuterda muqovalar sichqonchaga qarab 3D buriladi, ustida yorug'lik aksi siljiydi",
    "Har sahifada takrorlanadigan «pastdan suzib chiqish» animatsiyasi olib tashlandi",
  ],
  '1.2.0': [
    "Telefonda ilova yana tez va silliq: og'ir fon animatsiyalari o'chirildi (Sozlamalarda yoqish mumkin)",
    "Yangi Bosh sahifa: tezkor plitkalar, «Davom ettiring», sevimli ijrochilaringiz",
    "Siz uchun mikslar: kutubxonangizdan har kuni yangidan yig'iladi",
    "Chap panel — «Kutubxonangiz»: pleylist, ijrochi va albomlar muqovalari bilan",
    "O'ng panelda «Ijrochi haqida» kartasi",
    "Telefonda pastki menyuda «Bosh» sahifa",
  ],
  '1.1.1': [
    "Kutubxonada katta «Hozir ijroda» sahnasi: katta muqova, suzib yuruvchi ranglar va jonli to'lqinlar",
    "Butun ilova foni endi tirik — muqova ranglari suzadi va bass bilan nafas oladi",
    "Ijrochilar va albomlar: kutubxonada tugmalar orqali ko'ring va to'liq ijro eting",
    "Navbatni sudrab tartiblang — qatordagi ≡ tutqichni ushlab suring",
    "Ulashish kartasi: to'liq pleyerda «Ulashish» — story uchun chiroyli rasm",
    "Animatsiyalar endi har doim yoqiq (Sozlamalarda o'chirish mumkin)",
  ],
  '1.1.0': [
    "Yangi logotip: N harfi — bitta tovush to'lqini, bassdan (iliq) baland tovushlarga (sovuq) o'tadi",
    "Pleylistlar: o'z to'plamlaringizni yarating — qo'shiq menyusidan «Pleylistga qo'shish»",
    "To'liq pleyer jonlandi: muqova uchib ochiladi, fon muqova ranglarida bass bilan nafas oladi",
    "Qo'shiq almashganda muqova karta kabi almashadi, yurakcha bosilsa uchqunlar sochiladi",
    "Silliq o'tish: qo'shiqlar orasida ovoz asta pasayib-ko'tariladi (Sozlamalarda)",
    "Tinglash statistikasi: jami vaqt, eng sevimli ijrochilar va oxirgi 7 kun",
    "Tugmalar endi yumaloq fonsiz — faqat ikonka",
  ],
  '1.0.9': [
    "Telefonda «+» tugmasi: fayllarni tanlash yoki papka ulash — yangi qo'shiqlar o'zi qo'shiladi",
    "Orqaga tugmasi endi matn va yangiliklar oynalarini yopadi, ilovadan chiqib ketmaydi",
    "Qidiruv maydoni va sarlavhalar telefonda toza ko'rinadi",
  ],
  '1.0.8': [
    "Kuzatiladigan papkalar: Sozlamalarda papka ulang — unga tashlangan qo'shiqlar kutubxonaga o'zi qo'shiladi",
    "Telefonda ilovadan chiqqanda yoki ekran o'chganda ovoz endi shitirlamaydi",
    "Baland ovozda ham buzilish yo'q: chiqishda zaxira va yumshoq cheklagich qo'shildi",
  ],
  '1.0.7': [
    "Effektlar (Concert Hall, Slowed + Reverb, 8D) naushnikda shitirlamaydi: ovoz endi chegaradan oshmaydi",
    "Telefonda reverb yengillashdi: protsessorni kamroq yuklaydi, ovoz uzilmaydi",
  ],
  '1.0.6': [
    "Telefonda bildirishnoma yangilandi: muqova, rangli fon, vaqt chizig'i, sevimli va yopish tugmalari",
    "Kompyuterda vazifalar panelidagi play / pause / next tugmalari har qanday ekranda aniq ko'rinadi",
    "Ovoz effektlari menyusi va bo'limidagi yozuvlar qalinroq va o'qishga qulay",
  ],
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
  return appVer || '1.3.2';
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
        lastTime: audio.currentTime || S.lastTime, source: S.source, eq: S.eq, lite: S.lite, compact: S.compact, viz: S.viz, bass: S.bass, netCovers: S.netCovers, fx: S.fx, fxStyle: S.fxStyle, fade: S.fade, norm: S.norm, anim: IS_DESKTOP ? S.anim : true, animPhone: IS_DESKTOP ? undefined : S.anim,
      }));
    } catch { /* storage full or blocked */ }
  }, 300);
}

/* ---------- toast ---------- */
let toastTimer = 0;
const TOAST_ICONS = [['✨', 'sparkle'], ['♥', 'heart-fill'], ['🌙', 'moon'], ['✓', 'check']];
function toast(msg, sticky = false) {
  const el = $('#toast');
  let text = String(msg), ic = null;
  for (const [e, name] of TOAST_ICONS) if (text.includes(e)) { ic = ic || name; text = text.split(e).join('').trim(); }
  el.innerHTML = (ic ? `<svg class="i t-ic"><use href="#i-${ic}"/></svg>` : '') + `<span>${esc(text)}</span>`;
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
// Phones get shorter reverb tails: long convolutions starve the audio thread and crackle.
const LITE_AUDIO = !IS_DESKTOP || !!(NAVO && NAVO.devTest && /lite/.test(location.hash));
let master = null, outClip = null, fadeGain = null, fadingOut = false;
/* Smooth transitions: the last S.fade seconds of a song fade out, the next one fades in. */
function fadeTo(v, secs) {
  if (fadeGain && actx) {
    const t = actx.currentTime, g = fadeGain.gain;
    g.cancelScheduledValues(t); g.setValueAtTime(g.value, t); g.linearRampToValueAtTime(v, t + Math.max(0.02, secs));
  }
}
function fadeIn() {
  fadingOut = false;
  if (!S.fade || !fadeGain || !actx) { if (fadeGain && actx) fadeTo(1, 0.05); return; }
  const t = actx.currentTime; fadeGain.gain.cancelScheduledValues(t); fadeGain.gain.setValueAtTime(0.0001, t);
  fadeGain.gain.linearRampToValueAtTime(1, t + Math.min(3, Math.max(0.6, S.fade * 0.6)));
}
function fadeWatch() {
  if (!S.fade || !fadeGain || audio.paused) return;
  const d = audio.duration, left = d - audio.currentTime;
  if (!isFinite(d) || d < S.fade * 3) return;
  if (!fadingOut && left <= S.fade && left > 0.05) {
    if (S.repeat === 'one' || (S.qIndex >= S.queue.length - 1 && S.repeat !== 'all')) return;   // nothing follows: let it end naturally
    fadingOut = true; fadeTo(0.0001, left);
  } else if (fadingOut && left > S.fade + 0.3) { fadingOut = false; fadeTo(1, 0.25); }      // seeked back
}
audio.addEventListener('timeupdate', fadeWatch);
audio.addEventListener('seeked', fadeWatch);
function softClipCurve() {
  const n = 4096, c = new Float32Array(n), k = 0.72, room = 0.97 - k;
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1, a = Math.abs(x);
    c[i] = a <= k ? x : Math.sign(x) * (k + room * Math.tanh((a - k) / room));
  }
  return c;
}
let eqOut = null, wetOn = true, wetOffTimer = 0, limiter = null, normGain = null, loudAn = null, loudBuf = null;
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
    if (LITE_AUDIO) { algoRev = makeAlgoReverb(actx); convolver = algoRev.input; irMode = 'room'; }   // phones: see makeAlgoReverb
    else { convolver = actx.createConvolver(); convolver.buffer = roomIR = makeImpulse(actx, 3.2, 2.6); irMode = 'room'; }
    preDelay = actx.createDelay(0.2); preDelay.delayTime.value = 0.01;
    wetTone = actx.createBiquadFilter(); wetTone.type = 'lowpass'; wetTone.frequency.value = 16000; wetTone.Q.value = 0.5;
    fxMix = actx.createGain();
    panner = actx.createStereoPanner ? actx.createStereoPanner() : null;
    lfo = actx.createOscillator(); lfo.frequency.value = 0.11;
    lfoDepth = actx.createGain(); lfoDepth.gain.value = 0;
    fadeGain = actx.createGain();
    let node = srcNode.connect(fadeGain).connect(preamp);
    filters.forEach(f => { node = node.connect(f); });
    // effect colour stage: a bass shelf and a soft drive (saturation) for hardstyle / phonk punch
    fxBass = actx.createBiquadFilter(); fxBass.type = 'lowshelf'; fxBass.frequency.value = 95; fxBass.gain.value = 0;
    fxDrive = actx.createWaveShaper(); fxDrive.oversample = LITE_AUDIO ? 'none' : '2x';
    fxTrim = actx.createGain();
    node = node.connect(fxBass).connect(fxDrive).connect(fxTrim);
    eqOut = node;
    node.connect(fxDry).connect(fxMix);
    node.connect(preDelay).connect(convolver);
    (algoRev ? algoRev.output : convolver).connect(wetTone).connect(fxWet).connect(fxMix);
    let out = fxMix;
    if (panner) { lfo.connect(lfoDepth).connect(panner.pan); lfo.start(); out = fxMix.connect(panner); }
    // Brick-wall limiter: dry + reverb + EQ boosts can pass 0 dB, which crackles in headphones.
    // loudness levelling: one gain per song, set from its measured loudness (before the limiter,
    // so a raised quiet song still cannot clip)
    normGain = actx.createGain();
    out = out.connect(normGain);
    // the meter listens to the raw file (before EQ, effects and volume) so the measure belongs to the song
    loudAn = actx.createAnalyser(); loudAn.fftSize = 2048; loudBuf = new Float32Array(loudAn.fftSize);
    srcNode.connect(loudAn);
    limiter = actx.createDynamicsCompressor();
    limiter.threshold.value = -4; limiter.knee.value = 0; limiter.ratio.value = 20;
    limiter.attack.value = 0.002; limiter.release.value = 0.2;
    out = out.connect(limiter);
    out.connect(bassAn);
    bassAn.connect(analyser);
    // Output stage after the meters (visuals keep their levels): a little headroom, then a
    // soft clipper. Chrome's compressor adds make-up gain, so it alone is not a brick wall;
    // the clipper rounds off anything left instead of hard digital clipping.
    master = actx.createGain(); master.gain.value = LITE_AUDIO ? 0.8 : 0.94;
    const clip = outClip = actx.createWaveShaper(); clip.curve = softClipCurve();
    analyser.connect(master).connect(clip).connect(actx.destination);
    applyEq();
    applyFx();
  } catch (e) {
    console.warn('WebAudio unavailable', e);
    actx = null; analyser = null;
  }
}
/* ---------- loudness levelling ("Ovozni tenglashtirish") ----------
   Every song's loudness is measured while it plays (RMS of the raw file, quiet parts skipped)
   and remembered. From then on it starts at the right level: loud masters are turned down,
   quiet old recordings up a little. A new song gets a gentle first guess after ~8 s. */
// gentle on purpose: very loud masters (phonk is often about -6 dB RMS) come down a few dB, not to a whisper
const LOUD_TARGET = -11, LOUD_MAX_UP = 4, LOUD_MAX_DOWN = -6;
const loudM = { id: null, sum: 0, n: 0, saved: 0, applied: false };
function normDbFor(t) {
  if (!S.norm || !t || typeof t.loud !== 'number') return 0;
  return Math.max(LOUD_MAX_DOWN, Math.min(LOUD_MAX_UP, LOUD_TARGET - t.loud));
}
function applyNorm(t, secs = 0.08) {
  if (!normGain || !actx) return;
  const g = Math.pow(10, normDbFor(t) / 20), now = actx.currentTime;
  normGain.gain.cancelScheduledValues(now); normGain.gain.setValueAtTime(normGain.gain.value, now);
  normGain.gain.linearRampToValueAtTime(g, now + Math.max(0.02, secs));
}
function loudSample() {
  const t = cur();
  if (!loudAn || !t || audio.paused || audio.seeking) return;
  if (loudM.id !== t.id) Object.assign(loudM, { id: t.id, sum: 0, n: 0, saved: 0, applied: typeof t.loud === 'number' });
  const vol = audio.volume;                    // the element's volume is already in this signal
  if (vol < 0.05) return;
  loudAn.getFloatTimeDomainData(loudBuf);
  let ss = 0;
  for (let i = 0; i < loudBuf.length; i++) ss += loudBuf[i] * loudBuf[i];
  const ms = ss / loudBuf.length / (vol * vol);
  if (ms < 3e-5) return;                       // below about -45 dB: silence / fade, not the song's level
  loudM.sum += ms; loudM.n++;
  if (loudM.n < 16) return;                    // ~8 s of music before trusting the number
  const db = Math.round(10 * Math.log10(loudM.sum / loudM.n) * 10) / 10;
  const had = typeof t.loud === 'number';
  // a song heard before keeps a blend, so one odd listen (skipping around) cannot swing it far
  const val = had && loudM.n < 120 ? t.loud : db;
  if (!had || Math.abs(val - t.loud) > 0.05) t.loud = val;
  if (!loudM.applied) { loudM.applied = true; applyNorm(t, 4); }
  if (loudM.n - loudM.saved >= 60) { loudM.saved = loudM.n; DB.put('tracks', stripTrack(t)).catch(() => {}); }
}
setInterval(loudSample, 500);

function applyEq() {
  if (!actx) return;
  const t = actx.currentTime;
  const gains = S.eq.on ? S.eq.gains : EQ_FREQS.map(() => 0);
  filters.forEach((f, i) => f.gain.setTargetAtTime(gains[i], t, 0.04));
  const maxBoost = Math.max(0, ...gains);
  preamp.gain.setTargetAtTime(Math.pow(10, (-maxBoost * (LITE_AUDIO ? 1 : 0.7)) / 20), t, 0.04);
}
/* ---------- audio effects: Slowed + Reverb, Nightcore, 8D ---------- */
let fxDry = null, fxWet = null, convolver = null, fxMix = null, panner = null, lfo = null, lfoDepth = null;
let preDelay = null, wetTone = null, roomIR = null, hallIR = null, irMode = 'room', irSwap = 0, algoRev = null;
/* Phone reverb, built only from small native nodes (a Freeverb-style network: parallel
   damped combs, then allpass diffusers, slightly different per ear for width).
   Why not the ConvolverNode: with a reverb several seconds long Chrome renders most of it
   on a separate normal-priority thread. When the screen turns off Android slows that
   thread down, the reverb misses its deadline and the music stutters. This network runs
   entirely on the real-time audio thread at a small, fixed cost. */
function makeAlgoReverb(ctx) {
  const input = ctx.createGain(), output = ctx.createGain();
  const split = ctx.createChannelSplitter(2), merge = ctx.createChannelMerger(2);
  input.connect(split);
  const combs = [];
  const rate = 44100, spread = 23, DAMP = 0.3;
  const COMB = [1116, 1277, 1422, 1557, 1188, 1356];
  const AP = [556, 341];
  for (let ch = 0; ch < 2; ch++) {
    const inG = ctx.createGain(); inG.gain.value = 0.12;
    split.connect(inG, ch);
    const sum = ctx.createGain();
    for (const len of COMB) {
      const d = ctx.createDelay(0.1); d.delayTime.value = (len + ch * spread) / rate;
      // one-pole low-pass (never above unity gain, so the loop can never run away)
      const damp = ctx.createIIRFilter([1 - DAMP], [1, -DAMP]);
      const fb = ctx.createGain(); fb.gain.value = 0.93;     // start at the room value: a gain of 1 would ring up at start
      inG.connect(d); d.connect(damp).connect(fb).connect(d); d.connect(sum);
      combs.push({ fb });
    }
    let node = sum;
    for (const len of AP) {                       // Schroeder allpass: v = x + g·v(n-d), y = v(n-d) - g·v
      const g = 0.5;
      const v = ctx.createGain(), d = ctx.createDelay(0.05), fb = ctx.createGain(), ff = ctx.createGain(), out = ctx.createGain();
      d.delayTime.value = (len + ch * spread) / rate; fb.gain.value = g; ff.gain.value = -g;
      node.connect(v); v.connect(d); d.connect(fb).connect(v);
      d.connect(out); v.connect(ff).connect(out);
      node = out;
    }
    node.connect(merge, 0, ch);
  }
  merge.connect(output);
  output.gain.value = 0.41;
  const set = (hall, t = ctx.currentTime) => {
    for (const c of combs) {
      c.fb.gain.setTargetAtTime(hall ? 0.965 : 0.93, t, 0.05);
    }
    output.gain.setTargetAtTime(hall ? 0.58 : 0.41, t, 0.05);   // matched by measurement to the desktop reverb's level
  };
  return { input, output, set };
}
let fxBass = null, fxDrive = null, fxTrim = null, driveNow = -1;
function driveCurve(amount) {
  const n = 2048, c = new Float32Array(n), k = 1 + amount * 7, norm = Math.tanh(k);
  for (let i = 0; i < n; i++) { const x = (i / (n - 1)) * 2 - 1; c[i] = Math.tanh(k * x) / norm; }
  return c;
}
const FX_PRESETS = {
  'Oddiy':           { speed: 1,    reverb: 0,    d8: false },
  'Slowed + Reverb': { speed: 0.85, reverb: 0.4,  d8: false },
  'Concert Hall':    { speed: 0.84, reverb: 0.6,  d8: false, hall: true },
  'Slowed':          { speed: 0.82, reverb: 0.12, d8: false },
  'Sped up':         { speed: 1.15, reverb: 0,    d8: false },
  'Nightcore':       { speed: 1.25, reverb: 0.05, d8: false },
  '8D audio':        { speed: 1,    reverb: 0.25, d8: true },
  // phonk
  'Super Slowed':    { speed: 0.74, reverb: 0.48, d8: false, bass: 3 },
  'Ultra Slowed':    { speed: 0.62, reverb: 0.62, d8: false, hall: true, bass: 4 },
  'Hardstyle':       { speed: 1.12, reverb: 0.1,  d8: false, bass: 8, drive: 0.55 },
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
  const rate = ctx.sampleRate, seconds = LITE_AUDIO ? 3.4 : 5.2, len = Math.floor(rate * seconds), rt60 = LITE_AUDIO ? 3.2 : 4.4;
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
    if (algoRev) algoRev.set(hall); else convolver.buffer = hall ? (hallIR || (hallIR = makeHallImpulse(actx))) : roomIR;
    const n = actx.currentTime;
    preDelay.delayTime.setTargetAtTime(hall ? 0.045 : 0.01, n, 0.01);
    wetTone.frequency.setTargetAtTime(hall ? 5200 : 16000, n, 0.01);
    fxWet.gain.setTargetAtTime(S.fx.reverb * (hall ? 0.75 : 0.85), n, 0.12);
  }, 160);
  return true;
}
/* No reverb -> unplug the convolver so it stops costing CPU; plug it back in when needed. */
function setWetPath(on) {
  if (!eqOut || !preDelay) return;
  clearTimeout(wetOffTimer);
  if (on) { if (!wetOn) { eqOut.connect(preDelay); wetOn = true; } return; }
  if (!wetOn) return;
  wetOffTimer = setTimeout(() => {           // let the tail fade first
    if (S.fx.reverb > 0 || !wetOn) return;
    try { eqOut.disconnect(preDelay); } catch { /* */ }
    wetOn = false;
  }, 1500);
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
    setWetPath(f.reverb > 0);
    if (lfoDepth) lfoDepth.gain.setTargetAtTime(f.d8 ? 0.9 : 0, t, 0.2);
    fxMix.gain.setTargetAtTime(f.d8 ? 0.7 : 1, t, 0.2);   // panning to one side adds up to +3 dB
    if (fxBass) {
      const bass = f.bass || 0, drive = f.drive || 0;
      fxBass.gain.setTargetAtTime(bass, t, 0.08);
      if (drive !== driveNow) { fxDrive.curve = drive > 0 ? driveCurve(drive) : null; driveNow = drive; }
      // keep the overall level steady: the shelf and the drive both add loudness
      fxTrim.gain.setTargetAtTime(Math.pow(10, -(bass * 0.4) / 20) / (1 + drive * 0.35), t, 0.08);
    }
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
  $('#menu').classList.add('fx-menu');
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
  applyNorm(t);
  fadeIn();
  // phone with the screen off: nobody sees the bass effect, and decoding the whole song for it
  // would compete with playback for the CPU. It runs when the screen comes back on.
  if (S.bass && !(PHONE_FX && document.hidden)) prepareBeats(t);
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
  S.source = source || viewTitle(S.view);
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
  dealDir = 1;
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
  dealDir = -1;
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
  const au = $('#fpAurora');
  if (au) {
    au.style.setProperty('--a1', hsl(hues[0], Math.max(.6, sats[0]), .5));
    au.style.setProperty('--a2', hsl(hues[1], Math.max(.6, sats[1]), .48));
    au.style.setProperty('--a3', hsl(hues[2], Math.max(.55, sats[2]), .45));
  }
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
  dealCover(art);
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
  renderAbout(t);
  nativeArt(hasArt ? img : null, pal ? pal.hues[0] : 232 + hueOf((t.title || '') + (t.artist || '')) % 112, pal ? pal.sats[0] : 0.6);
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
// The notification gets a small copy of the cover and a colour picked from it.
const NOTE = { art: null, color: null, pending: false };
function nativeUpdate(sendArt) {
  if (!NativeMedia) return;
  const t = cur();
  if (!t) { NativeMedia.stop().catch(() => {}); return; }
  const o = {
    title: t.title, artist: t.artist || 'Navo', album: t.album || '',
    playing: S.playing, fav: !!t.fav,
    position: audio.currentTime || 0, rate: audio.playbackRate || 1,
  };
  if (isFinite(audio.duration) && audio.duration > 0) o.duration = audio.duration;
  if (NOTE.color != null) o.color = NOTE.color;
  if (sendArt) { if (NOTE.art) o.art = NOTE.art; else o.artReset = true; }
  NativeMedia.update(o).catch(() => {});
}
function nativeArt(img, hue, sat) {
  if (!NativeMedia) return;
  NOTE.art = null;
  if (img) {
    try {
      const c = document.createElement('canvas'); c.width = c.height = 384;
      const g = c.getContext('2d');
      const s = Math.min(img.naturalWidth || img.width, img.naturalHeight || img.height);
      g.drawImage(img, ((img.naturalWidth || img.width) - s) / 2, ((img.naturalHeight || img.height) - s) / 2, s, s, 0, 0, 384, 384);
      NOTE.art = c.toDataURL('image/jpeg', 0.86);
    } catch { /* */ }
  }
  // Deep enough that white text stays readable on the colourised notification.
  const [r, gg, b] = hslToRgb(((hue % 360) + 360) % 360, Math.min(0.7, Math.max(0.4, sat)), 0.34);
  NOTE.color = (r << 16) | (gg << 8) | b;
  nativeUpdate(true);
}
if (NativeMedia) {
  NativeMedia.addListener('action', e => {
    const a = e && e.action;
    if (a === 'toggle') toggle();
    else if (a === 'play') { if (!S.playing) play(); }
    else if (a === 'pause') { if (S.playing) pause(); }
    else if (a === 'next') next();
    else if (a === 'prev') prev();
    else if (a === 'seek') seekTo(+e.time || 0);
    else if (a === 'fav' && S.currentId) toggleFav(S.currentId).then(() => nativeUpdate());
  });
  ['loadedmetadata', 'seeked', 'ratechange'].forEach(ev => audio.addEventListener(ev, () => nativeUpdate()));
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
const vizCanvases = () => [$('#npViz'), $('#fpViz'), document.getElementById('mViz'), document.getElementById('hnViz')].filter(Boolean);
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
    if (nextT) setTimeout(() => { if (!(PHONE_FX && document.hidden)) analyzeBeats(nextT).catch(() => {}); }, 1500);
  } catch (e) { console.warn('beat analysis failed', e); }
}
audio.addEventListener('seeked', seekBeat);
document.addEventListener('visibilitychange', () => {
  if (!document.hidden && S.bass && cur() && beatFor !== S.currentId) prepareBeats(cur());
});


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
  if (S.anim !== false && !PHONE_FX) {
    const pv = p.toFixed(3);
    if (auroraEl) auroraEl.style.setProperty('--pulse', pv);
    if (bdAurEl) bdAurEl.style.setProperty('--pulse', pv);
  }
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
const vizRaw = new Float32Array(512);
function drawViz(cv, ts) {
  const kUp = lerpK(vizDt, 42), kDown = lerpK(vizDt, 170);
  // full device resolution so the bars stay sharp on phones and HiDPI screens (one fill per frame, cheap)
  const dpr = Math.min(PHONE_FX ? 2 : 2.5, window.devicePixelRatio || 1);
  const w = cv.clientWidth, h = cv.clientHeight;
  if (!w || !h) return false;
  const W = Math.round(w * dpr), H = Math.round(h * dpr);
  if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
  const g = cv.getContext('2d');
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, W, H);
  // bar and gap in whole device pixels: no half-pixel edges, no blur
  const big = cv.id === 'fpViz';
  const bw = Math.max(2, Math.round((big ? 4 : 3) * dpr)), gp = Math.max(2, Math.round((big ? 3.5 : 2.6) * dpr));
  const n = Math.max(8, Math.min(vizRaw.length, Math.floor((W + gp) / (bw + gp))));
  const x0 = Math.floor((W - (n * (bw + gp) - gp)) / 2);
  let st = vizState.get(cv);
  if (!st || st.length !== n) { st = new Float32Array(n); vizState.set(cv, st); }
  const bins = freqData ? freqData.length * 0.62 : 0;
  const live = analyser && S.playing;
  for (let k = 0; k < n; k++) {
    let v = 0;
    if (live) {
      const a = Math.floor(Math.pow(k / n, 1.7) * bins) + 1;
      const bEnd = Math.max(a + 1, Math.floor(Math.pow((k + 1) / n, 1.7) * bins) + 1);
      let sum = 0; for (let j = a; j < bEnd; j++) sum += freqData[j];
      v = sum / ((bEnd - a) * 255);
      // tilt: bass is naturally loudest, so lift the highs and calm the lows
      v = Math.pow(v, 2) * (0.55 + (k / n) * 1.1);
    } else if (S.playing) v = 0.22 + 0.16 * Math.sin(ts / 320 + k * 0.42) * Math.sin(ts / 950 + k * 0.13);
    vizRaw[k] = v;
  }
  const grad = g.createLinearGradient(x0, 0, W - x0, 0);
  grad.addColorStop(0, vizColors[0]); grad.addColorStop(0.5, vizColors[1]); grad.addColorStop(1, vizColors[2]);
  g.fillStyle = grad;
  if (!PHONE_FX && S.anim !== false) { g.shadowColor = vizColors[1]; g.shadowBlur = 6 * dpr; }   // a soft glow, desktop only
  g.beginPath();
  const mid = H / 2, rr = bw / 2, minH = bw, rounded = typeof g.roundRect === 'function';
  let moving = false;
  for (let k = 0; k < n; k++) {
    // neighbours blend in: the outline reads as one smooth wave instead of a jagged comb
    const v0 = vizRaw[Math.max(0, k - 1)], v2 = vizRaw[Math.min(n - 1, k + 1)];
    let v = vizRaw[k] * 0.5 + (v0 + v2) * 0.25;
    v = (1 - Math.exp(-1.7 * v)) / 0.817;          // soft ceiling: loud parts never slam flat against the top
    st[k] += (v - st[k]) * (v > st[k] ? kUp : kDown);
    if (st[k] > 0.004) moving = true;
    const bh = Math.max(minH, Math.round(st[k] * H * 0.94 / 2) * 2);
    const x = x0 + k * (bw + gp), y = Math.round(mid - bh / 2);
    if (rounded) g.roundRect(x, y, bw, bh, rr); else g.rect(x, y, bw, bh);
  }
  g.fill();
  g.shadowBlur = 0;
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
    case 'plays': return ids.sort((a, b) => ((T(b).plays || 0) - (T(a).plays || 0)) || ((T(b).lastPlayed || 0) - (T(a).lastPlayed || 0)));
    case 'dur': return ids.sort((a, b) => (T(b).duration || 0) - (T(a).duration || 0));
    default: return ids.sort((a, b) => (T(b).addedAt || 0) - (T(a).addedAt || 0));
  }
}
function idsForView(v) {
  const prev = S.view, q = S.query;
  S.view = v; S.query = '';
  try { return computeVisible(); } finally { S.view = prev; S.query = q; }
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
  else if (S.view.startsWith('pl:')) { const p = plGet(S.view.slice(3)); ids = p ? p.ids.filter(id => S.tracks.has(id)) : []; }
  else if (S.view.startsWith('mx:')) { const m = MIX.get(S.view.slice(3)); ids = m ? m.ids.filter(id => S.tracks.has(id)) : []; }
  else if (S.view === 'home') ids = [];
  else if (S.view === 'history') ids = S.order.filter(id => S.tracks.get(id).lastPlayed).sort((a, b) => S.tracks.get(b).lastPlayed - S.tracks.get(a).lastPlayed).slice(0, 300);
  else if (S.view.startsWith('ar:')) { const n = grpName(S.view); ids = sortedIds(S.order.filter(id => artistOf(S.tracks.get(id)) === n)); }
  else if (S.view.startsWith('al:')) { const k = grpName(S.view); const T = id => S.tracks.get(id);
    ids = S.order.filter(id => albumKey(T(id)) === k).sort((a, b) => ((T(a).trackNo || 999) - (T(b).trackNo || 999)) || String(T(a).title).localeCompare(String(T(b).title))); }
  else ids = sortedIds(S.order.slice());
  // search ignores case and accents, so "oybek" also finds "Oybék" and "o‘" / "o'" match
  const q = srchTxt(S.query);
  if (q) ids = ids.filter(id => { const t = S.tracks.get(id); return srchTxt(`${t.title} ${t.artist} ${t.album}`).includes(q); });
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
function agoText(ms) {
  const d = (Date.now() - ms) / 1000;
  if (d < 90) return 'hozirgina';
  if (d < 3600) return Math.round(d / 60) + ' daqiqa oldin';
  if (d < 86400) return Math.round(d / 3600) + ' soat oldin';
  if (d < 2 * 86400) return 'kecha';
  if (d < 7 * 86400) return Math.floor(d / 86400) + ' kun oldin';
  const x = new Date(ms);
  return `${x.getDate()}.${String(x.getMonth() + 1).padStart(2, '0')}.${x.getFullYear()}`;
}
function rowHTML(t, i) {
  const top = S.view === 'top';
  if (S.view === 'history') return rowHTMLWith(t, i, `<div><span class="plays ago">${agoText(t.lastPlayed)}</span></div>`);
  return rowHTMLWith(t, i, null);
}
function rowHTMLWith(t, i, col5) {
  const top = S.view === 'top';
  return `<div class="row" data-id="${esc(t.id)}" data-i="${i}"${i < 16 ? ` style="--d:${i}"` : ''}>` +
    `<div class="num${top ? ' rank' + (i < 3 ? ' r' + (i + 1) : '') : ''}">${i + 1}</div>` +
    thumbDiv(t) +
    `<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || 'Noma\'lum ijrochi')}</div></div>` +
    `<div class="alb">${esc(t.album || '—')}</div>` +
    (col5 || (top ? `<div><span class="plays">${t.plays} marta</span></div>`
         : `<div><span class="chip${LOSSLESS.has(t.ext) ? ' hq' : ''}">${esc((t.ext || '?').toUpperCase())}</span></div>`)) +
    `<div class="dur">${t.duration ? fmtTime(t.duration) : '--:--'}</div>` +
    `<div class="acts"><button class="icon-btn sm fav${t.fav ? ' on' : ''}" data-a="fav" title="Sevimli">${icon(t.fav ? 'heart-fill' : 'heart')}</button>` +
    `<button class="icon-btn sm" data-a="more" title="Ko'proq">${icon('more')}</button></div></div>`;
}
function renderList() {
  const isEq = S.view === 'eq', isStats = S.view === 'stats';
  $('#viewList').classList.toggle('hidden', isEq || isStats);
  $('#viewEq').classList.toggle('hidden', !isEq);
  $('#viewStats').classList.toggle('hidden', !isStats);
  $('.top-tools').classList.toggle('hidden', isEq || isStats);
  $('#viewTitle').textContent = viewTitle(S.view);
  renderPlSide();
  if (isEq || isStats) { $('#viewCount').textContent = ''; if (isStats) renderStats(); return; }

  const ids = computeVisible();
  S.visible = ids;
  const total = ids.reduce((s, id) => s + (S.tracks.get(id).duration || 0), 0);
  $('#viewCount').textContent = ids.length ? `${ids.length} ta qo'shiq · ${fmtTime(total)}` : '';
  $('#cntLibrary').textContent = S.order.length || '';
  const favN = S.order.filter(id => S.tracks.get(id).fav).length;
  $('#cntFav').textContent = favN || '';

  const list = $('#trackList'), empty = $('#empty');
  renderTopHero(ids);
  const col5 = S.view === 'top' ? 'Tinglangan' : S.view === 'history' ? 'Qachon' : 'Format';
  $('.list-head span:nth-child(5)').textContent = col5;
  if (S.view === 'home') {
    empty.classList.add('hidden'); list.classList.remove('hidden'); $('.list-head').classList.add('hidden');
    list.classList.remove('queue-mode');
    $('#viewCount').textContent = '';
    if (!S.order.length) { list.innerHTML = ''; list.classList.add('hidden'); empty.classList.remove('hidden');
      $('#emptyTitle').textContent = 'Kutubxona bo\'sh'; $('#emptyText').textContent = IS_DESKTOP ? 'Fayl yoki papka qo\'shing, yoki ularni oynaga sudrab tashlang.' : 'Telefoningizdagi musiqa fayllarini tanlang yoki papka ulang.'; $('#emptyActions').classList.remove('hidden'); return; }
    list.innerHTML = homeHTML();
    return;
  }
  if (S.view.startsWith('ar:') || S.view.startsWith('al:') || S.view.startsWith('mx:')) {
    empty.classList.add('hidden'); list.classList.remove('hidden'); $('.list-head').classList.add('hidden');
    list.classList.toggle('queue-mode', false);
    list.innerHTML = grpHeadHTML(ids) + ids.map((id, i) => rowHTML(S.tracks.get(id), i)).join('');
    markPlaying();
    return;
  }
  if (S.view === 'library' && S.libMode !== 'songs' && S.order.length) {
    empty.classList.add('hidden'); list.classList.remove('hidden'); $('.list-head').classList.add('hidden');
    list.innerHTML = nowCardHTML() + heroNowHTML() + libTabsHTML() + (S.libMode === 'artists' ? artistsGridHTML() : albumsGridHTML());
    $('#viewCount').textContent = S.libMode === 'artists' ? `${groupArtists().length} ta ijrochi` : `${groupAlbums().length} ta albom`;
    return;
  }
  list.classList.toggle('queue-mode', S.view === 'queue' && !S.query.trim());
  if (S.view.startsWith('pl:')) {           // playlist: header with actions, even when empty
    empty.classList.add('hidden');
    list.classList.remove('hidden');
    $('.list-head').classList.add('hidden');
    list.innerHTML = plHeadHTML(ids) + (ids.length ? ids.map((id, i) => rowHTML(S.tracks.get(id), i)).join('')
      : `<div class="pl-empty">${icon('playlist')}<b>Pleylist hozircha bo'sh</b><span>Qo'shiq yonidagi ⋯ menyusidan «Pleylistga qo'shish»ni tanlang.</span></div>`);
    markPlaying();
    return;
  }
  if (!ids.length && S.query.trim() && S.view === 'library' && searchGroupsHTML()) {
    empty.classList.add('hidden'); list.classList.remove('hidden'); $('.list-head').classList.add('hidden');
    list.innerHTML = searchGroupsHTML();
    return;
  }
  if (!ids.length) {
    list.innerHTML = '';
    list.classList.add('hidden');
    $('.list-head').classList.add('hidden');
    empty.classList.remove('hidden');
    const q = S.query.trim();
    const [title, text, showAdd] =
      q ? ['Hech narsa topilmadi', `"${q}" bo'yicha natija yo'q.`, false]
      : S.view === 'top' ? ['Top hali bo\'sh', 'Qo\'shiqlarni tinglang — 30 soniyadan ko\'p eshitilgan har bir qo\'shiq hisoblanadi va eng ko\'p tinglanganlar shu yerda chiqadi.', false]
      : S.view === 'favorites' ? ['Sevimlilar bo\'sh', 'Yoqqan qo\'shiqlaringizdagi yurakcha tugmasini bosing — ular shu yerda paydo bo\'ladi.', false]
      : S.view === 'queue' ? ['Navbat bo\'sh', 'Kutubxonadan biror qo\'shiqni ijro eting.', false]
      : S.view === 'history' ? ['Tarix hali bo\'sh', 'Qo\'shiq tinglang — har bir eshitilgan qo\'shiq vaqti bilan shu yerda saqlanadi.', false]
      : ['Kutubxona bo\'sh', IS_DESKTOP ? 'Fayl yoki butun papkani qo\'shing, yoki ularni oynaga sudrab tashlang. MP3, FLAC, WAV, M4A, OGG, WMA, APE va boshqalar.' : 'Telefoningizdagi musiqa fayllarini tanlang — MP3, FLAC, WAV, M4A, OGG, OPUS va boshqalar.', true];
    $('#emptyTitle').textContent = title;
    $('#emptyText').textContent = text;
    $('#emptyActions').classList.toggle('hidden', !showAdd);
    return;
  }
  empty.classList.add('hidden');
  list.classList.remove('hidden');
  $('.list-head').classList.add('hidden');      // the header now lives inside the list (sticky)
  const head = `<div class="list-head in"><span>#</span><span></span><span>Nomi</span><span>Albom</span><span>${col5}</span><span class="r">Vaqt</span><span></span></div>`;
  list.innerHTML = nowCardHTML() + heroNowHTML() + (S.view === 'library' && !S.query.trim() ? libTabsHTML() : '') + searchGroupsHTML() + head + ids.map((id, i) => rowHTML(S.tracks.get(id), i)).join('');
  markPlaying();
}
/* ---------- library carousels: "Siz uchun" + "Yaqinda qo'shilgan" ---------- */
const carouselSets = {};
function greeting() {
  const h = new Date().getHours();
  return h < 5 ? 'Xayrli tun' : h < 12 ? 'Xayrli tong' : h < 18 ? 'Xayrli kun' : 'Xayrli kech';
}
/* search in the library also finds artists, albums and playlists by name */
function searchGroupsHTML() {
  const q = srchTxt(S.query);
  if (S.view !== 'library' || q.length < 2) return '';
  const hit = name => srchTxt(name).includes(q);
  const ars = groupArtists().filter(g => hit(g.name)).slice(0, 8);
  const als = groupAlbums().filter(g => hit(g.name)).slice(0, 8);
  const pls = PL.list.filter(p => hit(p.name)).slice(0, 6);
  if (!ars.length && !als.length && !pls.length) return '';
  const chip = (view, img, title, sub, round) => `<button class="sr-chip" data-view="${esc(view)}"><span class="sr-art${round ? ' round' : ''}" style="background-image:url('${img}')"></span><span class="sr-t"><b>${esc(title)}</b><small>${esc(sub)}</small></span></button>`;
  const T = id => S.tracks.get(id);
  return `<div class="sr-groups">` +
    pls.map(p => chip('pl:' + p.id, p.ids.length && T(p.ids[0]) ? thumbFor(T(p.ids[0])) : placeholderArt({ title: p.name, artist: '' }), p.name, `Pleylist · ${p.ids.length} ta`, false)).join('') +
    ars.map(g => chip('ar:' + encodeURIComponent(g.name), thumbFor(T(g.ids[0])), g.name, `Ijrochi · ${g.ids.length} ta`, true)).join('') +
    als.map(g => chip('al:' + encodeURIComponent(g.key), thumbFor(T(g.ids[0])), g.name, `Albom · ${g.artist || ''}`, false)).join('') +
    `</div>`;
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
const DAILY = { map: {}, dirty: 0 };
try { DAILY.map = JSON.parse(localStorage.getItem('navo.daily') || '{}'); } catch { DAILY.map = {}; }
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function addDaily(secs) {
  const k = dayKey();
  DAILY.map[k] = (DAILY.map[k] || 0) + secs;
  if ((DAILY.dirty += secs) > 20) {
    DAILY.dirty = 0;
    const keys = Object.keys(DAILY.map).sort();
    if (keys.length > 400) keys.slice(0, keys.length - 400).forEach(x => delete DAILY.map[x]);
    try { localStorage.setItem('navo.daily', JSON.stringify(DAILY.map)); } catch { /* */ }
  }
}
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
  addDaily(d);
  const need = Math.min(30, (audio.duration || t.duration || 60) * 0.5);
  let dirty = false;
  if (!listen.counted && listen.secs >= need) {
    listen.counted = true;
    t.plays = (t.plays || 0) + 1;
    t.lastPlayed = Date.now();
    dirty = true;
    if (S.view === 'top' || S.view === 'history') renderList();
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
  if (!t || !isPhone() || S.query.trim() || !['home', 'library', 'top', 'favorites'].includes(S.view)) return '';
  const art = $('.p-art') && $('.p-art').getAttribute('src') ? $('.p-art').getAttribute('src') : thumbFor(t);
  return `<div class="m-now" data-act="open-full">` +
    `<div class="m-now-bg" style="background-image:${$('#fpBg').style.backgroundImage || 'none'}"></div>` +
    `<div class="m-now-art"><div class="bass-glow"></div><div class="boom-ring"></div><img class="cur-art bass-art" src="${art}" alt=""></div>` +
    `<div class="m-now-meta"><small>Hozir ijroda · ${esc(FXP.label)}</small><b class="cur-title">${esc(t.title)}</b>` +
    `<span class="cur-artist">${esc(t.artist || 'Noma\'lum ijrochi')}</span><canvas class="viz" id="mViz"></canvas></div></div>`;
}
/* desktop library: a stage for the song that is playing — its own colours, cover, live bars */
function heroNowHTML() {
  const t = cur();
  if (!t || isPhone() || S.view !== 'home') return '';
  const art = $('.p-art') && $('.p-art').getAttribute('src') ? $('.p-art').getAttribute('src') : thumbFor(t);
  return `<section class="hero-now">` +
    `<div class="hn-bg" style="background-image:${$('#fpBg').style.backgroundImage || 'none'}"></div>` +
    `<div class="hn-aur"><i></i><i></i><i></i></div>` +
    `<div class="hn-art" data-act="open-full"><div class="bass-glow"></div><div class="boom-ring"></div><img class="cur-art bass-art" src="${art}" alt=""></div>` +
    `<div class="hn-meta"><small>Hozir ijroda</small><h2 class="cur-title">${esc(t.title)}</h2><span class="cur-artist">${esc(t.artist || 'Noma\'lum ijrochi')}</span>` +
    `<div class="hn-row"><button class="play-btn" data-act="toggle">${icon(S.playing ? 'pause' : 'play')}</button>` +
    `<button class="icon-btn fav-btn${t.fav ? ' on' : ''}" data-act="fav-current">${icon(t.fav ? 'heart-fill' : 'heart')}</button>` +
    `<button class="icon-btn" data-act="open-full" title="To'liq ekranda ochish">${icon('expand')}</button></div></div>` +
    `<canvas class="viz" id="hnViz"></canvas></section>`;
}
function syncNowCard() {
  if (!isPhone()) {                          // desktop: the big "now playing" stage on top of the library
    if (S.view !== 'home') return;
    const hero = $('.hero-now');
    if (!hero && cur()) { renderList(); return; }
    if (hero) { const bg = $('.hn-bg', hero); if (bg) bg.style.backgroundImage = $('#fpBg').style.backgroundImage; }
    return;
  }
  if (!['home', 'library', 'top', 'favorites'].includes(S.view)) return;
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
  if (S.view === 'home' || S.view === 'library') S.backTo = S.view;
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
async function importFiles(fileList, quiet = false) {
  const files = Array.from(fileList).filter(f => AUDIO_SET.has(extOf(f.name)) || /^audio\//.test(f.type));
  if (!files.length) { if (!quiet) toast('Audio fayl topilmadi'); return []; }
  let added = 0;
  const ids = [];
  for (let k = 0; k < files.length; k++) {
    const f = files[k];
    if (!quiet) toast(`Import qilinmoqda… ${k + 1}/${files.length}`, true);
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
    if (!quiet && k % 5 === 4) renderList();
  }
  ids.added = added;
  if (quiet) return ids;
  hideToast(0);
  finishAdd(added, files.length);
  return ids;
}

/* ---------- watched folders: music dropped there joins the library by itself ----------
   PC: the main process watches the folders live. Phone: the folder (picked once through
   Android's folder picker) is re-read on start, on return to the app and every 30 s.
   Every file is imported once; deleting a song from the library doesn't bring it back. */
const NativeFolders = (!IS_DESKTOP && window.Capacitor && window.Capacitor.isNativePlatform && window.Capacitor.isNativePlatform() && window.capacitorExports)
  ? window.capacitorExports.registerPlugin('NavoFolders') : null;
const W = { list: [], seen: new Set(), busy: false, again: false };
try { W.list = JSON.parse(localStorage.getItem('navo.watch') || '[]'); } catch { W.list = []; }
try { W.seen = new Set(JSON.parse(localStorage.getItem('navo.watchSeen') || '[]')); } catch { W.seen = new Set(); }
const saveWatch = () => {
  try { localStorage.setItem('navo.watch', JSON.stringify(W.list)); localStorage.setItem('navo.watchSeen', JSON.stringify([...W.seen])); } catch { /* */ }
};
function renderWatch() {
  const box = $('#watchList');
  if (!box) return;
  box.innerHTML = W.list.map((w, i) => `<span class="watch-chip${w.bad ? ' bad' : ''}" title="${esc(w.bad ? 'Ruxsat yo\'qoldi — papkani qayta ulang' : (w.path || w.name))}">${icon('folder')}<span>${esc(w.name)}</span><button data-watch-del="${i}" aria-label="Uzish">${icon('close')}</button></span>`).join('');
}
async function addWatchFolder() {
  if (IS_DESKTOP) {
    const dir = await NAVO.pickWatchFolder();
    if (!dir) return;
    if (W.list.some(w => w.path === dir)) { toast('Bu papka allaqachon ulangan'); return; }
    W.list.push({ path: dir, name: dir.split(/[\\/]/).filter(Boolean).pop() || dir });
  } else if (NativeFolders) {
    let r;
    try { r = await NativeFolders.pick(); } catch { r = null; }
    if (!r || !r.uri) return;
    const old = W.list.find(w => w.uri === r.uri);
    if (old) { old.bad = false; } else W.list.push({ uri: r.uri, name: r.name || 'Papka' });
  } else { toast('Bu qurilmada papka ulab bo\'lmaydi'); return; }
  saveWatch(); renderWatch();
  toast('Papka ulandi — undagi qo\'shiqlar qo\'shilmoqda…', true);
  syncWatch(true);
}
function removeWatchFolder(i) {
  const w = W.list[i];
  if (!w) return;
  W.list.splice(i, 1);
  if (w.uri && NativeFolders) NativeFolders.release({ uri: w.uri }).catch(() => {});
  saveWatch(); renderWatch();
  if (IS_DESKTOP) NAVO.watchSet(W.list.map(x => x.path));
  toast(`"${w.name}" uzildi. Qo'shiqlar kutubxonada qoladi`);
}
function watchDone(added, loud) {
  hideToast(0);
  if (added) { renderList(); renderNext(); toast(`Papkadan ${added} ta yangi qo'shiq qo'shildi ✨`); }
  else if (loud) toast('Papkada yangi qo\'shiq yo\'q');
}
async function importWatchedPaths(paths, loud) {
  const fresh = [...new Set(paths)].filter(p => !W.seen.has('p:' + p.toLowerCase()));
  if (!fresh.length) { if (loud) watchDone(0, loud); return; }
  const items = await NAVO.parsePaths(fresh);
  let added = 0;
  for (const it of items || []) if (await addTrack(it)) added++;
  fresh.forEach(p => W.seen.add('p:' + p.toLowerCase()));
  saveWatch();
  watchDone(added, loud);
}
async function syncWatchAndroid(loud) {
  let added = 0, anyFile = false;
  for (const w of W.list) {
    if (!w.uri) continue;
    let files;
    try { files = (await NativeFolders.scan({ uri: w.uri })).files || []; w.bad = false; }
    catch (e) { if (/denied/.test(String(e && e.message))) w.bad = true; continue; }
    const fresh = files.filter(f => !W.seen.has('u:' + f.uri + '|' + f.size));
    for (let k = 0; k < fresh.length; k++) {
      const f = fresh[k], key = 'u:' + f.uri + '|' + f.size;
      anyFile = true;
      if (fresh.length > 2) toast(`Papkadan qo'shilmoqda… ${k + 1}/${fresh.length}`, true);
      // same id importFiles() would give it -> already in the library, nothing to copy
      if (S.tracks.has('f_' + hashStr(`${f.name}|${f.size}|${f.modified}`))) { W.seen.add(key); continue; }
      try {
        const { path } = await NativeFolders.copy({ uri: f.uri });
        const r = await fetch(window.Capacitor.convertFileSrc('file://' + path));
        if (!r.ok) throw new Error('HTTP ' + r.status);
        const blob = await r.blob();
        const file = new File([blob], f.name, { type: f.mime || blob.type || 'audio/mpeg', lastModified: f.modified || 0 });
        const ids = await importFiles([file], true);
        added += (ids && ids.added) || 0;
        W.seen.add(key);
      } catch (e) { console.warn('watch import', f.name, e); }
      if (k % 10 === 9) { saveWatch(); NativeFolders.clear().catch(() => {}); }
    }
  }
  NativeFolders.clear().catch(() => {});
  saveWatch(); renderWatch();
  watchDone(added, loud || (anyFile && added));
}
async function syncWatch(loud = false) {
  if (!W.list.length) return;
  if (W.busy) { W.again = true; return; }
  W.busy = true;
  try {
    if (IS_DESKTOP) {
      const dirs = W.list.map(w => w.path);
      const live = await NAVO.watchSet(dirs);
      W.list.forEach(w => { w.bad = !live.includes(w.path); });
      renderWatch();
      await importWatchedPaths(await NAVO.watchScan(dirs), loud);
    } else if (NativeFolders) await syncWatchAndroid(loud);
  } catch (e) { console.warn('watch sync', e); }
  W.busy = false;
  if (W.again) { W.again = false; syncWatch(); }
}
function initWatch() {
  renderWatch();
  $('#watchAdd') && $('#watchAdd').addEventListener('click', addWatchFolder);
  $('#watchList') && $('#watchList').addEventListener('click', e => {
    const b = e.target.closest('[data-watch-del]');
    if (b) removeWatchFolder(+b.dataset.watchDel);
  });
  if (IS_DESKTOP) {
    if (NAVO.onWatchFiles) NAVO.onWatchFiles(paths => {
      if (W.busy) { W.again = true; return; }
      W.busy = true;
      importWatchedPaths(paths, false).catch(() => {}).finally(() => { W.busy = false; if (W.again) { W.again = false; syncWatch(); } });
    });
  } else if (NativeFolders) {
    const CapApp = window.capacitorApp && window.capacitorApp.App;
    if (CapApp) CapApp.addListener('resume', () => syncWatch());
    setInterval(() => { if (!document.hidden) syncWatch(); }, 30000);
  }
  setTimeout(() => syncWatch(), 2500);
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
  if (!IS_DESKTOP) return addWatchFolder();
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
  if (t.fav) heartBurst(id);
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

/* ---------- playlists (stored per device in localStorage) ---------- */
const PL = { list: [] };
try { PL.list = (JSON.parse(localStorage.getItem('navo.playlists') || '[]') || []).filter(p => p && p.id && Array.isArray(p.ids)); } catch { PL.list = []; }
const plSave = () => { try { localStorage.setItem('navo.playlists', JSON.stringify(PL.list)); } catch { /* */ } };
const plGet = id => PL.list.find(p => p.id === id);
function plAsk({ title, text = '', value = '', ok = 'Saqlash', danger = false, input = true }) {
  return new Promise(res => {
    const m = $('#plModal'), inp = $('#plName'), okB = $('#plOk');
    $('#plTitle').textContent = title;
    $('#plText').textContent = text; $('#plText').classList.toggle('hidden', !text);
    inp.classList.toggle('hidden', !input); inp.value = value;
    okB.textContent = ok; okB.classList.toggle('danger', danger);
    m.classList.remove('hidden');
    if (input) setTimeout(() => { inp.focus(); inp.select(); }, 60);
    const done = v => { m.classList.add('hidden'); okB.onclick = $('#plCancel').onclick = inp.onkeydown = m.onpointerdown = null; res(v); };
    okB.onclick = () => done(input ? (inp.value.trim().slice(0, 60) || null) : true);
    $('#plCancel').onclick = () => done(null);
    inp.onkeydown = e => { if (e.key === 'Enter') okB.click(); else if (e.key === 'Escape') done(null); };
    m.onpointerdown = e => { if (e.target === m) done(null); };
    plAsk.cancel = () => done(null);
  });
}
async function plCreate(ids = []) {
  const name = await plAsk({ title: 'Yangi pleylist', value: `Pleylist ${PL.list.length + 1}` });
  if (!name) return null;
  const p = { id: 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name, ids: [...new Set(ids)], created: Date.now() };
  PL.list.push(p); plSave();
  toast(ids.length ? `"${name}" yaratildi va qo'shiq qo'shildi` : `"${name}" pleylisti yaratildi`);
  if (!ids.length) setView('pl:' + p.id); else renderList();
  return p;
}
function plAdd(pid, ids) {
  const p = plGet(pid); if (!p) return;
  const before = p.ids.length;
  ids.forEach(id => { if (!p.ids.includes(id)) p.ids.push(id); });
  plSave();
  toast(p.ids.length > before ? `"${p.name}" pleylistiga qo'shildi` : 'Bu qo\'shiq allaqachon pleylistda');
  if (S.view === 'pl:' + pid || S.view === 'library') renderList(); else renderPlSide();
}
function plRemove(pid, id) {
  const p = plGet(pid); if (!p) return;
  p.ids = p.ids.filter(x => x !== id); plSave(); renderList();
  toast('Pleylistdan olib tashlandi');
}
async function plRename(pid) {
  const p = plGet(pid); if (!p) return;
  const name = await plAsk({ title: 'Nomini o\'zgartirish', value: p.name });
  if (!name) return;
  p.name = name; plSave(); renderList();
}
async function plDelete(pid) {
  const p = plGet(pid); if (!p) return;
  const yes = await plAsk({ title: `"${p.name}" o'chirilsinmi?`, text: 'Faqat pleylist o\'chadi, qo\'shiqlar kutubxonada qoladi.', ok: 'O\'chirish', danger: true, input: false });
  if (!yes) return;
  PL.list = PL.list.filter(x => x.id !== pid); plSave();
  setView('library');
  toast('Pleylist o\'chirildi');
}
function plPickFor(ids, x, y) {
  showMenu('<div class="menu-title">Pleylistga qo\'shish</div>' +
    PL.list.map(p => `<button data-m="${esc(p.id)}">${icon('playlist')}${esc(p.name)}<em class="m-count">${p.ids.length}</em></button>`).join('') +
    (PL.list.length ? '<hr>' : '') + `<button data-m="__new">${icon('plus')}Yangi pleylist</button>`,
    x, y, m => (m === '__new' ? plCreate(ids) : plAdd(m, ids)));
}
function plCover(p) {
  const t = p.ids.map(id => S.tracks.get(id)).find(Boolean);
  return t ? thumbFor(t) : '';
}
function renderPlSide() {
  const box = $('#plSide'); if (!box) return;
  const chips = $('#libChips');
  if (chips) chips.innerHTML = [['all', 'Hammasi'], ['pl', 'Pleylist'], ['ar', 'Ijrochi'], ['al', 'Albom']]
    .map(([f, l]) => `<button class="lib-chip${S.sideFilter === f ? ' on' : ''}" data-act="side-filter" data-f="${f}">${l}</button>`).join('');
  const F = S.sideFilter, items = [];
  const favN = S.order.filter(id => S.tracks.get(id).fav).length;
  if (F === 'all' || F === 'pl') {
    items.push(`<button class="ls-item${S.view === 'favorites' ? ' active' : ''}" data-view="favorites"><span class="ls-art fav">${icon('heart-fill')}</span><span class="ls-t"><b>Sevimlilar</b><small>Pleylist · ${favN} ta qo'shiq</small></span></button>`);
    PL.list.forEach(p => { const c = plCover(p), n = p.ids.filter(id => S.tracks.has(id)).length;
      items.push(`<button class="ls-item${S.view === 'pl:' + p.id ? ' active' : ''}" data-view="pl:${esc(p.id)}"><span class="ls-art"${c ? ` style="background-image:url('${c}')"` : ''}>${c ? '' : icon('playlist')}</span><span class="ls-t"><b>${esc(p.name)}</b><small>Pleylist · ${n} ta qo'shiq</small></span></button>`); });
  }
  if (F === 'all' || F === 'ar') groupArtists().slice(0, F === 'all' ? 8 : 200).forEach(g => { const t = g.art || S.tracks.get(g.ids[0]), v = 'ar:' + encodeURIComponent(g.name);
    items.push(`<button class="ls-item${S.view === v ? ' active' : ''}" data-view="${esc(v)}"><span class="ls-art round" style="background-image:url('${thumbFor(t)}')"></span><span class="ls-t"><b>${esc(g.name)}</b><small>Ijrochi · ${g.ids.length} ta</small></span></button>`); });
  if (F === 'all' || F === 'al') groupAlbums().slice(0, F === 'all' ? 6 : 200).forEach(g => { const t = g.art || S.tracks.get(g.ids[0]), v = 'al:' + encodeURIComponent(g.key);
    items.push(`<button class="ls-item${S.view === v ? ' active' : ''}" data-view="${esc(v)}"><span class="ls-art" style="background-image:url('${thumbFor(t)}')"></span><span class="ls-t"><b>${esc(g.name)}</b><small>Albom · ${esc(g.artist)}</small></span></button>`); });
  box.innerHTML = items.join('') || '<div class="pl-hint">Hali hech narsa yo\'q — «+» ni bosing</div>';
  return;
  box.innerHTML = PL.list.map(p => `<button class="nav-item pl-item${S.view === 'pl:' + p.id ? ' active' : ''}" data-view="pl:${esc(p.id)}">${icon('playlist')}<span>${esc(p.name)}</span><em>${p.ids.filter(id => S.tracks.has(id)).length || ''}</em></button>`).join('')
    || '<div class="pl-hint">Yoqqan qo\'shiqlaringizni to\'plang — «+» ni bosing</div>';
}
function plShelfHTML() {
  if (!isPhone() && !PL.list.length) return '';
  return '<section class="shelf pl-shelf"><div class="shelf-head"><div><h3>Pleylistlar</h3><small>O\'zingiz yig\'gan to\'plamlar</small></div></div><div class="shelf-row">' +
    PL.list.map(p => { const c = plCover(p), n = p.ids.filter(id => S.tracks.has(id)).length;
      return `<div class="card pl-card-item" data-view="pl:${esc(p.id)}"><div class="card-art pl-art"${c ? ` style="background-image:url('${c}')"` : ''}>${c ? '' : icon('playlist')}</div>` +
        `<div class="t">${esc(p.name)}</div><div class="a">${n} ta qo'shiq</div></div>`; }).join('') +
    `<div class="card pl-card-item pl-add" data-act="pl-new"><div class="card-art pl-art">${icon('plus')}</div><div class="t">Yangi pleylist</div><div class="a">Yaratish</div></div>` +
    '</div></section>';
}
function plHeadHTML(ids) {
  const p = plGet(S.view.slice(3)); if (!p) return '';
  const c = plCover(p), total = ids.reduce((s, id) => s + (S.tracks.get(id).duration || 0), 0);
  return `<div class="pl-head"><div class="pl-cover"${c ? ` style="background-image:url('${c}')"` : ''}>${c ? '' : icon('playlist')}</div>` +
    `<div class="pl-info"><small>Pleylist</small><h2>${esc(p.name)}</h2><span>${ids.length} ta qo'shiq${total ? ' · ' + fmtTime(total) : ''}</span>` +
    `<div class="pl-acts"><button class="btn btn-primary sm" data-act="pl-play"${ids.length ? '' : ' disabled'}>${icon('play')}Ijro</button>` +
    `<button class="icon-btn" data-act="pl-shuffle" title="Aralash ijro"${ids.length ? '' : ' disabled'}>${icon('shuffle')}</button>` +
    `<button class="icon-btn" data-act="pl-rename" title="Nomini o'zgartirish">${icon('edit')}</button>` +
    `<button class="icon-btn" data-act="pl-delete" title="Pleylistni o'chirish">${icon('trash')}</button></div></div></div>`;
}

/* ---------- artists & albums ---------- */
const artistOf = t => firstArtist(t && t.artist) || 'Noma\'lum ijrochi';
const albumKey = t => (t && t.album) ? t.album + '\u0001' + (t.albumArtist || firstArtist(t.artist) || '') : '';
function groupArtists() {
  const m = new Map();
  for (const id of S.order) { const t = S.tracks.get(id), a = artistOf(t); const g = m.get(a) || { name: a, ids: [], art: null }; g.ids.push(id); if (!g.art && t.artKey && S.thumbs.get(t.artKey)) g.art = t; m.set(a, g); }
  return [...m.values()].sort((x, y) => (x.name === 'Noma\'lum ijrochi') - (y.name === 'Noma\'lum ijrochi') || y.ids.length - x.ids.length || x.name.localeCompare(y.name));
}
function groupAlbums() {
  const m = new Map();
  for (const id of S.order) { const t = S.tracks.get(id), k = albumKey(t); if (!k) continue; const g = m.get(k) || { key: k, name: t.album, artist: t.albumArtist || artistOf(t), year: t.year, ids: [], art: null }; g.ids.push(id); if (!g.art && t.artKey && S.thumbs.get(t.artKey)) g.art = t; m.set(k, g); }
  return [...m.values()].sort((x, y) => y.ids.length - x.ids.length || String(x.name).localeCompare(String(y.name)));
}
function libTabsHTML() {
  const b = (m, ic, l) => `<button class="lib-tab${S.libMode === m ? ' on' : ''}" data-act="lib-mode" data-mode="${m}">${icon(ic)}${l}</button>`;
  return `<div class="lib-tabs">${b('songs', 'note', 'Qo\'shiqlar')}${b('artists', 'user', 'Ijrochilar')}${b('albums', 'disc', 'Albomlar')}</div>`;
}
const q8 = () => S.query.trim().toLowerCase();
function artistsGridHTML() {
  const gs = groupArtists().filter(g => !q8() || g.name.toLowerCase().includes(q8()));
  return '<div class="grp-grid">' + gs.map((g, i) => { const t = g.art || S.tracks.get(g.ids[0]);
    return `<div class="grp-card ar${i < 18 ? '" style="--d:' + i : ''}" data-view="ar:${esc(encodeURIComponent(g.name))}"><div class="grp-art" style="background-image:url('${thumbFor(t)}')"></div><b>${esc(g.name)}</b><span>${g.ids.length} ta qo'shiq</span></div>`; }).join('') + '</div>';
}
function albumsGridHTML() {
  const gs = groupAlbums().filter(g => !q8() || `${g.name} ${g.artist}`.toLowerCase().includes(q8()));
  if (!gs.length) return '<div class="pl-empty">' + icon('disc') + '<b>Albomlar topilmadi</b><span>Qo\'shiqlaringizda albom nomi yozilmagan. Uni qo\'shiq menyusidagi «Nomi va rasmini o\'zgartirish» orqali qo\'shishingiz mumkin.</span></div>';
  return '<div class="grp-grid">' + gs.map((g, i) => { const t = g.art || S.tracks.get(g.ids[0]);
    return `<div class="grp-card al${i < 18 ? '" style="--d:' + i : ''}" data-view="al:${esc(encodeURIComponent(g.key))}"><div class="grp-art" style="background-image:url('${thumbFor(t)}')"></div><b>${esc(g.name)}</b><span>${esc(g.artist)}${g.year ? ' · ' + g.year : ''}</span></div>`; }).join('') + '</div>';
}
function grpHeadHTML(ids) {
  const isAr = S.view.startsWith('ar:'), t = ids.map(id => S.tracks.get(id)).find(x => x && x.artKey && S.thumbs.get(x.artKey)) || S.tracks.get(ids[0]);
  const total = ids.reduce((s, id) => s + (S.tracks.get(id).duration || 0), 0);
  const isMx = S.view.startsWith('mx:'), mx = isMx && MIX.get(S.view.slice(3));
  const name = viewTitle(S.view), sub = isMx ? esc(mx ? mx.sub : '') : isAr ? '' : esc(grpName(S.view).split('\u0001')[1] || '');
  return `<div class="pl-head grp-head${isAr ? ' ar' : ''}"><div class="pl-cover"${t ? ` style="background-image:url('${thumbFor(t)}')"` : ''}></div>` +
    `<div class="pl-info"><button class="grp-back" data-act="grp-back">${icon('back')}${S.backTo === 'home' ? 'Bosh sahifa' : 'Kutubxona'}</button><small>${isMx ? 'Siz uchun miks' : isAr ? 'Ijrochi' : 'Albom'}</small><h2>${esc(name)}</h2><span>${sub ? sub + ' · ' : ''}${ids.length} ta qo'shiq${total ? ' · ' + fmtTime(total) : ''}</span>` +
    `<div class="pl-acts"><button class="btn btn-primary sm" data-act="pl-play">${icon('play')}Ijro</button>` +
    `<button class="icon-btn" data-act="pl-shuffle" title="Aralash ijro">${icon('shuffle')}</button></div></div></div>`;
}

/* ---------- queue: drag the grip to reorder ---------- */
function initQueueDrag() {
  const list = $('#trackList');
  list.addEventListener('pointerdown', e => {
    const grip = e.target.closest('.queue-mode .row .num');
    if (!grip || e.button > 0) return;
    const row = grip.closest('.row'), rows = [...list.querySelectorAll('.row')];
    const from = rows.indexOf(row);
    if (from < 0) return;
    e.preventDefault();
    const h = row.getBoundingClientRect().height + 2, y0 = e.clientY, scroll0 = list.scrollTop;
    let to = from;
    row.classList.add('dragging'); list.classList.add('is-dragging');
    try { grip.setPointerCapture(e.pointerId); } catch { /* */ }
    const move = ev => {
      const dy = ev.clientY - y0 + (list.scrollTop - scroll0);
      row.style.transform = `translateY(${dy}px)`;
      to = Math.max(0, Math.min(rows.length - 1, from + Math.round(dy / h)));
      rows.forEach((r, i) => { if (r === row) return; const shift = (i > from && i <= to) ? -h : (i < from && i >= to) ? h : 0; r.style.transform = shift ? `translateY(${shift}px)` : ''; });
      const lr = list.getBoundingClientRect();     // keep scrolling near the edges
      if (ev.clientY < lr.top + 50) list.scrollTop -= 8; else if (ev.clientY > lr.bottom - 50) list.scrollTop += 8;
    };
    const up = () => {
      grip.removeEventListener('pointermove', move); grip.removeEventListener('pointerup', up); grip.removeEventListener('pointercancel', up);
      rows.forEach(r => { r.style.transform = ''; }); row.classList.remove('dragging'); list.classList.remove('is-dragging');
      if (to === from) return;
      const ids = S.queue.filter(id => S.tracks.has(id));
      const [moved] = ids.splice(from, 1); ids.splice(to, 0, moved);
      S.queue = ids; S.qIndex = Math.max(0, S.queue.indexOf(S.currentId));
      renderList(); renderNext(); persist();
      toast('Navbat tartibi o\'zgardi');
    };
    grip.addEventListener('pointermove', move); grip.addEventListener('pointerup', up); grip.addEventListener('pointercancel', up);
  });
}

/* ---------- share card: a story-sized picture of the song that is playing ---------- */
function wrapLines(g, text, maxW, maxLines) {
  const words = String(text).split(/\s+/), lines = []; let line = '';
  for (const w of words) { const test = line ? line + ' ' + w : w; if (g.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; }
  if (line) lines.push(line);
  if (lines.length > maxLines) { lines.length = maxLines; let l = lines[maxLines - 1]; while (g.measureText(l + '…').width > maxW && l.length) l = l.slice(0, -1); lines[maxLines - 1] = l + '…'; }
  return lines;
}
async function makeShareCard() {
  const t = cur(); if (!t) return null;
  const W = 1080, H = 1920, c = document.createElement('canvas'); c.width = W; c.height = H;
  const g = c.getContext('2d');
  try { await document.fonts.load('800 80px Manrope'); await document.fonts.load('600 40px Manrope'); } catch { /* */ }
  const cs = getComputedStyle(document.documentElement), C1 = cs.getPropertyValue('--c1').trim() || '#7a5cff', C2 = cs.getPropertyValue('--c2').trim() || '#ff4fa3', C3 = cs.getPropertyValue('--c3').trim() || '#19b4c9';
  const artSrc = fpArtEl.getAttribute('src') || ($('.p-art') && $('.p-art').getAttribute('src'));
  let art = null; try { art = await loadImage(artSrc); } catch { /* */ }
  g.fillStyle = '#07060d'; g.fillRect(0, 0, W, H);
  if (art) { g.save(); g.filter = 'blur(70px) saturate(1.5) brightness(.75)'; g.drawImage(art, -300, -200, W + 600, H + 400); g.restore(); }
  const glow = (x, y, r, col, a) => { const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, col); gr.addColorStop(1, 'transparent'); g.globalAlpha = a; g.fillStyle = gr; g.fillRect(0, 0, W, H); g.globalAlpha = 1; };
  g.globalCompositeOperation = 'screen'; glow(160, 240, 820, C1, .85); glow(980, 1000, 760, C2, .7); glow(380, 1760, 720, C3, .65); g.globalCompositeOperation = 'source-over';
  const shade = g.createLinearGradient(0, 0, 0, H); shade.addColorStop(0, 'rgba(0,0,0,.25)'); shade.addColorStop(.5, 'rgba(0,0,0,.05)'); shade.addColorStop(1, 'rgba(0,0,0,.7)'); g.fillStyle = shade; g.fillRect(0, 0, W, H);
  // cover with a deep shadow
  const S0 = 800, x0 = (W - S0) / 2, y0 = 300, rad = 56;
  const rr = (x, y, w, h, r) => { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); };
  g.save(); g.shadowColor = 'rgba(0,0,0,.65)'; g.shadowBlur = 90; g.shadowOffsetY = 40; rr(x0, y0, S0, S0, rad); g.fillStyle = '#111'; g.fill(); g.restore();
  g.save(); rr(x0, y0, S0, S0, rad); g.clip(); if (art) { const r = Math.max(S0 / art.naturalWidth, S0 / art.naturalHeight); g.drawImage(art, x0 + (S0 - art.naturalWidth * r) / 2, y0 + (S0 - art.naturalHeight * r) / 2, art.naturalWidth * r, art.naturalHeight * r); } g.restore();
  // title + artist
  g.fillStyle = '#fff'; g.textAlign = 'left'; g.font = '800 82px Manrope';
  const lines = wrapLines(g, t.title, W - 2 * x0, 2);
  let y = y0 + S0 + 140;
  for (const l of lines) { g.fillText(l, x0, y); y += 92; }
  g.font = '600 44px Manrope'; g.fillStyle = 'rgba(255,255,255,.8)';
  g.fillText(wrapLines(g, t.artist || 'Noma\'lum ijrochi', W - 2 * x0, 1)[0], x0, y + 6);
  // a waveform in the song's colours (seeded by its title so it stays the same)
  let seed = (parseInt(String(hashStr(t.title + (t.artist || ''))).replace(/[^0-9a-z]/gi, '').slice(0, 7), 36) % 2147483646) + 1; const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
  const wy = y + 120, bars = 56, bw = (W - 2 * x0) / bars;
  const wg = g.createLinearGradient(x0, 0, W - x0, 0); wg.addColorStop(0, C1); wg.addColorStop(.5, C2); wg.addColorStop(1, C3);
  g.fillStyle = wg;
  for (let i = 0; i < bars; i++) { const hgt = 12 + Math.pow(rnd(), 1.6) * 90 * (0.55 + 0.45 * Math.sin(i / bars * Math.PI)); rr(x0 + i * bw + 3, wy - hgt / 2, bw - 6, hgt, Math.min(6, (bw - 6) / 2)); g.fill(); }
  // brand
  try { const logo = await loadImage('img/logo.svg'); g.drawImage(logo, x0, H - 190, 84, 84); } catch { /* */ }
  g.fillStyle = '#fff'; g.font = '800 44px Manrope'; g.fillText('Navo', x0 + 108, H - 140);
  g.font = '600 32px Manrope'; g.fillStyle = 'rgba(255,255,255,.7)'; g.fillText('bilan tinglanmoqda', x0 + 108, H - 98);
  return c.toDataURL('image/png');
}
const NativeShare = NativeFolders;   // the folders plugin also saves / shares pictures on Android
async function openShareCard() {
  toast('Karta tayyorlanmoqda…', true);
  const url = await makeShareCard();
  hideToast(0);
  if (!url) return;
  $('#shareImg').src = url;
  $('#shareSend').classList.toggle('hidden', IS_DESKTOP);
  $('#shareModal').classList.remove('hidden');
}
function closeShare() { $('#shareModal').classList.add('hidden'); }
async function saveShare(send) {
  const url = $('#shareImg').src, t = cur(), name = `Navo - ${t ? t.title : 'qo\'shiq'}`;
  try {
    if (IS_DESKTOP) { const p = await NAVO.saveImage(url, name); if (p) { toast('Karta saqlandi ✓'); closeShare(); } return; }
    if (!NativeShare) { const a = document.createElement('a'); a.href = url; a.download = name + '.png'; a.click(); return; }
    if (send) await NativeShare.shareImage({ data: url.split(',')[1], name });
    else { await NativeShare.saveImage({ data: url.split(',')[1], name }); toast('Karta galereyaga saqlandi ✓'); closeShare(); }
  } catch (e) { console.warn(e); toast('Kartani saqlab bo\'lmadi'); }
}

/* ---------- home page ---------- */
const MIX = new Map();
function dayShuffle(arr, salt) {
  let seed = 0; const k = dayKey() + salt; for (let i = 0; i < k.length; i++) seed = (seed * 31 + k.charCodeAt(i)) % 2147483647;
  const rnd = () => ((seed = (seed * 16807 + 11) % 2147483647) / 2147483647);
  for (let i = arr.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [arr[i], arr[j]] = [arr[j], arr[i]]; }
  return arr;
}
function buildMixes() {
  MIX.clear();
  const T = id => S.tracks.get(id), all = S.order.slice();
  const add = (id, name, sub, ids, hue) => { if (ids.length >= 3) MIX.set(id, { id, name, sub, ids, hue }); };
  const byPlays = all.filter(id => (T(id).plays || 0) > 0).sort((a, b) => T(b).plays - T(a).plays);
  // one mix per favourite artist: their songs first, then the songs you play most
  groupArtists().filter(g => g.name !== 'Noma\'lum ijrochi').slice(0, 3).forEach((g, i) => {
    const extra = byPlays.filter(id => !g.ids.includes(id)).slice(0, 12);
    add('ar' + i, g.name + ' miksi', `${g.name} va siz ko'p tinglaganlar`, [...g.ids, ...extra].slice(0, 30), hueOf(g.name));
  });
  const favs = all.filter(id => T(id).fav);
  add('fav', 'Sevimlilar aralash', 'Yoqqan qo\'shiqlaringiz, har safar boshqacha', dayShuffle(favs.slice(), 'fav'), 330);
  const fresh = all.slice().sort((a, b) => (T(b).addedAt || 0) - (T(a).addedAt || 0)).slice(0, 25);
  add('new', 'Yangi to\'lqin', 'Kutubxonaga eng so\'nggi qo\'shilganlar', fresh, 190);
  const forgot = all.filter(id => !T(id).lastPlayed || Date.now() - T(id).lastPlayed > 10 * 864e5);
  add('lost', 'Unutilgan durdonalar', 'Anchadan beri eshitmagansiz', dayShuffle(forgot, 'lost').slice(0, 25), 40);
  add('deep', 'Chuqur sho\'ng\'ish', 'Butun kutubxona, aralash', dayShuffle(all.slice(), 'deep').slice(0, 40), 265);
}
function mosaic(ids) {
  const arts = []; for (const id of ids) { const t = S.tracks.get(id); if (!t) continue; const th = thumbFor(t); if (!arts.includes(th)) arts.push(th); if (arts.length === 4) break; }
  while (arts.length < 4 && arts.length) arts.push(arts[arts.length % Math.max(1, arts.length)]);
  return arts.map(a => `<i style="background-image:url('${a}')"></i>`).join('');
}
function homeHTML() {
  buildMixes();
  const T = id => S.tracks.get(id);
  // quick tiles: favourites, playlists, top, favourite artists, mixes — up to 8
  const tiles = [];
  const favIds = S.order.filter(id => T(id).fav);
  tiles.push({ v: 'favorites', name: 'Sevimlilar', art: `<span class="qt-fav">${icon('heart-fill')}</span>` });
  PL.list.slice(0, 3).forEach(p => tiles.push({ v: 'pl:' + p.id, name: p.name, art: mosaic(p.ids) }));
  if (S.order.some(id => (T(id).plays || 0) > 0)) tiles.push({ v: 'top', name: 'Top qo\'shiqlaringiz', art: `<span class="qt-top">${icon('flame')}</span>` });
  groupArtists().filter(g => g.name !== 'Noma\'lum ijrochi').slice(0, 3).forEach(g => tiles.push({ v: 'ar:' + encodeURIComponent(g.name), name: g.name, art: `<i class="one" style="background-image:url('${thumbFor(g.art || T(g.ids[0]))}')"></i>` }));
  [...MIX.values()].forEach(m => tiles.push({ v: 'mx:' + m.id, name: m.name, art: mosaic(m.ids) }));
  const qt = tiles.slice(0, 8).map((x, i) => `<div class="qt" data-view="${esc(x.v)}" style="--d:${i}"><div class="qt-art">${x.art}</div><b>${esc(x.name)}</b>` +
    `<button class="qt-play" data-act="play-group" data-target="${esc(x.v)}" title="Ijro">${icon('play')}</button></div>`).join('');
  const recentPlayed = S.order.filter(id => T(id).lastPlayed).sort((a, b) => T(b).lastPlayed - T(a).lastPlayed).slice(0, 14);
  const recentAdded = S.order.slice().sort((a, b) => (T(b).addedAt || 0) - (T(a).addedAt || 0)).slice(0, 14);
  carouselSets.again = recentPlayed; carouselSets.recent = recentAdded;
  const shelf = (key, title, sub, ids) => ids.length < 2 ? '' :
    `<section class="shelf"><div class="shelf-head"><div><h3>${title}</h3><small>${sub}</small></div>` +
    `<div class="shelf-nav"><button class="round-btn sm" data-shelf="${key}" data-dir="-1">${icon('prev')}</button><button class="round-btn sm" data-shelf="${key}" data-dir="1">${icon('next')}</button></div></div>` +
    `<div class="shelf-row" data-row="${key}">` + ids.map((id, i) => { const t = T(id);
      return `<div class="card" data-sec="${key}" data-i="${i}" data-cid="${esc(id)}"><div class="card-art" style="background-image:url('${thumbFor(t)}')"><span class="card-play">${icon('play')}</span></div>` +
        `<div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || 'Noma\'lum ijrochi')}</div></div>`; }).join('') + '</div></section>';
  const mixes = [...MIX.values()];
  const mixShelf = !mixes.length ? '' : `<section class="shelf"><div class="shelf-head"><div><h3>Siz uchun mikslar</h3><small>Kutubxonangizdan har kuni yangidan yig'iladi</small></div></div>` +
    `<div class="shelf-row mix-row">` + mixes.map(m => `<div class="mix-card" data-view="mx:${m.id}" style="--h:${m.hue}"><div class="mix-art">${mosaic(m.ids)}<span class="mix-name">${esc(m.name)}</span>` +
      `<button class="qt-play" data-act="play-group" data-target="mx:${m.id}" title="Ijro">${icon('play')}</button></div><div class="a">${esc(m.sub)}</div></div>`).join('') + '</div></section>';
  const arts = groupArtists().filter(g => g.name !== 'Noma\'lum ijrochi').slice(0, 12);
  const artShelf = arts.length < 2 ? '' : `<section class="shelf"><div class="shelf-head"><div><h3>Sevimli ijrochilaringiz</h3><small>Kutubxonangizdagi eng ko'p qo'shiqlar</small></div></div><div class="shelf-row art-row">` +
    arts.map(g => `<div class="art-card" data-view="ar:${esc(encodeURIComponent(g.name))}"><div class="art-av" style="background-image:url('${thumbFor(g.art || T(g.ids[0]))}')"></div><b>${esc(g.name)}</b><span>Ijrochi</span></div>`).join('') + '</div></section>';
  return nowCardHTML() + `<h2 class="home-greet">${greeting()}</h2><div class="qt-grid">${qt}</div>` + heroNowHTML() +
    shelf('again', 'Davom ettiring', 'Yaqinda tinglaganlaringiz', recentPlayed) + mixShelf + artShelf +
    shelf('recent', 'Yaqinda qo\'shilgan', 'Yangi qo\'shiqlaringiz', recentAdded) + plShelfHTML();
}
function renderAbout(t) {
  const box = $('#npAbout'); if (!box) return;
  const name = t && artistOf(t);
  if (!t || !name || name === 'Noma\'lum ijrochi') { box.innerHTML = ''; box.classList.add('hidden'); return; }
  const ids = S.order.filter(id => artistOf(S.tracks.get(id)) === name);
  const secs = ids.reduce((s, id) => s + (S.tracks.get(id).listened || 0), 0);
  const pic = ids.map(id => S.tracks.get(id)).find(x => x.artKey && S.thumbs.get(x.artKey)) || t;
  box.classList.remove('hidden');
  box.innerHTML = `<div class="ab-bg" style="background-image:url('${thumbFor(pic)}')"></div><div class="ab-in"><small>Ijrochi haqida</small><b>${esc(name)}</b>` +
    `<span>Kutubxonangizda ${ids.length} ta qo'shiq${secs > 30 ? ' · ' + fmtHours(secs) + ' tinglagansiz' : ''}</span>` +
    `<button class="btn btn-ghost sm" data-view="ar:${esc(encodeURIComponent(name))}">Barcha qo'shiqlari</button></div>`;
}

/* ---------- listening statistics ---------- */
function fmtHours(sec) {
  if (sec > 0 && sec < 60) return `${Math.max(1, Math.round(sec))} soniya`;
  const h = Math.floor(sec / 3600), m = Math.round((sec % 3600) / 60);
  return h ? `${h} soat ${m} daq` : `${m} daqiqa`;
}
function renderStats() {
  const box = $('#statsBox'); if (!box) return;
  const T = [...S.tracks.values()];
  const listened = T.reduce((s, t) => s + (t.listened || 0), 0), plays = T.reduce((s, t) => s + (t.plays || 0), 0);
  const libDur = T.reduce((s, t) => s + (t.duration || 0), 0);
  const byArtist = new Map();
  T.forEach(t => { const a = firstArtist(t.artist) || 'Noma\'lum ijrochi'; const o = byArtist.get(a) || { secs: 0, plays: 0, t }; o.secs += t.listened || 0; o.plays += t.plays || 0; byArtist.set(a, o); });
  const artists = [...byArtist.entries()].filter(([, o]) => o.secs > 0).sort((a, b) => b[1].secs - a[1].secs).slice(0, 5);
  const tracks = T.filter(t => t.plays > 0).sort((a, b) => (b.plays - a.plays) || ((b.listened || 0) - (a.listened || 0))).slice(0, 5);
  const days = [];
  for (let k = 6; k >= 0; k--) { const d = new Date(); d.setDate(d.getDate() - k); days.push({ d, s: DAILY.map[dayKey(d)] || 0 }); }
  const maxDay = Math.max(60, ...days.map(x => x.s));
  const week = days.reduce((s, x) => s + x.s, 0);
  const DN = ['Ya', 'Du', 'Se', 'Ch', 'Pa', 'Ju', 'Sh'];
  const tile = (v, l) => `<div class="st-tile"><b>${v}</b><span>${l}</span></div>`;
  box.innerHTML =
    `<div class="st-tiles">${tile(fmtHours(listened), 'jami tinglagansiz')}${tile(plays, 'marta tinglangan')}${tile(fmtHours(week), 'shu hafta')}${tile(S.order.length, 'qo\'shiq · ' + fmtHours(libDur))}</div>` +
    `<div class="st-card"><h3>Oxirgi 7 kun</h3><div class="st-bars">${days.map(x => `<div class="st-bar"><i style="height:${Math.max(3, Math.round(100 * x.s / maxDay))}%" title="${fmtHours(x.s)}"></i><span>${DN[x.d.getDay()]}</span></div>`).join('')}</div></div>` +
    `<div class="st-grid"><div class="st-card"><h3>Eng ko'p tinglangan ijrochilar</h3>${artists.length ? artists.map(([a, o], i) => `<div class="st-row"><em>${i + 1}</em>${thumbDiv(o.t)}<div class="meta"><div class="t">${esc(a)}</div><div class="a">${fmtHours(o.secs)} · ${o.plays} marta</div></div></div>`).join('') : '<p class="st-none">Qo\'shiq tinglang — statistikangiz shu yerda yig\'iladi.</p>'}</div>` +
    `<div class="st-card"><h3>Eng ko'p tinglangan qo'shiqlar</h3>${tracks.length ? tracks.map((t, i) => `<div class="st-row" data-play-id="${esc(t.id)}"><em>${i + 1}</em>${thumbDiv(t)}<div class="meta"><div class="t">${esc(t.title)}</div><div class="a">${esc(t.artist || 'Noma\'lum ijrochi')} · ${t.plays} marta</div></div></div>`).join('') : '<p class="st-none">Hali hech bir qo\'shiq 30 soniyadan ko\'p tinglanmagan.</p>'}</div></div>`;
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
    `<button data-m="pl">${icon('playlist')}Pleylistga qo'shish</button>` +
    (S.view.startsWith('pl:') ? `<button data-m="plrm">${icon('trash')}Pleylistdan olib tashlash</button>` : '') +
    `<button data-m="fav">${icon(t.fav ? 'heart-fill' : 'heart')}${t.fav ? 'Sevimlilardan olib tashlash' : 'Sevimlilarga qo\'shish'}</button>` +
    `<button data-m="artist">${icon('user')}Ijrochiga o'tish</button>` +
    (t.album ? `<button data-m="album">${icon('disc')}Albomga o'tish</button>` : '') +
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
    else if (a === 'pl') plPickFor([id], x, y);
    else if (a === 'plrm') plRemove(S.view.slice(3), id);
    else if (a === 'fav') toggleFav(id);
    else if (a === 'edit') openEdit(id);
    else if (a === 'artist') { closeFull(); setView('ar:' + encodeURIComponent(artistOf(t))); }
    else if (a === 'album') { closeFull(); setView('al:' + encodeURIComponent(albumKey(t))); }
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
    inner.innerHTML = ly.lines.map((l, i) => `<div class="ly-line${l.text ? '' : ' gap'}" data-i="${i}">${l.text ? esc(l.text) : '<span class="ly-rest">' + icon('note') + icon('note') + icon('note') + '</span>'}</div>`).join('');
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
  const label = sleepT.end ? String(Math.max(1, Math.ceil((sleepT.end - Date.now()) / 60000))) : '';
  $$('.sleep-btn').forEach(b => { b.classList.toggle('on', on); $('.badge', b).innerHTML = sleepT.eot ? icon('note') : label; });
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
const SORTS = [['added', "Yangi qo'shilgan"], ['title', 'Nomi bo\'yicha'], ['artist', 'Ijrochi bo\'yicha'], ['album', 'Albom bo\'yicha'], ['plays', 'Ko\'p tinglangan'], ['dur', 'Davomiyligi']];
// y > 0: menu opens below that point; y < 0: menu opens ABOVE the point -y
function showMenu(html, x, y, onPick) {
  closeMenu();
  const m = $('#menu');
  m.innerHTML = html;
  m.classList.remove('fx-menu');
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
/* ============================================================
   Signature motion: cover flight, card deal, aurora, sparks
   ============================================================ */
const REDUCED_MOTION = matchMedia('(prefers-reduced-motion: reduce)');
const motionOK = () => S.anim !== false && !miniOn;
const SPRING = 'cubic-bezier(.18, 1.25, .35, 1)', GLIDE = 'cubic-bezier(.65, 0, .25, 1)';
const auroraEl = $('#fpAurora'), bdAurEl = $('#bdAur');
function applyAnim() {
  document.documentElement.classList.toggle('no-anim', S.anim === false);
  const cb = $('#animOn'); if (cb) cb.checked = S.anim !== false;
}
let dealDir = 1;
function coverSource() {
  for (const sel of ['.m-now .bass-art', '#player .p-art', '.side-now img']) {
    const el = $(sel);
    if (!el || !el.offsetParent) continue;
    const r = el.getBoundingClientRect();
    if (r.width > 8 && r.bottom > 0 && r.top < innerHeight) return el;
  }
  return null;
}
function flyCover(fromEl, toEl, kind) {
  const a = fromEl.getBoundingClientRect(), b = toEl.getBoundingClientRect();
  if (!a.width || !b.width || !toEl.offsetParent) return;
  const src = (kind === 'open' ? toEl : fromEl).getAttribute('src') || fromEl.getAttribute('src');
  if (!src) return;
  const ghost = document.createElement('img');
  ghost.className = 'fly-cover'; ghost.src = src;
  Object.assign(ghost.style, { left: b.left + 'px', top: b.top + 'px', width: b.width + 'px', height: b.height + 'px' });
  document.body.appendChild(ghost);
  const s = a.width / b.width, dx = a.left - b.left, dy = a.top - b.top;
  const rA = parseFloat(getComputedStyle(fromEl).borderRadius) || 12, rB = parseFloat(getComputedStyle(toEl).borderRadius) || 24;
  const hide = kind === 'open' ? toEl : toEl;
  hide.style.visibility = 'hidden';
  const open = kind === 'open';
  const anim = ghost.animate([
    { transform: `translate(${dx}px, ${dy}px) scale(${s})`, borderRadius: `${rA / s}px`, boxShadow: '0 6px 16px -8px rgba(0,0,0,.6)' },
    { transform: 'none', borderRadius: `${rB}px`, boxShadow: open ? '0 40px 90px -30px rgba(0,0,0,.85)' : '0 6px 16px -8px rgba(0,0,0,.6)' },
  ], { duration: open ? 640 : 480, easing: open ? SPRING : GLIDE, fill: 'both' });
  const done = () => { hide.style.visibility = ''; ghost.remove(); };
  anim.onfinish = done; anim.oncancel = done;
  setTimeout(done, 1200);
}
function dealCover(newSrc) {
  if (!motionOK()) return;
  const fp = $('#fullPlayer');
  const old = fpArtEl.getAttribute('src');
  if (fp.classList.contains('open') && !fp.classList.contains('ly-on') && old && old !== newSrc && fpArtEl.offsetParent) {
    const r = fpArtEl.getBoundingClientRect();
    const ghost = document.createElement('img');
    ghost.className = 'fly-cover deal'; ghost.src = old;
    Object.assign(ghost.style, { left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: getComputedStyle(fpArtEl).borderRadius });
    document.body.appendChild(ghost);
    const d = dealDir;
    ghost.animate([
      { transform: 'none', opacity: 1, filter: 'brightness(1)' },
      { transform: `translateX(${-d * 58}%) translateY(6%) rotate(${-d * 14}deg) scale(.8)`, opacity: 0, filter: 'brightness(.6)' },
    ], { duration: 560, easing: GLIDE, fill: 'both' }).onfinish = () => ghost.remove();
    fpArtEl.animate([
      { transform: `translateX(${d * 42}%) rotate(${d * 9}deg) scale(.86)`, opacity: 0 },
      { transform: 'none', opacity: 1 },
    ], { duration: 720, delay: 90, easing: SPRING, fill: 'backwards' });
    const tt = $('#fullPlayer .fp-tt');
    if (tt) tt.animate([{ transform: `translateX(${d * 26}px)`, opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 520, delay: 140, easing: SPRING, fill: 'backwards' });
  }
  // small covers: a soft pop
  for (const el of $$('#player .p-art, .side-now img, .m-now .bass-art')) {
    if (el.offsetParent) el.animate([{ transform: 'scale(.82)', opacity: .2 }, { transform: 'none', opacity: 1 }], { duration: 480, easing: SPRING });
  }
  setTimeout(fitTitle, 60);
}
/* long titles in the full player glide back and forth instead of being cut */
function fitTitle() {
  const h = $('#fullPlayer .fp-tt .cur-title');
  if (!h) return;
  h.classList.remove('glide'); h.style.removeProperty('--shift');
  requestAnimationFrame(() => {
    const over = h.scrollWidth - h.clientWidth;
    if (over > 6 && motionOK()) { h.style.setProperty('--shift', `-${over + 8}px`); h.style.setProperty('--glide-t', `${Math.max(6, over / 18)}s`); h.classList.add('glide'); }
  });
}
function sparkAt(x, y, n = 14, hues) {
  const layer = $('#sparkLayer');
  if (!layer) return;
  const cs = getComputedStyle(document.documentElement);
  const cols = hues || [cs.getPropertyValue('--accent'), cs.getPropertyValue('--c1'), cs.getPropertyValue('--c2'), '#fff'];
  for (let k = 0; k < n; k++) {
    const p = document.createElement('i');
    const ang = (k / n) * Math.PI * 2 + Math.random() * 0.5, dist = 34 + Math.random() * 46, size = 4 + Math.random() * 6;
    Object.assign(p.style, { left: x + 'px', top: y + 'px', width: size + 'px', height: size + 'px', background: cols[k % cols.length] });
    layer.appendChild(p);
    p.animate([
      { transform: 'translate(-50%, -50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(ang) * dist}px), calc(-50% + ${Math.sin(ang) * dist}px)) scale(0)`, opacity: 0 },
    ], { duration: 620 + Math.random() * 300, easing: 'cubic-bezier(.1, .8, .3, 1)' }).onfinish = () => p.remove();
  }
}
function heartBurst(id) {
  if (!motionOK()) return;
  const btns = [...$$('.fav-btn, .row[data-id="' + CSS.escape(id) + '"] .fav')].filter(b => b.offsetParent);
  for (const b of btns) {
    const r = b.getBoundingClientRect();
    if (!r.width) continue;
    sparkAt(r.left + r.width / 2, r.top + r.height / 2, 12, ['#ff5c8a', '#ff8fb1', '#ffd1e0', getComputedStyle(document.documentElement).getPropertyValue('--accent')]);
    b.animate([{ transform: 'scale(1)' }, { transform: 'scale(1.45)' }, { transform: 'scale(.92)' }, { transform: 'scale(1)' }], { duration: 520, easing: 'ease-out' });
  }
}
function ripple(btn) {
  const r = btn.getBoundingClientRect(), layer = $('#sparkLayer');
  if (!layer || !r.width) return;
  const o = document.createElement('b');
  o.className = 'ripple';
  Object.assign(o.style, { left: r.left + r.width / 2 + 'px', top: r.top + r.height / 2 + 'px', width: r.width + 'px', height: r.height + 'px' });
  layer.appendChild(o);
  o.animate([{ transform: 'translate(-50%, -50%) scale(1)', opacity: .55 }, { transform: 'translate(-50%, -50%) scale(2.1)', opacity: 0 }], { duration: 650, easing: 'cubic-bezier(.2, .7, .3, 1)' }).onfinish = () => o.remove();
}
window.addEventListener('resize', () => { if ($('#fullPlayer').classList.contains('open')) fitTitle(); });

/* covers lean toward the cursor, with a light sheen that follows it (desktop, animations on) */
const TILT_SEL = '.card-art, .grp-art, .mix-art, .art-av, .pl-cover, .qt-art';
let tiltEl = null, tiltRaf = 0, tiltEv = null;
function tiltReset(el) { if (!el) return; el.classList.remove('tilting'); el.style.transform = ''; el.style.removeProperty('--gx'); el.style.removeProperty('--gy'); }
document.addEventListener('pointermove', e => {
  if (!IS_DESKTOP || S.anim === false || e.pointerType !== 'mouse') return;
  tiltEv = e;
  if (tiltRaf) return;
  tiltRaf = requestAnimationFrame(() => {
    tiltRaf = 0;
    const ev = tiltEv, el = ev.target.closest && ev.target.closest(TILT_SEL);
    if (el !== tiltEl) { tiltReset(tiltEl); tiltEl = el; }
    if (!el) return;
    const r = el.getBoundingClientRect(), x = (ev.clientX - r.left) / r.width, y = (ev.clientY - r.top) / r.height;
    const max = el.classList.contains('qt-art') ? 8 : 13;
    el.classList.add('tilting');
    el.style.transform = `perspective(700px) rotateX(${((0.5 - y) * max).toFixed(2)}deg) rotateY(${((x - 0.5) * max).toFixed(2)}deg) scale(1.035)`;
    el.style.setProperty('--gx', (x * 100).toFixed(1) + '%'); el.style.setProperty('--gy', (y * 100).toFixed(1) + '%');
  });
}, { passive: true });
document.addEventListener('pointerleave', () => { tiltReset(tiltEl); tiltEl = null; });

function openFull() {
  if (!S.currentId) return;
  if (miniOn) { setMini(false); return; }
  const fp = $('#fullPlayer');
  clearTimeout(fullHideTimer);
  if (!fp.classList.contains('shown')) { fp.classList.add('shown'); void fp.offsetWidth; }   // reflow so the slide-in still plays
  const from = motionOK() ? coverSource() : null;
  fp.classList.add('open');
  if (from) flyCover(from, fpArtEl, 'open');
  fitTitle();
  $('#fullPlayer').setAttribute('aria-hidden', 'false');
  startLoop();
}
function closeFull() {
  const fp = $('#fullPlayer');
  if (!fp.classList.contains('open')) return;
  if (motionOK() && !fp.classList.contains('ly-on')) { const to = coverSource(); if (to) flyCover(fpArtEl, to, 'close'); }
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

/* ---------- phone: ask to be exempt from battery optimisation ----------
   With the screen off many phones (Xiaomi, Samsung, Tecno…) throttle apps that are not
   exempt, even ones playing music; the sound then stutters. One system dialog fixes it. */
const BATT = { exempt: true, maker: '' };
const TIP_MI = "Xiaomi / Redmi / POCO: Sozlamalar → Ilovalar → Navo → Batareya tejash → «Cheklovsiz».";
const TIP_HW = "Huawei / Honor: Sozlamalar → Batareya → Ilovalarni ishga tushirish → Navo → qo'lda boshqarish.";
const TIP_OP = "OPPO / realme / OnePlus: Sozlamalar → Batareya → Navo → «Fonda ishlashga ruxsat».";
const TIP_TC = "Tecno / Infinix: Sozlamalar → Batareya → Navo → «Cheklamaslik».";
const MAKER_TIPS = {
  xiaomi: TIP_MI, redmi: TIP_MI, poco: TIP_MI,
  samsung: "Samsung: Sozlamalar → Ilovalar → Navo → Batareya → «Cheklanmagan».",
  huawei: TIP_HW, honor: TIP_HW, oppo: TIP_OP, realme: TIP_OP, oneplus: TIP_OP,
  vivo: "vivo: Sozlamalar → Batareya → Fonda yuqori quvvat sarfi → Navo'ni yoqing.",
  tecno: TIP_TC, infinix: TIP_TC,
};
const makerTip = () => MAKER_TIPS[String(BATT.maker || '').toLowerCase().split(/\s/)[0]] || '';
async function battRefresh() {
  if (!NativeMedia || !NativeMedia.batteryStatus) return;
  try { Object.assign(BATT, await NativeMedia.batteryStatus()); } catch { return; }
  const st = $('#battState'), b = $('#battAsk');
  if (st) st.textContent = BATT.exempt
    ? 'Yoqilgan ✓ Navo ekran o\'chganda ham to\'liq tezlikda ishlaydi.' + (makerTip() ? ' Baribir uzilsa: ' + makerTip() : '')
    : 'O\'chiq — telefon Navo\'ni sekinlashtirishi mumkin, ovoz qotib chiqadi. Ruxsat bering.';
  if (b) b.classList.toggle('hidden', BATT.exempt);
  const c = $('#battCard'); if (c) c.classList.toggle('ok', BATT.exempt);
}
function battAsk() { $('#battModal').classList.add('hidden'); if (NativeMedia && NativeMedia.batteryAsk) NativeMedia.batteryAsk().catch(() => {}); }
function battMaybePrompt() {
  if (!NativeMedia || BATT.exempt) return;
  let asked = 0; try { asked = +localStorage.getItem('navo.battAsked') || 0; } catch { /* */ }
  if (asked >= 2) return;                                   // asked twice: the Settings card stays for later
  try { localStorage.setItem('navo.battAsked', String(asked + 1)); } catch { /* */ }
  $('#battMaker').textContent = makerTip() ? 'Agar keyin ham uzilsa: ' + makerTip() : '';
  $('#battModal').classList.remove('hidden');
}
if (NativeMedia) {
  document.addEventListener('visibilitychange', () => { if (!document.hidden) battRefresh(); });
  setTimeout(battRefresh, 1500);
  let battPrompted = false;
  audio.addEventListener('playing', () => { if (!battPrompted) { battPrompted = true; setTimeout(async () => { await battRefresh(); battMaybePrompt(); }, 2500); } });
}

/* ---------- settings: section tabs that follow the scroll ---------- */
function setGroup(id, smooth = true) {
  const box = $('#setScroll'), g = $('#' + id);
  if (!box || !g) return;
  box.scrollTo({ top: Math.max(0, g.offsetTop - box.offsetTop - 4), behavior: smooth && motionOK() ? 'smooth' : 'auto' });
  markGroup(id);
}
function markGroup(id) {
  $$('#setTabs [data-sg]').forEach(b => b.classList.toggle('on', b.dataset.sg === id));
  const on = $(`#setTabs [data-sg="${id}"]`);
  if (on && on.scrollIntoView) { const nav = $('#setTabs'); nav.scrollTo({ left: on.offsetLeft - nav.clientWidth / 2 + on.offsetWidth / 2, behavior: 'smooth' }); }
}
function initSetTabs() {
  $('#setTabs').addEventListener('click', e => { const b = e.target.closest('[data-sg]'); if (b) setGroup(b.dataset.sg); });
  const box = $('#setScroll');
  let raf = 0;
  box.addEventListener('scroll', () => {
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      const y = box.scrollTop + 80, groups = $$('.set-group', box);
      let cur = groups[0];
      for (const g of groups) if (g.offsetTop - box.offsetTop <= y) cur = g;
      if (box.scrollTop + box.clientHeight >= box.scrollHeight - 4) cur = groups[groups.length - 1];
      if (cur && !$(`#setTabs [data-sg="${cur.id}"]`).classList.contains('on')) markGroup(cur.id);
    });
  }, { passive: true });
}

/* ---------- backup: everything you made in Navo, in one small file (not the music itself) ---------- */
const BACKUP_KEYS = ['navo.state', 'navo.playlists', 'navo.daily', 'navo.watch'];
async function makeBackup() {
  const tracks = S.order.map(id => S.tracks.get(id)).filter(Boolean).map(t => ({
    id: t.id, file: t.path ? baseName(t.path) : (t.name || ''), title: t.title, artist: t.artist, album: t.album,
    fav: !!t.fav, plays: t.plays || 0, listened: Math.round(t.listened || 0), lastPlayed: t.lastPlayed || 0, loud: t.loud,
  }));
  const lyrics = {};
  try { for (const k of await DB.allKeys('lyrics')) { const v = await DB.get('lyrics', k); if (v && v.src === 'Siz') lyrics[k] = v; } } catch { /* */ }
  const ls = {};
  for (const k of BACKUP_KEYS) { try { const v = localStorage.getItem(k); if (v != null) ls[k] = v; } catch { /* */ } }
  const data = { app: 'Navo', kind: 'backup', v: 1, ver: await getAppVersion(), at: new Date().toISOString(), tracks, lyrics, ls };
  const text = JSON.stringify(data);
  const name = `Navo-zaxira-${dayKey()}.json`;
  try {
    if (IS_DESKTOP && NAVO.saveFile) { const r = await NAVO.saveFile(name, text); if (r) toast('Zaxira nusxa saqlandi ✓'); return; }
    if (NativeFolders && NativeFolders.shareFile) {
      await NativeFolders.shareFile({ data: btoa(unescape(encodeURIComponent(text))), name, mime: 'application/json' });
      toast('Faylni Yuklanmalar yoki Drive\'ga saqlang ✓');
      return;
    }
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' })); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    toast('Zaxira nusxa saqlandi ✓');
  } catch (e) { console.warn(e); toast('Zaxira nusxani saqlab bo\'lmadi'); }
}
async function loadBackup(file) {
  let d;
  try { d = JSON.parse(await file.text()); } catch { toast('Bu fayl Navo zaxira nusxasi emas'); return; }
  if (!d || d.kind !== 'backup' || !Array.isArray(d.tracks)) { toast('Bu fayl Navo zaxira nusxasi emas'); return; }
  // songs are matched by their id (file name + size + date), then by file name, then by title + artist
  const byFile = new Map(), byTa = new Map();
  for (const id of S.order) {
    const t = S.tracks.get(id);
    const f = t.path ? baseName(t.path) : (t.name || '');
    if (f) byFile.set(f.toLowerCase(), t);
    byTa.set(`${t.title}|${t.artist}`.toLowerCase(), t);
  }
  const idMap = new Map();
  let hit = 0;
  for (const b of d.tracks) {
    const t = S.tracks.get(b.id) || (b.file && byFile.get(String(b.file).toLowerCase())) || byTa.get(`${b.title}|${b.artist}`.toLowerCase());
    if (!t) continue;
    hit++; idMap.set(b.id, t.id);
    if (b.title) t.title = b.title;
    if (typeof b.artist === 'string') t.artist = b.artist;
    if (typeof b.album === 'string') t.album = b.album;
    t.fav = t.fav || !!b.fav;
    t.plays = Math.max(t.plays || 0, b.plays || 0);
    t.listened = Math.max(t.listened || 0, b.listened || 0);
    t.lastPlayed = Math.max(t.lastPlayed || 0, b.lastPlayed || 0) || undefined;
    if (typeof b.loud === 'number' && typeof t.loud !== 'number') t.loud = b.loud;
    try { await DB.put('tracks', stripTrack(t)); } catch { /* */ }
  }
  for (const [k, v] of Object.entries(d.lyrics || {})) { const id = idMap.get(k) || k; if (S.tracks.has(id)) { try { await DB.put('lyrics', v, id); } catch { /* */ } } }
  const ls = d.ls || {};
  try {
    if (ls['navo.playlists']) {
      const incoming = JSON.parse(ls['navo.playlists']) || [];
      for (const p of incoming) {
        if (!p || !p.id || !Array.isArray(p.ids)) continue;
        const ids = [...new Set(p.ids.map(id => idMap.get(id) || id))];
        const have = PL.list.find(x => x.id === p.id);
        if (have) have.ids = [...new Set([...have.ids, ...ids])]; else PL.list.push({ ...p, ids });
      }
      localStorage.setItem('navo.playlists', JSON.stringify(PL.list));
    }
    if (ls['navo.daily']) {
      const inc = JSON.parse(ls['navo.daily']) || {};
      for (const [k, v] of Object.entries(inc)) DAILY.map[k] = Math.max(DAILY.map[k] || 0, +v || 0);
      localStorage.setItem('navo.daily', JSON.stringify(DAILY.map));
    }
    if (ls['navo.state']) {
      const st = JSON.parse(ls['navo.state']) || {};
      // settings only; the queue and position stay as they are on this device
      for (const k of ['queue', 'qIndex', 'unshuffled', 'currentId', 'lastTime', 'source', 'compact']) delete st[k];
      const mine = JSON.parse(localStorage.getItem('navo.state') || '{}');
      localStorage.setItem('navo.state', JSON.stringify({ ...mine, ...st }));
    }
  } catch (e) { console.warn(e); }
  toast(`Tiklandi: ${hit} ta qo'shiq, ${PL.list.length} ta pleylist ✓`, true);
  setTimeout(() => location.reload(), 1600);
}

/* ============================================================
   Events
   ============================================================ */
function bind() {
  document.addEventListener('click', e => {
    const viewBtn = e.target.closest('[data-view]'), actIn = e.target.closest('[data-act]');
    if (viewBtn && !(actIn && viewBtn.contains(actIn))) { setView(viewBtn.dataset.view); return; }
    const go = e.target.closest('[data-view-go]');
    if (go) { closeFull(); setView(go.dataset.viewGo); if (go.dataset.sg) setGroup(go.dataset.sg, false); return; }
    const actEl = e.target.closest('[data-act]');
    if (!actEl) return;
    const act = actEl.dataset.act;
    if (act === 'toggle' && motionOK()) ripple(actEl);
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
      case 'add-menu': { const r = actEl.getBoundingClientRect();
        showMenu('<div class="menu-title">Musiqa qo\'shish</div>' +
          `<button data-m="files">${icon('plus')}Fayllarni tanlash</button>` +
          `<button data-m="folder">${icon('folder')}Papka ulash — yangilari o'zi qo'shiladi</button>`,
          Math.max(12, r.right - 270), r.bottom + 8, m => (m === 'folder' ? addWatchFolder() : addFiles()));
        break; }
      case 'pl-new': plCreate(); break;
      case 'lib-mode': S.libMode = actEl.dataset.mode; renderList(); $('#trackList').scrollTop = 0; break;
      case 'grp-back': setView(S.backTo || 'library'); break;
      case 'play-group': { e.stopPropagation(); const ids = idsForView(actEl.dataset.target); if (ids.length) { if (S.shuffle) toggleShuffle(); playList(ids, 0, viewTitle(actEl.dataset.target)); } break; }
      case 'side-filter': S.sideFilter = actEl.dataset.f; renderPlSide(); break;
      case 'side-add': { const r = actEl.getBoundingClientRect();
        showMenu('<div class="menu-title">Yaratish yoki qo\'shish</div>' +
          `<button data-m="pl">${icon('playlist')}Yangi pleylist</button><button data-m="files">${icon('plus')}Fayllar qo'shish</button>` +
          (IS_DESKTOP ? `<button data-m="folder">${icon('folder')}Papka qo'shish</button>` : '') +
          `<button data-m="watch">${icon('folder')}Papka ulash — yangilari o'zi qo'shiladi</button>`,
          r.left, r.bottom + 8, m => (m === 'pl' ? plCreate() : m === 'files' ? addFiles() : m === 'folder' ? addFolder() : addWatchFolder()));
        break; }
      case 'share-card': openShareCard(); break;
      case 'pl-play': if (S.visible.length) { if (S.shuffle) toggleShuffle(); playList(S.visible, 0); } break;
      case 'pl-shuffle': if (S.visible.length) { if (!S.shuffle) { S.shuffle = true; syncModes(); } playList(S.visible, Math.floor(Math.random() * S.visible.length)); } break;
      case 'pl-rename': plRename(S.view.slice(3)); break;
      case 'pl-delete': plDelete(S.view.slice(3)); break;
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
    const card = e.target.closest('.card[data-sec]');
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
  initQueueDrag();
  $('#shareClose').addEventListener('click', closeShare);
  $('#shareSave').addEventListener('click', () => saveShare(false));
  $('#shareSend').addEventListener('click', () => saveShare(true));
  $('#shareModal').addEventListener('pointerdown', e => { if (e.target.id === 'shareModal') closeShare(); });
  applyAnim();
  $('#animOn').addEventListener('change', e => { S.anim = e.target.checked; applyAnim(); persist(); toast(S.anim ? 'Animatsiyalar yoqildi ✨' : 'Animatsiyalar o\'chirildi'); });
  $('#normOn').checked = S.norm;
  $('#normOn').addEventListener('change', e => { S.norm = e.target.checked; applyNorm(cur(), 0.6); persist(); toast(S.norm ? 'Ovoz tenglashtirish yoqildi ✓' : 'Ovoz tenglashtirish o\'chirildi'); });
  initSetTabs();
  if (!NativeMedia) $('#battCard').remove();      // only the Android app has this setting
  else $('#battAsk').addEventListener('click', battAsk);
  $('#battGo').addEventListener('click', battAsk);
  $('#battLater').addEventListener('click', () => $('#battModal').classList.add('hidden'));
  $('#battModal').addEventListener('pointerdown', e => { if (e.target.id === 'battModal') $('#battModal').classList.add('hidden'); });
  $('#backupMake').addEventListener('click', makeBackup);
  $('#backupLoad').addEventListener('click', () => { const i = $('#backupInput'); i.value = ''; i.click(); });
  $('#backupInput').addEventListener('change', e => { const f = e.target.files && e.target.files[0]; if (f) loadBackup(f); });
  const syncFade = () => { const r = $('#fadeSecs'); r.value = S.fade; setFill(r); $('#fadeOut').textContent = S.fade ? S.fade + ' s' : "O'chiq"; };
  syncFade();
  $('#fadeSecs').addEventListener('input', e => { S.fade = +e.target.value; syncFade(); if (!S.fade) fadeTo(1, 0.2); persist(); });
  $('#statsBox').addEventListener('click', e => {
    const r = e.target.closest('[data-play-id]'); if (!r) return;
    const ids = [...$('#statsBox').querySelectorAll('[data-play-id]')].map(x => x.dataset.playId);
    playList(ids, Math.max(0, ids.indexOf(r.dataset.playId)), 'Statistika');
  });
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
  $('#search').addEventListener('input', e => { clearTimeout(st); st = setTimeout(() => { S.query = e.target.value; if (S.view === 'home' && S.query.trim()) setView('library'); else renderList(); }, 120); });

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
  const pickArt = () => { const i = $('#artInput'); i.value = ''; i.click(); };
  $('#editPickArt').addEventListener('click', pickArt);
  $('#editCam').addEventListener('click', pickArt);
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
    else if ((e.key.toLowerCase() === 'f' || e.key.toLowerCase() === 'k') && (e.ctrlKey || e.metaKey)) { e.preventDefault(); if (['eq', 'stats'].includes(S.view)) setView('library'); $('#search').focus(); $('#search').select(); }
    else if (e.key.toLowerCase() === 'b' && (e.ctrlKey || e.metaKey) && IS_DESKTOP) { e.preventDefault(); setCompact(!S.compact); }
    else if (e.key.toLowerCase() === 'm' && (e.ctrlKey || e.metaKey) && e.shiftKey && IS_DESKTOP) { e.preventDefault(); setMini(!miniOn); }
    else if (e.key === '?' && IS_DESKTOP) { $('#keysModal').classList.contains('hidden') ? openKeys() : closeKeys(); }
    else if (e.key === 'Escape') { if (!$('#shareModal').classList.contains('hidden')) closeShare(); else if (!$('#plModal').classList.contains('hidden')) $('#plCancel').click(); else if (!$('#editModal').classList.contains('hidden')) closeEdit(); else if (!$('#keysModal').classList.contains('hidden')) closeKeys(); else if (!$('#newsModal').classList.contains('hidden')) $('#newsModal').classList.add('hidden'); else if (miniOn) setMini(false); else { closeMenu(); closeFull(); } }
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
      if (!$('#shareModal').classList.contains('hidden')) closeShare();
      else if (!$('#plModal').classList.contains('hidden')) { if (plAsk.cancel) plAsk.cancel(); }
      else if (!$('#lyModal').classList.contains('hidden')) closeLyEdit();
      else if (!$('#newsModal').classList.contains('hidden')) $('#newsModal').classList.add('hidden');
      else if (!$('#updateCard').classList.contains('hidden')) $('#updateCard').classList.add('hidden');
      else if (!$('#editModal').classList.contains('hidden')) closeEdit();
      else if (!$('#menu').classList.contains('hidden')) closeMenu();
      else if ($('#fullPlayer').classList.contains('open')) closeFull();
      else if (S.view !== 'home') setView(S.view.startsWith('ar:') || S.view.startsWith('al:') || S.view.startsWith('mx:') ? (S.backTo || 'home') : 'home');
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
  setView('home');

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
  initWatch();
  // find pictures for songs that were added without one
  setTimeout(() => S.order.forEach(queueCover), 1500);
  // intro: let the logo animation play briefly, then reveal the app
  moveTabPill();
  const sp = $('#splash');
  if (sp) {
    // leave once the logo has drawn itself and its rings have sounded (or at once with reduced motion)
    let gone = false;
    const leave = () => {
      if (gone) return; gone = true;
      sp.classList.add('out');
        setTimeout(() => sp.remove(), 800);
    };
    const ring = $('.sp-ring.r2', sp);
    const running = ring && ring.getAnimations().length && S.anim !== false;
    if (!running) leave();
    else { ring.addEventListener('animationend', () => setTimeout(leave, 220), { once: true }); setTimeout(leave, 2600); }
  }

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
if (IS_DESKTOP && NAVO.devTest) window.__navo = { makeAlgoReverb, makeImpulse, makeHallImpulse, showUpdateCard, setMini, coverCandidates, fetchLyrics, findCoverOnline, openEdit, closeEdit, loadIndex, openFull, toggleLyrics, openLyEdit, S, setFxPreset, toast, W, syncWatch, renderWatch, saveWatch, audioDbg: () => ({ algo: !!algoRev, raw: loudAn ? (loudAn.getFloatTimeDomainData(loudBuf), +(10 * Math.log10(loudBuf.reduce((s, x) => s + x * x, 0) / loudBuf.length + 1e-12)).toFixed(1)) : null, ng: normGain ? +normGain.gain.value.toFixed(3) : null, fade: fadeGain ? fadeGain.gain.value : null, outClip, lite: LITE_AUDIO, wetOn, red: limiter ? limiter.reduction : null, state: actx && actx.state, an: analyser }) };
boot().then(() => showNewsIfUpdated()).catch(() => {});
})();
