/**
 * ╔══════════════════════════════════════════════════════════════╗
 * ║         AcademiX — Shutdown Admin API v1.0                  ║
 * ║  Load ONLY on admin-panel.html                              ║
 * ╚══════════════════════════════════════════════════════════════╝
 *
 * CARA PAKAI di admin-panel.html:
 *
 *   <!-- di <body> mana saja: -->
 *   <div id="shutdown-widget"></div>
 *
 *   <!-- sebelum </body>: -->
 *   <script src="shutdown-controller.js"></script>
 *   <script src="shutdown-admin.js"></script>
 *
 *  Atau panggil manual:
 *   ShutdownAdmin.shutdown({ title: '...', message: '...' })
 *   ShutdownAdmin.activate()
 */

(() => {
  'use strict';

  const STORAGE_KEY   = 'academix_shutdown';
  const COUNTDOWN_SEC = 20;

  /* ── Helpers ─────────────────────────────────────────── */
  const getState = () => {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || {}; }
    catch { return {}; }
  };
  const setState = (obj) =>
    localStorage.setItem(STORAGE_KEY, JSON.stringify(obj));
  const clearState = () =>
    localStorage.removeItem(STORAGE_KEY);

  /* ══════════════════════════════════════════════════════
     ACTIONS
  ══════════════════════════════════════════════════════ */
  const shutdown = ({ title, message } = {}) => {
    const state = {
      isShutdown   : true,
      shutdownStart: Date.now(),
      duration     : COUNTDOWN_SEC * 1000,
      title        : title   || 'Website Akan Ditutup',
      message      : message || 'Harap segera menyelesaikan aktivitas Anda.',
    };
    setState(state);
    /* trigger storage event di tab lain */
    window.dispatchEvent(new StorageEvent('storage', {
      key     : STORAGE_KEY,
      newValue: JSON.stringify(state),
    }));
    return state;
  };

  const activate = () => {
    clearState();
    window.dispatchEvent(new StorageEvent('storage', {
      key     : STORAGE_KEY,
      newValue: null,
    }));
  };

  const getStatus = () => {
    const s = getState();
    if (!s.isShutdown) return { active: false };
    const elapsed   = Date.now() - (s.shutdownStart || 0);
    const remaining = Math.max(0, COUNTDOWN_SEC * 1000 - elapsed);
    return {
      active   : true,
      remaining: Math.ceil(remaining / 1000),
      state    : s,
    };
  };

  /* ══════════════════════════════════════════════════════
     AUTO-INJECT WIDGET
     Jika ada <div id="shutdown-widget"> di halaman,
     widget UI akan di-render otomatis.
  ══════════════════════════════════════════════════════ */
  const injectWidget = () => {
    const container = document.getElementById('shutdown-widget');
    if (!container) return;

    /* inject style khusus widget */
    const style = document.createElement('style');
    style.textContent = `
      /* ─── Widget Card ─── */
      .sdw-card {
        background: rgba(11,15,26,0.85);
        border: 1px solid rgba(255,255,255,0.07);
        border-radius: 16px;
        padding: 24px;
        font-family: 'DM Sans', sans-serif;
      }

      .sdw-header {
        display: flex; align-items: center; gap: 10px;
        margin-bottom: 20px;
      }
      .sdw-header-icon {
        width: 36px; height: 36px; border-radius: 10px;
        background: rgba(239,68,68,0.12);
        border: 1px solid rgba(239,68,68,0.2);
        display: flex; align-items: center; justify-content: center;
        flex-shrink: 0;
      }
      .sdw-header h3 {
        font-family: 'Sora', sans-serif;
        font-size: 15px; font-weight: 700; color: #e8ecf8;
        margin: 0; line-height: 1.2;
      }
      .sdw-header p {
        font-size: 12px; color: #3d4460; margin: 2px 0 0;
      }

      /* Status badge */
      .sdw-status {
        display: inline-flex; align-items: center; gap: 6px;
        padding: 5px 12px; border-radius: 999px;
        font-size: 12px; font-weight: 600; margin-bottom: 20px;
      }
      .sdw-status.online {
        background: rgba(16,185,129,0.1);
        border: 1px solid rgba(16,185,129,0.2);
        color: #34d399;
      }
      .sdw-status.offline {
        background: rgba(239,68,68,0.1);
        border: 1px solid rgba(239,68,68,0.2);
        color: #f87171;
      }
      .sdw-status-dot {
        width: 6px; height: 6px; border-radius: 50%;
        animation: sdw-blink 1.2s step-start infinite;
      }
      .sdw-status.online  .sdw-status-dot { background: #10b981; }
      .sdw-status.offline .sdw-status-dot { background: #ef4444; }
      @keyframes sdw-blink { 50% { opacity: 0; } }

      /* Form inputs */
      .sdw-field { margin-bottom: 14px; }
      .sdw-label {
        display: block; font-size: 12px; font-weight: 600;
        color: #7d88a4; letter-spacing: 0.04em;
        margin-bottom: 6px;
      }
      .sdw-input {
        width: 100%; background: rgba(255,255,255,0.05);
        border: 1px solid rgba(255,255,255,0.08);
        border-radius: 10px; padding: 10px 14px;
        color: #e8ecf8; font-size: 13.5px;
        font-family: 'DM Sans', sans-serif;
        outline: none;
        transition: border-color 0.2s;
        resize: vertical; min-height: 40px;
      }
      .sdw-input:focus { border-color: rgba(91,80,239,0.5); }

      /* Countdown info (saat aktif) */
      .sdw-active-info {
        background: rgba(239,68,68,0.07);
        border: 1px solid rgba(239,68,68,0.15);
        border-radius: 12px; padding: 14px;
        margin-bottom: 18px; display: none;
      }
      .sdw-active-info.visible { display: block; }
      .sdw-active-info-row {
        display: flex; justify-content: space-between; align-items: center;
        font-size: 13px; color: #7d88a4;
      }
      .sdw-active-info-row + .sdw-active-info-row { margin-top: 6px; }
      .sdw-active-info-val {
        font-weight: 700; color: #f87171;
        font-variant-numeric: tabular-nums;
      }

      /* Buttons */
      .sdw-btn-group {
        display: flex; gap: 10px; margin-top: 20px;
      }
      .sdw-btn {
        flex: 1; display: flex; align-items: center; justify-content: center;
        gap: 8px; padding: 11px 16px; border-radius: 10px;
        font-size: 13.5px; font-weight: 600; cursor: pointer;
        border: none; transition: all 0.18s ease;
        font-family: 'DM Sans', sans-serif;
        white-space: nowrap;
      }
      .sdw-btn:active { transform: scale(0.97); }
      .sdw-btn-off {
        background: rgba(239,68,68,0.18);
        border: 1px solid rgba(239,68,68,0.3);
        color: #f87171;
      }
      .sdw-btn-off:hover {
        background: rgba(239,68,68,0.28);
        border-color: rgba(239,68,68,0.5);
        box-shadow: 0 0 16px rgba(239,68,68,0.2);
      }
      .sdw-btn-off:disabled {
        opacity: 0.4; cursor: not-allowed; pointer-events: none;
      }
      .sdw-btn-on {
        background: rgba(16,185,129,0.15);
        border: 1px solid rgba(16,185,129,0.25);
        color: #34d399;
      }
      .sdw-btn-on:hover {
        background: rgba(16,185,129,0.25);
        border-color: rgba(16,185,129,0.45);
        box-shadow: 0 0 16px rgba(16,185,129,0.15);
      }
      .sdw-btn-on:disabled {
        opacity: 0.4; cursor: not-allowed; pointer-events: none;
      }

      /* Divider */
      .sdw-divider {
        border: none; border-top: 1px solid rgba(255,255,255,0.06);
        margin: 18px 0;
      }

      /* Log */
      .sdw-log-title {
        font-size: 11px; font-weight: 600; color: #3d4460;
        letter-spacing: 0.08em; text-transform: uppercase;
        margin-bottom: 8px;
      }
      .sdw-log {
        max-height: 110px; overflow-y: auto;
        font-size: 11.5px; font-family: 'Sora', monospace;
        line-height: 1.7;
      }
      .sdw-log-item { color: #3d4460; }
      .sdw-log-item.success { color: #34d399; }
      .sdw-log-item.danger  { color: #f87171; }
      .sdw-log-item .sdw-log-time { color: #3d4460; margin-right: 6px; }
    `;
    document.head.appendChild(style);

    /* build HTML */
    container.innerHTML = `
      <div class="sdw-card">
        <div class="sdw-header">
          <div class="sdw-header-icon">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/>
              <line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div>
            <h3>Website Control</h3>
            <p>Kendalikan status website secara realtime</p>
          </div>
        </div>

        <!-- Status -->
        <div class="sdw-status online" id="sdw-status-badge">
          <span class="sdw-status-dot"></span>
          <span id="sdw-status-text">Website Online</span>
        </div>

        <!-- Active info (muncul saat shutdown aktif) -->
        <div class="sdw-active-info" id="sdw-active-info">
          <div class="sdw-active-info-row">
            <span>Sisa countdown</span>
            <span class="sdw-active-info-val" id="sdw-remain">—</span>
          </div>
          <div class="sdw-active-info-row">
            <span>Judul aktif</span>
            <span class="sdw-active-info-val" id="sdw-title-active" style="font-size:11px;max-width:160px;text-align:right;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">—</span>
          </div>
        </div>

        <!-- Form -->
        <div class="sdw-field">
          <label class="sdw-label" for="sdw-inp-title">JUDUL PENGUMUMAN</label>
          <input id="sdw-inp-title" class="sdw-input" type="text"
            placeholder="Website Akan Ditutup"
            value="Website Akan Ditutup" />
        </div>
        <div class="sdw-field">
          <label class="sdw-label" for="sdw-inp-msg">PESAN PENGUMUMAN</label>
          <textarea id="sdw-inp-msg" class="sdw-input" rows="3"
            placeholder="Harap segera menyelesaikan aktivitas Anda.">Harap segera menyelesaikan aktivitas Anda.</textarea>
        </div>

        <!-- Buttons -->
        <div class="sdw-btn-group">
          <button class="sdw-btn sdw-btn-off" id="sdw-btn-off" onclick="ShutdownAdmin._widgetOff()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
            Matikan Website
          </button>
          <button class="sdw-btn sdw-btn-on" id="sdw-btn-on" onclick="ShutdownAdmin._widgetOn()">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M18.36 6.64a9 9 0 1 1-12.73 0"/><line x1="12" y1="2" x2="12" y2="12"/></svg>
            Aktifkan Website
          </button>
        </div>

        <hr class="sdw-divider"/>

        <!-- Activity log -->
        <div class="sdw-log-title">Activity Log</div>
        <div class="sdw-log" id="sdw-log"></div>
      </div>
    `;

    /* start polling status */
    updateWidgetStatus();
    setInterval(updateWidgetStatus, 1000);
  };

  /* ══════════════════════════════════════════════════════
     WIDGET HELPERS
  ══════════════════════════════════════════════════════ */
  let logItems = [];

  const addLog = (msg, type = '') => {
    const now = new Date().toLocaleTimeString('id-ID', { hour12: false });
    logItems.unshift({ msg, type, time: now });
    if (logItems.length > 20) logItems.pop();
    renderLog();
  };

  const renderLog = () => {
    const el = document.getElementById('sdw-log');
    if (!el) return;
    el.innerHTML = logItems
      .map(l => `<div class="sdw-log-item ${l.type}">
        <span class="sdw-log-time">[${l.time}]</span>${l.msg}
      </div>`)
      .join('');
  };

  const updateWidgetStatus = () => {
    const status = getStatus();
    const badge  = document.getElementById('sdw-status-badge');
    const text   = document.getElementById('sdw-status-text');
    const info   = document.getElementById('sdw-active-info');
    const remain = document.getElementById('sdw-remain');
    const titleA = document.getElementById('sdw-title-active');
    const btnOff = document.getElementById('sdw-btn-off');
    const btnOn  = document.getElementById('sdw-btn-on');
    if (!badge) return;

    if (status.active) {
      badge.className = 'sdw-status offline';
      text.textContent = 'Website Offline (Shutdown)';
      info.classList.add('visible');
      remain.textContent = status.remaining + 's';
      titleA.textContent = status.state.title || '—';
      if (btnOff) btnOff.disabled = true;
      if (btnOn)  btnOn.disabled  = false;
    } else {
      badge.className = 'sdw-status online';
      text.textContent = 'Website Online';
      info.classList.remove('visible');
      if (btnOff) btnOff.disabled = false;
      if (btnOn)  btnOn.disabled  = true;
    }
  };

  /* ══════════════════════════════════════════════════════
     BUTTON HANDLERS
  ══════════════════════════════════════════════════════ */
  const _widgetOff = () => {
    const title   = (document.getElementById('sdw-inp-title')?.value || '').trim()
                    || 'Website Akan Ditutup';
    const message = (document.getElementById('sdw-inp-msg')?.value || '').trim()
                    || 'Harap segera menyelesaikan aktivitas Anda.';
    shutdown({ title, message });
    addLog(`Shutdown dimulai: "${title}"`, 'danger');
    updateWidgetStatus();
  };

  const _widgetOn = () => {
    activate();
    addLog('Website diaktifkan kembali', 'success');
    updateWidgetStatus();
  };

  /* ══════════════════════════════════════════════════════
     INIT
  ══════════════════════════════════════════════════════ */
  const init = () => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', injectWidget);
    } else {
      injectWidget();
    }
  };
  init();

  /* ── Public API ── */
  window.ShutdownAdmin = {
    shutdown,
    activate,
    getStatus,
    _widgetOff,
    _widgetOn,
  };

})();
