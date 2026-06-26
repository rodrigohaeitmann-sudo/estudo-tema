import * as api from './api.js';
import * as srs from './srs.js';
import * as state from './state.js';
import * as ui from './ui.js';

let session = null;

// ---------- Início ----------

function computeHomeData() {
  const questions = state.getQuestions();
  const progress  = state.getProgress();
  const settings  = state.getSettings();
  const today     = srs.todayStr();

  const dueCount = questions.filter((q) => progress[q.id] && srs.isDue(progress[q.id], today)).length;
  const unseenTotal = questions.filter((q) => !progress[q.id]).length;

  const goal          = settings.newPerDay || 0;
  const answeredToday = state.getAnsweredToday(today);

  const entries      = Object.values(progress).filter((p) => p.attempts > 0);
  const totalAttempts = entries.reduce((s, p) => s + p.attempts, 0);
  const totalCorrect  = entries.reduce((s, p) => s + p.correct, 0);

  let alert = null;
  if (!settings.url || !settings.token) {
    alert = 'Configure a URL do Apps Script e o token na aba Ajustes para carregar as questões.';
  } else if (questions.length === 0) {
    alert = 'Nenhuma questão carregada ainda. Verifique a conexão e toque em "Sincronizar agora" nos Ajustes.';
  }

  const tagStats  = state.getTagStats();
  const weakAreas = Object.values(tagStats)
    .filter((s) => s.kind === 'area' && s.recent.length >= 3)
    .map((s) => ({
      tag: s.tag,
      accuracy: s.recent.filter((r) => r.correct).length / s.recent.length,
    }))
    .filter((s) => s.accuracy < 0.6)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 3);

  return {
    dueCount,
    unseenTotal,
    wrongCount: entries.filter((p) => p.correct < p.attempts).length,
    hasQuestions: questions.length > 0,
    answeredToday,
    goal,
    goalMet: goal > 0 && answeredToday >= goal,
    streak: state.getCurrentStreak(today),
    totalAnswered: entries.length,
    accuracy: totalAttempts > 0 ? totalCorrect / totalAttempts : null,
    mastered: entries.filter((p) => (p.stability || 0) >= 21).length,
    weakAreas,
    alert,
  };
}

