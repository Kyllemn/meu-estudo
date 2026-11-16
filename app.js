// Estado da aplicação
const state = {
  subjects: JSON.parse(localStorage.getItem('subjects')) || [],
  sessions: JSON.parse(localStorage.getItem('sessions')) || [],
  goals: JSON.parse(localStorage.getItem('goals')) || { daily: 120, weekly: 600, monthly: 2400 },
  pomodoro: {
    isRunning: false,
    isBreak: false,
    timeLeft: 25 * 60,
    interval: null,
    currentSubject: null
  }
};

// Utilitários
function save() {
  localStorage.setItem('subjects', JSON.stringify(state.subjects));
  localStorage.setItem('sessions', JSON.stringify(state.sessions));
  localStorage.setItem('goals', JSON.stringify(state.goals));
}

function formatMinutes(min) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m > 0 ? `${h}h ${m}min` : `${h}h`;
}

function getDateKey(date = new Date()) {
  return date.toISOString().split('T')[0];
}

function getStartOfWeek(date = new Date()) {
  const d = new Date(date);
  const day = d.getDay();
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  return new Date(d.setDate(diff));
}

function getStartOfMonth(date = new Date()) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function getSessionsInPeriod(period) {
  const now = new Date();
  let start;

  if (period === 'hoje') {
    start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  } else if (period === 'semana') {
    start = getStartOfWeek(now);
    start.setHours(0, 0, 0, 0);
  } else {
    start = getStartOfMonth(now);
  }

  return state.sessions.filter(s => new Date(s.date) >= start);
}

function getTotalMinutes(sessions) {
  return sessions.reduce((sum, s) => sum + s.minutes, 0);
}

// Navegação
document.querySelectorAll('.nav-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.nav-btn').forEach(b => b.classList.remove('active'));
    document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
    btn.classList.add('active');
    document.getElementById(btn.dataset.tab).classList.add('active');
  });
});

document.querySelectorAll('.period-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.period-btn').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    renderDashboard(btn.dataset.period);
  });
});

// Matérias
function renderSubjects() {
  const list = document.getElementById('subjects-list');
  const selects = [
    document.getElementById('pomodoro-subject'),
    document.getElementById('session-subject')
  ];

  list.innerHTML = '';
  selects.forEach(sel => sel.innerHTML = '<option value="">Selecione...</option>');

  state.subjects.forEach(sub => {
    // Lista
    const item = document.createElement('div');
    item.className = 'subject-item';
    item.innerHTML = `
      <div>
        <span class="subject-dot" style="background:${sub.color}"></span>
        <strong>${sub.name}</strong>
      </div>
      <button class="delete-btn" data-id="${sub.id}">🗑️</button>
    `;
    list.appendChild(item);

    // Selects
    selects.forEach(sel => {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = sub.name;
      sel.appendChild(opt);
    });
  });

  // Delete
  list.querySelectorAll('.delete-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      if (confirm('Remover essa matéria?')) {
        state.subjects = state.subjects.filter(s => s.id !== btn.dataset.id);
        state.sessions = state.sessions.filter(s => s.subjectId !== btn.dataset.id);
        save();
        renderSubjects();
        renderDashboard();
      }
    });
  });
}

document.getElementById('subject-form').addEventListener('submit', e => {
  e.preventDefault();
  const name = document.getElementById('subject-name').value.trim();
  const color = document.getElementById('subject-color').value;
  if (!name) return;

  state.subjects.push({
    id: Date.now().toString(),
    name,
    color
  });
  save();
  document.getElementById('subject-form').reset();
  document.getElementById('subject-color').value = '#6366f1';
  renderSubjects();
});

// Metas
function loadGoals() {
  document.getElementById('goal-daily').value = state.goals.daily || '';
  document.getElementById('goal-weekly').value = state.goals.weekly || '';
  document.getElementById('goal-monthly').value = state.goals.monthly || '';
}

document.getElementById('goals-form').addEventListener('submit', e => {
  e.preventDefault();
  state.goals = {
    daily: parseInt(document.getElementById('goal-daily').value) || 0,
    weekly: parseInt(document.getElementById('goal-weekly').value) || 0,
    monthly: parseInt(document.getElementById('goal-monthly').value) || 0
  };
  save();
  alert('Metas salvas!');
  renderDashboard();
});

