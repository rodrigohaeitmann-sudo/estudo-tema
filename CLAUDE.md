# TEMa Estudo — Configuração do Projeto

## Identidade Git
```
git config user.name Claude
git config user.email noreply@anthropic.com
```

## Branch de Deploy
O GitHub Pages é servido a partir do branch **`claude/claude-md-docs-q7jvxl`**.  
Sempre comite e faça push nesse branch — **não** em `main`.

## Fluxo obrigatório após cada alteração de código
Após implementar qualquer correção ou melhoria:

1. Configure a identidade git (se ainda não configurado):
   ```
   git config user.name Claude
   git config user.email noreply@anthropic.com
   ```
2. Adicione os arquivos modificados ao staging:
   ```
   git add <arquivos>
   ```
3. Crie o commit:
   ```
   git commit -m "Descrição da alteração"
   ```
4. Faça push para o branch de deploy:
   ```
   git push -u origin claude/claude-md-docs-q7jvxl
   ```
5. Confirme que o deploy do GitHub Pages foi concluído com sucesso verificando os workflow runs.

**Nunca deixe alterações sem commit e push ao final de uma tarefa.**

## Stack
- PWA estática: HTML + CSS + JS vanilla (sem bundler)
- Google Sheets como backend via Apps Script
- SRS (Spaced Repetition System) implementado em `js/srs.js`
- Temas: Âmbar, Ametista, Esmeralda × claro/noturno via CSS custom properties em `css/style.css`
- Fonte: Manrope (Google Fonts)

## Estrutura de arquivos
```
index.html          — Shell HTML, tema inicial, manifesto
css/style.css       — Todos os estilos, tokens de tema
js/
  app.js            — Orquestrador principal, SRS, sync
  ui.js             — Renderização de todas as telas
  api.js            — Comunicação com Google Apps Script
  srs.js            — Algoritmo de repetição espaçada
  state.js          — Estado local (localStorage)
apps-script/Code.gs — Backend Google Apps Script
manifest.json       — Manifesto PWA
```

## URL do app
https://rodrigohaeitmann-sudo.github.io/estudo-tema/
