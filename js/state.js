// Persistência local (localStorage): cache de questões/progresso e fila de sync.
// A planilha (via Apps Script) é a fonte da verdade cross-device; conflitos são
// resolvidos por last-write-wins usando lastAnswered por questão.

const K = {
  settings: 'tema:settings',
  questions: 'tema:questions',
  progress: 'tema:progress',
  pending: 'tema:pending',
  newToday: 'tema:newToday',
  answeredToday: 'tema:answeredToday',
  streak: 'tema:streak',
  lastSync: 'tema:lastSync',
  tagStats: 'tema:tag_stats',
  estudos: 'tema:estudos',
};

// Desloca uma data 'YYYY-MM-DD' por `delta` dias (seguro quanto a fuso local).
function shiftDay(dateStr, delta) {
  const [y, m, d] = String(dateStr).split('-').map(Number);
  const dt = new Date(y, m - 1, d + delta);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

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

// --- Estudos (cache do getAll, indexado por estudo_id) ---
let _estudoMap = null; // memoiza o índice; invalidado em setEstudos

export function getEstudos() {
  return read(K.estudos, []);
}

export function setEstudos(list) {
  write(K.estudos, Array.isArray(list) ? list : []);
  _estudoMap = null;
}

function estudoMap() {
  if (_estudoMap) return _estudoMap;
  _estudoMap = new Map();
  for (const e of getEstudos()) {
    if (e && e.estudo_id) _estudoMap.set(e.estudo_id, e);
  }
  return _estudoMap;
}

// Retorna a ficha do estudo (do cache) ou null. Não faz fetch.
export function getEstudo(id) {
  if (!id) return null;
  return estudoMap().get(id) || null;
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

// --- Contador total de questões respondidas por dia (meta/ofensiva) ---
export function getAnsweredToday(today) {
  const v = read(K.answeredToday, null);
  return v && v.date === today ? v.count : 0;
}

export function incrementAnsweredToday(today) {
  const count = getAnsweredToday(today) + 1;
  write(K.answeredToday, { date: today, count });
  return count;
}

// --- Ofensiva (streak): dias consecutivos cumprindo a meta ---
// Estrutura: { count, lastDay } — lastDay é a última data em que a meta foi batida.

export function getStreakRaw() {
  return read(K.streak, { count: 0, lastDay: '' });
}

// Ofensiva "viva": conta se a meta foi batida hoje ou ontem; senão, foi quebrada.
export function getCurrentStreak(today) {
  const s = getStreakRaw();
  if (!s.lastDay) return 0;
  if (s.lastDay === today) return s.count;
  if (s.lastDay === shiftDay(today, -1)) return s.count;
  return 0;
}

// Marca a meta de hoje como cumprida; encadeia com ontem ou inicia nova ofensiva.
// Idempotente: chamar várias vezes no mesmo dia não altera a contagem.
export function completeStreakDay(today) {
  const s = getStreakRaw();
  if (s.lastDay === today) return s.count;
  s.count = s.lastDay === shiftDay(today, -1) ? s.count + 1 : 1;
  s.lastDay = today;
  write(K.streak, s);
  return s.count;
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

// Migra progresso do formato SM-2 (ef/interval) para FSRS (difficulty/stability).
// Executa uma única vez; entradas já no formato FSRS são ignoradas.
export function migrateProgress() {
  const progress = getProgress();
  let changed = false;
  for (const p of Object.values(progress)) {
    if ('ef' in p && !('difficulty' in p)) {
      // ef [1.3, 2.8] → difficulty [1, 10]: ef alto = fácil = D baixo
      const ef = p.ef || 2.3;
      p.difficulty = Math.round(Math.min(10, Math.max(1, 1 + (2.8 - ef) * 6)) * 10) / 10;
      p.stability  = p.interval || 0;
      p.cardState  = (p.interval || 0) >= 1 ? 2 : 0;
      delete p.ef;
      delete p.interval;
      changed = true;
    }
  }
  if (changed) write(K.progress, progress);
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
  localStorage.removeItem(K.answeredToday);
  localStorage.removeItem(K.lastSync);
  localStorage.removeItem(K.tagStats);
  localStorage.removeItem(K.estudos);
  _estudoMap = null;
  // Nota: a ofensiva (K.streak) é preservada — é uma conquista local, não cache.
}
