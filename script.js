/* =============================================================
   AcademiX — script.js
   Full Application Logic with Supabase Backend
   ============================================================= */

/* ─────────────────────────────────────────────────────────────
   SUPABASE CONFIG — Ganti dengan credentials Supabase kamu
   ───────────────────────────────────────────────────────────── */
const SUPABASE_URL    = 'https://ckqcpviipscapbyngepp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_7YMEQSMDsUJTmDvYtXp0wg_A8cvKh6s';
const ADMIN_EMAIL     = 'kenzstrx739@gmail.com';

const { createClient } = supabase;
const db = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

/* ─────────────────────────────────────────────────────────────
   GLOBAL STATE
   ───────────────────────────────────────────────────────────── */
let currentUser = null;
let currentSession = null;
let currentSubjectId = null;
let currentSubjectData = null;

/* EXAM STATE */
let examState = {
  exam: null, questions: [], answers: {}, currentQ: 0,
  timerInterval: null, timeLeft: 0,
  cheatCount: 0, examActive: false
};

/* SOCIAL STATE */
let confessionSort = 'newest';
let commentSort   = 'newest';

/* DEBOUNCE */
let searchDebounceTimer = null;

/* REALTIME CHANNELS */
let realtimeChannels = [];

/* ─────────────────────────────────────────────────────────────
   INIT
   ───────────────────────────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', async () => {
  showLoadingOverlay();

  // Cegah initUser dipanggil dua kali (getSession + onAuthStateChange SIGNED_IN)
  let initialized = false;

  const { data: { session } } = await db.auth.getSession();
  if (session) {
    initialized = true;
    currentSession = session;
    await initUser(session.user);
  } else {
    showLanding();
  }

  // Auth state listener
  db.auth.onAuthStateChange(async (event, session) => {
    if (event === 'SIGNED_IN' && session) {
      if (initialized) {
        closeModal('modal-login');
        return;
      }
      initialized = true;
      currentSession = session;
      await initUser(session.user);
      closeModal('modal-login');
    } else if (event === 'SIGNED_OUT') {
      initialized = false;
      currentUser = null; currentSession = null;
      showLanding();
    }
  });
});

/* ─────────────────────────────────────────────────────────────
   AUTH
   ───────────────────────────────────────────────────────────── */
async function loginWithGoogle() {
  const { error } = await db.auth.signInWithOAuth({
    provider: 'google',
    options: { redirectTo: window.location.origin }
  });
  if (error) showToast('Gagal login dengan Google: ' + error.message, 'error');
}

async function handleEmailSubmit() {
  const email = document.getElementById('login-email-input').value.trim();
  if (!validateEmail(email)) { showToast('Format email tidak valid', 'error'); return; }

  // Cek apakah email ini sudah pernah berhasil login
  const knownEmails = JSON.parse(localStorage.getItem('academix_known_emails') || '[]');
  if (knownEmails.includes(email)) {
    // Coba pakai session yang mungkin masih aktif via getSession
    showLoadingOverlay();
    const { data: { session } } = await db.auth.getSession();
    if (session && session.user.email === email) {
      // Session masih aktif — langsung masuk
      hideLoadingOverlay();
      showToast('Selamat datang kembali!', 'success');
      await initUser(session.user);
      closeModal('modal-login');
      return;
    }
    // Session habis tapi email dikenal — kirim OTP tapi beri tahu user
    const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
    hideLoadingOverlay();
    if (!error) {
      showOTPStep(email);
      showToast('Sesi habis, OTP dikirim ke ' + email, 'info');
      return;
    }
  }

  showLoadingOverlay();
  const { error } = await db.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
  hideLoadingOverlay();

  if (error) { showToast('Gagal kirim OTP: ' + error.message, 'error'); return; }

  showOTPStep(email);
  showToast('Kode OTP 8 digit dikirim ke ' + email, 'info');
}

function showOTPStep(email) {
  document.getElementById('email-step-1').classList.add('hidden');
  document.getElementById('email-step-2').classList.remove('hidden');
  document.getElementById('otp-email-display').textContent = email;
  startOTPTimer();
  initOTPBoxes();
}

function initOTPBoxes() {
  const boxes = document.querySelectorAll('.otp-box');
  const hiddenInput = document.getElementById('login-otp-input');

  // Reset semua kotak
  boxes.forEach(b => { b.value = ''; b.classList.remove('filled'); });
  hiddenInput.value = '';

  boxes.forEach((box, i) => {
    // Clone untuk hapus event lama
    const fresh = box.cloneNode(true);
    box.parentNode.replaceChild(fresh, box);
  });

  // Re-select setelah clone
  const freshBoxes = document.querySelectorAll('.otp-box');

  freshBoxes.forEach((box, i) => {
    box.addEventListener('input', (e) => {
      // Hanya angka
      box.value = box.value.replace(/\D/g, '').slice(-1);
      box.classList.toggle('filled', box.value !== '');

      // Sync ke hidden input
      hiddenInput.value = [...freshBoxes].map(b => b.value).join('');

      // Pindah ke kotak berikutnya
      if (box.value && i < freshBoxes.length - 1) freshBoxes[i + 1].focus();
    });

    box.addEventListener('keydown', (e) => {
      if (e.key === 'Backspace') {
        if (!box.value && i > 0) {
          freshBoxes[i - 1].value = '';
          freshBoxes[i - 1].classList.remove('filled');
          freshBoxes[i - 1].focus();
        }
        box.classList.remove('filled');
        hiddenInput.value = [...freshBoxes].map(b => b.value).join('');
      }
      if (e.key === 'Enter') handleOTPVerify();
    });

    box.addEventListener('paste', (e) => {
      e.preventDefault();
      const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, 8);
      [...pasted].forEach((char, j) => {
        if (freshBoxes[j]) {
          freshBoxes[j].value = char;
          freshBoxes[j].classList.add('filled');
        }
      });
      hiddenInput.value = [...freshBoxes].map(b => b.value).join('');
      const next = freshBoxes[Math.min(pasted.length, 7)];
      if (next) next.focus();
    });
  });

  // Fokus kotak pertama
  freshBoxes[0].focus();
}

let otpTimerInterval = null;
function startOTPTimer() {
  let secs = 300;
  const el = document.getElementById('otp-countdown');
  clearInterval(otpTimerInterval);
  otpTimerInterval = setInterval(() => {
    secs--;
    const m = Math.floor(secs / 60).toString().padStart(2,'0');
    const s = (secs % 60).toString().padStart(2,'0');
    if (el) el.textContent = `${m}:${s}`;
    if (secs <= 0) { clearInterval(otpTimerInterval); showToast('OTP telah kedaluwarsa, kirim ulang.', 'error'); }
  }, 1000);
}

async function handleOTPVerify() {
  const email = document.getElementById('login-email-input').value.trim();
  const code  = document.getElementById('login-otp-input').value.trim();

  if (code.length !== 8) { showToast('Kode OTP harus 8 digit', 'error'); return; }

  showLoadingOverlay();
  const { data, error } = await db.auth.verifyOtp({ email, token: code, type: 'email' });
  hideLoadingOverlay();

  if (error) { showToast('Kode OTP tidak valid atau kedaluwarsa', 'error'); return; }

  // Simpan email ke daftar known — login berikutnya skip OTP jika sesi masih aktif
  const known = JSON.parse(localStorage.getItem('academix_known_emails') || '[]');
  if (!known.includes(email)) {
    known.push(email);
    localStorage.setItem('academix_known_emails', JSON.stringify(known));
  }
  // onAuthStateChange akan handle initUser otomatis
}

function resetEmailLogin() {
  document.getElementById('email-step-1').classList.remove('hidden');
  document.getElementById('email-step-2').classList.add('hidden');
  document.getElementById('login-otp-input').value = '';
  document.querySelectorAll('.otp-box').forEach(b => { b.value = ''; b.classList.remove('filled'); });
  clearInterval(otpTimerInterval);
}

async function logout() {
  cleanupRealtime();
  if (examState.examActive) endExam(false);
  await db.auth.signOut();
}