// Registrar sessão
document.getElementById('session-form').addEventListener('submit', e => {
  e.preventDefault();
  const subjectId = document.getElementById('session-subject').value;
  const minutes = parseInt(document.getElementById('session-minutes').value);
  const notes = document.getElementById('session-notes').value;
  const feeling = document.getElementById('session-feeling').value;

  if (!subjectId || !minutes) return;

  state.sessions.push({
    id: Date.now().toString(),
    subjectId,
    minutes,
    date: new Date().toISOString(),
    notes,
    feeling
  });
  save();
  e.target.reset();
  alert('Sessão registrada!');
  renderDashboard();
  renderRecentSessions();
});

// Dashboard
let subjectChart = null;

function renderDashboard(period = 'hoje') {
  const sessions = getSessionsInPeriod(period);
  const total = getTotalMinutes(sessions);
  
  let goal = 0;
  if (period === 'hoje') goal = state.goals.daily;
  else if (period === 'semana') goal = state.goals.weekly;
  else goal = state.goals.monthly;

  const percent = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;

  document.getElementById('progress-cards').innerHTML = `
    <div class="progress-card">
      <h4>Progresso ${period === 'hoje' ? 'de Hoje' : period === 'semana' ? 'da Semana' : 'do Mês'}</h4>
      <div class="progress-text">${formatMinutes(total)} / ${formatMinutes(goal)}</div>
      <div class="progress-bar-container">
        <div class="progress-bar" style="width:${percent}%; background:${percent >= 100 ? 'var(--success)' : 'var(--primary)'}"></div>
      </div>
      <div style="text-align:right; font-size:0.9rem; color:var(--text-muted)">${percent}%</div>
    </div>
  `;

  // Chart por matéria
  const bySubject = {};
  sessions.forEach(s => {
    bySubject[s.subjectId] = (bySubject[s.subjectId] || 0) + s.minutes;
  });

  const labels = [];
  const data = [];
  const colors = [];

  Object.entries(bySubject).forEach(([id, mins]) => {
    const sub = state.subjects.find(s => s.id === id);
    if (sub) {
      labels.push(sub.name);
      data.push(mins);
      colors.push(sub.color);
    }
  });

  if (subjectChart) subjectChart.destroy();

  const ctx = document.getElementById('subjectChart').getContext('2d');
  subjectChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels,
      datasets: [{
        data,
        backgroundColor: colors,
        borderWidth: 0
      }]
    },
    options: {
      plugins: {
        legend: { position: 'bottom', labels: { color: '#f1f5f9', padding: 15 } }
      },
      cutout: '65%'
    }
  });

  renderRecentSessions();
}

function renderRecentSessions() {
  const container = document.getElementById('recent-sessions');
  const recent = [...state.sessions].reverse().slice(0, 8);

  if (recent.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:1rem">Nenhuma sessão ainda</p>';
    return;
  }

  container.innerHTML = recent.map(s => {
    const sub = state.subjects.find(sub => sub.id === s.subjectId) || { name: '?', color: '#64748b' };
    const date = new Date(s.date);
    return `
      <div class="session-item">
        <div>
          <span class="subject-dot" style="background:${sub.color}"></span>
          <strong>${sub.name}</strong>
          ${s.notes ? `<div style="font-size:0.85rem; color:var(--text-muted)">${s.notes}</div>` : ''}
        </div>
        <div style="text-align:right">
          <div>${formatMinutes(s.minutes)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted)">${date.toLocaleDateString('pt-BR')}</div>
        </div>
      </div>
    `;
  }).join('');
}

// Pomodoro
function updateTimerDisplay() {
  const mins = Math.floor(state.pomodoro.timeLeft / 60);
  const secs = state.pomodoro.timeLeft % 60;
  document.getElementById('timer-display').textContent = 
    `${mins.toString().padStart(2,'0')}:${secs.toString().padStart(2,'0')}`;
}

