// Persistência local (localStorage): cache de questões/progresso e fila de sync.
// A planilha (via Apps Script) é a fonte da verdade cross-device; conflitos são
// resolvidos por last-write-wins usando lastAnswered por questão.

const K = {
  settings: 'tema:settings',
  questions: 'tema:questions',
  progress: 'tema:progress',
  pending: 'tema:pending',
  newToday: 'tema:newToday',
  lastSync: 'tema:lastSync',
  tagStats: 'tema:tag_stats',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  localStorage.setItem(key, JSON.stringify(value));
}

// --- Configurações ---
export function getSettings() {
  return { url: '', token: '', newPerDay: 15, ...read(K.settings, {}) };
}

export function saveSettings(settings) {
  write(K.settings, settings);
}

// --- Questões (cache do getAll) ---
export function getQuestions() {
  return read(K.questions, []);
}

export function setQuestions(questions) {
  write(K.questions, questions);
}

// --- Progresso (mapa por questionId) ---
export function getProgress() {
  return read(K.progress, {});
}

export function updateProgress(entry) {
  const map = getProgress();
  map[entry.questionId] = entry;
  write(K.progress, map);
}

// Merge LWW: adota o registro do servidor a menos que o local seja mais recente;
// registros locais mais novos são devolvidos para reenvio.
export function mergeServerProgress(serverList) {
  const local = getProgress();
  const merged = { ...local };
  const toResend = [];
  for (const sp of serverList) {
    const lp = local[sp.questionId];
    if (!lp || (sp.lastAnswered || '') >= (lp.lastAnswered || '')) {
      merged[sp.questionId] = sp;
    } else {
      toResend.push(lp);
    }
  }
  write(K.progress, merged);
  return toResend;
}

// --- Fila de pendências (sync offline) ---
export function getPending() {
  return read(K.pending, { progress: {}, answers: [] });
}

export function queueAnswer(progressEntry, answer) {
  const p = getPending();
  p.progress[progressEntry.questionId] = progressEntry;
  p.answers.push(answer);
  write(K.pending, p);
}

export function queueProgressList(entries) {
  const p = getPending();
  for (const e of entries) p.progress[e.questionId] = e;
  write(K.pending, p);
}

export function clearPending() {
  write(K.pending, { progress: {}, answers: [] });
}

export function hasPending() {
  const p = getPending();
  return Object.keys(p.progress).length > 0 || p.answers.length > 0;
}

// --- Contador de questões novas por dia ---
export function getNewToday(today) {
  const v = read(K.newToday, null);
  return v && v.date === today ? v.count : 0;
}

export function incrementNewToday(today) {
  write(K.newToday, { date: today, count: getNewToday(today) + 1 });
}

// --- Estatísticas por tag (área e tipo de questão) ---
// Estrutura: { [key]: { tag, kind, attempts, correct, recent: [{ts, correct}] } }
// 'key' = "area:<nome>" ou "tipo:<nome>"; 'recent' mantém as últimas 10 respostas.

export function getTagStats() {
  return read(K.tagStats, {});
}

export function recordTagAnswer(tags, isCorrect, ts) {
  const stats = getTagStats();
  for (const { key, tag, kind } of tags) {
    if (!stats[key]) stats[key] = { tag, kind, attempts: 0, correct: 0, recent: [] };
    stats[key].attempts += 1;
    if (isCorrect) stats[key].correct += 1;
    stats[key].recent.unshift({ ts, correct: isCorrect });
    if (stats[key].recent.length > 10) stats[key].recent.length = 10;
  }
  write(K.tagStats, stats);
}

// Retorna Set de keys fracas (acurácia recente < threshold com mínimo de respostas).
export function getWeakTagKeys(threshold, minAnswers) {
  threshold = threshold === undefined ? 0.6 : threshold;
  minAnswers = minAnswers === undefined ? 3 : minAnswers;
  const stats = getTagStats();
  const weak = new Set();
  for (const key of Object.keys(stats)) {
    const s = stats[key];
    if (s.recent.length < minAnswers) continue;
    const recentAcc = s.recent.filter((r) => r.correct).length / s.recent.length;
    if (recentAcc < threshold) weak.add(key);
  }
  return weak;
}

// --- Última sincronização ---
export function getLastSync() {
  return read(K.lastSync, '');
}

export function setLastSync(iso) {
  write(K.lastSync, iso);
}

// --- Limpeza (mantém configurações) ---
export function clearLocalData() {
  localStorage.removeItem(K.questions);
  localStorage.removeItem(K.progress);
  localStorage.removeItem(K.pending);
  localStorage.removeItem(K.newToday);
  localStorage.removeItem(K.lastSync);
  localStorage.removeItem(K.tagStats);
}
