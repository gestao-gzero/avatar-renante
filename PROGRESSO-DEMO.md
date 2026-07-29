# Progresso — demo do Renan (quarta 29/07 + quinta 30/07)

Última atualização: 28/07, após sua primeira rodada real de testes. Este
arquivo é o registro de tudo que foi feito, o que falta, e o que depende de
você. Resultado dos testes está em `PLANO-DE-TESTES.md`.

**Status geral: você testou a maior parte do roteiro — quase tudo ✅. Achou 2
problemas reais (respostas duplicadas no Meet, botão "Restaurar padrões" não
resetava o layout), os dois já corrigidos e enviados. Hot-swap dentro do
Google Meet — a peça mais arriscada de tudo isso — validado de ponta a ponta
numa sessão de 10+ min com 2 ciclos de troca. Faltam só os itens da seção
"Perguntas" abaixo.**

## ✅ Resultado dos seus testes (28/07)

Quase tudo passou de primeira. Dois achados reais, já corrigidos:

### 🐛 Bug 1 — respostas duplicadas no Meet ("fala algo, depois fala outra coisa")
**Causa**: `meetSilenceSec` (pausa de silêncio antes de mandar a fala pro n8n
dentro do Meet) estava em **0.5s** — mais curto que uma pausa natural no meio
de uma frase falada. Uma pausa pra respirar/pensar já bastava pra disparar o
envio cedo, com a pergunta pela metade; a pessoa continuava falando, e o
resto virava um SEGUNDO envio separado — daí as duas respostas em sequência.
O limite de 1 envio/segundo que já existia não protegia contra isso porque
pausas naturais no meio da fala costumam passar de 1 segundo.

**Correção**: subi o padrão de 0.5s → **1.5s** (`DEFAULT_SETTINGS.meetSilenceSec`
em `src/routes/index.tsx`, mais os 2 fallbacks equivalentes em `meet.tsx`).
Também adicionei uma nota explicando o motivo direto no campo "Pausa antes de
enviar" (painel Modos), pra quem for mexer nesse valor no futuro não recriar
o mesmo problema.
⚠️ **Ainda não testei isso ao vivo** — o valor mudou, mas não repeti seu
teste do Meet pra confirmar que resolveu. Precisa validar de novo.

### 🐛 Bug 2 — "Restaurar padrões" não restaurava o layout
Você notou certo: eram dois resets independentes — "Restaurar padrões" (topo)
só resetava configurações (URLs, IDs, etc.), e só o menu "Layout → Padrão"
resetava as posições dos painéis. Um botão chamado "Restaurar padrões"
deveria fazer as duas coisas. Corrigido: agora "Restaurar padrões" reseta
configurações **e** layout juntos (`resetToDefaults` chama `resetBento`
internamente, `src/routes/index.tsx`).

### Sem ação necessária
- Botão de capturar frame "não achei" — sem problema, você disse que o poster
  automático já está bom assim; não mexi em nada aqui.
- Placeholder PNG genérico — você gostou de como ficou; mantido.
- Legendas/transcrição "não sai exatamente o que eu falei" — isso é precisão
  do motor de STT (Web Speech/Deepgram), não um bug do app; não dá pra
  "corrigir" no código, é característica de cada motor.

---

## BLOCO A — apresentação de quarta (29/07)

### ✅ 1. Logo oficial na tela de login
- Antes: wordmark de texto ("G" rosa + "Zero") solto no fundo escuro do login.
- Agora: usa a arte oficial `GZero - Logo Rosa - 14fev22.jpeg` (a mesma logo já
  usada na topbar do console), dentro de uma pílula branca — o JPEG não tem
  fundo transparente, então sem a pílula ele traria um retângulo branco colado
  no fundo escuro.
- Fallback: se a imagem não carregar por algum motivo, volta pro wordmark de
  texto — o login nunca fica sem marca.
- Onde: [`src/routes/index.tsx:421`](src/routes/index.tsx#L421) (componente
  `LoginLogo`) e uso em `src/routes/index.tsx:3357`.
- **Atualizado (rodada 2)**: `APP_PASSWORD=renante2026` já está no `.env`
  local (a mesma senha que você confirmou estar na Vercel) — a tela de login
  já pode ser testada com `bun dev`.

