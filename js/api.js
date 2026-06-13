// Cliente do Apps Script Web App.
//
// Leitura (getAll): tenta fetch normal; se falhar por rede/CORS, cai para JSONP
// (carregamento via <script>), que é imune a CORS. JSONP exige que o Code.gs
// implantado suporte o parâmetro `callback` (versão atual deste repositório).
//
// Escrita (saveProgress): POST text/plain (requisição "simple", sem preflight);
// se falhar por rede/CORS, refaz em modo no-cors (dispara sem ler a resposta).

export class ApiError extends Error {
  constructor(message, kind) {
    super(message);
    this.name = 'ApiError';
    this.kind = kind; // 'url' | 'network' | 'login' | 'parse' | 'api'
  }
}

const URL_RE = /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/;

function validarUrl(url) {
  if (!URL_RE.test((url || '').trim())) {
    throw new ApiError(
      'A URL precisa começar com https://script.google.com/macros/s/ e terminar em /exec. ' +
        'Use a URL da implantação (Implantar › Gerenciar implantações), não a barra de endereço do editor.',
      'url'
    );
  }
}

// Traduz erros vindos do script para algo acionável.
function traduzErroApi(raw) {
  const e = String(raw || '');
  if (/invalid token/i.test(e)) {
    return 'Token inválido: o token digitado aqui não corresponde à propriedade ' +
      'API_TOKEN do script (Configurações do projeto › Propriedades do script).';
  }
  if (/getLastRow|getRange|getDataRange|null|getSheetByName|TypeError/i.test(e)) {
    return 'Não encontrei uma das abas da planilha. Confirme que existem as abas ' +
      'com os nomes exatos: Questoes, Progresso e Respostas (sem acento). Erro: ' + e;
  }
  return 'Erro retornado pelo script: ' + e;
}

function jsonp(fullUrl) {
  return new Promise((resolve, reject) => {
    const cb = 'temacb_' + Math.random().toString(36).slice(2);
    const script = document.createElement('script');
    let done = false;
    const timer = setTimeout(() => finish(() => reject(new ApiError(
      'Tempo esgotado ao contatar o Apps Script via JSONP.', 'network'))), 20000);
    function finish(fn) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      delete window[cb];
      script.remove();
      fn();
    }
    window[cb] = (data) => finish(() => resolve(data));
    script.onerror = () => finish(() => reject(new ApiError(
      'Não foi possível carregar o script. Verifique se a URL termina em /exec e se a ' +
        'implantação está com acesso "Qualquer pessoa". Se já estiver, reimplante o Code.gs ' +
        'atualizado (ele adiciona suporte a JSONP).',
      'network')));
    script.src = fullUrl + (fullUrl.includes('?') ? '&' : '?') + 'callback=' + cb;
    document.head.appendChild(script);
  });
}

export async function getAll(url, token) {
  validarUrl(url);
  const qs = `?action=getAll&token=${encodeURIComponent(token)}`;
  let data;
  try {
    const res = await fetch(url + qs, { redirect: 'follow' });
    const text = await res.text();
    if (text.trim().startsWith('<')) {
      throw new ApiError(
        'O script respondeu com HTML (provável tela de login do Google) em vez de dados. ' +
          'Na implantação, defina "Quem pode acessar" como "Qualquer pessoa" — não pode ser ' +
          '"Somente eu" nem "Qualquer pessoa com conta Google".',
        'login'
      );
    }
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError('Resposta inesperada do script: ' + text.slice(0, 140), 'parse');
    }
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // TypeError "Failed to fetch" = rede/CORS → tenta JSONP (imune a CORS).
    data = await jsonp(url + qs);
  }
  if (!data.ok) throw new ApiError(traduzErroApi(data.error), 'api');
  return data;
}

export async function saveProgress(url, token, progressList, answers) {
  validarUrl(url);
  const payload = JSON.stringify({ token, action: 'saveProgress', progress: progressList, answers });
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
      redirect: 'follow',
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      throw new ApiError('Resposta inesperada do script ao salvar: ' + text.slice(0, 140), 'parse');
    }
    if (!data.ok) throw new ApiError(traduzErroApi(data.error), 'api');
    return data;
  } catch (err) {
    if (err instanceof ApiError) throw err;
    // Rede/CORS: dispara em no-cors (resposta opaca; assume enfileirado no servidor).
    await fetch(url, {
      method: 'POST',
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: payload,
    });
    return { ok: true, assumed: true };
  }
}
