'use strict';

/* =========================================================
   Meu Estudo — app.js
   Tudo salvo no localStorage (funciona offline).
   ========================================================= */

// ---------- Utilidades ----------
const $ = id => document.getElementById(id);

function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (raw === null) return fallback;
    const val = JSON.parse(raw);
    return (val === null || val === undefined) ? fallback : val;
  } catch (e) {
    return fallback;
  }
}

function store(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (e) {
    toast('Não foi possível salvar (armazenamento cheio?)');
  }
}

function escapeHTML(str) {
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function safeColor(c) {
  return /^#[0-9a-f]{3,8}$/i.test(String(c)) ? c : '#64748b';
}

function uid() {
  return Date.now().toString() + Math.random().toString(36).slice(2, 6);
}

function clampInt(value, min, max, def) {
  const n = parseInt(value, 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function formatMinutes(min) {
  min = Math.round(min || 0);
  if (!min) return '0min';
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

// Data no fuso do aparelho (toISOString usa UTC e trocava o dia depois das 21h no Brasil)
function getDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

let toastTimer = null;
function toast(msg, ms = 2500) {
  const el = $('toast');
  if (!el) return;
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), ms);
}

// Executa sem deixar um erro derrubar o resto do app
function safe(fn) {
  try { fn(); } catch (e) { console.error(e); }
}

// ---------- Estado ----------
const DEFAULT_DAILY = 120;

function normalizeGoals(g) {
  const daily = g && Number.isFinite(Number(g.daily)) && Number(g.daily) >= 0
    ? Math.round(Number(g.daily))
    : DEFAULT_DAILY;
  return { daily, weekly: daily * 7, monthly: daily * 30 };
}

const state = {
  subjects: Array.isArray(load('subjects', [])) ? load('subjects', []) : [],
  sessions: Array.isArray(load('sessions', [])) ? load('sessions', []) : [],
  goals: normalizeGoals(load('goals', null)),
  period: 'hoje',
  pomodoro: {
    isRunning: false,     // contando agora
    isBreak: false,       // fase de pausa
    started: false,       // existe um ciclo em andamento (rodando ou pausado)
    timeLeft: 25 * 60,    // segundos restantes
    endTime: null,        // horário (ms) em que a fase termina, quando rodando
    sessionLength: 25 * 60, // duração total da fase atual (s)
    currentSubject: null,
    interval: null
  }
};
const P = state.pomodoro;

function save() {
  state.goals = normalizeGoals(state.goals);
  store('subjects', state.subjects);
  store('sessions', state.sessions);
  store('goals', state.goals);
}

function addSession(data) {
  state.sessions.push(Object.assign({
    id: uid(),
    date: new Date().toISOString(),
    notes: '',
    feeling: 'bom'
  }, data));
  save();
}

function getSubject(id) {
  return state.subjects.find(s => s.id === id) || null;
}

// ---------- Períodos ----------
function getStartOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1); // semana começa na segunda
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

function getStartOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getSessionsInPeriod(period) {
  const now = new Date();
  let start;
  if (period === 'hoje') start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  else if (period === 'semana') start = getStartOfWeek(now);
  else start = getStartOfMonth(now);
  return state.sessions.filter(s => {
    const d = new Date(s.date);
    return !isNaN(d) && d >= start;
  });
}

function getTotalMinutes(sessions) {
  return sessions.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
}

// ---------- Navegação ----------
function showTab(name) {
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === name));
  // o gráfico precisa ser desenhado com a aba visível
  if (name === 'dashboard') safe(() => renderDashboard());
  if (name === 'pomodoro') safe(updatePomodoroUI);
}

document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
});

document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderDashboard(btn.dataset.period);
  });
});

