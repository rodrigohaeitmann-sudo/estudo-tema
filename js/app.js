import * as api from './api.js';
import * as srs from './srs.js';
import * as state from './state.js';
import * as ui from './ui.js';

let session = null;

// ---------- Início ----------

function computeHomeData() {
  const questions = state.getQuestions();
  const progress = state.getProgress();
  const settings = state.getSettings();
  const today = srs.todayStr();

  const dueCount = questions.filter((q) => progress[q.id] && srs.isDue(progress[q.id], today)).length;
  const unseen = questions.filter((q) => !progress[q.id]).length;
  const allowance = Math.max(0, settings.newPerDay - state.getNewToday(today));
  const newCount = Math.min(unseen, allowance);

  const entries = Object.values(progress).filter((p) => p.attempts > 0);
  const totalAttempts = entries.reduce((s, p) => s + p.attempts, 0);
  const totalCorrect = entries.reduce((s, p) => s + p.correct, 0);

  let alert = null;
  if (!settings.url || !settings.token) {
    alert = 'Configure a URL do Apps Script e o token na aba Ajustes para carregar as questões.';
  } else if (questions.length === 0) {
    alert = 'Nenhuma questão carregada ainda. Verifique a conexão e toque em "Sincronizar agora" nos Ajustes.';
  }

  return {
    dueCount,
    newCount,
    totalAnswered: entries.length,
    accuracy: totalAttempts > 0 ? totalCorrect / totalAttempts : null,
    alert,
  };
}

function refreshHome() {
  ui.renderHome(computeHomeData());
  updateSyncUI();
}

function updateSyncUI() {
  const lastSync = state.getLastSync();
  const lastText = lastSync ? `Última sincronização: ${new Date(lastSync).toLocaleString('pt-BR')}` : '';
  if (!navigator.onLine) {
    ui.setSyncIndicator('offline', `Offline — respostas serão sincronizadas depois. ${lastText}`);
  } else if (state.hasPending()) {
    ui.setSyncIndicator('pending', `Há respostas aguardando sincronização. ${lastText}`);
  } else {
    ui.setSyncIndicator('ok', lastText);
  }
}

// ---------- Sessão de estudo ----------

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function buildQueue() {
  const questions = state.getQuestions();
  const progress = state.getProgress();
  const settings = state.getSettings();
  const today = srs.todayStr();

  const due = shuffle(questions.filter((q) => progress[q.id] && srs.isDue(progress[q.id], today)));
  const allowance = Math.max(0, settings.newPerDay - state.getNewToday(today));
  const fresh = questions.filter((q) => !progress[q.id]).slice(0, allowance);
  return [...due, ...fresh];
}

function startSession() {
  const queue = buildQueue();
  if (queue.length === 0) return;
  session = {
    queue,
    position: 0,
    firstTry: {}, // questionId -> acertou na primeira apresentação da sessão
  };
  ui.showScreen('study');
  presentNext();
}

function presentNext() {
  if (!session || session.position >= session.queue.length) {
    finishSession();
    return;
  }
  const question = session.queue[session.position];
  ui.renderQuestion(
    question,
    { position: session.position + 1, total: session.queue.length },
    (letter) => onAnswer(question, letter)
  );
}

function onAnswer(question, chosen) {
  const isCorrect = chosen === question.gabarito;
  const now = new Date();
  const today = srs.todayStr(now);

  const prev = state.getProgress()[question.id] || srs.initialState(question.id, now);
  if (prev.attempts === 0) state.incrementNewToday(today);
  const next = srs.schedule(prev, isCorrect, now);
  state.updateProgress(next);
  state.queueAnswer(next, {
    ts: next.lastAnswered,
    questionId: question.id,
    chosen,
    correct: isCorrect ? 1 : 0,
    tema: question.tema || '',
  });

  if (!(question.id in session.firstTry)) session.firstTry[question.id] = isCorrect;
  if (!isCorrect) session.queue.push(question);

  updateSyncUI();
  ui.showFeedback(question, chosen, isCorrect, () => {
    session.position += 1;
    presentNext();
  });
}

function finishSession() {
  const firstTry = session ? session.firstTry : {};
  const answered = Object.keys(firstTry).length;
  const correctFirstTry = Object.values(firstTry).filter(Boolean).length;
  session = null;
  ui.renderSessionEnd({ answered, correctFirstTry });
  refreshHome();
  syncPending().catch(() => updateSyncUI());
}

// ---------- Estatísticas ----------

