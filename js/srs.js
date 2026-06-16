// FSRS-5 — Free Spaced Repetition Scheduler
// Estado por questão: { questionId, difficulty, stability, reps, cardState, due, attempts, correct, lastAnswered }
// cardState: 0=novo, 2=revisão, 3=reaprendendo
// Ratings: 1=Não sei (Again), 2=Difícil (Hard), 3=Ok (Good), 4=Fácil (Easy)

// Parâmetros padrão FSRS-5 (19 pesos, treináveis por usuário em versões futuras)
const W = [
  0.40255,  // w0  S0(Again)
  1.18385,  // w1  S0(Hard)
  3.17395,  // w2  S0(Good)
  15.69105, // w3  S0(Easy)
  7.1949,   // w4  escala de dificuldade inicial
  0.5345,   // w5  decaimento da dificuldade inicial
  1.4604,   // w6  ajuste de dificuldade por rating
  0.0046,   // w7  peso de mean-reversion
  1.54575,  // w8  base de crescimento da estabilidade (recall)
  0.1192,   // w9  amortecimento pela estabilidade atual
  1.01925,  // w10 efeito da recuperabilidade no crescimento
  1.9395,   // w11 base de estabilidade pós-lapso
  0.11,     // w12 efeito da dificuldade no lapso
  0.29605,  // w13 efeito da estabilidade no lapso
  2.2698,   // w14 efeito da recuperabilidade no lapso
  0.2315,   // w15 penalidade para Hard
  2.9898,   // w16 bônus para Easy
  0.51655,  // w17
  0.6621,   // w18
];

const FACTOR           = 19 / 81; // ≈ 0.2346 — constante da curva de esquecimento
const DECAY            = -0.5;
const TARGET_RETENTION = 0.9;     // retenção-alvo: 90%

function clamp(v, lo, hi) { return Math.min(hi, Math.max(lo, v)); }

// Dificuldade inicial para o primeiro rating
function d0(rating) {
  return clamp(W[4] - Math.exp(W[5] * (rating - 1)) + 1, 1, 10);
}

// Recuperabilidade R(t, S): probabilidade de acertar após t dias com estabilidade S
function retrievability(t, s) {
  return Math.pow(1 + FACTOR * t / s, DECAY);
}

// Intervalo (dias) para atingir TARGET_RETENTION dada a estabilidade S
// Para 90%: intervalo ≈ S (a estabilidade é definida como o intervalo onde R=90%)
function nextInterval(s) {
  return Math.max(1, Math.round(s * (Math.pow(TARGET_RETENTION, 1 / DECAY) - 1) / FACTOR));
}

// Atualização de dificuldade após um review (mean-reversion para d0 do Easy)
function nextDifficulty(d, rating) {
  return clamp(
    W[7] * d0(4) + (1 - W[7]) * (d - W[6] * (rating - 3)),
    1, 10
  );
}

// Estabilidade após acerto (Hard/Good/Easy)
function sRecall(d, s, r, rating) {
  const hardPenalty = rating === 2 ? W[15] : 1;
  const easyBonus   = rating === 4 ? W[16] : 1;
  return Math.max(s, s * (
    Math.exp(W[8]) * (11 - d) * Math.pow(s, -W[9])
    * (Math.exp(W[10] * (1 - r)) - 1)
    * hardPenalty * easyBonus + 1
  ));
}

// Estabilidade após lapso (rating = 1 Again)
function sForget(d, s, r) {
  return Math.max(0.1,
    W[11] * Math.pow(d, -W[12])
    * (Math.pow(s + 1, W[13]) - 1)
    * Math.exp(W[14] * (1 - r))
  );
}

// ── API pública ──────────────────────────────────────────────────────────────

export function todayStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function initialState(questionId, now = new Date()) {
  return {
    questionId,
    difficulty:    0,
    stability:     0,
    reps:          0,
    cardState:     0,
    due:           todayStr(now),
    attempts:      0,
    correct:       0,
    lastAnswered:  '',
  };
}

// Agenda o próximo review. rating: 1=Não sei 2=Difícil 3=Ok 4=Fácil
export function schedule(prev, isCorrect, rating, now = new Date()) {
  const s = { ...prev };

  const elapsedDays = prev.lastAnswered
    ? Math.max(0, (now - new Date(prev.lastAnswered)) / 86400000)
    : 0;

  const isNew = !prev.stability || prev.stability <= 0;

  if (isNew) {
    s.difficulty = d0(rating);
    s.stability  = W[rating - 1];
    s.cardState  = 2;
    s.reps       = 1;
  } else {
    const R = retrievability(elapsedDays, prev.stability);
    s.difficulty = nextDifficulty(prev.difficulty, rating);
    if (rating === 1) {
      s.stability = sForget(prev.difficulty, prev.stability, R);
      s.reps      = 0;
      s.cardState = 3;
    } else {
      s.stability = sRecall(prev.difficulty, prev.stability, R, rating);
      s.reps      = (prev.reps || 0) + 1;
      s.cardState = 2;
    }
  }

  const interval = rating === 1 ? 1 : nextInterval(s.stability);
  const dueDate  = new Date(now);
  dueDate.setDate(dueDate.getDate() + interval);
  s.due = todayStr(dueDate);

  s.attempts     = (prev.attempts || 0) + 1;
  s.correct      = (prev.correct  || 0) + (isCorrect ? 1 : 0);
  s.lastAnswered = now.toISOString();
  return s;
}

// Preview sem persistir: retorna os próximos intervalos para cada rating
export function previewIntervals(prev, now = new Date()) {
  const today = todayStr(now);
  return [1, 2, 3, 4].map((rating) => {
    const next = schedule(prev, rating >= 3, rating, now);
    const dueDays = Math.max(0,
      Math.round((new Date(next.due) - new Date(today)) / 86400000)
    );
    return { rating, days: dueDays, text: formatInterval(dueDays) };
  });
}

function formatInterval(days) {
  if (days <= 0) return 'hoje';
  if (days === 1) return 'amanhã';
  if (days < 7)   return `${days}d`;
  if (days < 30)  return `${Math.round(days / 7)}sem`;
  if (days < 365) return `${Math.round(days / 30)}m`;
  return `${(days / 365).toFixed(1)}a`;
}

export function isDue(state, today = todayStr()) {
  return (state.due || '') <= today;
}