// ---------- Matérias ----------
function renderSubjects() {
  const list = $('subjects-list');
  const selects = [$('pomodoro-subject'), $('session-subject')];
  const previous = selects.map(sel => sel.value);

  selects.forEach(sel => {
    sel.innerHTML = '<option value="">Selecione...</option>';
    state.subjects.forEach(sub => {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = sub.name;
      sel.appendChild(opt);
    });
  });

  // mantém o que estava selecionado; com uma única matéria, já seleciona
  selects.forEach((sel, i) => {
    if (previous[i] && getSubject(previous[i])) sel.value = previous[i];
    else if (state.subjects.length === 1) sel.value = state.subjects[0].id;
  });

  if (state.subjects.length === 0) {
    list.innerHTML = '<p class="empty-msg">Nenhuma matéria ainda. Adicione a primeira acima.</p>';
  } else {
    list.innerHTML = state.subjects.map(sub => `
      <div class="subject-item">
        <div>
          <span class="subject-dot" style="background:${safeColor(sub.color)}"></span>
          <strong>${escapeHTML(sub.name)}</strong>
        </div>
        <button type="button" class="delete-btn" data-id="${escapeHTML(sub.id)}" aria-label="Remover ${escapeHTML(sub.name)}">🗑️</button>
      </div>
    `).join('');
  }
}

// Um único listener para todos os botões de excluir
$('subjects-list').addEventListener('click', e => {
  const btn = e.target.closest('.delete-btn');
  if (!btn) return;
  const id = btn.dataset.id;
  const sub = getSubject(id);
  if (!sub) return;
  const count = state.sessions.filter(s => s.subjectId === id).length;
  const msg = count > 0
    ? `Remover "${sub.name}"? As ${count} sessões dessa matéria também serão apagadas.`
    : `Remover "${sub.name}"?`;
  if (!confirm(msg)) return;

  state.subjects = state.subjects.filter(s => s.id !== id);
  state.sessions = state.sessions.filter(s => s.subjectId !== id);
  save();
  renderSubjects();
  renderDashboard();
  updatePomodoroUI();
});

$('subject-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = $('subject-name').value.trim();
  const color = $('subject-color').value;
  if (!name) return;

  state.subjects.push({ id: uid(), name, color: safeColor(color) });
  save();
  e.target.reset();
  $('subject-color').value = '#6366f1';
  renderSubjects();
  updatePomodoroUI();
  toast('Matéria adicionada ✅');
});

