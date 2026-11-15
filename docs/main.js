(() => {
  const REL = 'https://github.com/Javohir877/navo/releases/latest/download/';
  const $ = s => document.querySelector(s);

  // Pick the right main download for the visitor's device
  const ua = navigator.userAgent || '';
  if (/Android/i.test(ua)) {
    $('#mainDl').href = REL + 'Navo.apk';
    $('#mainDlLabel').textContent = 'Android uchun yuklab olish';
    $('#mainDlSub').textContent = 'APK · Android 6+ · 3 MB';
    $('#mainDl svg').innerHTML = $('#altDl svg').innerHTML;
    $('#altDl').href = REL + 'Navo-Setup.exe';
    $('#altDlLabel').textContent = 'Windows';
    $('#altDlSub').textContent = 'Kompyuter uchun · 83 MB';
    $('#altDl svg').innerHTML = '<path d="M3 5.5 10.5 4.5v7H3zM11.5 4.3 21 3v8.5h-9.5zM3 12.5h7.5v7L3 18.5zM11.5 12.5H21V21l-9.5-1.3z"/>';
  } else if (/Linux/i.test(ua) && !/Android/i.test(ua)) {
    $('#mainDl').href = REL + 'Navo.AppImage';
    $('#mainDlLabel').textContent = 'Linux uchun yuklab olish';
    $('#mainDlSub').textContent = 'AppImage · 64-bit';
  } else if (/iPhone|iPad|Macintosh/i.test(ua)) {
    $('#mainDlSub').textContent = 'macOS va iOS versiyasi tez orada';
  }

  // Feature icons (inline SVG)
  const I = {
    bolt: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    head: '<path d="M3 18v-6a9 9 0 0 1 18 0v6"/><path d="M21 19a2 2 0 0 1-2 2h-1v-6h3zM3 19a2 2 0 0 0 2 2h1v-6H3z"/>',
    spin: '<path d="M21 12a9 9 0 1 1-3-6.7"/><path d="M21 4v5h-5"/>',
    mic: '<rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 11a7 7 0 0 0 14 0M12 18v4"/>',
    disc: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/>',
    image: '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="9" cy="9" r="2"/><path d="m21 15-5-5L5 21"/>',
    flame: '<path d="M12 22c4 0 7-2.8 7-6.8 0-3.3-2.1-5.6-3.6-7.2-.4 2-1.4 3.3-2.6 3.8.3-3.4-1.3-6.6-4.3-8.8.2 3.1-1.3 5.2-2.8 7C4.4 11.6 5 13 5 15.2 5 19.2 8 22 12 22z"/>',
    eq: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
  };
  const order = ['bolt', 'head', 'spin', 'mic', 'disc', 'image', 'flame', 'eq', 'moon'];
  document.querySelectorAll('.card .ico').forEach((el, i) => {
    el.innerHTML = `<svg viewBox="0 0 24 24">${I[order[i]] || I.bolt}</svg>`;
  });

  // Format marquee (duplicated for a seamless loop)
  const fm = ['MP3', 'FLAC', 'WAV', 'M4A', 'AAC', 'OGG', 'OPUS', 'WMA', 'APE', 'AIFF', 'ALAC', 'DSD', 'WavPack', 'AC3', 'MKA', 'AMR'];
  $('#fmtTrack').innerHTML = [...fm, ...fm].map(f => `<span>${f}</span>`).join('');

  // Latest version number from GitHub (best effort)
  fetch('https://api.github.com/repos/Javohir877/navo/releases/latest')
    .then(r => (r.ok ? r.json() : null))
    .then(j => { if (j && j.tag_name) $('#ver').textContent = j.tag_name.replace(/^v/, ''); })
    .catch(() => {});

  $('#yr').textContent = new Date().getFullYear();

  // Reveal on scroll
  const io = 'IntersectionObserver' in window ? new IntersectionObserver(es => es.forEach(e => {
    if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
  }), { threshold: 0.12 }) : null;
  document.querySelectorAll('.section .head, .card, .dl, .step-col, details, .show-text, .show-img, .duo figure').forEach(el => {
    if (!io) return;
    el.classList.add('reveal');
    io.observe(el);
  });
})();
