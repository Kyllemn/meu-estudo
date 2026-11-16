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

function save() {
  localStorage.setItem('subjects', JSON.stringify(state.subjects));
  localStorage.setItem('sessions', JSON.stringify(state.sessions));
  localStorage.setItem('goals', JSON.stringify(state.goals));
}

function formatMinutes(min) {
  if (!min) return '0min';
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
  d.setDate(diff);
  d.setHours(0,0,0,0);
  return d;
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
  } else {
    start = getStartOfMonth(now);
  }
  return state.sessions.filter(s => new Date(s.date) >= start);
}

function getTotalMinutes(sessions) {
  return sessions.reduce((sum, s) => sum + (s.minutes || 0), 0);
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
  selects.forEach(sel => {
    sel.innerHTML = '<option value="">Selecione...</option>';
  });

  state.subjects.forEach(sub => {
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

    selects.forEach(sel => {
      const opt = document.createElement('option');
      opt.value = sub.id;
      opt.textContent = sub.name;
      sel.appendChild(opt);
    });
  });

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
  e.target.reset();
  document.getElementById('subject-color').value = '#6366f1';
  renderSubjects();
});

// Metas
function formatHM(mins) {
  if (!mins) return '';
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h.toString().padStart(2,'0')}:${m.toString().padStart(2,'0')}`;
}

function parseHM(str) {
  if (!str) return 0;
  const parts = str.trim().split(':');
  if (parts.length !== 2) return 0;
  const h = parseInt(parts[0]) || 0;
  const m = parseInt(parts[1]) || 0;
  return h * 60 + m;
}

function updateGoalExamples() {
  const d = parseHM(document.getElementById('goal-daily').value);
  const w = parseHM(document.getElementById('goal-weekly').value);
  const m = parseHM(document.getElementById('goal-monthly').value);

  document.getElementById('ex-daily').textContent = d ? `= ${formatMinutes(d)}` : '';
  document.getElementById('ex-weekly').textContent = w ? `= ${formatMinutes(w)}` : '';
  document.getElementById('ex-monthly').textContent = m ? `= ${formatMinutes(m)}` : '';
}

function loadGoals() {
  document.getElementById('goal-daily').value = formatHM(state.goals.daily);
  document.getElementById('goal-weekly').value = formatHM(state.goals.weekly);
  document.getElementById('goal-monthly').value = formatHM(state.goals.monthly);
  updateGoalExamples();
}

document.getElementById('goals-form').addEventListener('submit', e => {
  e.preventDefault();
  state.goals = {
    daily: parseHM(document.getElementById('goal-daily').value),
    weekly: parseHM(document.getElementById('goal-weekly').value),
    monthly: parseHM(document.getElementById('goal-monthly').value)
  };
  save();

  const btn = e.target.querySelector('button');
  const original = btn.textContent;
  btn.textContent = 'Salvo!';
  btn.style.background = '#10b981';
  setTimeout(() => {
    btn.textContent = original;
    btn.style.background = '';
  }, 1500);

  renderDashboard();
});

['goal-daily','goal-weekly','goal-monthly'].forEach(id => {
  document.getElementById(id).addEventListener('input', updateGoalExamples);
});

// Registrar
document.getElementById('session-form').addEventListener('submit', e => {
  e.preventDefault();
  const subjectId = document.getElementById('session-subject').value;
  const hours = parseInt(document.getElementById('session-hours').value) || 0;
  const mins = parseInt(document.getElementById('session-minutes').value) || 0;
  const minutes = hours * 60 + mins;
  const notes = document.getElementById('session-notes').value.trim();
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
});

// Dashboard
let subjectChart = null;

function renderDashboard(period = 'hoje') {
  const sessions = getSessionsInPeriod(period);
  const total = getTotalMinutes(sessions);

  let goal = 0;
  let label = '';
  if (period === 'hoje') { goal = state.goals.daily; label = 'de Hoje'; }
  else if (period === 'semana') { goal = state.goals.weekly; label = 'da Semana'; }
  else { goal = state.goals.monthly; label = 'do Mês'; }

  const percent = goal > 0 ? Math.min(100, Math.round((total / goal) * 100)) : 0;

  document.getElementById('progress-cards').innerHTML = `
    <div class="card progress-card">
      <h3>Progresso ${label}</h3>
      <div class="big-number">${formatMinutes(total)} <span style="color:var(--text-muted); font-size:1rem">/ ${formatMinutes(goal)}</span></div>
      <div class="progress-bar-bg">
        <div class="progress-bar" style="width:${percent}%"></div>
      </div>
      <div style="text-align:right; margin-top:0.4rem; font-size:0.9rem; color:var(--text-muted)">${percent}%</div>
    </div>
  `;

  // Chart
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

  const ctx = document.getElementById('subjectChart');
  if (labels.length === 0) {
    ctx.style.display = 'none';
  } else {
    ctx.style.display = 'block';
    subjectChart = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels,
        datasets: [{ data, backgroundColor: colors, borderWidth: 0 }]
      },
      options: {
        plugins: {
          legend: { position: 'bottom', labels: { color: '#f8fafc', padding: 12, font: { size: 12 } } }
        },
        cutout: '68%'
      }
    });
  }

  renderRecentSessions();
}

function renderRecentSessions() {
  const container = document.getElementById('recent-sessions');
  const recent = [...state.sessions].reverse().slice(0, 6);

  if (recent.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:1rem 0">Nenhuma sessão ainda</p>';
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
          ${s.notes ? `<div style="font-size:0.82rem; color:var(--text-muted); margin-top:2px">${s.notes}</div>` : ''}
        </div>
        <div style="text-align:right; font-size:0.9rem">
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
  document.getElementById('mode-label').textContent = state.pomodoro.isBreak ? 'Pausa' : 'Foco';

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
  document.getElementById('mode-label').textContent = 'Foco';
}

// Alarme sonoro simples
function playAlarm() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 880;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 1.2);
    osc.start();
    osc.stop(ctx.currentTime + 1.2);
  } catch (e) {}
}

function showAlarmModal(title, message, onYes, onNo) {
  const modal = document.getElementById('alarm-modal');
  document.getElementById('alarm-title').textContent = title;
  document.getElementById('alarm-message').textContent = message;
  modal.classList.add('show');
  playAlarm();

  const yesBtn = document.getElementById('alarm-yes');
  const noBtn = document.getElementById('alarm-no');

  const clean = () => {
    modal.classList.remove('show');
    yesBtn.onclick = null;
    noBtn.onclick = null;
  };

  yesBtn.onclick = () => {
    clean();
    if (onYes) onYes();
  };
  noBtn.onclick = () => {
    clean();
    if (onNo) onNo();
  };
}

function pomodoroFinished() {
  if (!state.pomodoro.isBreak) {
    // Fim do foco
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

    const today = getDateKey();
    const count = state.sessions.filter(s => s.notes === 'Pomodoro' && getDateKey(new Date(s.date)) === today).length;
    document.getElementById('pomodoros-hoje').textContent = count;

    showAlarmModal(
      'Tempo de foco acabou!',
      'Quer parar agora ou fazer a pausa?',
      () => {
        // Sim, parar
        resetPomodoro();
      },
      () => {
        // Não, continuar → inicia pausa
        state.pomodoro.isBreak = true;
        const breakMin = parseInt(document.getElementById('break-time').value) || 5;
        state.pomodoro.timeLeft = breakMin * 60;
        document.getElementById('current-subject').textContent = 'Pausa!';
        document.getElementById('mode-label').textContent = 'Pausa';
        startPomodoro();
      }
    );
  } else {
    // Fim da pausa
    showAlarmModal(
      'Pausa acabou!',
      'Quer parar ou continuar estudando?',
      () => {
        // Sim, parar
        resetPomodoro();
      },
      () => {
        // Não, continuar → novo foco
        state.pomodoro.isBreak = false;
        const focus = parseInt(document.getElementById('focus-time').value) || 25;
        state.pomodoro.timeLeft = focus * 60;
        document.getElementById('current-subject').textContent = 'Foco';
        document.getElementById('mode-label').textContent = 'Foco';
        state.pomodoro.isRunning = false;
        document.getElementById('btn-start').disabled = false;
        document.getElementById('btn-pause').disabled = true;
        updateTimerDisplay();
      }
    );
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

function init() {
  renderSubjects();
  loadGoals();
  renderDashboard('hoje');
  updateTimerDisplay();

  const today = getDateKey();
  const count = state.sessions.filter(s => s.notes === 'Pomodoro' && getDateKey(new Date(s.date)) === today).length;
  document.getElementById('pomodoros-hoje').textContent = count;

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('service-worker.js').catch(() => {});
  }
}

init();