/* ─────────────────────────────────────────────────────────────
   USER INIT
   ───────────────────────────────────────────────────────────── */
async function initUser(authUser) {
  showLoadingOverlay();
  const email = authUser.email;
  const role = email === ADMIN_EMAIL ? 'admin' : 'siswa';

  // Upsert user profile
  const defaultUsername = email.split('@')[0].replace(/[^a-zA-Z0-9_]/g,'');
  let { data: profile, error } = await db.from('users')
    .upsert({ id: authUser.id, email, role, username: defaultUsername }, { onConflict: 'id' })
    .select().single();

  if (error) {
    const { data: p2 } = await db.from('users').select('*').eq('id', authUser.id).single();
    profile = p2;
  }

  currentUser = profile || { id: authUser.id, email, role, username: defaultUsername };

  // Check if banned
  if (currentUser.banned) {
    await db.auth.signOut();
    showToast('Akun kamu telah diblokir oleh admin.', 'error');
    hideLoadingOverlay();
    return;
  }

  updateSidebarUser();
  showApp();
  setupRealtimeListeners();
  await navigate('dashboard');
  hideLoadingOverlay();
}

function updateSidebarUser() {
  const initials = currentUser.username ? currentUser.username[0].toUpperCase() : '?';
  document.getElementById('sidebar-avatar').textContent = initials;
  document.getElementById('topbar-avatar').textContent = initials;
  document.getElementById('sidebar-username').textContent = currentUser.username || currentUser.email;
  const roleBadge = document.getElementById('sidebar-role');
  roleBadge.textContent = currentUser.role === 'admin' ? 'Admin' : 'Siswa';
  roleBadge.classList.toggle('admin', currentUser.role === 'admin');

  // Tampilkan menu admin HANYA untuk admin
  const adminNav = document.getElementById('admin-nav');
  if (currentUser.role === 'admin') {
    adminNav.classList.remove('hidden');
  } else {
    adminNav.classList.add('hidden');
  }
}

/* ─────────────────────────────────────────────────────────────
   NAVIGATION
   ───────────────────────────────────────────────────────────── */
const pageMap = {
  dashboard:          'section-dashboard',
  subjects:           'section-subjects',
  'subject-detail':   'section-subject-detail',
  exams:              'section-exams',
  'exam-room':        'section-exam-room',
  results:            'section-results',
  leaderboard:        'section-leaderboard',
  social:             'section-social',
  'admin-subjects':   'section-admin-subjects',
  'admin-questions':  'section-admin-questions',
  'admin-monitor':    'section-admin-monitor',
  'admin-moderation': 'section-admin-moderation',
  'admin-broadcast':  'section-admin-broadcast',
};

const pageTitles = {
  dashboard: 'Dashboard', subjects: 'Mata Pelajaran', 'subject-detail': 'Kisi-Kisi',
  exams: 'Ujian', 'exam-room': 'Ujian Berlangsung', results: 'Hasil Ujian',
  leaderboard: 'Leaderboard', social: 'Sosial',
  'admin-subjects': 'Kelola Mapel', 'admin-questions': 'Kelola Soal',
  'admin-monitor': 'Monitoring', 'admin-moderation': 'Moderasi', 'admin-broadcast': 'Broadcast',
};

async function navigate(page) {
  if (currentUser?.role !== 'admin' && page.startsWith('admin')) {
    showToast('Akses ditolak', 'error'); return;
  }

  // Hide all sections
  document.querySelectorAll('.app-section').forEach(s => s.classList.remove('active'));
  const target = pageMap[page];
  if (target) {
    const el = document.getElementById(target);
    if (el) { el.classList.remove('hidden'); el.classList.add('active'); }
  }

  // Update nav
  document.querySelectorAll('.nav-item').forEach(n => {
    n.classList.toggle('active', n.dataset.page === page);
  });

  // Update topbar
  document.getElementById('topbar-title').textContent = pageTitles[page] || '';

  // Close sidebar on mobile
  document.getElementById('sidebar').classList.remove('open');

  // Load page data
  const loaders = {
    dashboard:          loadDashboard,
    subjects:           loadSubjects,
    exams:              loadExams,
    results:            loadResults,
    leaderboard:        loadLeaderboard,
    social:             loadSocial,
    'admin-subjects':   loadAdminSubjects,
    'admin-questions':  loadAdminQuestions,
    'admin-monitor':    loadAdminMonitor,
    'admin-moderation': loadAdminModeration,
    'admin-broadcast':  loadAdminBroadcast,
  };
  if (loaders[page]) await loaders[page]();
}

/* ─────────────────────────────────────────────────────────────
   DASHBOARD
   ───────────────────────────────────────────────────────────── */
async function loadDashboard() {
  document.getElementById('welcome-msg').textContent = `Selamat datang, ${currentUser.username}!`;

  // Stats
  const [{ count: examsDone }, { data: results }, { count: subjects }] = await Promise.all([
    db.from('results').select('*', { count: 'exact', head: true }).eq('user_id', currentUser.id),
    db.from('results').select('score').eq('user_id', currentUser.id),
    db.from('subjects').select('*', { count: 'exact', head: true }),
  ]);

  const avg = results?.length ? Math.round(results.reduce((a,r) => a + r.score, 0) / results.length) : 0;
  document.getElementById('stat-exams-done').textContent = examsDone || 0;
  document.getElementById('stat-avg-score').textContent = avg;
  document.getElementById('stat-subjects').textContent = subjects || 0;

  // Rank
  const { data: lb } = await db.from('leaderboard').select('*').order('avg_score', { ascending: false });
  const rank = lb ? lb.findIndex(r => r.user_id === currentUser.id) + 1 : 0;
  document.getElementById('stat-rank').textContent = rank > 0 ? `#${rank}` : '#--';

  // Recent activity
  const { data: recent } = await db.from('results').select('*, subjects(name)')
    .eq('user_id', currentUser.id).order('created_at', { ascending: false }).limit(5);
  const actEl = document.getElementById('recent-activity');
  if (!recent?.length) {
    actEl.innerHTML = '<div class="empty-state"><p>Belum ada aktivitas</p></div>'; return;
  }
  actEl.innerHTML = recent.map(r => `
    <div class="activity-item">
      <span style="color:var(--accent-2);font-size:0.8rem;">Ujian</span>
      <span>${r.subjects?.name || '-'}</span>
      <span style="margin-left:auto;font-weight:700;color:${scoreColor(r.score)}">${r.score}</span>
    </div>`).join('');

  // Mini leaderboard
  const mlEl = document.getElementById('mini-leaderboard');
  if (!lb?.length) { mlEl.innerHTML = '<div class="empty-state"><p>Belum ada data</p></div>'; return; }
  mlEl.innerHTML = lb.slice(0,5).map((r,i) => `
    <div class="mini-lb-item">
      <span style="font-family:var(--font-display);font-weight:800;color:${i===0?'#f59e0b':i===1?'#94a3b8':'var(--text-muted)'}">#${i+1}</span>
      <span style="flex:1">${r.username}</span>
      <span style="font-weight:700;color:var(--accent)">${r.avg_score}</span>
    </div>`).join('');
}

/* ─────────────────────────────────────────────────────────────
   SUBJECTS
   ───────────────────────────────────────────────────────────── */
async function loadSubjects(query = '') {
  let q = db.from('subjects').select('*').order('name');
  if (query) q = q.ilike('name', `%${query}%`);
  const { data, error } = await q;
  const grid = document.getElementById('subjects-grid');
  if (error) { grid.innerHTML = '<p>Gagal memuat mata pelajaran.</p>'; return; }
  if (!data?.length) {
    grid.innerHTML = '<div class="empty-state"><p>Belum ada mata pelajaran tersedia.</p></div>'; return;
  }
  grid.innerHTML = data.map(s => {
    const access = getSubjectAccess(s);
    return `
    <div class="subject-card ${access.accessible ? '' : 'subject-locked'}" onclick="${access.accessible ? `openSubjectDetail('${s.id}')` : `showToast('Mapel ini belum bisa diakses: ${access.label}', 'error')`}">
      <div class="subject-tag">${s.duration_minutes || 60} menit</div>
      ${!access.accessible ? `<div class="subject-lock-overlay"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg></div>` : ''}
      <h3>${s.name}</h3>
      <p>${s.description || 'Tidak ada deskripsi.'}</p>
      <div class="subject-meta">
        <span class="${access.cls}">${access.label}</span>
      </div>
    </div>`;
  }).join('');
}

