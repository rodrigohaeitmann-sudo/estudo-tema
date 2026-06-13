# TEMa Estudo — Revisão Intervalada de Mastologia

Web app estático (HTML/CSS/JS puro, sem build) para revisão intervalada de questões
da prova de título de mastologia. As questões ficam em uma planilha Google que você
atualiza livremente; o progresso (algoritmo SM-2 simplificado, estilo Anki) é salvo
de volta na mesma planilha via Google Apps Script, permitindo usar em vários
dispositivos. O app é hospedado no GitHub Pages e pode ser adicionado à tela
inicial do celular.

## Como funciona

- **Revisão intervalada (SM-2 simplificado):** acertos consecutivos aumentam o
  intervalo até a próxima revisão (~1, 3, 7, 16, 37 dias...). Errar zera a
  progressão da questão e ela volta ao fim da fila da sessão atual até ser acertada.
- **Sessão de estudo:** primeiro as questões vencidas (em ordem aleatória), depois
  até N questões novas por dia (padrão 15, configurável em Ajustes).
- **Offline:** as respostas ficam em fila no navegador e são sincronizadas com a
  planilha quando houver conexão.
- **Conflitos entre dispositivos:** vence o registro mais recente por questão
  (last-write-wins via data da última resposta).

## Setup (uma única vez)

### 1. Criar a planilha Google

Crie uma planilha com **3 abas** com estes nomes e cabeçalhos exatos na linha 1:

**Aba `Questoes`** (você edita — pode adicionar questões a qualquer momento):

| id | tema | enunciado | alt_a | alt_b | alt_c | alt_d | alt_e | gabarito | comentario | fonte | ano | ativa |
|----|------|-----------|-------|-------|-------|-------|-------|----------|------------|-------|-----|-------|
| Q001 | Rastreamento | Texto da questão... | ... | ... | ... | ... | ... | C | Explicação... | TEMa 2022 | 2022 | 1 |

- `id`: **estável e único** (ex.: Q001, Q002...). Nunca renumere nem reutilize —
  é o vínculo entre a questão e o seu progresso. A ordem das linhas não importa.
- `gabarito`: letra de A a E.
- `ativa`: deixe vazio ou `1`; coloque `0` para a questão sumir do app sem apagar a linha.

**Aba `Progresso`** (escrita pelo script — só crie os cabeçalhos):

| question_id | ef | intervalo | reps | due | tentativas | acertos | ultima_resposta |
|-------------|----|-----------|------|-----|------------|---------|-----------------|

**Aba `Respostas`** (log escrito pelo script — só crie os cabeçalhos):

| timestamp | question_id | escolhida | correta | tema |
|-----------|-------------|-----------|---------|------|

### 2. Publicar o Apps Script

1. Na planilha: **Extensões → Apps Script** e cole o conteúdo de
   [`apps-script/Code.gs`](apps-script/Code.gs) (substituindo o que estiver lá).
2. Na engrenagem **Configurações do projeto → Propriedades do script**, adicione
   a propriedade `API_TOKEN` com um token de sua escolha (qualquer senha longa).
3. **Implantar → Nova implantação → App da web**, com:
   - Executar como: **você**
   - Quem pode acessar: **qualquer pessoa**
4. Copie a URL que termina em `/exec`.

> Sempre que editar o `Code.gs`, vá em **Implantar → Gerenciar implantações →
> editar → Nova versão**, senão a URL `/exec` continua servindo a versão antiga.

### 3. Publicar o app no GitHub Pages

No GitHub: **Settings → Pages → Deploy from a branch → `main` / `/ (root)`**.
Qualquer push na `main` atualiza o app.

### 4. Configurar o app no celular

1. Abra a URL do GitHub Pages no celular.
2. Na aba **Ajustes**: cole a URL `/exec` e o token, toque em **Salvar** e depois
   em **Testar conexão**.
3. Adicione o app à tela inicial (menu do navegador → "Adicionar à tela inicial").

## Solução de problemas de conexão

Toque em **Testar conexão** nos Ajustes — o app agora mostra a causa exata. As mais comuns:

- **"respondeu com HTML / tela de login do Google"**: a implantação não está pública.
  Vá em **Implantar → Gerenciar implantações → editar (lápis)** e em **Quem pode acessar**
  escolha **Qualquer pessoa** (não pode ser "Somente eu" nem "Qualquer pessoa com conta Google").
- **"Token inválido"**: o token nos Ajustes não bate com a propriedade `API_TOKEN`
  (Configurações do projeto → Propriedades do script). Acerte um dos dois.
- **"Não encontrei uma das abas"**: a planilha precisa ter as abas com os nomes exatos
  `Questoes`, `Progresso` e `Respostas` (sem acento).
- **"não foi possível alcançar o script / erro de rede"**: confirme que a URL termina em
  `/exec` (é a URL da implantação, não a do editor). O app tenta um modo alternativo (JSONP)
  automaticamente; para ele funcionar, reimplante o `Code.gs` desta versão (que adiciona
  suporte a JSONP) em **Implantar → Gerenciar implantações → Nova versão**.

> Ao editar o `Code.gs`, sempre crie uma **Nova versão** da implantação, senão a URL `/exec`
> continua servindo o código antigo.

## Desenvolvimento

Sem build: edite e dê push. Para rodar localmente (ES modules não funcionam via
`file://`):

```bash
python3 -m http.server 8000
# abra http://localhost:8000
```

Para testar o Apps Script direto (o `-L` é obrigatório — o Apps Script responde
com redirect 302):

```bash
curl -L "https://script.google.com/macros/s/SEU_DEPLOY/exec?action=getAll&token=SEU_TOKEN"

curl -L -X POST "https://script.google.com/macros/s/SEU_DEPLOY/exec" \
  -H "Content-Type: text/plain;charset=utf-8" \
  -d '{"token":"SEU_TOKEN","action":"saveProgress","progress":[{"questionId":"Q001","ef":2.3,"interval":1,"reps":1,"due":"2026-06-13","attempts":1,"correct":1,"lastAnswered":"2026-06-12T14:00:00Z"}],"answers":[{"ts":"2026-06-12T14:00:00Z","questionId":"Q001","chosen":"C","correct":1,"tema":"Rastreamento"}]}'
```

### Estrutura

```
index.html          SPA com 4 telas (Início, Estudo, Estatísticas, Ajustes)
css/style.css       Estilo mobile-first
js/app.js           Orquestração: sessão, sync, navegação
js/api.js           Cliente do Apps Script (getAll / saveProgress)
js/srs.js           Algoritmo SM-2 simplificado (puro, testável no console)
js/state.js         localStorage: cache, fila offline, merge LWW
js/ui.js            Renderização das telas
apps-script/Code.gs Código do backend (deploy manual no editor do Apps Script)
manifest.json       PWA-lite para "adicionar à tela inicial"
```
