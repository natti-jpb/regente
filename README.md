# Regente

Orquestrador de terminais com agentes de código para macOS. Rode vários agentes (Claude Code, Codex, Gemini CLI, OpenCode ou shell puro) em terminais reais dentro de um app só — organizados por workspaces e abas, com **status ao vivo de cada agente**: quem está trabalhando, quem finalizou e quem está esperando você.

- 🗂 **Workspaces** com abas de terminal (um workspace por projeto/repo, com pasta padrão)
- 🚦 **Status por agente** — 🔵 trabalhando · 🟢 finalizou, te esperando · 🟠 aguardando input · ⚪ ocioso · 🔴 encerrado
- 🔔 **Notificações macOS** quando um agente termina ou pede input com o app fora de foco (clicar leva direto ao terminal)
- 📊 **Dashboard** com contadores globais e por workspace
- ⌨️ **Atalhos configuráveis** (janela de Ajustes, ⌘3) e comando de inicialização por agente
- 🪝 Para **Claude Code**, status preciso via hooks (opt-in); para os demais, heurística por processos

## Requisitos

- macOS (Apple Silicon ou Intel)
- [Node.js](https://nodejs.org) 18+ e npm
- Xcode Command Line Tools (`xcode-select --install`) — para compilar o `node-pty`

## Como usar (fork/clone)

```bash
git clone https://github.com/natti-jpb/regente.git
cd regente
npm install    # compila o node-pty para o Electron automaticamente
npm start      # roda em modo dev
```

Para instalar como app de verdade (ícone no Dock, abrir pelo Spotlight):

```bash
npm run dist
cp -R dist/mac-arm64/Regente.app /Applications/   # em Intel: dist/mac-x64
```

Como o build é feito na sua própria máquina, o Gatekeeper não bloqueia — só downloads da internet exigem assinatura/notarização.

### Status preciso do Claude Code (opcional, recomendado)

Em **Ajustes → Claude Code → Instalar** (ou `npm run hooks:install`). Isso adiciona hooks `UserPromptSubmit`, `Stop` e `Notification` em `~/.claude/settings.json` (com backup `settings.json.bak-regente`). Os hooks fazem POST para `http://127.0.0.1:$REGENTE_PORT` e **só agem em terminais abertos pelo Regente** — fora dele são no-op instantâneo. Para remover: `node scripts/install-claude-hooks.js --uninstall`.

Sem os hooks o app ainda funciona: o status vem da heurística de processos (menos preciso para "finalizou" em TUIs que ficam abertas).

## Atalhos padrão

Todos reconfiguráveis em Ajustes (clique no atalho e pressione a combinação nova; funciona com o foco dentro do terminal).

| Atalho | Ação |
|---|---|
| ⌘T | Nova aba (terminal) |
| ⌘N | Novo workspace |
| ⌘⌫ | Fechar aba atual |
| ⌘⇧⌫ | Excluir workspace atual |
| ⌘S / ⌘W | Próxima / anterior aba |
| ⌘⇧S / ⌘⇧W | Próximo / anterior workspace |
| ⌘1 | Dashboard |
| ⌘2 | Pular para o terminal que precisa de você |
| ⌘3 | Ajustes |

Nos modais, **Enter confirma/envia** (botão pré-selecionado) e **Esc cancela**.

## Ajustes (⌘3)

- **Atalhos** — remapeie qualquer ação; conflitos são resolvidos automaticamente
- **Terminal** — tamanho da fonte
- **Comando de inicialização por agente** — ex: `claude --permission-mode auto` (padrão)
- **Hooks do Claude Code** — instalar/verificar

## Comportamentos importantes

- **Fechar a janela não mata os agentes** — o app segue no Dock; ⌘Q encerra tudo (inclusive os agentes)
- Ao reabrir o app, as abas voltam como shells parados na pasta certa (o agente não roda sozinho — use ↻)
- Single-instance: abrir de novo só foca a janela existente
- Estado e preferências ficam em `~/.regente/state.json`

## Desenvolvimento

```bash
npm start              # dev
npm run smoke          # teste de PTY + hook server + máquina de status, sem janela
REGENTE_DEBUG=1 npm start   # habilita endpoints locais de debug (screenshot, injetar teclas)
```

Arquitetura: PTYs e máquina de status no processo main (`main/`), renderer vanilla JS + xterm.js sem bundler (`renderer/`), estado em JSON. Os atalhos são interceptados no `before-input-event` (antes do xterm ver a tecla) e espelhados no menu nativo.

## Licença

[MIT](LICENSE)
