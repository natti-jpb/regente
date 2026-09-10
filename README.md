# Regente

Ambiente para orquestrar e visualizar terminais com agentes de código no macOS — um "Maestri melhorado". Os terminais rodam **dentro** do app (PTYs reais), organizados por workspaces, com status ao vivo de cada agente.

## Abrir o app

Instalado como app normal: **Spotlight (⌘Space) → "Regente"**, Launchpad, ou `open -a Regente`. O app é single-instance — abrir de novo só foca a janela existente.

Para desenvolvimento (rodar do código-fonte):

```bash
npm install   # roda electron-rebuild do node-pty automaticamente
npm start
```

Para re-empacotar o `.app` depois de mudar o código:

```bash
npm run dist   # gera dist/mac-arm64/Regente.app
cp -R dist/mac-arm64/Regente.app /Applications/
```

## Ajustes (⚙ na sidebar, ou ⌘,)

- **Atalhos** — todas as ações são reconfiguráveis (clique no atalho e pressione a combinação nova). Padrões: ⌘T nova aba · ⌘N novo workspace · ⌘⌫ fecha aba · ⌘⇧⌫ exclui workspace · ⌘S/⌘W próxima/anterior aba · ⌘⇧S/⌘⇧W próximo/anterior workspace · ⌘1 dashboard · ⌘2 pula pro terminal que precisa de você · ⌘3 ajustes. Nos modais de confirmação, **Enter confirma** (botão pré-selecionado) e Esc cancela.
- **Terminal** — tamanho da fonte.
- **Comando de inicialização por agente** — ex: trocar `claude` por `claude --permission-mode auto`.
- **Hooks do Claude Code** — instalar/verificar.

## Conceitos

- **Workspace** — grupo de abas de terminal com uma pasta padrão (ex: um por repositório/projeto). Na sidebar, cada workspace expande/oculta suas abas.
- **Aba (terminal)** — shell real (`$SHELL -l`) com um preset de agente (Claude Code, Codex, Gemini CLI, OpenCode ou Shell puro). O comando de inicialização é digitado automaticamente ao criar — editável por aba, e dá para salvar como padrão do agente (ex: `claude --permission-mode auto`, fica em `presetCommands` no `~/.regente/state.json`).
- **Dashboard** — contadores globais: terminais abertos, trabalhando e finalizados/aguardando input, com breakdown por workspace.

## Status

| Badge | Significado | Fonte |
|---|---|---|
| 🔵 Trabalhando | agente/processo rodando | heurística (processo filho + output) ou hooks |
| 🟠 Aguardando você | Claude pediu permissão/input | hook `Notification` |
| 🟢 Finalizou — te esperando | agente terminou o turno/tarefa | hook `Stop` ou heurística (processo longo saiu) |
| ⚪ Ocioso | shell parado, nada rodando | heurística |
| 🔴 Encerrado | o shell saiu | PTY exit |

Notificação do macOS dispara quando um terminal entra em "precisa de você" e a janela não está em foco. Clicar na notificação abre direto o terminal.

## Hooks do Claude Code (status preciso)

Clique em **⚙ Hooks Claude** na sidebar (ou `npm run hooks:install`). Isso adiciona hooks `UserPromptSubmit`, `Stop` e `Notification` em `~/.claude/settings.json` (com backup `.bak-regente`). Os hooks fazem POST para `http://127.0.0.1:$REGENTE_PORT` e **só agem em terminais abertos pelo Regente** — fora dele são no-op instantâneo.

Para remover: `node scripts/install-claude-hooks.js --uninstall`.

## Comportamentos importantes

- **Fechar a janela NÃO mata os agentes** — o app continua no dock; clique para reabrir. `Cmd+Q` encerra tudo.
- Ao reabrir o app, os terminais persistidos voltam como shells parados na pasta certa (o agente **não** roda sozinho — use ↻ no card).
- Estado fica em `~/.regente/state.json`.

## Verificação

```bash
npm run smoke   # testa PTY + hook server + máquina de status, sem abrir janela
```