async function openSubjectDetail(id) {
  navigate('subject-detail');
  const { data: s } = await db.from('subjects').select('*').eq('id', id).single();
  currentSubjectId = id;
  currentSubjectData = s;
  document.getElementById('subject-detail-title').textContent = s.name;
  // Render kisi
  const kisiEl = document.getElementById('kisi-content');
  if (!s.kisi_content) {
    kisiEl.innerHTML = '<div class="empty-state"><p>Belum ada kisi-kisi tersedia.</p></div>';
  } else {
    kisiEl.innerHTML = `<div class="kisi-item"><div style="white-space:pre-wrap;font-size:0.92rem;color:var(--text-secondary)">${escapeHTML(s.kisi_content)}</div></div>`;
  }
  // Load rating
  await loadSubjectRating(id);
}

function switchSubjectTab(tab) {
  document.getElementById('kisi-panel').classList.toggle('hidden', tab !== 'kisi');
  document.getElementById('rating-panel').classList.toggle('hidden', tab !== 'rating');
  document.querySelectorAll('#section-subject-detail .tabs .tab-btn').forEach((b,i) => {
    b.classList.toggle('active', (i===0 && tab==='kisi') || (i===1 && tab==='rating'));
  });
}

async function loadSubjectRating(subjectId) {
  const { data } = await db.from('ratings').select('rating').eq('subject_id', subjectId);
  const avgEl = document.getElementById('rating-avg');
  if (!data?.length) { avgEl.textContent = 'Belum ada rating'; return; }
  const avg = (data.reduce((a,r) => a+r.rating, 0) / data.length).toFixed(1);
  avgEl.textContent = `Rata-rata: ${avg} / 5 (${data.length} rating)`;

  const { data: myRating } = await db.from('ratings').select('rating')
    .eq('subject_id', subjectId).eq('user_id', currentUser.id).single();
  if (myRating) highlightStars(myRating.rating);
}

function highlightStars(val) {
  document.querySelectorAll('#stars-input .star').forEach((s,i) => {
    s.classList.toggle('active', i < val);
  });
}

async function rateSubject(val) {
  highlightStars(val);
  await db.from('ratings').upsert({
    subject_id: currentSubjectId, user_id: currentUser.id, rating: val
  }, { onConflict: 'subject_id,user_id' });
  showToast('Rating tersimpan!', 'success');
  await loadSubjectRating(currentSubjectId);
}

/* ─────────────────────────────────────────────────────────────
   EXAMS
   ───────────────────────────────────────────────────────────── */
async function loadExams() {
  const { data, error } = await db.from('subjects').select('*').order('name');
  const el = document.getElementById('exams-list');
  if (error || !data?.length) {
    el.innerHTML = '<div class="empty-state"><p>Belum ada ujian tersedia.</p></div>'; return;
  }
  el.innerHTML = data.map(s => {
    const access = getSubjectAccess(s);
    return `
    <div class="exam-card ${access.accessible ? '' : 'exam-locked'}">
      <div class="exam-info">
        <h3>${s.name}</h3>
        <p>${s.description || ''}</p>
        <div class="exam-meta">
          <span>${s.duration_minutes || 60} menit</span>
          <span class="${access.cls}">${access.label}</span>
        </div>
      </div>
      ${access.accessible
        ? `<button class="btn btn-primary" onclick="startExam('${s.id}','${escapeAttr(s.name)}',${s.duration_minutes||60})">Mulai Ujian</button>`
        : `<button class="btn btn-secondary" disabled style="opacity:0.5;cursor:not-allowed">
             <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0 1 10 0v4"/></svg>
             Terkunci
           </button>`
      }
    </div>`;
  }).join('');
}

async function startExam(subjectId, subjectName, durationMins) {
  // Check if already taken (optional: allow retake)
  const { data: questions } = await db.from('questions').select('*').eq('subject_id', subjectId);
  if (!questions?.length) { showToast('Belum ada soal untuk mapel ini.', 'error'); return; }

  // Shuffle questions
  const shuffled = questions.sort(() => Math.random() - 0.5);
  examState = {
    exam: { subject_id: subjectId, subject_name: subjectName },
    questions: shuffled, answers: {}, currentQ: 0,
    timerInterval: null, timeLeft: durationMins * 60,
    cheatCount: 0, examActive: true
  };

  document.getElementById('exam-title').textContent = subjectName + ' — Ujian';
  document.getElementById('exam-subject').textContent = subjectName;
  renderQuestion();
  startExamTimer();
  setupAntiCheat();
  navigate('exam-room');
}

function renderQuestion() {
  const q = examState.questions[examState.currentQ];
  const total = examState.questions.length;
  const pct = ((examState.currentQ + 1) / total * 100).toFixed(0);

  document.getElementById('exam-progress-fill').style.width = pct + '%';
  document.getElementById('exam-progress-text').textContent = `${examState.currentQ + 1} / ${total}`;

  // Dots
  const dotsEl = document.getElementById('question-dots');
  dotsEl.innerHTML = examState.questions.map((_, i) => `
    <div class="q-dot ${i === examState.currentQ ? 'current' : ''} ${examState.answers[i] !== undefined ? 'answered' : ''}"
         onclick="jumpToQuestion(${i})"></div>`).join('');

  // Nav buttons
  document.getElementById('btn-prev').style.visibility = examState.currentQ > 0 ? 'visible' : 'hidden';
  const isLast = examState.currentQ === total - 1;
  document.getElementById('btn-next').textContent = isLast ? 'Selesai' : 'Selanjutnya';
  document.getElementById('exam-submit').style.display = isLast ? 'block' : 'none';

  // Question
  const area = document.getElementById('question-area');
  const ans = examState.answers[examState.currentQ];

  let optionsHTML = '';
  if (q.type === 'pg') {
    const opts = ['A','B','C','D'];
    optionsHTML = `<div class="options-list">${opts.map(k => `
      <div class="option-item ${ans === k ? 'selected' : ''}" onclick="selectPG(${examState.currentQ},'${k}')">
        <span class="option-key">${k}</span>
        <span>${q.options?.[k] || ''}</span>
      </div>`).join('')}</div>`;
  } else if (q.type === 'pgk') {
    const opts = ['A','B','C','D'];
    const curAns = ans || [];
    optionsHTML = `<div class="options-list">${opts.map(k => `
      <label class="checkbox-option ${curAns.includes(k) ? 'selected' : ''}" onclick="togglePGK(${examState.currentQ},'${k}')">
        <input type="checkbox" ${curAns.includes(k) ? 'checked' : ''} readonly>
        <span class="option-key">${k}</span>
        <span>${q.options?.[k] || ''}</span>
      </label>`).join('')}</div>`;
  } else {
    optionsHTML = `<div class="isian-input">
      <input type="text" class="input" id="isian-ans-input" placeholder="Tulis jawaban kamu..."
        value="${ans || ''}" oninput="saveIsian(${examState.currentQ}, this.value)" />
    </div>`;
  }

  area.innerHTML = `
    <div class="question-card">
      <div class="question-num">Soal ${examState.currentQ + 1} dari ${total}
        <span class="type-badge type-${q.type}" style="margin-left:8px">${q.type.toUpperCase()}</span>
      </div>
      <div class="question-text">${q.question_text}</div>
      ${optionsHTML}
    </div>`;
}

