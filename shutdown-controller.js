/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║   AcademiX — Shutdown Controller v3.0                           ║
 * ║                                                                  ║
 * ║  Drop satu <script> tag ke semua halaman. Otomatis:              ║
 * ║  • Cek status shutdown di localStorage                           ║
 * ║  • Tampilkan overlay + countdown 20 detik untuk user biasa       ║
 * ║  • Redirect ke maintenance.html setelah fade to black            ║
 * ║  • BLOKIR akses fresh (jika sudah maintenance, langsung redirect) ║
 * ║  • ADMIN yang sudah login (window.__sdAdminMode = true) BEBAS    ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

(() => {
  'use strict';

  /* ─── Konfigurasi ─── */
  const CFG = {
    STORAGE_KEY    : 'academix_shutdown',
    COUNTDOWN_SEC  : 20,
    FADE_DURATION  : 2800,           // ms
    CHECK_INTERVAL : 600,            // ms polling
    MAINTENANCE_URL: 'maintenance.html',
  };

  /* ─── State ─── */
  let overlayEl     = null;
  let countdownEl   = null;
  let progressEl    = null;
  let ringFillEl    = null;
  let fadeEl        = null;
  let tickTimer     = null;
  let checkTimer    = null;
  let isFading      = false;
  let overlayActive = false;

  /* ─── Helpers localStorage ─── */
  const getState = () => {
    try { return JSON.parse(localStorage.getItem(CFG.STORAGE_KEY)) || {}; }
    catch { return {}; }
  };
  const setState  = v => localStorage.setItem(CFG.STORAGE_KEY, JSON.stringify(v));
  const clearSt   = () => localStorage.removeItem(CFG.STORAGE_KEY);

  /* ─── Cek halaman ─── */
  const isMaintenancePage = () => /maintenance/i.test(location.pathname + location.search);

  /**
   * Cek apakah user adalah admin yang sudah login.
   * Script dari script.js akan set window.__sdAdminMode = true setelah verifikasi role.
   */
  const isAdmin = () => !!window.__sdAdminMode;

  /* ══════════════════════════════════════════════════════════════
     BUILD OVERLAY DOM
  ══════════════════════════════════════════════════════════════ */
  const buildOverlay = () => {
    if (document.getElementById('sx-overlay')) {
      overlayEl   = document.getElementById('sx-overlay');
      countdownEl = document.getElementById('sx-num');
      progressEl  = document.getElementById('sx-bar');
      ringFillEl  = document.getElementById('sx-ring-fill');
      fadeEl      = document.getElementById('sx-fade');
      return;
    }

    /* Inject CSS */
    const style = document.createElement('style');
    style.id = 'sx-styles';
    style.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=Sora:wght@700;800&display=swap');

      #sx-overlay {
        position: fixed; inset: 0; z-index: 999998;
        display: flex; align-items: center; justify-content: center;
        background: rgba(4,7,13,0.92);
        backdrop-filter: blur(24px) saturate(0.4);
        -webkit-backdrop-filter: blur(24px) saturate(0.4);
        opacity: 0; transition: opacity 0.55s cubic-bezier(.4,0,.2,1);
        pointer-events: none;
      }
      #sx-overlay.sx-on { opacity: 1; pointer-events: all; }

      #sx-card {
        width: min(500px, calc(100vw - 40px));
        background: rgba(8,12,22,0.97);
        border: 1px solid rgba(239,68,68,0.3);
        border-radius: 22px;
        padding: 44px 40px 40px;
        box-shadow:
          0 0 0 1px rgba(239,68,68,0.06),
          0 32px 90px rgba(0,0,0,0.8),
          0 0 100px rgba(239,68,68,0.08);
        transform: scale(0.88) translateY(16px);
        opacity: 0;
        transition: transform 0.58s cubic-bezier(0.34,1.56,0.64,1), opacity 0.5s ease;
        text-align: center; position: relative; overflow: hidden;
      }
      #sx-card::before {
        content: ''; position: absolute; inset: -1px; border-radius: 23px;
        background: linear-gradient(135deg,rgba(239,68,68,0.5),rgba(245,158,11,0.2),rgba(239,68,68,0.05));
        z-index: -1; animation: sxGlow 3s ease-in-out infinite alternate;
        pointer-events: none;
      }
      @keyframes sxGlow { from{opacity:0.3} to{opacity:0.9} }
      #sx-overlay.sx-on #sx-card { transform: scale(1) translateY(0); opacity: 1; }

      #sx-icon {
        width: 70px; height: 70px; border-radius: 18px;
        background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.24);
        display: flex; align-items: center; justify-content: center;
        margin: 0 auto 22px;
        animation: sxPulse 2.2s ease-in-out infinite;
      }
      @keyframes sxPulse {
        0%,100%{box-shadow:0 0 0 0 rgba(239,68,68,0.35)}
        50%{box-shadow:0 0 0 16px rgba(239,68,68,0)}
      }

      #sx-badge {
        display: inline-flex; align-items: center; gap: 7px;
        background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.22);
        border-radius: 999px; padding: 5px 14px 5px 10px;
        font-size: 10.5px; font-weight: 700; letter-spacing: 0.1em;
        color: #f87171; text-transform: uppercase; margin-bottom: 18px;
      }
      #sx-badge-dot {
        width: 7px; height: 7px; border-radius: 50%;
        background: #ef4444; box-shadow: 0 0 7px rgba(239,68,68,0.9);
        animation: sxBlink 1s step-start infinite;
      }
      @keyframes sxBlink { 50%{opacity:0} }

      #sx-title {
        font-family: 'Sora', sans-serif;
        font-size: clamp(17px, 3.5vw, 22px);
        font-weight: 800; color: #eaf0ff; margin-bottom: 10px; line-height: 1.3;
      }
      #sx-msg {
        font-size: 13.5px; line-height: 1.75; color: #5a6480;
        margin-bottom: 30px;
      }

      /* Ring countdown */
      #sx-ring-wrap {
        display: flex; flex-direction: column; align-items: center;
        margin-bottom: 24px;
      }
      #sx-ring-label {
        font-size: 10px; letter-spacing: 0.14em; font-weight: 700;
        text-transform: uppercase; color: #2e3550; margin-bottom: 12px;
      }
      #sx-ring-svg { position: relative; width: 104px; height: 104px; }
      #sx-ring-bg  { fill:none; stroke:rgba(255,255,255,0.05); stroke-width:4; }
      #sx-ring-fill {
        fill: none; stroke: #ef4444; stroke-width: 4; stroke-linecap: round;
        transform-origin: center; transform: rotate(-90deg);
        stroke-dasharray: 272; stroke-dashoffset: 0;
        transition: stroke-dashoffset 0.85s linear, stroke 0.4s ease;
        filter: drop-shadow(0 0 8px rgba(239,68,68,0.6));
      }
      #sx-num-wrap {
        position: absolute; inset: 0;
        display: flex; align-items: center; justify-content: center;
      }
      #sx-num {
        font-family: 'Sora', sans-serif; font-size: 32px; font-weight: 800;
        color: #ef4444; transition: color 0.4s ease;
        font-variant-numeric: tabular-nums;
      }

      /* Progress bar */
      #sx-bar-track {
        width: 100%; height: 3px; background: rgba(255,255,255,0.05);
        border-radius: 999px; overflow: hidden; margin-bottom: 22px;
      }
      #sx-bar {
        height: 100%; border-radius: 999px; width: 100%;
        background: linear-gradient(90deg,#ef4444,#f97316);
        transition: width 0.85s linear;
        box-shadow: 0 0 12px rgba(239,68,68,0.5);
      }

      #sx-foot {
        font-size: 11.5px; color: #2e3550;
        display: flex; align-items: center; justify-content: center; gap: 6px;
      }

      /* Fade to black */
      #sx-fade {
        position: fixed; inset: 0; z-index: 999999;
        background: #000; opacity: 0; pointer-events: none;
        transition: opacity var(--sx-fd,2.8s) cubic-bezier(.4,0,.2,1);
      }
      #sx-fade.sx-fade-in { opacity: 1; pointer-events: all; }

      @media(max-width:480px){
        #sx-card { padding: 30px 22px 26px; border-radius: 18px; }
        #sx-num  { font-size: 26px; }
      }
    `;
    document.head.appendChild(style);

    /* Inject HTML */
    const frag = document.createDocumentFragment();

    const overlayDiv = document.createElement('div');
    overlayDiv.id = 'sx-overlay';
    overlayDiv.setAttribute('role', 'alertdialog');
    overlayDiv.setAttribute('aria-modal', 'true');
    overlayDiv.setAttribute('aria-labelledby', 'sx-title');
    overlayDiv.innerHTML = `
      <div id="sx-card">
        <div id="sx-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none"
               stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
            <line x1="12" y1="9" x2="12" y2="13"/>
            <line x1="12" y1="17" x2="12.01" y2="17"/>
          </svg>
        </div>
        <div><div id="sx-badge"><span id="sx-badge-dot"></span>Pengumuman Sistem</div></div>
        <h2 id="sx-title">Website Akan Ditutup</h2>
        <p id="sx-msg">Harap segera menyelesaikan aktivitas Anda.</p>
        <div id="sx-ring-wrap">
          <span id="sx-ring-label">Menutup dalam</span>
          <div style="position:relative;width:104px;height:104px">
            <svg id="sx-ring-svg" viewBox="0 0 100 100" width="104" height="104">
              <circle id="sx-ring-bg"   cx="50" cy="50" r="43"/>
              <circle id="sx-ring-fill" cx="50" cy="50" r="43"/>
            </svg>
            <div id="sx-num-wrap"><span id="sx-num">20</span></div>
          </div>
        </div>
        <div id="sx-bar-track"><div id="sx-bar"></div></div>
        <p id="sx-foot">
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Data Anda tersimpan otomatis
        </p>
      </div>
    `;
    frag.appendChild(overlayDiv);

    const fadeDiv = document.createElement('div');
    fadeDiv.id = 'sx-fade';
    frag.appendChild(fadeDiv);

    document.body.appendChild(frag);

    overlayEl   = document.getElementById('sx-overlay');
    countdownEl = document.getElementById('sx-num');
    progressEl  = document.getElementById('sx-bar');
    ringFillEl  = document.getElementById('sx-ring-fill');
    fadeEl      = document.getElementById('sx-fade');
  };

  /* ══════════════════════════════════════════════════════════════
     SHOW / HIDE OVERLAY
  ══════════════════════════════════════════════════════════════ */
  const showOverlay = (state) => {
    if (!overlayEl) buildOverlay();
    overlayActive = true;

    const titleEl = document.getElementById('sx-title');
    const msgEl   = document.getElementById('sx-msg');
    if (titleEl && state.title)   titleEl.textContent = state.title;
    if (msgEl   && state.message) msgEl.textContent   = state.message;

    overlayEl.classList.add('sx-on');
    document.body.style.overflow = 'hidden';
    startTick(state);
  };

  const hideOverlay = () => {
    if (!overlayEl) return;
    overlayActive = false;
    isFading      = false;
    clearInterval(tickTimer);
    overlayEl.classList.remove('sx-on');
    document.body.style.overflow = '';
    if (fadeEl) {
      fadeEl.style.setProperty('--sx-fd','0s');
      fadeEl.classList.remove('sx-fade-in');
      setTimeout(() => fadeEl.style.removeProperty('--sx-fd'), 60);
    }
  };

  /* ══════════════════════════════════════════════════════════════
     COUNTDOWN TICK
  ══════════════════════════════════════════════════════════════ */
  const startTick = (state) => {
    clearInterval(tickTimer);
    const total = CFG.COUNTDOWN_SEC * 1000;
    const circ  = 272; // stroke-dasharray value

    const tick = () => {
      const elapsed   = Date.now() - (state.shutdownStart || 0);
      const remaining = Math.max(0, total - elapsed);
      const secs      = Math.ceil(remaining / 1000);
      const pct       = remaining / total;
      const col       = secs <= 5 ? '#f97316' : '#ef4444';

      if (countdownEl) { countdownEl.textContent = secs; countdownEl.style.color = col; }
      if (ringFillEl)  { ringFillEl.style.strokeDashoffset = circ * (1 - pct); ringFillEl.style.stroke = col; }
      if (progressEl)  progressEl.style.width = (pct * 100) + '%';

      if (remaining <= 0 && !isFading) {
        isFading = true;
        clearInterval(tickTimer);
        triggerFade();
      }
    };

    tick();
    tickTimer = setInterval(tick, 200);
  };

  /* ══════════════════════════════════════════════════════════════
     FADE TO BLACK → REDIRECT
  ══════════════════════════════════════════════════════════════ */
  const triggerFade = () => {
    if (!fadeEl) { location.replace(CFG.MAINTENANCE_URL); return; }
    fadeEl.style.setProperty('--sx-fd', (CFG.FADE_DURATION / 1000) + 's');
    void fadeEl.offsetHeight; // reflow
    fadeEl.classList.add('sx-fade-in');
    setTimeout(() => location.replace(CFG.MAINTENANCE_URL), CFG.FADE_DURATION + 80);
  };

  /* ══════════════════════════════════════════════════════════════
     POLL — cek state setiap CHECK_INTERVAL ms
  ══════════════════════════════════════════════════════════════ */
  const poll = () => {
    /* Halaman maintenance & admin selalu bebas */
    if (isMaintenancePage()) return;
    if (isAdmin()) {
      /* Jika admin, pastikan overlay tidak tampil */
      if (overlayActive) hideOverlay();
      return;
    }

    const state = getState();

    if (state.isShutdown) {
      const elapsed = Date.now() - (state.shutdownStart || 0);
      const total   = CFG.COUNTDOWN_SEC * 1000;

      /* Countdown sudah habis → langsung redirect tanpa overlay */
      if (elapsed >= total + CFG.FADE_DURATION + 300) {
        location.replace(CFG.MAINTENANCE_URL);
        return;
      }
      /* Tampilkan overlay jika belum */
      if (!overlayActive) {
        buildOverlay();
        showOverlay(state);
      }
    } else {
      /* Shutdown dimatikan admin → sembunyikan overlay */
      if (overlayActive) hideOverlay();
    }
  };

  /* ══════════════════════════════════════════════════════════════
     BLOKIR AKSES FRESH SAAT MAINTENANCE AKTIF
     (cek SEBELUM DOM ready, agar tidak ada flicker)
  ══════════════════════════════════════════════════════════════ */
  const earlyBlock = () => {
    if (isMaintenancePage()) return;

    /* Tunggu sampai kita tahu apakah user admin atau bukan.
       Jika __sdAdminMode sudah true, biarkan masuk. */
    if (isAdmin()) return;

    const state = getState();
    if (!state.isShutdown) return;

    const elapsed = Date.now() - (state.shutdownStart || 0);
    const total   = CFG.COUNTDOWN_SEC * 1000;

    /* Jika countdown masih berjalan, tetap tampilkan overlay di bawah.
       Jika sudah habis (maintenance mode), redirect segera. */
    if (elapsed >= total + CFG.FADE_DURATION + 300) {
      /* Langsung redirect — jangan tunggu DOM */
      location.replace(CFG.MAINTENANCE_URL);
    }
    /* Jika masih dalam countdown, biarkan init() handle via poll() */
  };

  /* ══════════════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════════════ */
  const init = () => {
    buildOverlay();
    poll();
    checkTimer = setInterval(poll, CFG.CHECK_INTERVAL);

    /* StorageEvent — sinkron perubahan dari tab lain */
    window.addEventListener('storage', e => {
      if (e.key === CFG.STORAGE_KEY) poll();
    });
  };

  /* Jalankan early-block sesegera mungkin */
  earlyBlock();

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  /* ══════════════════════════════════════════════════════════════
     PUBLIC API — dipakai oleh script.js
  ══════════════════════════════════════════════════════════════ */
  window.ShutdownCtrl = {
    getState,
    setState,
    clearSt,
    triggerFade,

    /** Aktifkan shutdown dari script lain */
    shutdown({ title, message } = {}) {
      const s = {
        isShutdown   : true,
        shutdownStart: Date.now(),
        duration     : CFG.COUNTDOWN_SEC * 1000,
        title  : title   || 'Website Akan Ditutup',
        message: message || 'Harap segera menyelesaikan aktivitas Anda.',
      };
      setState(s);
      window.dispatchEvent(new StorageEvent('storage', {
        key: CFG.STORAGE_KEY, newValue: JSON.stringify(s),
      }));
      return s;
    },

    /** Aktifkan kembali website */
    activate() {
      clearSt();
      window.dispatchEvent(new StorageEvent('storage', {
        key: CFG.STORAGE_KEY, newValue: null,
      }));
    },

    /** Status saat ini */
    getStatus() {
      const s = getState();
      if (!s.isShutdown) return { active: false };
      const rem = Math.max(0, CFG.COUNTDOWN_SEC * 1000 - (Date.now() - (s.shutdownStart || 0)));
      return { active: true, remaining: Math.ceil(rem / 1000), state: s };
    },
  };

})();