function startPomodoro() {
  const subjectId = document.getElementById('pomodoro-subject').value;
  if (!subjectId && !state.pomodoro.isBreak) {
    alert('Selecione uma matéria');
    return;
  }

  if (!state.pomodoro.isRunning) {
    state.pomodoro.currentSubject = subjectId;
    const sub = state.subjects.find(s => s.id === subjectId);
    document.getElementById('current-subject').textContent = sub ? sub.name : 'Pausa';
  }

  state.pomodoro.isRunning = true;
  document.getElementById('btn-start').disabled = true;
  document.getElementById('btn-pause').disabled = false;

  state.pomodoro.interval = setInterval(() => {
    state.pomodoro.timeLeft--;
    updateTimerDisplay();

    if (state.pomodoro.timeLeft <= 0) {
      clearInterval(state.pomodoro.interval);
      pomodoroFinished();
    }
  }, 1000);
}

function pausePomodoro() {
  clearInterval(state.pomodoro.interval);
  state.pomodoro.isRunning = false;
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-pause').disabled = true;
}

function resetPomodoro() {
  clearInterval(state.pomodoro.interval);
  state.pomodoro.isRunning = false;
  state.pomodoro.isBreak = false;
  const focus = parseInt(document.getElementById('focus-time').value) || 25;
  state.pomodoro.timeLeft = focus * 60;
  updateTimerDisplay();
  document.getElementById('btn-start').disabled = false;
  document.getElementById('btn-pause').disabled = true;
  document.getElementById('current-subject').textContent = 'Selecione uma matéria';
}

function pomodoroFinished() {
  if (!state.pomodoro.isBreak) {
    // Salva sessão de foco
    const minutes = parseInt(document.getElementById('focus-time').value) || 25;
    if (state.pomodoro.currentSubject) {
      state.sessions.push({
        id: Date.now().toString(),
        subjectId: state.pomodoro.currentSubject,
        minutes,
        date: new Date().toISOString(),
        notes: 'Pomodoro',
        feeling: 'bom'
      });
      save();
    }

    // Conta pomodoros de hoje
    const today = getDateKey();
    const todayPomodoros = state.sessions.filter(s => 
      s.notes === 'Pomodoro' && getDateKey(new Date(s.date)) === today
    ).length;
    document.getElementById('pomodoros-hoje').textContent = todayPomodoros;

    // Inicia pausa
    state.pomodoro.isBreak = true;
    const breakMin = parseInt(document.getElementById('break-time').value) || 5;
    state.pomodoro.timeLeft = breakMin * 60;
    document.getElementById('current-subject').textContent = 'Pausa!';
    alert('Pomodoro concluído! Hora da pausa.');
    startPomodoro();
  } else {
    // Fim da pausa
    state.pomodoro.isBreak = false;
    const focus = parseInt(document.getElementById('focus-time').value) || 25;
    state.pomodoro.timeLeft = focus * 60;
    document.getElementById('current-subject').textContent = 'Pronto pra mais um?';
    state.pomodoro.isRunning = false;
    document.getElementById('btn-start').disabled = false;
    document.getElementById('btn-pause').disabled = true;
    alert('Pausa acabou! Bora estudar.');
    updateTimerDisplay();
  }
  renderDashboard();
}

document.getElementById('btn-start').addEventListener('click', startPomodoro);
document.getElementById('btn-pause').addEventListener('click', pausePomodoro);
document.getElementById('btn-reset').addEventListener('click', resetPomodoro);

document.getElementById('focus-time').addEventListener('change', () => {
  if (!state.pomodoro.isRunning && !state.pomodoro.isBreak) {
    state.pomodoro.timeLeft = (parseInt(document.getElementById('focus-time').value) || 25) * 60;
    updateTimerDisplay();
  }
});

// Init
function init() {
  renderSubjects();
  loadGoals();
  renderDashboard('hoje');
  updateTimerDisplay();

  // Conta pomodoros de hoje
  const today = getDateKey();
  const todayPomodoros = state.sessions.filter(s => 
    s.notes === 'Pomodoro' && getDateKey(new Date(s.date)) === today
  ).length;
  document.getElementById('pomodoros-hoje').textContent = todayPomodoros;

  // Service Worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

init();