function refreshHome() {
  ui.renderHome(computeHomeData());
  renderLauncher();
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

function questionTagKeys(q) {
  const keys = [];
  if (q.area) keys.push('area:' + q.area);
  if (q.tipo) keys.push('tipo:' + q.tipo);
  return keys;
}

function hasWeakTag(question, weakKeys) {
  if (!weakKeys.size) return false;
  return questionTagKeys(question).some((k) => weakKeys.has(k));
}

// Estudo diário = apenas revisões vencidas (questões já vistas que o SRS agendou).
// Questões inéditas NÃO entram aqui — são introduzidas via "Estudar por tema".
function buildReviewQueue(limit) {
  const questions = state.getQuestions();
  const progress  = state.getProgress();
  const today     = srs.todayStr();
  const weakKeys  = state.getWeakTagKeys();

  const due = questions.filter((q) => progress[q.id] && srs.isDue(progress[q.id], today));
  const weakDue  = shuffle(due.filter((q) =>  hasWeakTag(q, weakKeys)));
  const otherDue = shuffle(due.filter((q) => !hasWeakTag(q, weakKeys)));
  const all = [...weakDue, ...otherDue];
  return limit ? all.slice(0, limit) : all;
}

function beginSession(queue) {
  if (queue.length === 0) return false;
  // Snapshot de quais questões eram inéditas no início (rótulo Nova/Revisão estável
  // mesmo que uma nova seja reenfileirada após erro).
  const progress = state.getProgress();
  const newSet = new Set();
  for (const q of queue) {
    const p = progress[q.id];
    if (!p || !p.attempts) newSet.add(q.id);
  }
  session = {
    queue,
    position: 0,
    firstTry: {},          // questionId → acertou na primeira vez nesta sessão
    injected: new Set(),   // IDs injetados como irmãs (não geram novas injeções)
    newSet,                // IDs que eram inéditos no início da sessão
  };
  ui.showScreen('study');
  presentNext();
  return true;
}

// ---------- Revisão global de erradas (lotes de 10/15/20) ----------

// Todas as questões já vistas que o usuário errou (acertos < tentativas), de
// todos os temas. Vencidas primeiro, depois menor estabilidade. Limitado ao lote.
function buildWrongQueue(limit) {
  const progress = state.getProgress();
  const today    = srs.todayStr();
  const wrong = state.getQuestions().filter((q) => {
    const p = progress[q.id];
    return p && p.attempts > 0 && p.correct < p.attempts;
  });
  wrong.sort((a, b) => {
    const pa = progress[a.id];
    const pb = progress[b.id];
    const ad = srs.isDue(pa, today) ? 0 : 1;
    const bd = srs.isDue(pb, today) ? 0 : 1;
    if (ad !== bd) return ad - bd;
    return (pa.stability || 0) - (pb.stability || 0);
  });
  return limit ? wrong.slice(0, limit) : wrong;
}

function startWrongSession(limit) {
  beginSession(buildWrongQueue(limit));
}

// ---------- Estudo sugerido (bloco diário equilibrado de 10) ----------

// Monta um bloco de ~10 questões: 6 de um tema prioritário (3 de um estudo + 3
// de outro, para manter o fluxo) + 4 de revisão. O tema prioritário e os estudos
// são escolhidos pelos MENOS respondidos, equilibrando a evolução entre todos os
// temas e estudos ao longo do tempo (repetível: cada bloco recalcula o balanço).
function buildSuggestedQueue() {
  const questions = state.getQuestions();
  const progress  = state.getProgress();
  const today     = srs.todayStr();
  const groupBy   = groupByOptions()[0];

  const isNewQ = (q) => !progress[q.id] || !progress[q.id].attempts;
  const isDueQ = (q) => progress[q.id] && srs.isDue(progress[q.id], today);

  // Contagens de respondidas para equilíbrio (por tema e por estudo).
  const themeAnswered = {}, studyAnswered = {}, byTheme = {};
  for (const q of questions) {
    const p = progress[q.id];
    const ans = p && p.attempts ? 1 : 0;
    const tk = themeKeyOf(q, groupBy);
    if (tk) { themeAnswered[tk] = (themeAnswered[tk] || 0) + ans; (byTheme[tk] = byTheme[tk] || []).push(q); }
    const e = (q.estudo_id || '').trim();
    if (e) studyAnswered[e] = (studyAnswered[e] || 0) + ans;
  }

  const used = new Set();
  const rankFresh = (q) => (isNewQ(q) ? 0 : isDueQ(q) ? 1 : 2); // inéditas → vencidas → resto
  const pick = (pool, n) => {
    const chosen = pool
      .filter((q) => !used.has(q.id))
      .sort((a, b) => rankFresh(a) - rankFresh(b) || ((progress[a.id] && progress[a.id].stability) || 0) - ((progress[b.id] && progress[b.id].stability) || 0))
      .slice(0, n);
    chosen.forEach((q) => used.add(q.id));
    return chosen;
  };

  const block = [];

  // 1) Tema prioritário: menos respondido (sorteio leve entre os 3 menores p/ variar).
  const candidateThemes = Object.keys(byTheme)
    .filter((tk) => byTheme[tk].some((q) => isNewQ(q) || isDueQ(q)))
    .sort((a, b) => (themeAnswered[a] || 0) - (themeAnswered[b] || 0));
  const lowest = candidateThemes.slice(0, Math.min(3, candidateThemes.length));
  const priorityTheme = lowest.length ? lowest[Math.floor(Math.random() * lowest.length)] : null;

  // 2) Dentro do tema, 2 estudos menos respondidos → 3 + 3.
  if (priorityTheme) {
    const qsTheme = byTheme[priorityTheme];
    const byStudy = {};
    for (const q of qsTheme) {
      const e = (q.estudo_id || '').trim();
      if (e) (byStudy[e] = byStudy[e] || []).push(q);
    }
    const studies = Object.keys(byStudy)
      .filter((e) => byStudy[e].some((q) => !used.has(q.id)))
      .sort((a, b) => (studyAnswered[a] || 0) - (studyAnswered[b] || 0));
    if (studies.length >= 2) {
      block.push(...pick(byStudy[studies[0]], 3));
      block.push(...pick(byStudy[studies[1]], 3));
    } else if (studies.length === 1) {
      block.push(...pick(byStudy[studies[0]], 6));
    }
    // Completa as 6 com qualquer questão do tema, se faltou (poucos estudos/questões).
    if (block.length < 6) block.push(...pick(qsTheme, 6 - block.length));
  }

  // 3) 4 questões de revisão (vencidas), priorizando áreas fracas.
  const weakKeys = state.getWeakTagKeys();
  const due = questions.filter((q) => isDueQ(q) && !used.has(q.id));
  const weakDue  = shuffle(due.filter((q) =>  hasWeakTag(q, weakKeys)));
  const otherDue = shuffle(due.filter((q) => !hasWeakTag(q, weakKeys)));
  const reviews = [...weakDue, ...otherDue].slice(0, 4);
  reviews.forEach((q) => used.add(q.id));
  block.push(...reviews);

  // 4) Completa até 10 se faltou (ex.: poucas vencidas).
  if (block.length < 10) block.push(...pick(questions, 10 - block.length));

  return block;
}

function startSuggestedSession() {
  beginSession(buildSuggestedQueue());
}

// ---------- Launcher da Home (seletor de atividade + Iniciar) ----------

const launcher = { activity: 'sugerido', count: 'todas' };

// Contagens para o launcher: vencidas e erradas pendentes.
function launcherCounts() {
  const progress = state.getProgress();
  const today = srs.todayStr();
  const qs = state.getQuestions();
  let due = 0, wrong = 0;
  for (const q of qs) {
    const p = progress[q.id];
    if (p && srs.isDue(p, today)) due += 1;
    if (p && p.attempts > 0 && p.correct < p.attempts) wrong += 1;
  }
  return { due, wrong, hasQuestions: qs.length > 0 };
}

function renderLauncher() {
  ui.renderLauncher(launcher, launcherCounts(), launcherHandlers);
}

const launcherHandlers = {
  onActivity(a) { launcher.activity = a; renderLauncher(); },
  onCount(c) { launcher.count = c; renderLauncher(); },
  onStart() {
    const lim = launcher.count === 'todas' ? null : launcher.count;
    if (launcher.activity === 'sugerido') startSuggestedSession();
    else if (launcher.activity === 'revisar') beginSession(buildReviewQueue(lim));
    else if (launcher.activity === 'erradas') startWrongSession(lim);
  },
};

// ---------- Estudar por tema ----------

const COUNT_OPTIONS = [5, 10, 20, 'max'];
const themeStudy = { groupBy: null, theme: null, mode: 'novas', count: 10 };

// Quais agrupamentos existem no banco (Área e/ou Tema).
function groupByOptions() {
  const qs = state.getQuestions();
  const opts = [];
  if (qs.some((q) => q.area)) opts.push('area');
  if (qs.some((q) => q.tema)) opts.push('tema');
  return opts.length ? opts : ['tema'];
}

function themeKeyOf(q, groupBy) {
  return ((groupBy === 'tema' ? q.tema : q.area) || '').trim();
}

// Lista de temas do agrupamento, com contagem por modo (novas/erradas/todas).
function computeThemeGroups(groupBy) {
  const questions = state.getQuestions();
  const progress  = state.getProgress();
  const map = {};
  for (const q of questions) {
    const key = themeKeyOf(q, groupBy);
    if (!key) continue;
    if (!map[key]) map[key] = { name: key, novas: 0, erradas: 0, todas: 0 };
    const p = progress[q.id];
    map[key].todas += 1;
    if (!p || !p.attempts) map[key].novas += 1;
    else if (p.correct < p.attempts) map[key].erradas += 1;
  }
  return Object.values(map).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
}

// Monta a fila de uma sessão por tema conforme modo e quantidade.
function buildThemeQueue(groupBy, theme, mode, count) {
  const questions = state.getQuestions();
  const progress  = state.getProgress();
  const today     = srs.todayStr();

  let pool = questions.filter((q) => themeKeyOf(q, groupBy) === theme);
  if (mode === 'novas') {
    pool = pool.filter((q) => !progress[q.id] || !progress[q.id].attempts);
    pool = pool.slice(); // mantém a ordem da planilha (sequência pedagógica)
  } else {
    if (mode === 'erradas') {
      pool = pool.filter((q) => {
        const p = progress[q.id];
        return p && p.attempts > 0 && p.correct < p.attempts;
      });
    }
    // 'todas' e 'erradas': vencidas primeiro, depois menor estabilidade
    pool.sort((a, b) => {
      const pa = progress[a.id];
      const pb = progress[b.id];
      const ad = pa && srs.isDue(pa, today) ? 0 : 1;
      const bd = pb && srs.isDue(pb, today) ? 0 : 1;
      if (ad !== bd) return ad - bd;
      return (pa ? pa.stability || 0 : 0) - (pb ? pb.stability || 0 : 0);
    });
  }
  const n = count === 'max' ? pool.length : Math.min(count, pool.length);
  return pool.slice(0, n);
}

// Renderiza a tela de montagem da sessão por tema com o estado atual.
function renderStudySetup() {
  const opts = groupByOptions();
  if (!themeStudy.groupBy || !opts.includes(themeStudy.groupBy)) themeStudy.groupBy = opts[0];

  const groups = computeThemeGroups(themeStudy.groupBy);
  if (themeStudy.theme && !groups.some((g) => g.name === themeStudy.theme)) themeStudy.theme = null;

  const sel = groups.find((g) => g.name === themeStudy.theme) || null;
  const available = sel ? sel[themeStudy.mode] : 0;

  ui.showStudySetup({
    groups,
    groupBy: themeStudy.groupBy,
    groupByOptions: opts,
    selectedTheme: themeStudy.theme,
    mode: themeStudy.mode,
    count: themeStudy.count,
    available,
  }, themeStudyHandlers);
}

const themeStudyHandlers = {
  onGroupBy(g) { themeStudy.groupBy = g; themeStudy.theme = null; renderStudySetup(); },
  onTheme(name) { themeStudy.theme = name; renderStudySetup(); },
  onMode(m) { themeStudy.mode = m; renderStudySetup(); },
  onCount(c) { themeStudy.count = c; renderStudySetup(); },
  onStart() {
    if (!themeStudy.theme) return;
    beginSession(buildThemeQueue(themeStudy.groupBy, themeStudy.theme, themeStudy.mode, themeStudy.count));
  },
};

// Abre a aba Estudo: retoma a sessão ativa, ou mostra a montagem por tema.
function openStudyTab() {
  if (session) ui.showSessionView();
  else renderStudySetup();
}

// ---------- Aba Estudos (biblioteca de estudos científicos) ----------

const estudosView = { groupBy: null };

// Estatísticas (total/novas/erradas) das questões que referenciam um estudo.
function estudoQuestionStats(estudo_id) {
  const progress = state.getProgress();
  const qs = state.getQuestions().filter((q) => (q.estudo_id || '').trim() === estudo_id);
  let novas = 0, erradas = 0;
  for (const q of qs) {
    const p = progress[q.id];
    if (!p || !p.attempts) novas += 1;
    else if (p.correct < p.attempts) erradas += 1;
  }
  return { total: qs.length, novas, erradas };
}

// Agrupa os estudos salvos por tema (área/tema dominante das suas questões).
function computeEstudosData(groupBy) {
  const estudos = state.getEstudos();
  const questions = state.getQuestions();
  const progress = state.getProgress();

  const byEstudo = {};
  for (const q of questions) {
    const e = (q.estudo_id || '').trim();
    if (!e) continue;
    (byEstudo[e] = byEstudo[e] || []).push(q);
  }

  const groupsMap = {};
  for (const est of estudos) {
    const qs = byEstudo[est.estudo_id] || [];
    let novas = 0, erradas = 0;
    const tally = {};
    for (const q of qs) {
      const p = progress[q.id];
      if (!p || !p.attempts) novas += 1;
      else if (p.correct < p.attempts) erradas += 1;
      const k = themeKeyOf(q, groupBy);
      if (k) tally[k] = (tally[k] || 0) + 1;
    }
    let theme = 'Outros', best = 0;
    for (const k in tally) { if (tally[k] > best) { best = tally[k]; theme = k; } }

    (groupsMap[theme] = groupsMap[theme] || []).push({
      estudo_id: est.estudo_id,
      nome: est.nome || est.estudo_id,
      total: qs.length,
      novas,
      erradas,
    });
  }

  const groups = Object.keys(groupsMap)
    .sort((a, b) => (a === 'Outros' ? 1 : b === 'Outros' ? -1 : a.localeCompare(b, 'pt-BR')))
    .map((name) => ({
      name,
      estudos: groupsMap[name].sort((x, y) => x.nome.localeCompare(y.nome, 'pt-BR')),
    }));

  return { groupBy, groupByOptions: groupByOptions(), groups, totalEstudos: estudos.length };
}

// Fila com as questões que referenciam um estudo: vencidas primeiro, depois
// inéditas, depois o restante já visto.
function buildEstudoQueue(estudo_id) {
  const progress = state.getProgress();
  const today = srs.todayStr();
  const rank = (q) => {
    const p = progress[q.id];
    if (p && srs.isDue(p, today)) return 0;
    if (!p) return 1;
    return 2;
  };
  return state.getQuestions()
    .filter((q) => (q.estudo_id || '').trim() === estudo_id)
    .sort((a, b) => rank(a) - rank(b));
}

function renderEstudos() {
  const opts = groupByOptions();
  if (!estudosView.groupBy || !opts.includes(estudosView.groupBy)) estudosView.groupBy = opts[0];
  ui.showEstudosList(computeEstudosData(estudosView.groupBy), estudosHandlers);
}

const estudosHandlers = {
  onGroupBy(g) { estudosView.groupBy = g; renderEstudos(); },
  onOpen(id) { openEstudoDetail(id); },
};

function openEstudoDetail(id) {
  const estudo = state.getEstudo(id);
  if (!estudo) return;
  ui.showEstudoDetail(estudo, estudoQuestionStats(id), {
    onBack: renderEstudos,
    onStudy: () => beginSession(buildEstudoQueue(id)),
  });
}

function openEstudosTab() {
  renderEstudos();
}

function presentNext() {
  if (!session || session.position >= session.queue.length) {
    finishSession();
    return;
  }
  const question = session.queue[session.position];
  ui.renderQuestion(
    question,
    { position: session.position + 1, total: session.queue.length, isNew: session.newSet.has(question.id) },
    (letter) => onAnswer(question, letter)
  );
}

// Etapa 1: usuário escolhe alternativa → revela resposta + exibe botões de rating
function onAnswer(question, chosen) {
  const isCorrect = chosen === question.gabarito;
  const prev      = state.getProgress()[question.id] || srs.initialState(question.id);

  // Para acertos: mostra 3 botões (Difícil/Ok/Fácil) com preview de intervalo
  // Para erros: mostra apenas "Próxima" (rating automático = 1)
  const previews = isCorrect ? srs.previewIntervals(prev) : null;

  // Ficha do estudo (do cache) — null se a questão não tiver estudo_id válido
  const estudo = state.getEstudo(question.estudo_id);

  ui.showFeedback(question, chosen, isCorrect, previews, estudo, (rating) => {
    commitAnswer(question, chosen, isCorrect, rating, prev);
    session.position += 1;
    presentNext();
  });
}

// Etapa 2: usuário escolhe rating → persiste o agendamento FSRS
function commitAnswer(question, chosen, isCorrect, rating, prev) {
  const now   = new Date();
  const today = srs.todayStr(now);

  if (prev.attempts === 0) state.incrementNewToday(today);

  // Conta toda resposta para a meta do dia e fecha a ofensiva ao bater a meta.
  const answeredToday = state.incrementAnsweredToday(today);
  const goal = state.getSettings().newPerDay || 0;
  if (goal > 0 && answeredToday >= goal) state.completeStreakDay(today);

  const next = srs.schedule(prev, isCorrect, rating, now);
  state.updateProgress(next);

  const tags = [];
  if (question.area) tags.push({ key: 'area:' + question.area, tag: question.area, kind: 'area' });
  if (question.tipo) tags.push({ key: 'tipo:' + question.tipo, tag: question.tipo, kind: 'tipo' });
  if (tags.length) state.recordTagAnswer(tags, isCorrect, next.lastAnswered);

  state.queueAnswer(next, {
    ts:         next.lastAnswered,
    questionId: question.id,
    chosen,
    correct: isCorrect ? 1 : 0,
    rating,
    tema: question.tema || '',
    area: question.area || '',
    tipo: question.tipo || '',
  });

  if (!(question.id in session.firstTry)) session.firstTry[question.id] = isCorrect;

  // Erros (rating 1 = Again): re-enfileira + injeta irmãs se houver
  if (rating === 1) {
    session.queue.push(question);
    if (!session.injected.has(question.id) && (question.area || question.tipo)) {
      const sisters = getSisterQuestions(question, session);
      if (sisters.length) {
        const insertAt = Math.min(session.position + 2, session.queue.length - 1);
        session.queue.splice(insertAt, 0, ...sisters);
        sisters.forEach((s) => session.injected.add(s.id));
      }
    }
  }

  updateSyncUI();
}

// Retorna até `limit` questões da mesma área ou tipo não presentes na sessão atual
function getSisterQuestions(question, session, limit = 2) {
  const questions = state.getQuestions();
  const progress  = state.getProgress();
  const today     = srs.todayStr();
  const inSession = new Set(session.queue.map((q) => q.id));

  return questions
    .filter((q) => {
      if (inSession.has(q.id)) return false;
      if (!progress[q.id]) return false; // só reforça questões já vistas (não desbloqueia novas)
      const sameArea = question.area && q.area === question.area;
      const sameTipo = question.tipo && q.tipo === question.tipo;
      return sameArea || sameTipo;
    })
    .sort((a, b) => {
      const pa = progress[a.id];
      const pb = progress[b.id];
      const aDue = pa && srs.isDue(pa, today) ? 0 : 1;
      const bDue = pb && srs.isDue(pb, today) ? 0 : 1;
      if (aDue !== bDue) return aDue - bDue;
      return (pa ? pa.stability || 0 : 0) - (pb ? pb.stability || 0 : 0);
    })
    .slice(0, limit);
}

function finishSession() {
  const firstTry       = session ? session.firstTry : {};
  const answered       = Object.keys(firstTry).length;
  const correctFirstTry = Object.values(firstTry).filter(Boolean).length;
  session = null;

  const today = srs.todayStr();
  const goal  = state.getSettings().newPerDay || 0;
  ui.renderSessionEnd({
    answered,
    correctFirstTry,
    goalMet: goal > 0 && state.getAnsweredToday(today) >= goal,
    streak:  state.getCurrentStreak(today),
  });
  refreshHome();
  syncPending().catch(() => updateSyncUI());
}

// ---------- Estatísticas ----------

function refreshStats() {
  const questions = state.getQuestions();
  const progress  = state.getProgress();
  const temaById  = Object.fromEntries(questions.map((q) => [q.id, q.tema || 'Sem tema']));

  const entries       = Object.values(progress).filter((p) => p.attempts > 0);
  const totalAttempts = entries.reduce((s, p) => s + p.attempts, 0);
  const totalCorrect  = entries.reduce((s, p) => s + p.correct, 0);
  const mastered      = entries.filter((p) => (p.stability || 0) >= 21).length;

  const byTemaMap = {};
  for (const p of entries) {
    const tema = temaById[p.questionId] || 'Sem tema';
    byTemaMap[tema] = byTemaMap[tema] || { tema, answered: 0, attempts: 0, correct: 0 };
    byTemaMap[tema].answered += 1;
    byTemaMap[tema].attempts += p.attempts;
    byTemaMap[tema].correct  += p.correct;
  }
  const byTema = Object.values(byTemaMap)
    .map((t) => ({ ...t, accuracy: t.attempts > 0 ? t.correct / t.attempts : 0 }))
    .sort((a, b) => a.tema.localeCompare(b.tema));

  const tagStats    = state.getTagStats();
  const makeTagRows = (kind) =>
    Object.values(tagStats)
      .filter((s) => s.kind === kind && s.attempts > 0)
      .map((s) => ({
        name:       s.tag,
        attempts:   s.attempts,
        correct:    s.correct,
        accuracy:   s.correct / s.attempts,
        recentAcc:  s.recent.length
          ? s.recent.filter((r) => r.correct).length / s.recent.length
          : null,
        recentCount: s.recent.length,
      }))
      .sort((a, b) => a.accuracy - b.accuracy);

  ui.renderStats({
    totalAnswered: entries.length,
    totalAttempts,
    accuracy: totalAttempts > 0 ? totalCorrect / totalAttempts : 0,
    mastered,
    byTema,
    byArea: makeTagRows('area'),
    byTipo: makeTagRows('tipo'),
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

async function fullSync() {
  const { url, token } = state.getSettings();
  if (!url || !token) throw new Error('Configure a URL do Apps Script e o token na aba Ajustes.');
  if (!navigator.onLine) throw new Error('Sem conexão com a internet.');
  await syncPending();
  const data = await api.getAll(url, token);
  state.setQuestions(data.questions.filter(isValidQuestion));
  state.setEstudos(data.estudos || []);
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
  document.getElementById('cfg-url').value       = s.url;
  document.getElementById('cfg-token').value     = s.token;
  document.getElementById('cfg-new-per-day').value = s.newPerDay;
}

function bindConfig() {
  document.getElementById('btn-save-config').addEventListener('click', () => {
    state.saveSettings({
      url:       document.getElementById('cfg-url').value.trim(),
      token:     document.getElementById('cfg-token').value.trim(),
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
      ui.setConfigStatus(`Conexão OK — ${data.questions.length} questões, ${(data.estudos || []).length} estudos e ${data.progress.length} registros de progresso na planilha.`);
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
      if (screen === 'home')  refreshHome();
      ui.showScreen(screen);
      if (screen === 'study') openStudyTab();
      if (screen === 'estudos') openEstudosTab();
    });
  });
}

function init() {
  state.migrateProgress(); // SM-2 → FSRS (no-op se já migrado)
  bindNav();
  bindConfig();
  loadConfigForm();
  document.getElementById('btn-theme-study').addEventListener('click', () => {
    ui.showScreen('study');
    openStudyTab();
  });

  window.addEventListener('online', () => {
    syncPending().catch(() => updateSyncUI());
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') syncPending().catch(() => {});
  });

  refreshHome();
  const s = state.getSettings();
  if (s.url && s.token) {
    fullSync().catch((err) => ui.setSyncIndicator('offline', 'Falha ao sincronizar: ' + err.message));
  }
}

init();