function selectPG(qIdx, key) {
  examState.answers[qIdx] = key;
  renderQuestion();
}
function togglePGK(qIdx, key) {
  let cur = examState.answers[qIdx] || [];
  const idx = cur.indexOf(key);
  if (idx === -1) cur.push(key); else cur.splice(idx, 1);
  examState.answers[qIdx] = cur;
  renderQuestion();
}
function saveIsian(qIdx, val) { examState.answers[qIdx] = val; }
function prevQuestion() { if (examState.currentQ > 0) { examState.currentQ--; renderQuestion(); } }
function nextQuestion() {
  if (examState.currentQ < examState.questions.length - 1) {
    examState.currentQ++; renderQuestion();
  }
}
function jumpToQuestion(i) { examState.currentQ = i; renderQuestion(); }

function startExamTimer() {
  const el = document.getElementById('exam-timer');
  examState.timerInterval = setInterval(() => {
    examState.timeLeft--;
    const m = Math.floor(examState.timeLeft / 60).toString().padStart(2,'0');
    const s = (examState.timeLeft % 60).toString().padStart(2,'0');
    el.textContent = `${m}:${s}`;
    if (examState.timeLeft <= 60) el.classList.add('urgent');
    if (examState.timeLeft <= 0) { clearInterval(examState.timerInterval); submitExam(); }
  }, 1000);
}

async function submitExam() {
  clearInterval(examState.timerInterval);
  examState.examActive = false;
  removeAntiCheat();

  const questions = examState.questions;
  let correct = 0, total = 0;

  questions.forEach((q, i) => {
    const ans = examState.answers[i];
    total++;
    if (q.type === 'pg') {
      if (ans === q.correct_answer) correct++;
    } else if (q.type === 'pgk') {
      const ca = (q.correct_answers || []).sort().join(',');
      const ua = (ans || []).sort().join(',');
      if (ca === ua) correct++;
    } else if (q.type === 'isian') {
      if (ans?.toLowerCase().trim() === q.correct_answer?.toLowerCase().trim()) correct++;
    }
  });

  const score = Math.round((correct / total) * 100);
  const wrong = total - correct;

  // Save result
  await db.from('results').insert({
    user_id: currentUser.id,
    subject_id: examState.exam.subject_id,
    score, correct, wrong, total_questions: total,
    answers: examState.answers
  });

  // Update leaderboard
  await updateLeaderboard();

  // Show result modal
  const circle = document.getElementById('result-score-circle');
  circle.style.borderColor = scoreColorHex(score);
  document.getElementById('result-score-val').textContent = score;
  document.getElementById('result-score-val').style.color = scoreColorHex(score);
  document.getElementById('result-exam-title').textContent = examState.exam.subject_name + ' — Hasil';
  document.getElementById('result-subject-name').textContent = examState.exam.subject_name;
  document.getElementById('result-correct').textContent = correct;
  document.getElementById('result-wrong').textContent = wrong;
  document.getElementById('result-total-q').textContent = total;
  openModal('modal-result');
  navigate('results');
}

async function updateLeaderboard() {
  const { data: results } = await db.from('results').select('score').eq('user_id', currentUser.id);
  if (!results?.length) return;
  const avg = Math.round(results.reduce((a,r) => a + r.score, 0) / results.length);
  await db.from('leaderboard').upsert({
    user_id: currentUser.id, username: currentUser.username, avg_score: avg
  }, { onConflict: 'user_id' });
}

function endExam(save = false) {
  clearInterval(examState.timerInterval);
  examState.examActive = false;
  removeAntiCheat();
  if (save) submitExam();
  else navigate('dashboard');
}

/* ── ANTI-CHEAT ──── */
function setupAntiCheat() {
  document.addEventListener('visibilitychange', handleVisibilityChange);
  window.addEventListener('blur', handleWindowBlur);
}
function removeAntiCheat() {
  document.removeEventListener('visibilitychange', handleVisibilityChange);
  window.removeEventListener('blur', handleWindowBlur);
}
function handleVisibilityChange() {
  if (document.hidden && examState.examActive) triggerCheatWarning();
}
function handleWindowBlur() {
  if (examState.examActive) triggerCheatWarning();
}
function triggerCheatWarning() {
  examState.cheatCount++;
  const el = document.getElementById('cheat-count-msg');
  if (el) el.textContent = `Peringatan ${examState.cheatCount} dari 3`;
  document.getElementById('cheat-warning').classList.remove('hidden');
  if (examState.cheatCount >= 3) {
    examState.examActive = false;
    clearInterval(examState.timerInterval);
    removeAntiCheat();
    setTimeout(() => {
      document.getElementById('cheat-warning').classList.add('hidden');
      navigate('dashboard');
      showToast('Ujian dihentikan karena kecurangan terdeteksi.', 'error');
    }, 2000);
  }
}
function dismissCheatWarning() { document.getElementById('cheat-warning').classList.add('hidden'); }

/* ─────────────────────────────────────────────────────────────
   RESULTS
   ───────────────────────────────────────────────────────────── */
async function loadResults() {
  const { data } = await db.from('results').select('*, subjects(name)')
    .eq('user_id', currentUser.id).order('created_at', { ascending: false });
  const el = document.getElementById('results-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada hasil ujian.</p></div>'; return; }
  el.innerHTML = data.map(r => `
    <div class="result-item" onclick="showResultDetail(${JSON.stringify(r).replace(/"/g,'&quot;')})">
      <div class="result-score ${r.score>=70?'score-high':r.score>=50?'score-mid':'score-low'}">${r.score}</div>
      <div style="flex:1">
        <h4>${r.subjects?.name || '-'}</h4>
        <p style="font-size:0.82rem">${formatDate(r.created_at)}</p>
      </div>
      <div style="text-align:right;font-size:0.82rem;color:var(--text-muted)">
        <div>${r.correct} benar</div>
        <div>${r.wrong} salah</div>
      </div>
    </div>`).join('');
}

function showResultDetail(r) {
  const circle = document.getElementById('result-score-circle');
  circle.style.borderColor = scoreColorHex(r.score);
  document.getElementById('result-score-val').textContent = r.score;
  document.getElementById('result-score-val').style.color = scoreColorHex(r.score);
  document.getElementById('result-exam-title').textContent = (r.subjects?.name || '-') + ' — Hasil';
  document.getElementById('result-subject-name').textContent = r.subjects?.name || '-';
  document.getElementById('result-correct').textContent = r.correct;
  document.getElementById('result-wrong').textContent = r.wrong;
  document.getElementById('result-total-q').textContent = r.total_questions;
  openModal('modal-result');
}

/* ─────────────────────────────────────────────────────────────
   LEADERBOARD
   ───────────────────────────────────────────────────────────── */
