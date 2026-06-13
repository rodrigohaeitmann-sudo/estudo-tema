// Renderização das telas e manipulação do DOM.

const LETTERS = ['A', 'B', 'C', 'D', 'E'];

export function escapeHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function showScreen(name) {
  document.querySelectorAll('.screen').forEach((el) => el.classList.remove('active'));
  document.getElementById(`screen-${name}`).classList.add('active');
  document.querySelectorAll('#bottom-nav button').forEach((btn) => {
    btn.classList.toggle('active', btn.dataset.screen === name);
  });
}

// status: 'ok' | 'pending' | 'offline' | 'idle'
export function setSyncIndicator(status, text) {
  const el = document.getElementById('sync-indicator');
  el.className = `sync-indicator ${status}`;
  const syncText = document.getElementById('home-sync-text');
  if (text !== undefined) syncText.textContent = text;
}

export function renderHome({ dueCount, newCount, totalAnswered, accuracy, alert, newDoneToday, newPerDay, mastered }) {
  document.getElementById('due-count').textContent = dueCount;
  document.getElementById('new-count').textContent = newCount;
  document.getElementById('home-total').textContent = totalAnswered;

  // Goal progress
  const done = newDoneToday ?? 0;
  const goal = newPerDay ?? 15;
  const goalPct = goal > 0 ? Math.min(Math.round(done / goal * 100), 100) : 0;
  const goalCounts = document.getElementById('goal-counts');
  const goalBar = document.getElementById('goal-bar');
  if (goalCounts) goalCounts.textContent = `${done} / ${goal}`;
  if (goalBar) goalBar.style.width = goalPct + '%';

  // Performance
  const accText = accuracy === null ? '–' : `${Math.round(accuracy * 100)}%`;
  document.getElementById('home-accuracy').textContent = accText;

  const totalText = document.getElementById('home-total-text');
  if (totalText) {
    const mastPart = mastered != null && mastered > 0 ? ` · ${mastered} dominadas` : '';
    totalText.textContent = `${totalAnswered} questões respondidas${mastPart}`;
  }

  const perfBar = document.getElementById('perf-bar');
  if (perfBar) {
    perfBar.style.width = accuracy !== null ? Math.round(accuracy * 100) + '%' : '0%';
  }

  // Alert
  const alertEl = document.getElementById('home-alert');
  if (alert) {
    alertEl.textContent = alert;
    alertEl.classList.remove('hidden');
  } else {
    alertEl.classList.add('hidden');
  }

  document.getElementById('btn-start').disabled = dueCount + newCount === 0;
}

export function renderQuestion(question, { position, total }, onChoose) {
  const container = document.getElementById('study-container');
  const pct = total > 0 ? Math.round(((position - 1) / total) * 100) : 0;
  container.innerHTML = `
    <div class="session-header">
      <span class="session-pos">Questão ${position} de ${total}</span>
      <span class="question-tema">${escapeHtml(question.tema || 'Sem tema')}</span>
    </div>
    <div class="progress-bar"><div style="width:${pct}%"></div></div>
    <p class="question-text">${escapeHtml(question.enunciado)}</p>
    <div id="alternatives"></div>
    <div id="feedback-area"></div>
  `;
  const altContainer = container.querySelector('#alternatives');
  for (const letter of LETTERS) {
    const text = question[`alt_${letter.toLowerCase()}`];
    if (!text) continue;
    const btn = document.createElement('button');
    btn.className = 'alt-btn';
    btn.dataset.letter = letter;
    btn.innerHTML = `<span class="alt-letter">${letter}</span><span>${escapeHtml(text)}</span>`;
    btn.addEventListener('click', () => onChoose(letter), { once: true });
    altContainer.appendChild(btn);
  }
}

export function showFeedback(question, chosen, isCorrect, onNext) {
  document.querySelectorAll('#alternatives .alt-btn').forEach((btn) => {
    btn.classList.add('revealed');
    if (btn.dataset.letter === question.gabarito) btn.classList.add('correct');
    else if (btn.dataset.letter === chosen) btn.classList.add('wrong');
  });
  const area = document.getElementById('feedback-area');
  const cls = isCorrect ? 'ok' : 'fail';
  const icon = isCorrect ? '✓' : '✕';
  const verdictText = isCorrect
    ? 'Você acertou!'
    : `Resposta correta: ${escapeHtml(question.gabarito)}. A questão voltará nesta sessão.`;
  area.innerHTML = `
    <div class="feedback-box">
      <div class="verdict ${cls}">
        <span class="verdict-icon">${icon}</span>
        <span>${verdictText}</span>
      </div>
      <div class="comentario">${escapeHtml(question.comentario || 'Sem comentário cadastrado.')}</div>
      ${question.fonte ? `<div class="fonte">Fonte · ${escapeHtml(question.fonte)}${question.ano ? ` (${escapeHtml(question.ano)})` : ''}</div>` : ''}
    </div>
    <button id="btn-next" class="btn-primary" style="margin-top:14px">Próxima questão</button>
  `;
  area.querySelector('#btn-next').addEventListener('click', onNext, { once: true });
  area.scrollIntoView({ behavior: 'smooth', block: 'end' });
}

export function renderSessionEnd({ answered, correctFirstTry }) {
  const container = document.getElementById('study-container');
  const pct = answered > 0 ? Math.round((correctFirstTry / answered) * 100) : 0;
  container.innerHTML = `
    <div class="session-summary">
      <div class="big">🎉</div>
      <h2>Sessão concluída!</h2>
      <p>${answered} questões · ${correctFirstTry} acertos de primeira (${pct}%)</p>
      <button id="btn-back-home" class="btn-primary">Voltar ao início</button>
    </div>
  `;
  container.querySelector('#btn-back-home').addEventListener('click', () => showScreen('home'), { once: true });
}

export function renderStats({ totalAnswered, totalAttempts, accuracy, mastered, byTema }) {
  const container = document.getElementById('stats-container');
  if (totalAnswered === 0) {
    container.innerHTML = '<p class="muted" style="margin-top:8px">Nenhuma questão respondida ainda.</p>';
    return;
  }
  const acc = totalAttempts > 0 ? Math.round(accuracy * 100) : 0;
  const rows = byTema.map((t) => {
    const tAcc = Math.round(t.accuracy * 100);
    return `
      <div class="tema-row">
        <div class="tema-row-header">
          <span class="tema-name">${escapeHtml(t.tema)}</span>
          <span class="tema-meta">${t.answered} · ${tAcc}%</span>
        </div>
        <div class="track" style="height:6px">
          <div class="fill" style="width:${tAcc}%"></div>
        </div>
      </div>`;
  }).join('');

  container.innerHTML = `
    <div class="stats-top">
      <div class="stat-pill">
        <div class="big-num">${totalAnswered}</div>
        <div class="small-lbl">respondidas</div>
      </div>
      <div class="stat-pill">
        <div class="big-num accent">${acc}%</div>
        <div class="small-lbl">acurácia</div>
      </div>
      <div class="stat-pill">
        <div class="big-num">${mastered}</div>
        <div class="small-lbl">dominadas</div>
      </div>
    </div>
    <div class="card">
      <div class="section-title" style="margin-bottom:6px">Por tema</div>
      ${rows}
    </div>
  `;
}

export function setConfigStatus(text) {
  document.getElementById('config-status').textContent = text;
}
