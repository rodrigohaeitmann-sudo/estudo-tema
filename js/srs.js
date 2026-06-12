// SM-2 simplificado para revisão intervalada.
// Estado por questão: { questionId, ef, interval, reps, due, attempts, correct, lastAnswered }

export function todayStr(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function initialState(questionId, now = new Date()) {
  return {
    questionId,
    ef: 2.3,
    interval: 0,
    reps: 0,
    due: todayStr(now),
    attempts: 0,
    correct: 0,
    lastAnswered: '',
  };
}

// Intervalos gerados com acertos consecutivos: ~1, 3, 7, 16, 37... dias.
// Erro zera reps/intervalo: a questão volta para o início da progressão.
export function schedule(state, isCorrect, now = new Date()) {
  const s = { ...state };
  if (isCorrect) {
    s.reps += 1;
    if (s.reps === 1) s.interval = 1;
    else if (s.reps === 2) s.interval = 3;
    else s.interval = Math.round(s.interval * s.ef);
    s.ef = Math.min(2.8, round2(s.ef + 0.05));
    const due = new Date(now);
    due.setDate(due.getDate() + s.interval);
    s.due = todayStr(due);
  } else {
    s.reps = 0;
    s.interval = 0;
    s.ef = Math.max(1.3, round2(s.ef - 0.2));
    s.due = todayStr(now);
  }
  s.attempts += 1;
  if (isCorrect) s.correct += 1;
  s.lastAnswered = now.toISOString();
  return s;
}

export function isDue(state, today = todayStr()) {
  return (state.due || '') <= today;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}