async function loadLeaderboard() {
  const subjectId = document.getElementById('leaderboard-subject-filter')?.value;

  // Populate filter
  const { data: subjects } = await db.from('subjects').select('id, name').order('name');
  const filterEl = document.getElementById('leaderboard-subject-filter');
  if (filterEl && subjects) {
    const curVal = filterEl.value;
    filterEl.innerHTML = '<option value="">Semua Mata Pelajaran</option>' +
      subjects.map(s => `<option value="${s.id}" ${curVal===s.id?'selected':''}>${s.name}</option>`).join('');
  }

  let data;
  if (subjectId) {
    const { data: res } = await db.from('results').select('user_id, score, users(username)')
      .eq('subject_id', subjectId);
    // Aggregate per user
    const agg = {};
    res?.forEach(r => {
      if (!agg[r.user_id]) agg[r.user_id] = { user_id: r.user_id, username: r.users?.username, scores: [] };
      agg[r.user_id].scores.push(r.score);
    });
    data = Object.values(agg).map(u => ({
      user_id: u.user_id, username: u.username,
      avg_score: Math.round(u.scores.reduce((a,s)=>a+s,0)/u.scores.length)
    })).sort((a,b) => b.avg_score - a.avg_score);
  } else {
    const { data: lb } = await db.from('leaderboard').select('*').order('avg_score', { ascending: false });
    data = lb;
  }

  const el = document.getElementById('leaderboard-table');
  if (!data?.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada data leaderboard.</p></div>'; return; }
  el.innerHTML = data.map((r, i) => `
    <div class="lb-item ${i===0?'rank-1':i===1?'rank-2':i===2?'rank-3':''}">
      <span class="lb-rank lb-rank-${i+1}">#${i+1}</span>
      <div class="lb-info">
        <div class="lb-username">${r.username || '-'} ${r.user_id === currentUser.id ? '<span style="color:var(--accent-2);font-size:0.75rem">(Kamu)</span>' : ''}</div>
      </div>
      <div class="lb-score">${r.avg_score}</div>
    </div>`).join('');
}

/* ─────────────────────────────────────────────────────────────
   SOCIAL
   ───────────────────────────────────────────────────────────── */
async function loadSocial() {
  await loadConfessions();
  await loadComments();
}

async function loadConfessions() {
  let q = db.from('anonymous_messages')
    .select('*, replies:confession_replies(*, users!confession_replies_user_id_fkey(username, id))');
  if (confessionSort === 'popular') q = q.order('likes', { ascending: false });
  else q = q.order('created_at', { ascending: false });
  const { data } = await q;
  renderConfessions(data || []);
}

function renderConfessions(items) {
  const el = document.getElementById('confession-list');
  if (!items.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada pesan anonim.</p></div>'; return; }
  el.innerHTML = items.map(item => {
    const repliesHtml = (item.replies || []).map(rep => {
      // Jika yang reply adalah pemilik pesan → tetap Anonymous
      const isOwner = rep.user_id === item.user_id;
      const repName = isOwner ? 'Anonymous' : (rep.users?.username || 'User');
      const repInitial = repName[0].toUpperCase();
      return `<div class="reply-item">
        <div class="reply-avatar">${repInitial}</div>
        <div class="reply-body">
          <span class="reply-name">${repName}</span>
          <span class="reply-text">${escapeHTML(rep.content)}</span>
          <span class="reply-time">${timeAgo(rep.created_at)}</span>
        </div>
      </div>`;
    }).join('');

    return `<div class="feed-item" id="feed-${item.id}">
      <div class="feed-item-header">
        <div class="feed-avatar">A</div>
        <div>
          <div class="feed-name">Anonymous</div>
          <div class="feed-time">${timeAgo(item.created_at)}</div>
        </div>
      </div>
      <div class="feed-content">${escapeHTML(item.message || '')}</div>
      <div class="feed-actions">
        <button class="like-btn ${item.liked_by?.includes(currentUser.id) ? 'liked' : ''}"
          onclick="likeConfession('${item.id}')">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z"/></svg>
          ${item.likes || 0}
        </button>
        <button class="reply-btn" onclick="openConfessionReply('${item.id}')">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="9,17 4,12 9,7"/><path d="M20 18v-2a4 4 0 0 0-4-4H4"/></svg>
          Balas
        </button>
        <span class="reply-count">${(item.replies||[]).length} balasan</span>
      </div>
      ${repliesHtml ? `<div class="confession-replies">${repliesHtml}</div>` : ''}
      <div class="confession-reply-form hidden" id="reply-form-${item.id}">
        <input type="text" class="input input-sm" id="reply-input-${item.id}" placeholder="Tulis balasan..." />
        <button class="btn btn-primary btn-sm" onclick="submitConfessionReply('${item.id}')">Kirim</button>
        <button class="btn btn-ghost btn-sm" onclick="closeConfessionReply('${item.id}')">Batal</button>
      </div>
    </div>`;
  }).join('');
}

function openConfessionReply(confessionId) {
  // Tutup form reply lain dulu
  document.querySelectorAll('.confession-reply-form').forEach(f => f.classList.add('hidden'));
  const form = document.getElementById(`reply-form-${confessionId}`);
  if (form) {
    form.classList.remove('hidden');
    form.querySelector('input').focus();
  }
}

function closeConfessionReply(confessionId) {
  const form = document.getElementById(`reply-form-${confessionId}`);
  if (form) form.classList.add('hidden');
}

async function submitConfessionReply(confessionId) {
  const input = document.getElementById(`reply-input-${confessionId}`);
  const text = input?.value.trim();
  if (!text) { showToast('Balasan tidak boleh kosong', 'error'); return; }

  const { error } = await db.from('confession_replies').insert({
    confession_id: confessionId,
    user_id: currentUser.id,
    content: text
  });

  if (error) { showToast('Gagal mengirim balasan', 'error'); return; }
  showToast('Balasan terkirim!', 'success');
  await loadConfessions();
}

async function loadComments() {
  let q = db.from('comments').select('*, users!comments_user_id_fkey(username), replies:comments(*, users!comments_user_id_fkey(username))')
    .is('parent_id', null);
  if (commentSort === 'popular') q = q.order('likes', { ascending: false });
  else q = q.order('created_at', { ascending: false });
  const { data } = await q;
  renderFeed(data || [], 'comments-list', false);
}

function renderFeed(items, containerId, isAnon) {
  const el = document.getElementById(containerId);
  if (!items.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada pesan.</p></div>'; return; }
  el.innerHTML = items.map(item => {
    const name = isAnon ? 'Anonymous' : (item.users?.username || 'User');
    const initial = name[0].toUpperCase();
    const replies = item.replies || [];
    return `
    <div class="feed-item" id="feed-${item.id}">
      <div class="feed-item-header">
        <div class="feed-avatar">${initial}</div>
        <div>
          <div class="feed-name">${name}</div>
          <div class="feed-time">${timeAgo(item.created_at)}</div>
        </div>
      </div>
      <div class="feed-content">${escapeHTML(item.content || item.message || '')}</div>
      <div class="feed-actions">
        <button class="like-btn ${item.liked_by?.includes(currentUser.id) ? 'liked' : ''}"
          onclick="${isAnon ? `likeConfession('${item.id}')` : `likeComment('${item.id}')`}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z"/></svg>
          ${item.likes || 0}
        </button>
        ${!isAnon ? `<button class="reply-btn" onclick="openReply('${item.id}', '${escapeAttr(item.content||'')}')">Balas</button>` : ''}
      </div>
      ${replies.length ? `<div class="replies-list">${replies.map(rep => `
        <div class="reply-item">
          <span class="reply-name">${rep.users?.username || 'User'}:</span>
          <span>${escapeHTML(rep.content || '')}</span>
        </div>`).join('')}</div>` : ''}
    </div>`;
  }).join('');
}

async function sendConfession() {
  const text = document.getElementById('confession-text').value.trim();
  if (!text) { showToast('Pesan tidak boleh kosong', 'error'); return; }
  const { error } = await db.from('anonymous_messages').insert({
    user_id: currentUser.id, message: text, likes: 0
  });
  if (error) { showToast('Gagal mengirim pesan', 'error'); return; }
  document.getElementById('confession-text').value = '';
  showToast('Pesan anonim terkirim!', 'success');
  await loadConfessions();
}

async function sendComment() {
  const text = document.getElementById('comment-text').value.trim();
  if (!text) { showToast('Komentar tidak boleh kosong', 'error'); return; }
  const { error } = await db.from('comments').insert({
    user_id: currentUser.id, content: text, likes: 0, parent_id: null
  });
  if (error) { showToast('Gagal mengirim komentar', 'error'); return; }
  document.getElementById('comment-text').value = '';
  showToast('Komentar terkirim!', 'success');
  await loadComments();
}

function openReply(parentId, parentContent) {
  document.getElementById('reply-parent-id').value = parentId;
  document.getElementById('reply-parent-preview').textContent = parentContent.slice(0,100) + (parentContent.length>100?'...':'');
  document.getElementById('reply-text').value = '';
  openModal('modal-reply');
}

async function submitReply() {
  const parentId = document.getElementById('reply-parent-id').value;
  const text = document.getElementById('reply-text').value.trim();
  if (!text) return;
  await db.from('comments').insert({ user_id: currentUser.id, content: text, likes: 0, parent_id: parentId });
  closeModal('modal-reply');
  showToast('Balasan terkirim!', 'success');
  await loadComments();
}

async function likeConfession(id) {
  const { data } = await db.from('anonymous_messages').select('likes, liked_by').eq('id', id).single();
  const likedBy = data?.liked_by || [];
  if (likedBy.includes(currentUser.id)) return;
  await db.from('anonymous_messages').update({ likes: (data.likes||0)+1, liked_by: [...likedBy, currentUser.id] }).eq('id', id);
  await loadConfessions();
}

async function likeComment(id) {
  const { data } = await db.from('comments').select('likes, liked_by').eq('id', id).single();
  const likedBy = data?.liked_by || [];
  if (likedBy.includes(currentUser.id)) return;
  await db.from('comments').update({ likes: (data.likes||0)+1, liked_by: [...likedBy, currentUser.id] }).eq('id', id);
  await loadComments();
}

function setSort(type, sort, btn) {
  if (type === 'confession') confessionSort = sort;
  else commentSort = sort;
  btn.parentElement.querySelectorAll('.btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  if (type === 'confession') loadConfessions(); else loadComments();
}

function switchSocialTab(tab) {
  document.getElementById('confession-panel').classList.toggle('hidden', tab !== 'confession');
  document.getElementById('comments-panel').classList.toggle('hidden', tab !== 'comments');
  document.querySelectorAll('#section-social .tabs .tab-btn').forEach((b,i) => {
    b.classList.toggle('active', (i===0 && tab==='confession') || (i===1 && tab==='comments'));
  });
}

/* ─────────────────────────────────────────────────────────────
   ADMIN — SUBJECTS
   ───────────────────────────────────────────────────────────── */
/* Helper: cek apakah mapel bisa diakses sekarang */
function getSubjectAccess(s) {
  const mode = s.lock_mode || 'open';
  if (mode === 'locked') return { accessible: false, label: '🔒 Dikunci', cls: 'lock-badge locked' };
  if (mode === 'open')   return { accessible: true,  label: '🔓 Terbuka', cls: 'lock-badge open' };
  // scheduled
  const now = new Date();
  const openAt  = s.open_at  ? new Date(s.open_at)  : null;
  const closeAt = s.close_at ? new Date(s.close_at) : null;
  if (openAt && now < openAt) {
    return { accessible: false, label: `⏰ Buka ${formatDateTime(openAt)}`, cls: 'lock-badge scheduled' };
  }
  if (closeAt && now > closeAt) {
    return { accessible: false, label: `🔒 Sudah Tutup`, cls: 'lock-badge locked' };
  }
  return { accessible: true, label: `⏰ Buka s/d ${closeAt ? formatDateTime(closeAt) : '—'}`, cls: 'lock-badge open' };
}

function formatDateTime(d) {
  return d.toLocaleString('id-ID', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

async function quickToggleLock(id, currentMode) {
  const newMode = currentMode === 'locked' ? 'open' : 'locked';
  await db.from('subjects').update({ lock_mode: newMode }).eq('id', id);
  showToast(newMode === 'locked' ? '🔒 Mapel dikunci' : '🔓 Mapel dibuka', 'success');
  await loadAdminSubjects();
}

async function loadAdminSubjects() {
  const { data } = await db.from('subjects').select('*').order('name');
  const el = document.getElementById('admin-subjects-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada mata pelajaran.</p></div>'; return; }
  el.innerHTML = data.map(s => {
    const access = getSubjectAccess(s);
    const mode = s.lock_mode || 'open';
    return `
    <div class="admin-item">
      <div class="admin-item-info">
        <h4>${s.name}</h4>
        <p>${s.description || ''} &bull; ${s.duration_minutes||60} menit</p>
        <span class="${access.cls}">${access.label}</span>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-sm ${mode === 'locked' ? 'btn-success' : 'btn-warning'}"
          onclick="quickToggleLock('${s.id}', '${mode}')">
          ${mode === 'locked' ? '🔓 Buka' : '🔒 Kunci'}
        </button>
        <button class="btn btn-ghost btn-sm" onclick="editSubject(${JSON.stringify(s).replace(/"/g,'&quot;')})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteSubject('${s.id}')">Hapus</button>
      </div>
    </div>`;
  }).join('');
}

function setLockMode(mode, btn) {
  document.getElementById('subject-lock-mode').value = mode;
  document.querySelectorAll('.lock-tab').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
  document.getElementById('lock-schedule-fields').classList.toggle('hidden', mode !== 'scheduled');
}

function editSubject(s) {
  document.getElementById('modal-subject-title').textContent = 'Edit Mata Pelajaran';
  document.getElementById('edit-subject-id').value = s.id;
  document.getElementById('subject-name-input').value = s.name;
  document.getElementById('subject-desc-input').value = s.description || '';
  document.getElementById('subject-kisi-input').value = s.kisi_content || '';
  document.getElementById('subject-duration-input').value = s.duration_minutes || 60;

  // Restore lock mode
  const mode = s.lock_mode || 'open';
  document.getElementById('subject-lock-mode').value = mode;
  document.querySelectorAll('.lock-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.mode === mode);
  });
  document.getElementById('lock-schedule-fields').classList.toggle('hidden', mode !== 'scheduled');
  if (s.open_at) document.getElementById('subject-open-at').value = s.open_at.slice(0,16);
  if (s.close_at) document.getElementById('subject-close-at').value = s.close_at.slice(0,16);

  openModal('modal-add-subject');
}

async function saveSubject() {
  const id   = document.getElementById('edit-subject-id').value;
  const name = document.getElementById('subject-name-input').value.trim();
  const desc = document.getElementById('subject-desc-input').value.trim();
  const kisi = document.getElementById('subject-kisi-input').value.trim();
  const dur  = parseInt(document.getElementById('subject-duration-input').value) || 60;
  const lockMode = document.getElementById('subject-lock-mode').value || 'open';
  const openAt  = document.getElementById('subject-open-at').value || null;
  const closeAt = document.getElementById('subject-close-at').value || null;

  if (!name) { showToast('Nama mapel wajib diisi', 'error'); return; }

  const payload = {
    name, description: desc, kisi_content: kisi, duration_minutes: dur,
    lock_mode: lockMode,
    open_at: lockMode === 'scheduled' ? openAt : null,
    close_at: lockMode === 'scheduled' ? closeAt : null,
  };

  let error;
  if (id) {
    ({ error } = await db.from('subjects').update(payload).eq('id', id));
  } else {
    ({ error } = await db.from('subjects').insert(payload));
  }
  if (error) { showToast('Gagal menyimpan: ' + error.message, 'error'); return; }
  showToast('Mata pelajaran tersimpan!', 'success');
  closeModal('modal-add-subject');
  document.getElementById('edit-subject-id').value = '';
  document.getElementById('modal-subject-title').textContent = 'Tambah Mata Pelajaran';
  // Reset lock mode ke open
  setLockMode('open', document.querySelector('.lock-tab[data-mode="open"]'));
  await loadAdminSubjects();
}

async function deleteSubject(id) {
  if (!confirm('Hapus mata pelajaran ini?')) return;
  await db.from('subjects').delete().eq('id', id);
  showToast('Mata pelajaran dihapus', 'success');
  await loadAdminSubjects();
}

/* ─────────────────────────────────────────────────────────────
   ADMIN — QUESTIONS
   ───────────────────────────────────────────────────────────── */
async function loadAdminQuestions() {
  const subjectId = document.getElementById('question-subject-filter').value;
  const { data: subjects } = await db.from('subjects').select('id, name').order('name');
  const filterEl = document.getElementById('question-subject-filter');
  const selectEl = document.getElementById('question-subject-select');
  const opts = subjects?.map(s => `<option value="${s.id}">${s.name}</option>`).join('') || '';

  if (filterEl && subjects) {
    const curVal = filterEl.value;
    filterEl.innerHTML = '<option value="">Pilih Mata Pelajaran</option>' + opts;
    if (curVal) filterEl.value = curVal;
  }
  if (selectEl) selectEl.innerHTML = '<option value="">Pilih Mata Pelajaran</option>' + opts;

  if (!subjectId) return;
  const { data: questions } = await db.from('questions').select('*, subjects(name)').eq('subject_id', subjectId);
  const el = document.getElementById('admin-questions-list');
  if (!questions?.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada soal.</p></div>'; return; }
  el.innerHTML = questions.map(q => `
    <div class="admin-item">
      <div class="admin-item-info" style="flex:1">
        <div style="display:flex;gap:6px;align-items:center;margin-bottom:4px">
          <span class="type-badge type-${q.type}">${q.type.toUpperCase()}</span>
          <span style="font-size:0.82rem;color:var(--text-muted)">${q.points} poin</span>
        </div>
        <h4 style="font-size:0.9rem">${q.question_text?.slice(0,80)}${q.question_text?.length>80?'...':''}</h4>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-ghost btn-sm" onclick="editQuestion(${JSON.stringify(q).replace(/"/g,'&quot;')})">Edit</button>
        <button class="btn btn-danger btn-sm" onclick="deleteQuestion('${q.id}')">Hapus</button>
      </div>
    </div>`).join('');
}

function updateQuestionForm() {
  const type = document.getElementById('question-type-select').value;
  document.getElementById('options-section').classList.toggle('hidden', type === 'isian');
  document.getElementById('isian-answer-section').classList.toggle('hidden', type !== 'isian');
  document.getElementById('correct-answer-pg').classList.toggle('hidden', type !== 'pg');
  document.getElementById('correct-answer-pgk').classList.toggle('hidden', type !== 'pgk');
}

function editQuestion(q) {
  document.getElementById('modal-question-title').textContent = 'Edit Soal';
  document.getElementById('edit-question-id').value = q.id;
  document.getElementById('question-subject-select').value = q.subject_id;
  document.getElementById('question-type-select').value = q.type;
  document.getElementById('question-text-input').value = q.question_text;
  document.getElementById('question-points').value = q.points || 10;
  updateQuestionForm();
  if (q.options) {
    document.getElementById('opt-a').value = q.options.A || '';
    document.getElementById('opt-b').value = q.options.B || '';
    document.getElementById('opt-c').value = q.options.C || '';
    document.getElementById('opt-d').value = q.options.D || '';
  }
  if (q.type === 'pg') document.getElementById('correct-pg').value = q.correct_answer;
  if (q.type === 'pgk') {
    document.querySelectorAll('[name="pgk-ans"]').forEach(cb => {
      cb.checked = (q.correct_answers || []).includes(cb.value);
    });
  }
  if (q.type === 'isian') document.getElementById('isian-answer').value = q.correct_answer || '';
  openModal('modal-add-question');
}

async function saveQuestion() {
  const id      = document.getElementById('edit-question-id').value;
  const subId   = document.getElementById('question-subject-select').value;
  const type    = document.getElementById('question-type-select').value;
  const text    = document.getElementById('question-text-input').value.trim();
  const points  = parseInt(document.getElementById('question-points').value) || 10;
  if (!subId || !text) { showToast('Mata pelajaran dan soal wajib diisi', 'error'); return; }

  const payload = { subject_id: subId, type, question_text: text, points };
  if (type !== 'isian') {
    payload.options = {
      A: document.getElementById('opt-a').value,
      B: document.getElementById('opt-b').value,
      C: document.getElementById('opt-c').value,
      D: document.getElementById('opt-d').value,
    };
  }
  if (type === 'pg') payload.correct_answer = document.getElementById('correct-pg').value;
  if (type === 'pgk') payload.correct_answers = [...document.querySelectorAll('[name="pgk-ans"]:checked')].map(c => c.value);
  if (type === 'isian') payload.correct_answer = document.getElementById('isian-answer').value.trim();

  let error;
  if (id) {
    ({ error } = await db.from('questions').update(payload).eq('id', id));
  } else {
    ({ error } = await db.from('questions').insert(payload));
  }
  if (error) { showToast('Gagal menyimpan soal: ' + error.message, 'error'); return; }
  showToast('Soal tersimpan!', 'success');
  closeModal('modal-add-question');
  document.getElementById('edit-question-id').value = '';
  document.getElementById('modal-question-title').textContent = 'Tambah Soal';
  await loadAdminQuestions();
}

async function deleteQuestion(id) {
  if (!confirm('Hapus soal ini?')) return;
  await db.from('questions').delete().eq('id', id);
  showToast('Soal dihapus', 'success');
  await loadAdminQuestions();
}

/* ─────────────────────────────────────────────────────────────
   ADMIN — MONITORING
   ───────────────────────────────────────────────────────────── */
async function loadAdminMonitor() {
  const [{ count: students }, { count: subjects }, { count: results }, { data: allResults }] = await Promise.all([
    db.from('users').select('*', { count: 'exact', head: true }).eq('role', 'siswa'),
    db.from('subjects').select('*', { count: 'exact', head: true }),
    db.from('results').select('*', { count: 'exact', head: true }),
    db.from('results').select('*, users(username), subjects(name)').order('created_at', { ascending: false }).limit(50),
  ]);
  document.getElementById('admin-stat-students').textContent = students || 0;
  document.getElementById('admin-stat-exams').textContent = subjects || 0;
  document.getElementById('admin-stat-results').textContent = results || 0;

  const el = document.getElementById('admin-all-results');
  if (!allResults?.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada hasil ujian.</p></div>'; return; }
  el.innerHTML = allResults.map(r => `
    <div class="admin-item">
      <div class="admin-item-info">
        <h4>${r.users?.username || 'User'} &bull; ${r.subjects?.name || '-'}</h4>
        <p>${formatDate(r.created_at)} &bull; ${r.correct}/${r.total_questions} benar</p>
      </div>
      <div style="font-family:var(--font-display);font-size:1.4rem;font-weight:800;color:${scoreColorHex(r.score)}">${r.score}</div>
    </div>`).join('');
}

/* ─────────────────────────────────────────────────────────────
   ADMIN — MODERATION
   ───────────────────────────────────────────────────────────── */
async function loadAdminModeration() {
  await loadAdminConfessions();
  await loadAdminUsers();
}

async function loadAdminConfessions() {
  const { data } = await db.from('anonymous_messages')
    .select('*, users!anonymous_messages_user_id_fkey(username, email)').order('created_at', { ascending: false });
  const el = document.getElementById('admin-confessions-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada confession.</p></div>'; return; }
  el.innerHTML = data.map(m => `
    <div class="admin-item">
      <div class="admin-item-info" style="flex:1">
        <div style="font-size:0.78rem;color:var(--accent-2);margin-bottom:2px">
          Dari: ${m.users?.username || '-'} (${m.users?.email || '-'})
        </div>
        <p style="font-size:0.9rem;color:var(--text-secondary)">${escapeHTML(m.message)}</p>
        <p style="font-size:0.75rem">${timeAgo(m.created_at)} &bull; ${m.likes||0} likes</p>
      </div>
      <div class="admin-item-actions">
        <button class="btn btn-danger btn-sm" onclick="deleteConfession('${m.id}')">Hapus</button>
      </div>
    </div>`).join('');
}

async function deleteConfession(id) {
  await db.from('anonymous_messages').delete().eq('id', id);
  showToast('Pesan dihapus', 'success');
  await loadAdminConfessions();
}

async function loadAdminUsers() {
  const { data } = await db.from('users').select('*').order('username');
  const el = document.getElementById('admin-users-list');
  if (!data?.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada user.</p></div>'; return; }
  el.innerHTML = data.map(u => `
    <div class="admin-item">
      <div class="admin-item-info">
        <h4>${u.username} ${u.banned ? '<span class="banned-badge">Diblokir</span>' : ''}</h4>
        <p>${u.email} &bull; ${u.role}</p>
      </div>
      <div class="admin-item-actions">
        ${u.email !== ADMIN_EMAIL ? `
          <button class="btn btn-sm ${u.banned ? 'btn-success' : 'btn-danger'}" onclick="toggleBanUser('${u.id}', ${!!u.banned})">
            ${u.banned ? 'Unban' : 'Ban'}
          </button>` : ''}
      </div>
    </div>`).join('');
}

async function toggleBanUser(userId, isBanned) {
  await db.from('users').update({ banned: !isBanned }).eq('id', userId);
  showToast(isBanned ? 'User di-unban' : 'User di-ban', 'success');
  await loadAdminUsers();
}

function switchModTab(tab) {
  document.getElementById('mod-confessions-panel').classList.toggle('hidden', tab !== 'confessions');
  document.getElementById('mod-users-panel').classList.toggle('hidden', tab !== 'users');
  document.querySelectorAll('#section-admin-moderation .tabs .tab-btn').forEach((b,i) => {
    b.classList.toggle('active', (i===0 && tab==='confessions') || (i===1 && tab==='users'));
  });
}

/* ─────────────────────────────────────────────────────────────
   ADMIN — BROADCAST
   ───────────────────────────────────────────────────────────── */
async function sendBroadcast() {
  const title = document.getElementById('broadcast-title').value.trim();
  const msg   = document.getElementById('broadcast-message').value.trim();
  if (!title || !msg) { showToast('Judul dan pesan wajib diisi', 'error'); return; }

  const { error } = await db.from('broadcasts').insert({ title, message: msg, user_id: currentUser.id });
  if (error) { showToast('Gagal mengirim broadcast', 'error'); return; }
  document.getElementById('broadcast-title').value = '';
  document.getElementById('broadcast-message').value = '';
  showToast('Broadcast terkirim!', 'success');
  await loadAdminBroadcast();
}

async function loadAdminBroadcast() {
  const { data } = await db.from('broadcasts').select('*').order('created_at', { ascending: false });
  const el = document.getElementById('broadcast-history');
  if (!data?.length) { el.innerHTML = '<div class="empty-state"><p>Belum ada broadcast.</p></div>'; return; }
  el.innerHTML = data.map(b => `
    <div class="admin-item">
      <div class="admin-item-info">
        <h4>${b.title}</h4>
        <p>${b.message}</p>
        <p style="font-size:0.75rem">${formatDate(b.created_at)}</p>
      </div>
      <button class="btn btn-danger btn-sm" onclick="deleteBroadcast('${b.id}')">Hapus</button>
    </div>`).join('');
}

async function deleteBroadcast(id) {
  await db.from('broadcasts').delete().eq('id', id);
  showToast('Broadcast dihapus', 'success');
  await loadAdminBroadcast();
}

/* ─────────────────────────────────────────────────────────────
   REALTIME
   ───────────────────────────────────────────────────────────── */
function setupRealtimeListeners() {
  // Broadcasts
  const broadcastCh = db.channel('broadcasts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'broadcasts' }, payload => {
      showBroadcastBanner(payload.new.title + ': ' + payload.new.message);
    }).subscribe();

  // Leaderboard
  const lbCh = db.channel('leaderboard-updates')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'leaderboard' }, () => {
      const lb = document.getElementById('section-leaderboard');
      if (lb.classList.contains('active')) loadLeaderboard();
    }).subscribe();

  // Social
  const socialCh = db.channel('social-updates')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'anonymous_messages' }, () => {
      const panel = document.getElementById('confession-panel');
      if (!panel?.classList.contains('hidden')) loadConfessions();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'confession_replies' }, () => {
      const panel = document.getElementById('confession-panel');
      if (!panel?.classList.contains('hidden')) loadConfessions();
    })
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'comments' }, () => {
      const panel = document.getElementById('comments-panel');
      if (!panel?.classList.contains('hidden')) loadComments();
    }).subscribe();

  realtimeChannels = [broadcastCh, lbCh, socialCh];
}

function cleanupRealtime() {
  realtimeChannels.forEach(ch => ch.unsubscribe());
  realtimeChannels = [];
}

function showBroadcastBanner(text) {
  document.getElementById('broadcast-text').textContent = text;
  document.getElementById('broadcast-banner').classList.remove('hidden');
  setTimeout(() => document.getElementById('broadcast-banner').classList.add('hidden'), 8000);
}

/* ─────────────────────────────────────────────────────────────
   PAGE DISPLAY HELPERS
   ───────────────────────────────────────────────────────────── */
function showLanding() {
  const landing = document.getElementById('page-landing');
  const app     = document.getElementById('page-app');
  app.classList.remove('active');
  app.classList.add('hidden');
  app.style.display = '';
  landing.classList.add('active');
  landing.style.display = '';  // biarkan CSS (.page.active = block) yang handle
  hideLoadingOverlay();
}

function showApp() {
  const landing = document.getElementById('page-landing');
  const app     = document.getElementById('page-app');
  landing.classList.remove('active');
  landing.style.display = 'none';
  app.classList.remove('hidden');  // hapus hidden agar display:none !important tidak berlaku
  app.style.display = '';          // biarkan CSS (#page-app.active) yang atur display:flex
  app.classList.add('active');
}

/* ─────────────────────────────────────────────────────────────
   MODAL HELPERS
   ───────────────────────────────────────────────────────────── */
function openModal(id) { document.getElementById(id).classList.remove('hidden'); }
function closeModal(id) { document.getElementById(id).classList.add('hidden'); }

// Close modal on overlay click
document.querySelectorAll('.modal-overlay').forEach(overlay => {
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.classList.add('hidden');
  });
});

