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

export function renderHome({ dueCount, newCount, totalAnswered, accuracy, alert }) {
  document.getElementById('due-count').textContent = dueCount;
  document.getElementById('new-count').textContent = newCount;
  document.getElementById('home-total').textContent = totalAnswered;
  document.getElementById('home-accuracy').textContent =
    accuracy === null ? '–' : `${Math.round(accuracy * 100)}%`;
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
    <div class="session-progress">
      <span>Questão ${position} de ${total}</span>
      <span>${escapeHtml(question.fonte || '')}</span>
    </div>
    <div class="progress-bar"><div style="width:${pct}%"></div></div>
    <span class="question-tema">${escapeHtml(question.tema || 'Sem tema')}</span>
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
  const verdict = isCorrect
    ? '<div class="verdict ok">✔ Você acertou!</div>'
    : `<div class="verdict fail">✘ Você errou — gabarito: ${escapeHtml(question.gabarito)}. A questão voltará nesta sessão.</div>`;
  area.innerHTML = `
    <div class="feedback-box">
      ${verdict}
      <div class="comentario">${escapeHtml(question.comentario || 'Sem comentário cadastrado.')}</div>
      ${question.fonte ? `<div class="fonte">Fonte: ${escapeHtml(question.fonte)}${question.ano ? ` (${escapeHtml(question.ano)})` : ''}</div>` : ''}
    </div>
    <button id="btn-next" class="btn-primary">Próxima</button>
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
      <p>${answered} questões estudadas · ${correctFirstTry} acertos de primeira (${pct}%)</p>
      <button id="btn-back-home" class="btn-primary">Voltar ao início</button>
    </div>
  `;
  container.querySelector('#btn-back-home').addEventListener('click', () => showScreen('home'), { once: true });
}

export function renderStats({ totalAnswered, totalAttempts, accuracy, mastered, byTema }) {
  const container = document.getElementById('stats-container');
  if (totalAnswered === 0) {
    container.innerHTML = '<p class="muted">Nenhuma questão respondida ainda.</p>';
    return;
  }
  const rows = byTema
    .map(
      (t) => `<tr>
        <td>${escapeHtml(t.tema)}</td>
        <td class="num">${t.answered}</td>
        <td class="num">${Math.round(t.accuracy * 100)}%</td>
      </tr>`
    )
    .join('');
  container.innerHTML = `
    <div class="card card-wide">
      <div class="mini-stat"><span>${totalAnswered}</span> questões respondidas (${totalAttempts} tentativas)</div>
      <div class="mini-stat">acurácia geral: <span>${Math.round(accuracy * 100)}%</span></div>
      <div class="mini-stat">dominadas (intervalo ≥ 21 dias): <span>${mastered}</span></div>
    </div>
    <table class="stats-table">
      <thead><tr><th>Tema</th><th class="num">Resp.</th><th class="num">Acerto</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

export function setConfigStatus(text) {
  document.getElementById('config-status').textContent = text;
}
