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

export function renderHome({ dueCount, newCount, totalAnswered, accuracy, alert, newDoneToday, newPerDay, mastered, weakAreas }) {
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

  // Áreas fracas detectadas pelo algoritmo
  const weakEl = document.getElementById('home-weak-areas');
  if (weakEl) {
    if (weakAreas && weakAreas.length > 0) {
      const chips = weakAreas.map((w) =>
        `<span class="weak-chip">${escapeHtml(w.tag)}<span class="weak-pct">${Math.round(w.accuracy * 100)}%</span></span>`
      ).join('');
      weakEl.innerHTML = `<div class="weak-header">Focos de atenção</div><div class="weak-chips">${chips}</div>`;
      weakEl.classList.remove('hidden');
    } else {
      weakEl.classList.add('hidden');
    }
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
  const tagChips = [
    question.area ? `<span class="tag-chip tag-area">${escapeHtml(question.area)}</span>` : '',
    question.tipo ? `<span class="tag-chip tag-tipo">${escapeHtml(question.tipo)}</span>` : '',
  ].filter(Boolean).join('');
  container.innerHTML = `
    <div class="session-header">
      <span class="session-pos">Questão ${position} de ${total}</span>
      <span class="question-tema">${escapeHtml(question.tema || 'Sem tema')}</span>
    </div>
    ${tagChips ? `<div class="question-tag-row">${tagChips}</div>` : ''}
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

// previews: null (errou) ou array [{rating,days,text}] para acertos
// onRate(rating): 1=Again (auto, em erros) / 2=Difícil / 3=Ok / 4=Fácil
export function showFeedback(question, chosen, isCorrect, previews, onRate) {
  document.querySelectorAll('#alternatives .alt-btn').forEach((btn) => {
    btn.classList.add('revealed');
    if (btn.dataset.letter === question.gabarito) btn.classList.add('correct');
    else if (btn.dataset.letter === chosen) btn.classList.add('wrong');
  });

  const feedbackArea = document.getElementById('feedback-area');
  const cls  = isCorrect ? 'ok' : 'fail';
  const icon = isCorrect ? '✓' : '✕';
  const verdictText = isCorrect
    ? 'Você acertou!'
    : `Resposta correta: ${escapeHtml(question.gabarito)}. A questão voltará nesta sessão.`;

  const LABELS = { 2: 'Difícil', 3: 'Ok', 4: 'Fácil' };

  let actionHTML;
  if (isCorrect && previews) {
    const btns = previews
      .filter((p) => p.rating >= 2)
      .map((p) => `
        <button class="rating-btn rating-${p.rating}" data-rating="${p.rating}">
          <span class="rating-label">${LABELS[p.rating]}</span>
          <span class="rating-interval">${escapeHtml(p.text)}</span>
        </button>`)
      .join('');
    actionHTML = `
      <p class="rating-header">Como foi essa questão?</p>
      <div class="rating-row">${btns}</div>`;
  } else {
    actionHTML = `<button id="btn-next" class="btn-primary" style="margin-top:14px">Próxima questão</button>`;
  }

  feedbackArea.innerHTML = `
    <div class="feedback-box">
      <div class="verdict ${cls}">
        <span class="verdict-icon">${icon}</span>
        <span>${verdictText}</span>
      </div>
      <div class="comentario">${escapeHtml(question.comentario || 'Sem comentário cadastrado.')}</div>
      ${question.fonte ? `<div class="fonte">Fonte · ${escapeHtml(question.fonte)}${question.ano ? ` (${escapeHtml(question.ano)})` : ''}</div>` : ''}
    </div>
    ${actionHTML}
  `;

  if (isCorrect && previews) {
    feedbackArea.querySelectorAll('.rating-btn').forEach((btn) => {
      btn.addEventListener('click', () => onRate(parseInt(btn.dataset.rating)), { once: true });
    });
  } else {
    feedbackArea.querySelector('#btn-next').addEventListener('click', () => onRate(1), { once: true });
  }

  feedbackArea.scrollIntoView({ behavior: 'smooth', block: 'end' });
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

function tagRows(items, nameKey) {
  if (!items || items.length === 0) return '<p class="muted" style="font-size:13px;padding:8px 0">Nenhum dado ainda — responda questões com área/tipo cadastrados.</p>';
  return items.map((t) => {
    const pct = Math.round(t.accuracy * 100);
    const recentPct = t.recentAcc !== null && t.recentAcc !== undefined ? Math.round(t.recentAcc * 100) : null;
    const isWeak = recentPct !== null && t.recentCount >= 3 && recentPct < 60;
    const barColor = isWeak ? 'var(--bad)' : pct >= 75 ? 'var(--good)' : 'var(--accent)';
    const badge = isWeak ? '<span class="deficit-badge">Déficit</span>' : '';
    const recentInfo = recentPct !== null
      ? `<span class="recent-acc ${isWeak ? 'weak' : ''}">recente ${recentPct}%</span>`
      : '';
    return `
      <div class="tema-row">
        <div class="tema-row-header">
          <span class="tema-name">${escapeHtml(t[nameKey])}${badge}</span>
          <span class="tema-meta">${t.attempts} tentativas · ${pct}% ${recentInfo}</span>
        </div>
        <div class="track" style="height:6px">
          <div class="fill" style="width:${pct}%;background:${barColor}"></div>
        </div>
      </div>`;
  }).join('');
}

export function renderStats({ totalAnswered, totalAttempts, accuracy, mastered, byTema, byArea, byTipo }) {
  const container = document.getElementById('stats-container');
  if (totalAnswered === 0) {
    container.innerHTML = '<p class="muted" style="margin-top:8px">Nenhuma questão respondida ainda.</p>';
    return;
  }
  const acc = totalAttempts > 0 ? Math.round(accuracy * 100) : 0;
  const temaRows = byTema.map((t) => {
    const tAcc = Math.round(t.accuracy * 100);
    return `
      <div class="tema-row">
        <div class="tema-row-header">
          <span class="tema-name">${escapeHtml(t.tema)}</span>
          <span class="tema-meta">${t.answered} questões · ${tAcc}%</span>
        </div>
        <div class="track" style="height:6px">
          <div class="fill" style="width:${tAcc}%"></div>
        </div>
      </div>`;
  }).join('');

  const hasAreaData = byArea && byArea.length > 0;
  const hasTipoData = byTipo && byTipo.length > 0;

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

    ${hasAreaData ? `
    <div class="card">
      <div class="section-title" style="margin-bottom:6px">Por área clínica</div>
      <p class="stats-hint">Ordenado da menor para a maior acurácia · "recente" = últimas 10 respostas</p>
      ${tagRows(byArea, 'name')}
    </div>` : ''}

    ${hasTipoData ? `
    <div class="card">
      <div class="section-title" style="margin-bottom:6px">Por tipo de questão</div>
      ${tagRows(byTipo, 'name')}
    </div>` : ''}

    <div class="card">
      <div class="section-title" style="margin-bottom:6px">Por tema</div>
      ${temaRows}
    </div>
  `;
}

export function setConfigStatus(text) {
  document.getElementById('config-status').textContent = text;
}