function refreshStats() {
  const questions = state.getQuestions();
  const progress = state.getProgress();
  const temaById = Object.fromEntries(questions.map((q) => [q.id, q.tema || 'Sem tema']));

  const entries = Object.values(progress).filter((p) => p.attempts > 0);
  const totalAttempts = entries.reduce((s, p) => s + p.attempts, 0);
  const totalCorrect = entries.reduce((s, p) => s + p.correct, 0);
  const mastered = entries.filter((p) => p.interval >= 21).length;

  const byTemaMap = {};
  for (const p of entries) {
    const tema = temaById[p.questionId] || 'Sem tema';
    byTemaMap[tema] = byTemaMap[tema] || { tema, answered: 0, attempts: 0, correct: 0 };
    byTemaMap[tema].answered += 1;
    byTemaMap[tema].attempts += p.attempts;
    byTemaMap[tema].correct += p.correct;
  }
  const byTema = Object.values(byTemaMap)
    .map((t) => ({ ...t, accuracy: t.attempts > 0 ? t.correct / t.attempts : 0 }))
    .sort((a, b) => a.tema.localeCompare(b.tema));

  ui.renderStats({
    totalAnswered: entries.length,
    totalAttempts,
    accuracy: totalAttempts > 0 ? totalCorrect / totalAttempts : 0,
    mastered,
    byTema,
  });
}

// ---------- Sincronização ----------

function isValidQuestion(q) {
  return q.id && q.enunciado && ['A', 'B', 'C', 'D', 'E'].includes(q.gabarito);
}

async function syncPending() {
  const { url, token } = state.getSettings();
  if (!url || !token || !navigator.onLine || !state.hasPending()) {
    updateSyncUI();
    return;
  }
  const pending = state.getPending();
  await api.saveProgress(url, token, Object.values(pending.progress), pending.answers);
  state.clearPending();
  state.setLastSync(new Date().toISOString());
  updateSyncUI();
}

// Lança em caso de erro (mensagem acionável vinda de api.js) para os chamadores exibirem.
async function fullSync() {
  const { url, token } = state.getSettings();
  if (!url || !token) throw new Error('Configure a URL do Apps Script e o token na aba Ajustes.');
  if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
  await syncPending();
  const data = await api.getAll(url, token);
  state.setQuestions(data.questions.filter(isValidQuestion));
  const toResend = state.mergeServerProgress(data.progress);
  if (toResend.length > 0) {
    state.queueProgressList(toResend);
    await syncPending();
  }
  state.setLastSync(new Date().toISOString());
  refreshHome();
}

// ---------- Configurações ----------

function loadConfigForm() {
  const s = state.getSettings();
  document.getElementById('cfg-url').value = s.url;
  document.getElementById('cfg-token').value = s.token;
  document.getElementById('cfg-new-per-day').value = s.newPerDay;
}

function bindConfig() {
  document.getElementById('btn-save-config').addEventListener('click', () => {
    state.saveSettings({
      url: document.getElementById('cfg-url').value.trim(),
      token: document.getElementById('cfg-token').value.trim(),
      newPerDay: Math.max(0, parseInt(document.getElementById('cfg-new-per-day').value, 10) || 0),
    });
    ui.setConfigStatus('Configurações salvas.');
    refreshHome();
  });

  document.getElementById('btn-test-connection').addEventListener('click', async () => {
    const { url, token } = state.getSettings();
    if (!url || !token) {
      ui.setConfigStatus('Preencha e salve a URL e o token antes de testar.');
      return;
    }
    ui.setConfigStatus('Testando conexão...');
    try {
      const data = await api.getAll(url, token);
      ui.setConfigStatus(`Conexão OK — ${data.questions.length} questões e ${data.progress.length} registros de progresso na planilha.`);
    } catch (err) {
      ui.setConfigStatus(`Falha na conexão: ${err.message}`);
    }
  });

  document.getElementById('btn-sync-now').addEventListener('click', async () => {
    ui.setConfigStatus('Sincronizando...');
    try {
      await fullSync();
      ui.setConfigStatus('Sincronização concluída.');
    } catch (err) {
      ui.setConfigStatus('Falha: ' + err.message);
    }
  });

  document.getElementById('btn-clear-local').addEventListener('click', () => {
    if (!confirm('Apagar questões e progresso salvos neste dispositivo? O que já foi sincronizado permanece na planilha.')) return;
    state.clearLocalData();
    ui.setConfigStatus('Dados locais apagados.');
    refreshHome();
  });
}

// ---------- Bootstrap ----------

function bindNav() {
  document.querySelectorAll('#bottom-nav button').forEach((btn) => {
    btn.addEventListener('click', () => {
      const screen = btn.dataset.screen;
      if (screen === 'stats') refreshStats();
      if (screen === 'home') refreshHome();
      ui.showScreen(screen);
    });
  });
}

function init() {
  bindNav();
  bindConfig();
  loadConfigForm();
  document.getElementById('btn-start').addEventListener('click', startSession);

  window.addEventListener('online', () => {
    syncPending().catch(() => updateSyncUI());
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncPending().catch(() => {});
  });

  refreshHome();
  // Renderiza do cache primeiro e tenta atualizar; erro acionável aparece no indicador.
  const s = state.getSettings();
  if (s.url && s.token) {
    fullSync().catch((err) => ui.setSyncIndicator('offline', 'Falha ao sincronizar: ' + err.message));
  }
}

init();
