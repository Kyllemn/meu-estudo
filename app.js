'use strict';

/* =========================================================
   Meu Estudo — app.js
   Tudo salvo no localStorage (funciona offline).
   ========================================================= */

// Versão do app: aparece no topo da tela. Deve ser igual ao data-version do index.html
// e ao ?v= dos arquivos. Ao publicar mudanças, aumente nos 3 lugares + service-worker.
const APP_VERSION = '4';

// ---------- Utilidades ----------
// Se um elemento não existir (ex.: HTML antigo em cache), devolve um "elemento falso"
// em vez de travar o app inteiro.
function missingElement() {
  return {
    value: '', textContent: '', innerHTML: '', hidden: true, disabled: false,
    style: {}, dataset: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    addEventListener() {}, appendChild() {}, focus() {}, reset() {},
    querySelector() { return null; }, querySelectorAll() { return []; }, closest() { return null; }
  };
}
const $ = id => document.getElementById(id) || missingElement();
const exists = id => !!document.getElementById(id);

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

// Mostra qualquer erro na tela (ajuda a descobrir problemas no celular)
window.addEventListener('error', e => {
  if (!e || !e.message || e.message === 'Script error.') return;
  toast('⚠️ Erro: ' + e.message + ' (v' + APP_VERSION + ')', 8000);
});

// HTML e JS de versões diferentes (cache antigo)? Recarrega uma vez buscando tudo novo.
(function checkVersion() {
  const htmlVersion = document.documentElement.getAttribute('data-version');
  let tried = false;
  try { tried = sessionStorage.getItem('reloadedFor') === APP_VERSION; } catch (e) { /* ignora */ }
  if (htmlVersion !== APP_VERSION && !tried) {
    try { sessionStorage.setItem('reloadedFor', APP_VERSION); } catch (e) { /* ignora */ }
    location.replace(location.pathname + '?v=' + APP_VERSION + '&t=' + Date.now());
  }
})();

// ---------- Estado ----------
const DEFAULT_DAILY = 120;

function normalizeGoals(g) {
  const daily = g && Number.isFinite(Number(g.daily)) && Number(g.daily) >= 0
    ? Math.round(Number(g.daily))
    : DEFAULT_DAILY;
  return { daily, weekly: daily * 7, monthly: daily * 30 };
}

// ---------- Projetos ----------
// "Principal" usa as chaves antigas do localStorage (seus dados atuais continuam lá).
// Cada projeto usa chaves próprias: estudo:proj:<id>:<nome>
const MAX_PROJECTS = 5;
const SPACE_KEYS = ['subjects', 'sessions', 'goals', 'pomodoroState', 'pomodoroSettings', 'lastSubject'];
const MAIN_PROJECT = { id: '', name: 'Principal', color: '#7c3aed' };

function loadProjects() {
  const list = load('estudo:projects', []);
  if (!Array.isArray(list)) return [];
  return list
    .filter(p => p && typeof p.id === 'string' && p.id && typeof p.name === 'string')
    .slice(0, MAX_PROJECTS)
    .map(p => ({ id: p.id, name: p.name, color: safeColor(p.color), createdAt: p.createdAt || '' }));
}

let projects = loadProjects();
let activeProjectId = load('estudo:activeProject', '');
if (typeof activeProjectId !== 'string' || !projects.some(p => p.id === activeProjectId)) activeProjectId = '';

function keyFor(projectId, name) {
  return projectId ? `estudo:proj:${projectId}:${name}` : name;
}
function key(name) { return keyFor(activeProjectId, name); }

function getActiveProject() {
  return projects.find(p => p.id === activeProjectId) || MAIN_PROJECT;
}

function loadArray(k) {
  const v = load(k, []);
  return Array.isArray(v) ? v : [];
}

