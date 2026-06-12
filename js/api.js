// Cliente do Apps Script Web App.
// POST usa Content-Type text/plain para ser uma requisição "simple" (sem
// preflight OPTIONS, que o Apps Script não responde). O Apps Script responde
// com redirect 302 para script.googleusercontent.com; redirect:'follow' resolve.

export async function getAll(url, token) {
  const res = await fetch(`${url}?action=getAll&token=${encodeURIComponent(token)}`, {
    redirect: 'follow',
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro desconhecido na API');
  return data;
}

export async function saveProgress(url, token, progressList, answers) {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ token, action: 'saveProgress', progress: progressList, answers }),
    redirect: 'follow',
  });
  const data = await res.json();
  if (!data.ok) throw new Error(data.error || 'Erro desconhecido na API');
  return data;
}