// ---------- Metas (só diária; semana e mês são projeções) ----------
function formatHM(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// "02:30" -> 150 | "2" -> 120 | inválido -> NaN
function parseHM(str) {
  const s = String(str || '').trim();
  const match = s.match(/^(\d{1,2})(?::(\d{0,2}))?$/);
  if (!match) return NaN;
  const h = parseInt(match[1], 10);
  const m = match[2] ? parseInt(match[2], 10) : 0;
  if (m > 59) return NaN;
  const total = h * 60 + m;
  if (total > 24 * 60) return NaN;
  return total;
}

// Máscara: digitando 0230 vira 02:30 (o teclado numérico do iPhone não tem ":")
function maskHM(v) {
  if (v.includes(':')) {
    const [a, ...rest] = v.split(':');
    return a.replace(/\D/g, '').slice(0, 2) + ':' + rest.join('').replace(/\D/g, '').slice(0, 2);
  }
  const d = v.replace(/\D/g, '').slice(0, 4);
  return d.length > 2 ? d.slice(0, 2) + ':' + d.slice(2) : d;
}

function updateGoalExamples() {
  const input = $('goal-daily');
  const ex = $('ex-daily');
  const raw = input.value.trim();
  const d = parseHM(raw);

  ex.classList.remove('error');
  if (!raw) {
    ex.textContent = '';
  } else if (Number.isNaN(d)) {
    ex.textContent = 'Formato inválido. Use HH:MM (ex: 02:30)';
    ex.classList.add('error');
  } else {
    ex.textContent = `= ${formatMinutes(d)} por dia`;
  }

  if (!Number.isNaN(d) && d > 0) {
    $('proj-weekly').textContent = formatMinutes(d * 7);
    $('proj-monthly').textContent = formatMinutes(d * 30);
  } else {
    $('proj-weekly').textContent = '—';
    $('proj-monthly').textContent = '—';
  }
}

function loadGoals() {
  $('goal-daily').value = formatHM(state.goals.daily);
  updateGoalExamples();
}

$('goal-daily').addEventListener('input', e => {
  const masked = maskHM(e.target.value);
  if (masked !== e.target.value) e.target.value = masked;
  updateGoalExamples();
});

$('goals-form').addEventListener('submit', e => {
  e.preventDefault();
  const daily = parseHM($('goal-daily').value);
  if (Number.isNaN(daily)) {
    toast('Digite a meta no formato HH:MM (ex: 02:30)');
    return;
  }
  state.goals = normalizeGoals({ daily });
  save();

  const btn = e.target.querySelector('button[type="submit"]');
  const original = btn.textContent;
  btn.textContent = 'Salvo!';
  btn.style.background = 'var(--success)';
  setTimeout(() => {
    btn.textContent = original;
    btn.style.background = '';
  }, 1500);

  renderDashboard();
});

// ---------- Registro manual ----------
$('session-form').addEventListener('submit', e => {
  e.preventDefault();
  const subjectId = $('session-subject').value;
  const hours = clampInt($('session-hours').value, 0, 12, 0);
  const mins = clampInt($('session-minutes').value, 0, 59, 0);
  const minutes = hours * 60 + mins;
  const notes = $('session-notes').value.trim();
  const feeling = $('session-feeling').value;

  if (!subjectId || !getSubject(subjectId)) {
    toast('Escolha a matéria');
    return;
  }
  if (minutes <= 0) {
    toast('Informe quanto tempo você estudou');
    return;
  }

  addSession({ subjectId, minutes, notes, feeling, type: 'manual' });
  e.target.reset();
  renderSubjects(); // reaplica seleção automática
  toast('Sessão registrada! ✅');
  renderDashboard();
});

// ---------- Dashboard ----------
let subjectChart = null;
const FEELING_EMOJI = { bom: '😊', medio: '😐', ruim: '😞' };

function renderDashboard(period) {
  if (period) state.period = period;
  period = state.period;

  const sessions = getSessionsInPeriod(period);
  const total = getTotalMinutes(sessions);

  let goal, label;
  if (period === 'hoje') { goal = state.goals.daily; label = 'de Hoje'; }
  else if (period === 'semana') { goal = state.goals.daily * 7; label = 'da Semana'; }
  else { goal = state.goals.daily * 30; label = 'do Mês'; }

  const percent = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;
  const done = goal > 0 && total >= goal;

  $('progress-cards').innerHTML = `
    <div class="card progress-card">
      <h3>Progresso ${label}</h3>
      <div class="big-number">${formatMinutes(total)} <span class="goal-of">/ ${goal > 0 ? formatMinutes(goal) : 'sem meta'}</span></div>
      <div class="progress-bar-bg">
        <div class="progress-bar${done ? ' done' : ''}" style="width:${percent}%"></div>
      </div>
      <div class="progress-footer">${done ? 'Meta batida! 🎉' : (goal > 0 ? percent + '%' : '')}</div>
    </div>
  `;

  renderSubjectChart(sessions);
  renderRecentSessions();
}

function renderSubjectChart(sessions) {
  const bySubject = {};
  sessions.forEach(s => {
    bySubject[s.subjectId] = (bySubject[s.subjectId] || 0) + (Number(s.minutes) || 0);
  });

  const items = [];
  Object.entries(bySubject).forEach(([id, mins]) => {
    const sub = getSubject(id);
    if (sub && mins > 0) items.push({ name: sub.name, color: safeColor(sub.color), mins });
  });
  items.sort((a, b) => b.mins - a.mins);

  const canvas = $('subjectChart');
  const fallback = $('subject-fallback');
  const empty = $('chart-empty');

  if (subjectChart) {
    try { subjectChart.destroy(); } catch (e) { /* ignora */ }
    subjectChart = null;
  }
  fallback.innerHTML = '';

  if (items.length === 0) {
    canvas.style.display = 'none';
    empty.style.display = 'block';
    return;
  }
  empty.style.display = 'none';

  // Chart.js vem da internet; sem conexão usa barras simples
  if (typeof window.Chart !== 'undefined') {
    try {
      canvas.style.display = 'block';
      subjectChart = new window.Chart(canvas, {
        type: 'doughnut',
        data: {
          labels: items.map(i => i.name),
          datasets: [{ data: items.map(i => i.mins), backgroundColor: items.map(i => i.color), borderWidth: 0 }]
        },
        options: {
          plugins: {
            legend: { position: 'bottom', labels: { color: '#f8fafc', padding: 12, font: { size: 12 } } },
            tooltip: { callbacks: { label: ctx => ` ${ctx.label}: ${formatMinutes(ctx.parsed)}` } }
          },
          cutout: '68%'
        }
      });
      return;
    } catch (e) {
      console.error(e);
      subjectChart = null;
    }
  }

  canvas.style.display = 'none';
  const max = items[0].mins;
  fallback.innerHTML = items.map(i => `
    <div class="bar-row">
      <div class="bar-label"><span class="subject-dot" style="background:${i.color}"></span>${escapeHTML(i.name)}<span class="bar-value">${formatMinutes(i.mins)}</span></div>
      <div class="progress-bar-bg"><div class="progress-bar" style="width:${Math.max(4, Math.round(i.mins / max * 100))}%;background:${i.color}"></div></div>
    </div>
  `).join('');
}

function renderRecentSessions() {
  const container = $('recent-sessions');
  const recent = [...state.sessions]
    .sort((a, b) => new Date(b.date) - new Date(a.date))
    .slice(0, 6);

  if (recent.length === 0) {
    container.innerHTML = '<p class="empty-msg">Nenhuma sessão ainda</p>';
    return;
  }

  container.innerHTML = recent.map(s => {
    const sub = getSubject(s.subjectId) || { name: '?', color: '#64748b' };
    const date = new Date(s.date);
    const dateText = isNaN(date) ? '' : date.toLocaleDateString('pt-BR');
    const emoji = FEELING_EMOJI[s.feeling] || '';
    return `
      <div class="session-item">
        <div class="session-info">
          <span class="subject-dot" style="background:${safeColor(sub.color)}"></span>
          <strong>${escapeHTML(sub.name)}</strong> ${emoji}
          ${s.notes ? `<div class="session-notes">${escapeHTML(s.notes)}</div>` : ''}
        </div>
        <div class="session-meta">
          <div>${formatMinutes(s.minutes)}</div>
          <div class="session-date">${dateText}</div>
        </div>
      </div>
    `;
  }).join('');
}

// ---------- Pomodoro ----------
// O timer usa o horário real de término (endTime). Assim ele não atrasa quando
// o iPhone bloqueia a tela, e continua certo se o app for fechado e reaberto.

function getFocusMinutes() { return clampInt($('focus-time').value, 1, 120, 25); }
function getBreakMinutes() { return clampInt($('break-time').value, 1, 30, 5); }

function savePomodoro() {
  store('pomodoroState', {
    isRunning: P.isRunning,
    isBreak: P.isBreak,
    started: P.started,
    timeLeft: P.timeLeft,
    endTime: P.endTime,
    sessionLength: P.sessionLength,
    currentSubject: P.currentSubject
  });
}

function countPomodorosToday() {
  const today = getDateKey();
  return state.sessions.filter(s =>
    (s.type === 'pomodoro' || (!s.type && s.notes === 'Pomodoro')) &&
    getDateKey(new Date(s.date)) === today
  ).length;
}

function updateTimerDisplay() {
  const t = Math.max(0, P.timeLeft);
  const mins = Math.floor(t / 60);
  const secs = t % 60;
  const text = `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  $('timer-display').textContent = text;
  if (P.started) document.title = `${text} · ${P.isBreak ? 'Pausa' : 'Foco'}`;
  else document.title = 'Meu Estudo';
}

function updatePomodoroUI() {
  updateTimerDisplay();

  $('mode-label').textContent = P.isBreak ? 'Pausa' : 'Foco';
  $('pomodoro-screen').classList.toggle('is-break', P.isBreak);

  let subjectText;
  if (P.isBreak) {
    subjectText = 'Hora de descansar 😌';
  } else if (P.started) {
    const sub = getSubject(P.currentSubject);
    subjectText = sub ? sub.name : 'Matéria removida';
  } else {
    const sub = getSubject($('pomodoro-subject').value);
    subjectText = sub ? sub.name : 'Selecione uma matéria';
  }
  $('current-subject').textContent = subjectText;

  const btnStart = $('btn-start');
  btnStart.disabled = P.isRunning;
  if (P.isRunning) btnStart.textContent = P.isBreak ? 'Pausa em andamento' : 'Estudando...';
  else if (P.started) btnStart.textContent = 'Continuar';
  else btnStart.textContent = 'Iniciar';

  $('btn-pause').disabled = !P.isRunning;
  $('pomodoros-hoje').textContent = countPomodorosToday();
}

function startTicking() {
  stopTicking();
  P.interval = setInterval(tick, 500);
}

function stopTicking() {
  if (P.interval) clearInterval(P.interval);
  P.interval = null;
}

function tick() {
  if (!P.isRunning || !P.endTime) return;
  const now = Date.now();
  if (now >= P.endTime) {
    finishPhase(now - P.endTime < 5000);
    return;
  }
  const left = Math.ceil((P.endTime - now) / 1000);
  if (left !== P.timeLeft) {
    P.timeLeft = left;
    updateTimerDisplay();
  }
}

function startPomodoro() {
  if (P.isRunning) return;

  if (!P.started) {
    // começando um foco novo
    const subjectId = $('pomodoro-subject').value;
    if (!subjectId || !getSubject(subjectId)) {
      toast(state.subjects.length ? 'Selecione uma matéria primeiro' : 'Cadastre uma matéria na aba Matérias');
      return;
    }
    P.currentSubject = subjectId;
    P.isBreak = false;
    P.sessionLength = getFocusMinutes() * 60;
    P.timeLeft = P.sessionLength;
    P.started = true;
  }

  P.endTime = Date.now() + P.timeLeft * 1000;
  P.isRunning = true;
  startTicking();
  savePomodoro();
  updatePomodoroUI();
}

function startBreak(fromTime) {
  P.isBreak = true;
  P.started = true;
  P.sessionLength = getBreakMinutes() * 60;
  P.endTime = fromTime + P.sessionLength * 1000;
  P.timeLeft = Math.max(0, Math.ceil((P.endTime - Date.now()) / 1000));
  P.isRunning = true;
  startTicking();
}

function pausePomodoro() {
  if (!P.isRunning) return;
  P.timeLeft = Math.max(0, Math.ceil((P.endTime - Date.now()) / 1000));
  P.endTime = null;
  P.isRunning = false;
  stopTicking();
  savePomodoro();
  updatePomodoroUI();
}

function resetPomodoroState() {
  stopTicking();
  P.isRunning = false;
  P.isBreak = false;
  P.started = false;
  P.endTime = null;
  P.currentSubject = null;
  P.sessionLength = getFocusMinutes() * 60;
  P.timeLeft = P.sessionLength;
  savePomodoro();
  updatePomodoroUI();
}

function getElapsedFocusSeconds() {
  if (!P.started || P.isBreak) return 0;
  const remaining = P.isRunning && P.endTime ? (P.endTime - Date.now()) / 1000 : P.timeLeft;
  return Math.max(0, P.sessionLength - remaining);
}

function resetPomodoro() {
  if (P.started && !P.isBreak && getElapsedFocusSeconds() >= 60) {
    if (!confirm('Zerar o timer? O tempo desta sessão NÃO será gravado.\n(Use "Parar" para gravar.)')) return;
  }
  resetPomodoroState();
}

function finishPhase(live) {
  const endedAt = P.endTime || Date.now();
  stopTicking();

  if (!P.isBreak) {
    // fim do foco: grava a sessão
    const subjectId = P.currentSubject;
    if (subjectId && getSubject(subjectId)) {
      addSession({
        subjectId,
        minutes: Math.max(1, Math.round(P.sessionLength / 60)),
        date: new Date(endedAt).toISOString(),
        notes: 'Pomodoro',
        feeling: 'bom',
        type: 'pomodoro'
      });
    }
    startBreak(endedAt);
    savePomodoro();
    updatePomodoroUI();
    safe(() => renderDashboard());
    notify(live, 'Pomodoro concluído! Hora da pausa.');
    tick(); // se o app ficou fechado e a pausa também já acabou
  } else {
    // fim da pausa
    resetPomodoroState();
    notify(live, 'Pausa acabou! Pronto pra mais um?');
  }
}

// Aviso no fim de cada fase: bipe + alerta (ou só um aviso na tela se o app estava fechado)
let audioCtx = null;
function unlockAudio() {
  try {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    if (!audioCtx) audioCtx = new AC();
    if (audioCtx.state === 'suspended') audioCtx.resume();
  } catch (e) { /* sem som */ }
}

function beep() {
  try {
    if (!audioCtx) return;
    const t0 = audioCtx.currentTime;
    for (let i = 0; i < 3; i++) {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.frequency.value = 880;
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      const s = t0 + i * 0.35;
      gain.gain.setValueAtTime(0.0001, s);
      gain.gain.exponentialRampToValueAtTime(0.3, s + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, s + 0.25);
      osc.start(s);
      osc.stop(s + 0.3);
    }
  } catch (e) { /* sem som */ }
}

function notify(live, msg) {
  if (live && document.visibilityState !== 'hidden') {
    beep();
    try { if (navigator.vibrate) navigator.vibrate([200, 100, 200]); } catch (e) { /* ignora */ }
    alert(msg);
  } else {
    toast(msg, 5000);
  }
}

// ---------- Parar (com opção de gravar) ----------
let pendingStop = null;

function stopPomodoro() {
  if (!P.started) {
    toast('Nenhuma sessão em andamento.');
    return;
  }
  if (P.isBreak) {
    resetPomodoroState();
    toast('Pausa encerrada.');
    return;
  }

  const wasRunning = P.isRunning;
  pausePomodoro(); // congela o tempo enquanto decide
  const minutes = Math.max(1, Math.round(getElapsedFocusSeconds() / 60));
  pendingStop = { subjectId: P.currentSubject, minutes, wasRunning };
  openStopModal();
}

function openStopModal() {
  const sub = getSubject(pendingStop.subjectId);
  $('stop-subject').textContent = sub ? sub.name : '—';
  $('stop-time').textContent = formatMinutes(pendingStop.minutes);
  $('stop-notes').value = '';
  setFeeling('bom');
  $('stop-step-ask').hidden = false;
  $('stop-step-details').hidden = true;
  $('stop-modal').hidden = false;
}

function closeStopModal() {
  $('stop-modal').hidden = true;
}

function setFeeling(value) {
  document.querySelectorAll('.feeling-btn').forEach(b => {
    b.classList.toggle('active', b.dataset.feeling === value);
  });
}

function getSelectedFeeling() {
  const active = document.querySelector('.feeling-btn.active');
  return active ? active.dataset.feeling : 'bom';
}

$('stop-yes').addEventListener('click', () => {
  $('stop-step-ask').hidden = true;
  $('stop-step-details').hidden = false;
  $('stop-notes').focus();
});

$('stop-no').addEventListener('click', () => {
  closeStopModal();
  pendingStop = null;
  resetPomodoroState();
  toast('Ok. Lembre de registrar manualmente na aba Registrar.', 5000);
});

$('stop-continue').addEventListener('click', () => {
  closeStopModal();
  const resume = pendingStop && pendingStop.wasRunning;
  pendingStop = null;
  if (resume) startPomodoro();
});

$('stop-back').addEventListener('click', () => {
  $('stop-step-ask').hidden = false;
  $('stop-step-details').hidden = true;
});

document.querySelectorAll('.feeling-btn').forEach(b => {
  b.addEventListener('click', () => setFeeling(b.dataset.feeling));
});

$('stop-save').addEventListener('click', () => {
  if (!pendingStop) { closeStopModal(); return; }
  const { subjectId, minutes } = pendingStop;
  const notes = $('stop-notes').value.trim();
  const feeling = getSelectedFeeling();

  closeStopModal();
  pendingStop = null;

  if (subjectId && getSubject(subjectId)) {
    addSession({ subjectId, minutes, notes: notes || 'Pomodoro (parcial)', feeling, type: 'pomodoro-parcial' });
    toast('Sessão salva! ✅');
  } else {
    toast('A matéria foi removida, sessão não gravada.');
  }
  resetPomodoroState();
  renderDashboard();
});

// ---------- Botões do Pomodoro ----------
// (antes só o "Parar" tinha listener — por isso Iniciar, Pausar e Reset não faziam nada)
$('btn-start').addEventListener('click', () => {
  unlockAudio(); // o iPhone só libera som depois de um toque
  startPomodoro();
});
$('btn-pause').addEventListener('click', pausePomodoro);
$('btn-stop').addEventListener('click', stopPomodoro);
$('btn-reset').addEventListener('click', resetPomodoro);

$('pomodoro-subject').addEventListener('change', updatePomodoroUI);

function savePomodoroSettings() {
  store('pomodoroSettings', { focus: getFocusMinutes(), brk: getBreakMinutes() });
}

$('focus-time').addEventListener('change', () => {
  $('focus-time').value = getFocusMinutes();
  savePomodoroSettings();
  if (!P.started) {
    P.sessionLength = getFocusMinutes() * 60;
    P.timeLeft = P.sessionLength;
    savePomodoro();
    updatePomodoroUI();
  }
});

$('break-time').addEventListener('change', () => {
  $('break-time').value = getBreakMinutes();
  savePomodoroSettings();
});

// Ao voltar para o app (tela desbloqueada), atualiza na hora
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') tick();
});

function restorePomodoro() {
  const settings = load('pomodoroSettings', null);
  if (settings && typeof settings === 'object') {
    $('focus-time').value = clampInt(settings.focus, 1, 120, 25);
    $('break-time').value = clampInt(settings.brk, 1, 30, 5);
  }

  const saved = load('pomodoroState', null);
  if (!saved || typeof saved !== 'object' || !saved.started) {
    resetPomodoroState();
    return;
  }

  P.isBreak = !!saved.isBreak;
  P.started = true;
  P.sessionLength = clampInt(saved.sessionLength, 1, 120 * 60, getFocusMinutes() * 60);
  P.timeLeft = clampInt(saved.timeLeft, 0, P.sessionLength, P.sessionLength);
  P.currentSubject = saved.currentSubject || null;
  P.endTime = Number(saved.endTime) || null;
  P.isRunning = !!saved.isRunning && !!P.endTime;

  // foco cuja matéria não existe mais: descarta
  if (!P.isBreak && !getSubject(P.currentSubject)) {
    resetPomodoroState();
    return;
  }

  if (P.currentSubject && getSubject(P.currentSubject)) {
    $('pomodoro-subject').value = P.currentSubject;
  }

  updatePomodoroUI();
  if (P.isRunning) {
    startTicking();
    tick();
  }
}

// ---------- Início ----------
function init() {
  safe(renderSubjects);
  safe(loadGoals);
  safe(restorePomodoro);
  safe(() => renderDashboard('hoje'));
  safe(updatePomodoroUI);

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

init();