const state = {
  subjects: loadArray(key('subjects')),
  sessions: loadArray(key('sessions')),
  goals: normalizeGoals(load(key('goals'), null)),
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
  store(key('subjects'), state.subjects);
  store(key('sessions'), state.sessions);
  store(key('goals'), state.goals);
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
let lastTab = 'dashboard';
function showTab(name) {
  if (!exists(name)) return;
  if (name !== 'menu') lastTab = name;
  document.querySelectorAll('.nav-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  document.querySelectorAll('.tab').forEach(t => t.classList.toggle('active', t.id === name));
  $('menu-btn').classList.toggle('active', name === 'menu');
  if (name === 'menu') safe(renderProjectUI);
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

  // mantém o que estava selecionado; senão usa a última matéria usada (ou a primeira)
  const last = load(key('lastSubject'), null);
  const fallbackId = getSubject(last) ? last : (state.subjects[0] ? state.subjects[0].id : '');
  selects.forEach((sel, i) => {
    if (previous[i] && getSubject(previous[i])) sel.value = previous[i];
    else sel.value = fallbackId;
  });

  if (state.subjects.length === 0) {
    list.innerHTML = '<p class="empty-msg">Nenhuma matéria ainda. Adicione a primeira acima.</p>';
  } else {
    list.innerHTML = state.subjects.map(sub => `
      <div class="subject-item">
        <div class="subject-main">
          <button type="button" class="dot-btn" data-color-id="${escapeHTML(sub.id)}" aria-label="Mudar cor de ${escapeHTML(sub.name)}">
            <span class="subject-dot" style="background:${safeColor(sub.color)}"></span>
          </button>
          <strong>${escapeHTML(sub.name)}</strong>
        </div>
        <button type="button" class="delete-btn" data-id="${escapeHTML(sub.id)}" aria-label="Remover ${escapeHTML(sub.name)}">🗑️</button>
      </div>
    `).join('');
  }
}

// Um único listener para os botões da lista (mudar cor / excluir)
$('subjects-list').addEventListener('click', e => {
  const colorBtn = e.target.closest('.dot-btn');
  if (colorBtn) {
    const sub = getSubject(colorBtn.dataset.colorId);
    if (!sub) return;
    pickColor(sub.color, color => {
      sub.color = color;
      save();
      renderSubjects();
      renderDashboard();
      toast('Cor atualizada ✅');
    });
    return;
  }
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
  $('subject-color').value = suggestColor(state.subjects.map(s => s.color));
  paintColorField('subject-color');
  renderSubjects();
  updatePomodoroUI();
  toast('Matéria adicionada ✅');
});

// ---------- Escolha de cor (com botão OK) ----------
// O seletor nativo do iPhone não tem botão OK; este é próprio do app.
const PALETTE = [
  '#ef4444', '#f97316', '#f59e0b', '#eab308', '#84cc16', '#22c55e',
  '#10b981', '#14b8a6', '#06b6d4', '#0ea5e9', '#3b82f6', '#6366f1',
  '#8b5cf6', '#a855f7', '#d946ef', '#ec4899', '#f43f5e', '#94a3b8'
];
let colorPick = null; // { value, onOk }

function toHex6(c) {
  c = String(c || '');
  if (/^#[0-9a-f]{6}$/i.test(c)) return c.toLowerCase();
  if (/^#[0-9a-f]{3}$/i.test(c)) return ('#' + c[1] + c[1] + c[2] + c[2] + c[3] + c[3]).toLowerCase();
  return '#6366f1';
}

// Sugere uma cor da paleta que ainda não foi usada
function suggestColor(used) {
  const usedSet = new Set((used || []).map(c => toHex6(c)));
  return PALETTE.find(c => !usedSet.has(c)) || PALETTE[Math.floor(Math.random() * PALETTE.length)];
}

function pickColor(initial, onOk) {
  if (!exists('color-modal')) {
    // plano B (HTML antigo)
    const c = prompt('Digite a cor (ex: #ff0000)', toHex6(initial));
    if (c && /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(c.trim())) onOk(toHex6(c.trim()));
    return;
  }
  colorPick = { value: toHex6(initial), onOk };
  $('color-grid').innerHTML = PALETTE.map(c =>
    `<button type="button" class="color-swatch-btn" data-color="${c}" style="background:${c}" aria-label="Cor ${c}"></button>`
  ).join('');
  updateColorPreview();
  $('color-modal').hidden = false;
}

function updateColorPreview() {
  if (!colorPick) return;
  const v = colorPick.value;
  $('color-preview-dot').style.background = v;
  $('color-custom').value = v;
  document.querySelectorAll('.color-swatch-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.color === v);
  });
}

$('color-grid').addEventListener('click', e => {
  const b = e.target.closest('.color-swatch-btn');
  if (!b || !colorPick) return;
  colorPick.value = b.dataset.color;
  updateColorPreview();
});

function onCustomColor() {
  if (!colorPick) return;
  colorPick.value = toHex6($('color-custom').value);
  updateColorPreview();
}
$('color-custom').addEventListener('input', onCustomColor);
$('color-custom').addEventListener('change', onCustomColor);

$('color-ok').addEventListener('click', () => {
  const pick = colorPick;
  colorPick = null;
  $('color-modal').hidden = true;
  if (pick && pick.onOk) pick.onOk(pick.value);
});

$('color-cancel').addEventListener('click', () => {
  colorPick = null;
  $('color-modal').hidden = true;
});

// Campo de cor de formulário: botão que mostra a cor + input escondido com o valor
function paintColorField(inputId) {
  const btn = document.querySelector(`.color-field[data-for="${inputId}"]`);
  if (!btn) return;
  const sw = btn.querySelector('.color-field-swatch');
  if (sw) sw.style.background = toHex6($(inputId).value);
}

document.querySelectorAll('.color-field').forEach(btn => {
  btn.addEventListener('click', () => {
    const inputId = btn.dataset.for;
    pickColor($(inputId).value, color => {
      $(inputId).value = color;
      paintColorField(inputId);
    });
  });
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
  store(key('pomodoroState'), {
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
      if (state.subjects.length) {
        toast('Selecione uma matéria primeiro');
      } else {
        alert('Cadastre uma matéria primeiro (aba Matérias).');
        showTab('materias');
      }
      return;
    }
    P.currentSubject = subjectId;
    store(key('lastSubject'), subjectId);
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
  if (exists('stop-modal')) openStopModal();
  else stopWithDialogs();
}

// Plano B do Parar, caso a janela não exista na página
function stopWithDialogs() {
  const { subjectId, minutes, wasRunning } = pendingStop;
  pendingStop = null;
  if (confirm(`Quer gravar essa sessão automaticamente? (${formatMinutes(minutes)})`)) {
    const notes = prompt('O que você estudou? (resumo rápido)');
    if (notes === null) { if (wasRunning) startPomodoro(); return; }
    const f = (prompt('Como foi? bom, medio ou ruim', 'bom') || '').toLowerCase().trim();
    const feeling = ['bom', 'medio', 'ruim'].includes(f) ? f : 'bom';
    if (getSubject(subjectId)) {
      addSession({ subjectId, minutes, notes: notes.trim() || 'Pomodoro (parcial)', feeling, type: 'pomodoro-parcial' });
      toast('Sessão salva! ✅');
    }
  } else {
    toast('Ok. Lembre de registrar manualmente na aba Registrar.', 5000);
  }
  resetPomodoroState();
  renderDashboard();
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
  store(key('pomodoroSettings'), { focus: getFocusMinutes(), brk: getBreakMinutes() });
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
  stopTicking();
  const settings = load(key('pomodoroSettings'), null);
  const hasSettings = settings && typeof settings === 'object';
  $('focus-time').value = hasSettings ? clampInt(settings.focus, 1, 120, 25) : 25;
  $('break-time').value = hasSettings ? clampInt(settings.brk, 1, 30, 5) : 5;

  const saved = load(key('pomodoroState'), null);
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

// ---------- Janela de confirmação (Sim / Não) ----------
let dialogHandlers = null;

function askDialog(opts, onYes, onNo) {
  const o = Object.assign({ title: '', message: '', yes: 'Sim', no: 'Não', danger: false, input: null }, opts);
  const hasInput = o.input !== null && o.input !== undefined;

  if (!exists('dialog')) {
    // plano B (HTML antigo)
    const text = (o.title ? o.title + '\n\n' : '') + o.message;
    if (hasInput) {
      const v = prompt(text, o.input);
      if (v !== null) { if (onYes) onYes(v); } else if (onNo) onNo();
    } else if (!o.no) {
      alert(text); if (onYes) onYes(true);
    } else if (confirm(text)) { if (onYes) onYes(true); } else if (onNo) onNo();
    return;
  }

  $('dialog-title').textContent = o.title;
  $('dialog-title').hidden = !o.title;
  $('dialog-message').textContent = o.message;
  $('dialog-input').hidden = !hasInput;
  $('dialog-input').value = hasInput ? o.input : '';
  $('dialog-yes').textContent = o.yes;
  $('dialog-yes').classList.toggle('danger', !!o.danger);
  $('dialog-no').textContent = o.no || '';
  $('dialog-no').hidden = !o.no;
  dialogHandlers = { onYes, onNo, hasInput };
  $('dialog').hidden = false;
  if (hasInput) $('dialog-input').focus();
}

function closeDialog(answerYes) {
  const h = dialogHandlers;
  dialogHandlers = null;
  $('dialog').hidden = true;
  if (!h) return;
  if (answerYes) { if (h.onYes) h.onYes(h.hasInput ? $('dialog-input').value : true); }
  else if (h.onNo) h.onNo();
}

$('dialog-yes').addEventListener('click', () => closeDialog(true));
$('dialog-no').addEventListener('click', () => closeDialog(false));
$('dialog-input').addEventListener('keydown', e => {
  if (e.key === 'Enter') { e.preventDefault(); closeDialog(true); }
});

// ---------- Projetos: trocar, criar, renomear, excluir ----------
function saveProjects() {
  store('estudo:projects', projects);
  store('estudo:activeProject', activeProjectId);
}

// Recarrega tudo do projeto ativo
function loadSpace() {
  stopTicking();
  state.subjects = loadArray(key('subjects'));
  state.sessions = loadArray(key('sessions'));
  state.goals = normalizeGoals(load(key('goals'), null));
  ['session-hours', 'session-minutes', 'session-notes'].forEach(id => { $(id).value = ''; });
  $('session-feeling').value = 'bom';
  $('pomodoro-subject').value = '';
  $('session-subject').value = '';
  safe(renderSubjects);
  safe(loadGoals);
  safe(restorePomodoro);
  safe(() => renderDashboard());
  safe(updatePomodoroUI);
  safe(renderProjectUI);
}

function projectStats(projectId) {
  const subjects = projectId === activeProjectId ? state.subjects : loadArray(keyFor(projectId, 'subjects'));
  const sessions = projectId === activeProjectId ? state.sessions : loadArray(keyFor(projectId, 'sessions'));
  return { subjects: subjects.length, minutes: getTotalMinutes(sessions) };
}

function renderProjectUI() {
  const active = getActiveProject();
  $('project-chip-name').textContent = active.name;
  $('project-chip-dot').style.background = active.color;
  $('reset-current').textContent = activeProjectId
    ? `Zerar dados do projeto "${active.name}"`
    : 'Zerar dados principais';

  const all = [MAIN_PROJECT].concat(projects);
  $('projects-list').innerHTML = all.map(p => {
    const st = projectStats(p.id);
    const isActive = p.id === activeProjectId;
    const pid = escapeHTML(p.id);
    return `
      <div class="project-item${isActive ? ' active' : ''}">
        <div class="project-main">
          ${p.id
            ? `<button type="button" class="dot-btn" data-action="color" data-id="${pid}" aria-label="Mudar cor de ${escapeHTML(p.name)}"><span class="subject-dot" style="background:${safeColor(p.color)}"></span></button>`
            : `<span class="dot-btn static"><span class="subject-dot" style="background:${p.color}"></span></span>`}
          <div class="project-text">
            <strong>${escapeHTML(p.name)}</strong>${isActive ? ' <span class="badge">atual</span>' : ''}
            <div class="project-stats">${st.subjects} ${st.subjects === 1 ? 'matéria' : 'matérias'} · ${formatMinutes(st.minutes)} estudados</div>
          </div>
        </div>
        <div class="project-actions">
          ${isActive ? '' : `<button type="button" class="btn-small" data-action="open" data-id="${pid}">Abrir</button>`}
          ${p.id ? `<button type="button" class="icon-btn" data-action="rename" data-id="${pid}" aria-label="Renomear ${escapeHTML(p.name)}">✏️</button>
                     <button type="button" class="icon-btn" data-action="delete" data-id="${pid}" aria-label="Excluir ${escapeHTML(p.name)}">🗑️</button>` : ''}
        </div>
      </div>`;
  }).join('');

  const full = projects.length >= MAX_PROJECTS;
  $('project-create').disabled = full;
  $('project-name').disabled = full;
  $('project-limit').textContent = full
    ? `Limite de ${MAX_PROJECTS} projetos atingido. Exclua um para criar outro.`
    : `${projects.length} de ${MAX_PROJECTS} projetos criados.`;
}

function blockedByPomodoro(actionText) {
  if (!P.started) return false;
  askDialog({
    title: 'Pomodoro em andamento',
    message: `Pare ou termine o Pomodoro antes de ${actionText}.`,
    yes: 'Ir para o Pomodoro',
    no: 'Cancelar'
  }, () => showTab('pomodoro'));
  return true;
}

function switchProject(id) {
  if (id === activeProjectId) return;
  if (id && !projects.some(p => p.id === id)) return;
  if (blockedByPomodoro('trocar de projeto')) return;
  activeProjectId = id;
  saveProjects();
  loadSpace();
  showTab('dashboard');
  toast(`Projeto: ${getActiveProject().name}`);
}

function removeSpaceData(projectId) {
  SPACE_KEYS.forEach(k => {
    try { localStorage.removeItem(keyFor(projectId, k)); } catch (e) { /* ignora */ }
  });
}

$('projects-list').addEventListener('click', e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const id = btn.dataset.id || '';
  const action = btn.dataset.action;

  if (action === 'open') { switchProject(id); return; }

  const proj = projects.find(p => p.id === id);
  if (!proj) return;

  if (action === 'color') {
    pickColor(proj.color, color => {
      proj.color = color;
      saveProjects();
      renderProjectUI();
    });
  } else if (action === 'rename') {
    askDialog({ title: 'Renomear projeto', message: 'Novo nome:', input: proj.name, yes: 'Salvar', no: 'Cancelar' }, value => {
      const name = String(value || '').trim().slice(0, 40);
      if (!name) { toast('O nome não pode ficar vazio'); return; }
      if (nameTaken(name, proj.id)) { toast('Já existe um projeto com esse nome'); return; }
      proj.name = name;
      saveProjects();
      renderProjectUI();
      toast('Projeto renomeado ✅');
    });
  } else if (action === 'delete') {
    if (id === activeProjectId && blockedByPomodoro('excluir este projeto')) return;
    askDialog({
      title: 'Excluir projeto',
      message: `Deseja excluir o projeto "${proj.name}"?`
    }, () => {
      askDialog({
        title: 'Tem certeza?',
        message: `Todas as matérias, sessões e metas de "${proj.name}" serão apagadas. Não dá para desfazer.`,
        yes: 'Sim, excluir',
        danger: true
      }, () => {
        removeSpaceData(id);
        projects = projects.filter(p => p.id !== id);
        if (activeProjectId === id) {
          activeProjectId = '';
          saveProjects();
          loadSpace();
        } else {
          saveProjects();
          renderProjectUI();
        }
        toast('Projeto excluído');
      });
    });
  }
});

function nameTaken(name, exceptId) {
  const n = name.toLowerCase();
  if (n === MAIN_PROJECT.name.toLowerCase()) return true;
  return projects.some(p => p.id !== exceptId && p.name.toLowerCase() === n);
}

$('project-form').addEventListener('submit', e => {
  e.preventDefault();
  if (projects.length >= MAX_PROJECTS) {
    toast(`Limite de ${MAX_PROJECTS} projetos atingido`);
    return;
  }
  const name = $('project-name').value.trim().slice(0, 40);
  if (!name) { toast('Digite o nome do projeto'); return; }
  if (nameTaken(name)) { toast('Já existe um projeto com esse nome'); return; }

  const proj = { id: 'p' + uid(), name, color: toHex6($('project-color').value), createdAt: new Date().toISOString() };
  projects.push(proj);
  saveProjects();
  $('project-name').value = '';
  $('project-color').value = suggestColor(projects.map(p => p.color));
  paintColorField('project-color');

  if (P.started) {
    renderProjectUI();
    toast('Projeto criado. Termine o Pomodoro para abrir.', 4000);
  } else {
    activeProjectId = proj.id;
    saveProjects();
    loadSpace();
    showTab('dashboard');
    toast(`Projeto "${name}" criado e aberto ✅`, 3500);
  }
});

// ---------- Zerar dados (2 confirmações) ----------
$('reset-current').addEventListener('click', () => {
  const active = getActiveProject();
  const isMain = !activeProjectId;
  askDialog({
    title: 'Zerar dados',
    message: isMain
      ? 'Deseja reiniciar os dados principais?'
      : `Deseja reiniciar os dados do projeto "${active.name}"?`
  }, () => {
    askDialog({
      title: 'Tem certeza?',
      message: `Todas as matérias, sessões, metas e o Pomodoro ${isMain ? 'do Principal' : `de "${active.name}"`} serão apagados. Não dá para desfazer.`,
      yes: 'Sim, zerar',
      danger: true
    }, () => {
      resetPomodoroState();
      removeSpaceData(activeProjectId);
      loadSpace();
      showTab('dashboard');
      toast('Dados zerados ✅', 3000);
    });
  });
});

$('reset-all').addEventListener('click', () => {
  const n = projects.length;
  askDialog({
    title: 'Zerar tudo',
    message: n
      ? `Deseja reiniciar TODOS os dados (Principal e ${n} ${n === 1 ? 'projeto' : 'projetos'})?`
      : 'Deseja reiniciar TODOS os dados?'
  }, () => {
    askDialog({
      title: 'Tem certeza?',
      message: 'Tudo será apagado: projetos, matérias, sessões, metas e Pomodoro. O app vai começar do zero. Não dá para desfazer.',
      yes: 'Sim, zerar tudo',
      danger: true
    }, () => {
      resetPomodoroState();
      projects.forEach(p => removeSpaceData(p.id));
      removeSpaceData('');
      projects = [];
      activeProjectId = '';
      try {
        localStorage.removeItem('estudo:projects');
        localStorage.removeItem('estudo:activeProject');
      } catch (e) { /* ignora */ }
      loadSpace();
      showTab('dashboard');
      toast('Tudo zerado. Recomeçando do zero ✅', 3500);
    });
  });
});

// ---------- Menu ----------
$('menu-btn').addEventListener('click', () => {
  if ($('menu').classList.contains('active')) showTab(lastTab || 'dashboard');
  else showTab('menu');
});
$('project-chip').addEventListener('click', () => showTab('menu'));

// ---------- Início ----------
function init() {
  safe(() => { $('app-version').textContent = 'v' + APP_VERSION; });
  safe(() => {
    $('subject-color').value = suggestColor(state.subjects.map(s => s.color));
    $('project-color').value = suggestColor(projects.map(p => p.color));
    paintColorField('subject-color');
    paintColorField('project-color');
  });
  safe(renderProjectUI);
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
