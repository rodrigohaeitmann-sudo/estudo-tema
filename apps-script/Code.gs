// TEMa Estudo — API (Google Apps Script Web App)
//
// Setup:
// 1. Na planilha: Extensões > Apps Script > cole este arquivo.
// 2. Configurações do projeto (engrenagem) > Propriedades do script >
//    adicione a propriedade API_TOKEN com o token que você escolher.
// 3. Implantar > Nova implantação > App da web >
//    Executar como: VOCÊ | Quem pode acessar: QUALQUER PESSOA.
// 4. Copie a URL /exec e cole nas Configurações do app junto com o token.
// 5. Após editar este código, é preciso reimplantar (gerenciar implantações >
//    editar > nova versão) para a URL /exec refletir as mudanças.

const SHEET_QUESTOES = 'Questoes';
const SHEET_PROGRESSO = 'Progresso';
const SHEET_RESPOSTAS = 'Respostas';

function doGet(e) {
  const params = (e && e.parameter) || {};
  return respond(handle(params, null), params.callback);
}

function doPost(e) {
  const params = (e && e.parameter) || {};
  let body = {};
  try {
    body = JSON.parse((e.postData && e.postData.contents) || '{}');
  } catch (err) {}
  return respond(handle(params, body), params.callback);
}

function handle(params, body) {
  const token = (body && body.token) || params.token;
  const stored = PropertiesService.getScriptProperties().getProperty('API_TOKEN');
  if (!stored || token !== stored) return { ok: false, error: 'invalid token' };

  const action = (body && body.action) || params.action;
  try {
    if (action === 'getAll') return getAll();
    if (action === 'saveProgress') return saveProgress(body || {});
    return { ok: false, error: 'unknown action: ' + action };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

function getAll() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const questions = readRows(ss, SHEET_QUESTOES)
    .filter(function (q) { return q.id && String(q.ativa) !== '0'; })
    .map(function (q) {
      return {
        id: String(q.id),
        tema: String(q.tema || ''),
        area: String(q.area || ''),
        tipo: String(q.tipo || ''),
        enunciado: String(q.enunciado || ''),
        alt_a: String(q.alt_a || ''),
        alt_b: String(q.alt_b || ''),
        alt_c: String(q.alt_c || ''),
        alt_d: String(q.alt_d || ''),
        alt_e: String(q.alt_e || ''),
        gabarito: String(q.gabarito || '').trim().toUpperCase(),
        comentario: String(q.comentario || ''),
        fonte: String(q.fonte || ''),
        ano: q.ano ? String(q.ano) : ''
      };
    });

  const progress = readRows(ss, SHEET_PROGRESSO)
    .filter(function (p) { return p.question_id; })
    .map(function (p) {
      // Lê tanto o novo formato (difficulty/stability) quanto o legado (ef/intervalo)
      var hasFSRS = p.difficulty !== undefined && p.difficulty !== '';
      var difficulty = hasFSRS
        ? Number(p.difficulty) || 5
        : Math.min(10, Math.max(1, 1 + (2.8 - (Number(p.ef) || 2.3)) * 6));
      var stability = hasFSRS
        ? Number(p.stability) || 0
        : Number(p.intervalo) || 0;
      var cardState = p.estado !== undefined && p.estado !== ''
        ? Number(p.estado) || 0
        : (stability >= 1 ? 2 : 0);
      return {
        questionId:   String(p.question_id),
        difficulty:   difficulty,
        stability:    stability,
        reps:         Number(p.reps) || 0,
        cardState:    cardState,
        due:          toDateStr(p.due),
        attempts:     Number(p.tentativas) || 0,
        correct:      Number(p.acertos) || 0,
        lastAnswered: toIso(p.ultima_resposta)
      };
    });

  return {
    ok: true,
    serverTime: new Date().toISOString(),
    questions: questions,
    progress: progress
  };
}

function saveProgress(body) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const progress = body.progress || [];
    const answers = body.answers || [];

    // Upsert na aba Progresso (chave: question_id na coluna A)
    // Colunas: question_id | difficulty | stability | reps | estado | due | tentativas | acertos | ultima_resposta
    const sh = ss.getSheetByName(SHEET_PROGRESSO);
    const last = sh.getLastRow();
    const ids = last > 1
      ? sh.getRange(2, 1, last - 1, 1).getValues().map(function (r) { return String(r[0]); })
      : [];
    progress.forEach(function (p) {
      const row = [
        String(p.questionId),
        p.difficulty || 5,
        p.stability  || 0,
        p.reps       || 0,
        p.cardState  || 2,
        p.due,
        p.attempts,
        p.correct,
        p.lastAnswered
      ];
      const idx = ids.indexOf(String(p.questionId));
      if (idx >= 0) {
        sh.getRange(idx + 2, 1, 1, row.length).setValues([row]);
      } else {
        sh.appendRow(row);
        ids.push(String(p.questionId));
      }
    });

    // Log append-only na aba Respostas
    // Colunas: ts | question_id | chosen | correct | tema | area | tipo | rating
    if (answers.length) {
      const sr = ss.getSheetByName(SHEET_RESPOSTAS);
      sr.getRange(sr.getLastRow() + 1, 1, answers.length, 8).setValues(
        answers.map(function (a) {
          return [a.ts, String(a.questionId), a.chosen, a.correct, a.tema || '', a.area || '', a.tipo || '', a.rating || 0];
        })
      );
    }

    return { ok: true, savedProgress: progress.length, savedAnswers: answers.length };
  } finally {
    lock.releaseLock();
  }
}

// --- helpers ---

function readRows(ss, name) {
  const sh = ss.getSheetByName(name);
  if (!sh || sh.getLastRow() < 2) return [];
  const values = sh.getDataRange().getValues();
  const headers = values[0].map(String);
  return values.slice(1).map(function (row) {
    const o = {};
    headers.forEach(function (h, i) { o[h] = row[i]; });
    return o;
  });
}

function toDateStr(v) {
  if (v instanceof Date) {
    return Utilities.formatDate(v, Session.getScriptTimeZone(), 'yyyy-MM-dd');
  }
  return String(v || '');
}

function toIso(v) {
  return v instanceof Date ? v.toISOString() : String(v || '');
}

function respond(obj, callback) {
  const json = JSON.stringify(obj);
  // JSONP: quando o cliente envia ?callback=fn, devolve fn(json) como JavaScript,
  // o que permite ler a resposta via <script> e contornar restrições de CORS.
  if (callback) {
    return ContentService.createTextOutput(callback + '(' + json + ')')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json)
    .setMimeType(ContentService.MimeType.JSON);
}