function switchLoginTab(tab) {
  document.getElementById('tab-google').classList.toggle('active', tab === 'google');
  document.getElementById('tab-email').classList.toggle('active', tab === 'email');
  document.getElementById('login-google-panel').classList.toggle('hidden', tab !== 'google');
  document.getElementById('login-email-panel').classList.toggle('hidden', tab !== 'email');
}

/* ─────────────────────────────────────────────────────────────
   TOAST
   ───────────────────────────────────────────────────────────── */
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  toast.innerHTML = `<div class="toast-icon"></div><span>${message}</span>`;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transform = 'translateX(30px)'; toast.style.transition = '0.3s'; setTimeout(() => toast.remove(), 300); }, 3500);
}

/* ─────────────────────────────────────────────────────────────
   LOADING
   ───────────────────────────────────────────────────────────── */
function showLoadingOverlay() { document.getElementById('loading-overlay').classList.remove('hidden'); }
function hideLoadingOverlay() { document.getElementById('loading-overlay').classList.add('hidden'); }

/* ─────────────────────────────────────────────────────────────
   SIDEBAR TOGGLE (mobile)
   ───────────────────────────────────────────────────────────── */
function toggleSidebar() {
  document.getElementById('sidebar').classList.toggle('open');
}

/* ─────────────────────────────────────────────────────────────
   SEARCH DEBOUNCE
   ───────────────────────────────────────────────────────────── */
function debounceSearch(val, type) {
  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(() => {
    if (type === 'subjects') loadSubjects(val);
  }, 300);
}

/* ─────────────────────────────────────────────────────────────
   UTILITIES
   ───────────────────────────────────────────────────────────── */
function generateOTP() {
  return Math.floor(10000000 + Math.random() * 90000000).toString();
}

function validateEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function escapeHTML(str) {
  return String(str).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function escapeAttr(str) {
  return String(str).replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

function scoreColor(score) {
  if (score >= 70) return 'var(--success)';
  if (score >= 50) return 'var(--warning)';
  return 'var(--danger)';
}

function scoreColorHex(score) {
  if (score >= 70) return '#10b981';
  if (score >= 50) return '#f59e0b';
  return '#ef4444';
}

function formatDate(isoStr) {
  if (!isoStr) return '-';
  return new Date(isoStr).toLocaleDateString('id-ID', { day:'numeric', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' });
}

function timeAgo(isoStr) {
  const diff = Date.now() - new Date(isoStr).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Baru saja';
  if (mins < 60) return `${mins} menit lalu`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} jam lalu`;
  const days = Math.floor(hrs / 24);
  return `${days} hari lalu`;
}