### ✅ 2. Renomear "Renante" → "Renan" (em tudo, exceto infraestrutura)
- Correção do que eu tinha feito antes: não é mais "Avatar e Renan", é
  **"Renan"** puro e simples, substituindo "Renante" em todo lugar visível —
  título da página/topbar, tela de login, saudações faladas, nome do bot no
  Meet, textos de ajuda/tooltip, e nomes de variáveis internas
  (`renanteP`→`renanP`, `renanteJson`→`renanJson`, etc.).
- A saudação do modo Entrevistador citava o próprio nome como "mistura de
  Renan e Dante" (a origem do nome "Renante") — como o nome agora é só
  "Renan", reescrevi essa fala pra não ficar contraditória (ver
  `src/routes/index.tsx`, `meetConfigs.entrevistador.greeting`).
- **Wake-word**: mantive `renan` **e** `renante` como palavras de ativação
  válidas no modo Reunião (você confirmou: "aceita se chamar renan ou
  renante") — isso já funcionava nos dois arquivos
  (`src/routes/index.tsx` e `src/routes/meet.tsx`, `WAKE_RE`/`END_RE`), não
  precisei mexer. Também ajustei o filtro que ignora a própria fala do bot no
  transcript do Meet (`/renante|renan/i`) pra reconhecer o nome novo.
- **Propositalmente NÃO renomeado** (são identificadores externos, não nomes
  de exibição — mudar quebraria integrações reais):
  - Domínio `https://renante.gravidadezero.ai` (DNS de verdade, é a URL que
    você confirmou usar)
  - Webhooks n8n `webhook/renante-reuniao` e `webhook/renante-entrevistador`
    (rotas registradas no servidor n8n — se quiser renomear essas também,
    precisa mudar dos dois lados: aqui no código E no n8n, senão a integração
    quebra)

---

## BLOCO B — estabilização para quinta (30/07)

### ✅ 3. Plano de testes
- Feito: `PLANO-DE-TESTES.md`, cobrindo os 8 blocos (baseline, sessão local,
  STT, hot-swap console, hot-swap Meet, Meet ponta-a-ponta, avatar/preview,
  layout) + um "caminho da demo" de ~10 min pra rodar na manhã de quinta.
- Ainda não executei nenhum teste — é o próximo passo, item por item, com você.

### ✅ 4. Hot-swap não funciona no Google Meet — causa raiz confirmada e corrigida
- **Diagnóstico**: não era um bug pontual — o hot-swap **nunca existiu** na
  página `/meet` (Camada 3). Ele só estava implementado no console
  (`index.tsx`). A página que roda de verdade dentro do Meet abria **uma**
  sessão HeyGen no boot e nunca a renovava — por isso qualquer chamada no Meet
  caía ao bater no limite de ~5 min do plano HeyGen.
- **Correção**: portei a mecânica completa do hot-swap pra `meet.tsx` —
  pré-aquece uma 2ª sessão, espera o avatar terminar de falar (ou corta com
  segurança se estourar o tempo limite), promove a sessão nova quando o vídeo
  dela está pronto, encerra a antiga, e retoma a frase cortada (se houver) na
  nova sessão. Mesmo algoritmo do console, adaptado à estrutura mais simples
  do `/meet`.
- Onde:
  - Config nova (`hs`=intervalo, `rg`=fala ao reconectar) trafega via query
    string, montada em `buildMeetUrl` (`src/routes/index.tsx`, bloco perto da
    linha 216) e lida em `readConfig()` de
    [`src/routes/meet.tsx`](src/routes/meet.tsx#L59).
  - Lógica de troca: `scheduleHotSwap` / `prewarmAndSwap` /
    `registerSessionEvents` em `src/routes/meet.tsx` (logo após a função
    `tryPlay`).
- **Isolamento pedido**: confirmado por leitura de código, não por teste ao
  vivo ainda — o bloco 4 do `PLANO-DE-TESTES.md` cobre isso (testar `/meet`
  isolado no navegador antes de testar dentro do Meet de verdade).
- ⚠️ **Importante**: essa correção só existe no código local. **Sem fazer
  deploy pra produção, o bot do Recall continua abrindo a versão antiga** — a
  URL pública é o que o Recall renderiza dentro do Meet (ver item 8).

### ✅ 5. Testar Google Meet ponta a ponta
- Ainda não executado — depende do item 4 estar rodando (o hot-swap é
  justamente o que fazia sessões longas no Meet falharem). O roteiro está
  pronto no bloco 5 do `PLANO-DE-TESTES.md`.

### ✅ 6+7. Layout 16:10 travado como o seu, exato
- Você capturou o layout do seu Mac via
  `copy(localStorage.getItem('avatarConsole.freeform.v1'))` e me passou o JSON
  — apliquei os valores **literalmente**, painel por painel, em
  `DEFAULT_RECTS` ([`src/routes/index.tsx:823`](src/routes/index.tsx#L823)).
  Não é mais uma estimativa minha (1440×900) — é o seu layout real.
- Largura máxima usada: **1460px** (painéis `avatar`, `modos` e `recall`
  terminam exatamente aí) — bate com o viewport do seu Mac (~1470px lógicos,
  calculado a partir da resolução do print que você mandou antes).
- Botão "↺ Padrão" e reset de layout agora restauram para este arranjo.
- `__dumpLayout()` (já no código, some mais rápido só depois do deploy) fica
  disponível pra qualquer ajuste futuro, sem precisar repetir o passo manual
  do `localStorage`.
- ⚠️ Ainda não testei visualmente no navegador — próximo passo real é abrir
  `bun dev` e comparar com o print original.

### ✅ 8. Remover URL antiga (mixpeak) da configuração
- A string `mixpeak.com` **não existe em nenhum lugar do código** — não achei
  nenhuma ocorrência no repositório. O que existia era
  `avatarBaseUrl: "https://mic-speak-pal.vercel.app"` — meu palpite é que era
  isso que você tinha em mente (é essa URL que o bot do Recall abre dentro do
  Meet).
- Troquei o default para **`https://renante.gravidadezero.ai`** (confirmado
  por você) em
  [`src/routes/index.tsx:46`](src/routes/index.tsx#L46).
- **Migração automática**: se alguém já usou o app antes e tem a URL antiga
  salva no `localStorage` do navegador, um simples `git pull` + reload **não
  seria suficiente** (config salva vence o default). Adicionei uma migração
  em `loadSettings()` (`src/routes/index.tsx:182`) que detecta hosts antigos
  (`mic-speak-pal.vercel.app`, `mixpeak`, `lovableproject.com`, `lovable.app`)
  e troca pela URL nova automaticamente no próximo load — sem precisar limpar
  o navegador manualmente.
- Também atualizei os textos de placeholder/erro que ainda citavam URLs de
  exemplo antigas (Lovable, `seu-app.vercel.app`) pra usar a URL real.
- Repositório GitHub confirmado como remoto (`origin`):
  `https://github.com/gestao-gzero/avatar-renante` — já era o remote
  configurado neste diretório, nada a fazer aqui.
- ⚠️ **Pendente de você/infra**: nada no código aponta mais pro deploy antigo,
  mas o **deploy em si** (Vercel ou onde `renante.gravidadezero.ai` está
  hospedado) precisa estar rodando esta versão nova antes da demo — sem isso,
  o bot do Recall abre código desatualizado independente do que está aqui.

### ✅ 9. Lista do HeyGen (preview + vozes) sem expor a chave
- Confirmei que a arquitetura seguia já correta: `listAvatars`/`listVoices`
  são server functions que usam `HEYGEN_API_KEY` do servidor
  ([`src/lib/heygen.functions.ts`](src/lib/heygen.functions.ts#L138)) — a
  chave nunca chega no navegador, não existe (nem existiu) prefixo tipo
  `VITE_`/`NEXT_PUBLIC_` em jogo aqui.
- **O bug real** era duplo:
  1. O frontend **bloqueava** a chamada se você não tivesse digitado a API
     key na tela, mesmo o servidor já tendo a chave — corrigido em
     `loadAvatarVoiceLists` (`src/routes/index.tsx`, perto da linha 696): o
     campo da UI agora é só um override opcional.
  2. Um erro HTTP do HeyGen (401/403/429/etc.) virava silenciosamente "lista
     vazia" — agora `listAvatars`/`listVoices` lançam erro com o status e
     corpo da resposta reais
     ([`src/lib/heygen.functions.ts:170-181`](src/lib/heygen.functions.ts#L170),
     `:197-201`), e a mensagem de erro na tela ficou mais específica.
- **Não precisei** colocar a chave no frontend como último recurso — a
  arquitetura server-side já resolve isso; se depois do teste real a lista
  ainda vier vazia, o próximo passo é confirmar se a `HEYGEN_API_KEY` tem
  permissão pra esses dois endpoints específicos (não é garantido).
- ⚠️ Ainda não testei contra a API de verdade (preciso rodar `bun dev` e
  clicar em "Carregar avatares e vozes").

### ✅ 10. Preview do avatar (PNG estático de fallback)
- Criei `public/avatar-poster.png` — um fundo escuro neutro (sem texto/ícone),
  gerado programaticamente (não é uma captura real do avatar).
- **Correção (rodada 3)**: a 1ª versão do placeholder tinha texto embutido
  ("Avatar e Renan · aguardando conexão"), que passou a **duplicar** com o
  overlay ao vivo ("AVATAR DESCONECTADO") depois que corrigi o bug abaixo —
  as duas camadas de texto ficavam sobrepostas (foi o que você viu no seu
  print). Troquei pelo fundo neutro atual; quem mostra status agora é só o
  overlay ao vivo, sem duplicar mensagem.
- Ordem de resolução do preview (vídeo antes de conectar):
  1. `posterUrl` configurado (preenchido automaticamente, ver "carregamento
     automático" abaixo, ou ao reselecionar um avatar manualmente na lista)
  2. Frame capturado manualmente (novo botão, ver abaixo)
  3. `/avatar-poster.png` (o placeholder acima) — nunca fica com tela quebrada
- **Carregamento automático (rodada 4)**: antes, a lista da API só carregava
  se alguém clicasse em "Carregar avatares e vozes" nas Configurações — e
  mesmo carregando, a foto do avatar já configurado (ex.: "Renan") só entrava
  no preview se a pessoa reselecionasse ele manualmente no dropdown (o
  `onChange` é o único lugar que preenchia `posterUrl`). Agora:
  1. A lista carrega **sozinha assim que o app abre** (depois do login
     resolver, se estiver ligado) — não precisa mais abrir Configurações.
  2. Ao carregar, se o avatar já configurado (`settings.avatarId`) for
     encontrado na lista E não houver `posterUrl` configurado ainda, o preview
     é preenchido automaticamente com a foto real da API.
  3. Só preenche se `posterUrl` estiver vazio — não sobrescreve uma URL
     manual nem um frame já capturado.
  (`loadAvatarVoiceLists` e o novo efeito logo abaixo dela, em
  `src/routes/index.tsx`.)
- **Novo**: botão "📸 Capturar frame atual como poster" no painel Avatar & Voz
  ([`src/routes/index.tsx:4300`](src/routes/index.tsx#L4300)) — com o avatar
  conectado, captura o frame atual do vídeo (canvas → PNG) e salva no
  navegador. É a forma mais rápida de trocar o placeholder genérico por um
  frame real: conecta o avatar uma vez, clica no botão, pronto.
- Guardado separado do resto da configuração (chave própria no
  `localStorage`) de propósito — um frame em base64 pode passar de 100KB e
  não deveria arriscar estourar a cota e derrubar toda a config salva junto.
- **Bug real encontrado e corrigido (rodada 2)**: o poster nunca aparecia na
  prática, mesmo configurado. O `<video>` tinha `display: none` sempre que
  `!connected`, e por cima entrava uma tela genérica (ícone 🎭 + "avatar
  desconectado") que cobria o box inteiro — é exatamente o que aparece no seu
  print. Ou seja, o preview existia no código mas ficava escondido atrás desse
  bloco opaco.
  - **Correção**: o `<video>` agora fica sempre visível (mostra o poster
    nativamente, é pra isso que o atributo `poster` do HTML serve). O texto de
    status ("conectando…"/"avatar desconectado") virou um overlay semi-
    transparente por cima da imagem, em vez de escondê-la.
    (`src/routes/index.tsx`, box `.avbox`; `src/styles.css`, classe `.scrn`.)

**Passo a passo pra configurar a imagem antes de conectar** (depois desta
correção):
1. Mais simples: conecte o avatar uma vez (com áudio/vídeo normais), e no
   painel **Avatar & Voz** clique em **"📸 Capturar frame atual como poster"**.
   Isso já vira o preview permanente daquele navegador — não precisa repetir.
2. Alternativa manual: no mesmo painel, cole uma URL de imagem no campo
   **"Poster do avatar"** (ex.: a `previewUrl` que a lista da API HeyGen já
   preenche sozinha ao escolher um avatar).
3. Sem fazer nada: aparece `/avatar-poster.png` (o placeholder que gerei) —
   nunca fica em branco/quebrado.
- A ordem de prioridade é: **URL manual → frame capturado → placeholder
  estático**. Ainda não testei visualmente esse fluxo no navegador (fica pro
  bloco 6 do `PLANO-DE-TESTES.md`).

---

## Arquivos alterados

| Arquivo | O que mudou |
|---|---|
| `src/routes/index.tsx` | Logo do login, rename Renante→Renan, URL + migração, listas HeyGen sem bloqueio, captura de poster + fix do preview antes de conectar, `__dumpLayout()`, `DEFAULT_RECTS` = layout exato do seu Mac, `hs`/`rg` na URL do Meet |
| `src/routes/meet.tsx` | Hot-swap completo (novo), rename Renante→Renan, leitura de `hs`/`rg` da query string |
| `src/styles.css` | Overlay do preview (`.scrn`) virou semi-transparente em vez de opaco |
| `src/lib/heygen.functions.ts` | Erros HTTP reais em `listAvatars`/`listVoices` (em vez de lista vazia silenciosa) |
| `src/lib/recall.functions.ts` | Nome padrão do bot: "Renan" |
| `.env` | `APP_PASSWORD=renante2026` adicionada (local — não vai pro Git) |
| `public/avatar-poster.png` | **Novo** — placeholder estático do preview |
| `PLANO-DE-TESTES.md` | **Novo** — roteiro de validação |
| `PROGRESSO-DEMO.md` | **Novo** — este arquivo |

Validado até agora: `tsc --noEmit` limpo, `vite build` (client + SSR) completo
sem erros. **Commitado e enviado ao GitHub** — commit `ec9b47c` na branch
`main` de `github.com/gestao-gzero/avatar-renante`, sem divergência do
`origin/main` (conferido com `git fetch` antes de enviar). Deploy automático
deve estar rodando agora. **Nenhum teste funcional/manual foi rodado ainda.**

---

## O que falta (em ordem)

1. **Retestar o Bloco 5 no Meet** com o novo `meetSilenceSec=1.5s` — confirmar
   que as respostas duplicadas pararam (era o único bug real do bloco).
2. **Reconferir "Restaurar padrões"** — clicar e ver se agora reseta layout
   junto com as configurações.
3. Seguir batendo o resto do roteiro que ainda não foi marcado (Bloco 0,
   partes do Bloco 3 que ficaram sem resposta clara).

---

## Resolvido nesta rodada

- **Motor de STT padrão → Web Speech**: trocado (`DEFAULT_SETTINGS.sttEngine`,
  `src/routes/index.tsx`). ⚠️ **Só vale pra navegador NOVO** (sem config salva
  ainda) — no seu navegador atual, que já testou e já tem `deepgram` salvo no
  `localStorage`, o valor salvo continua vencendo o novo default (mesma regra
  de sempre: config salva > default). Pra pegar o Web Speech no seu Mac agora,
  clique no botão **"Web Speech"** no painel STT (um clique, já existe na
  tela) — não precisa esperar deploy nem mexer em nada técnico.
- **Poster do avatar**: confirmado, mantido como está. Sem ação.

---

## Perguntas / decisões que precisam de você

1. **Teste de "derrubar a rede" (Bloco 3)** — você marcou "não entendi". O que
   esse item verifica: se a internet cair por alguns segundos bem no momento
   em que o hot-swap está preparando a sessão nova (não a atual, que continua
   no ar), ele não deveria travar o app — só desiste dessa tentativa e tenta
   de novo no próximo ciclo automático. Pra testar de propósito: abra o
   DevTools (F12) → aba Network → marque "Offline" bem no momento em que o
   log mostrar "HOT-SWAP: pré-aquecendo nova sessão…", espere uns segundos e
   desmarque. É um teste de robustez, não é crítico pra demo — pode pular se
   preferir.
