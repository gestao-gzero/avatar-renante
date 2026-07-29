✅ (passou),
⚠️ (passou com ressalva — anote o quê) ou ❌ 
  ## 1. Sessão local (console — Camada 1/2)

- [✅] Clicar em conectar avatar → sessão HeyGen conecta, vídeo aparece
- [✅] Saudação do modo atual é falada ao conectar
- [✅] Barge-in: falar por cima do avatar enquanto ele fala → ele para e escuta
- [✅] Filler: pergunta ao vivo → resposta instantânea antes da resposta real
- [⚠️] Legendas ao vivo aparecem na tela conforme a fala é transcrita. (Ainda nao esta perfeito, a transcrição nao sai exatamente oque eu falei)
- [✅] Botão "Nova conversa" reinicia o `sessionId`/contexto (confirmar no log)
- [✅] Botão "Remover avatar" / desconectar encerra a sessão de forma limpa

## 2. STT (reconhecimento de fala)

- [⚠️] Motor Deepgram (padrão): fala é transcrita corretamente (Ainda nao esta perfeito, a transcrição nao sai exatamente oque eu falei)
- [⚠️] Trocar para Web Speech API: idem (Ainda nao esta perfeito, a transcrição nao sai exatamente oque eu falei) achei melhor do que o deepgram
- [✅] Acúmulo de fala: pausas curtas no meio da frase não cortam o envio
- [✅] Mute do microfone dispara o envio ("terminei de falar") em ~200ms

## 3. Hot-swap — console (Camada 1/2)

Reduza temporariamente "Reconectar a cada" (painel Modos) para ~30s só pra
este teste (valor de produção é 270s / 4:30 — não esqueça de voltar depois).

- [✅] Sessão troca sozinha após o intervalo configurado
- [✅] Se o avatar estiver em silêncio no momento: troca sem ninguém notar
- [✅] Se o avatar estiver falando: espera terminar a frase, troca depois
- [✅] Forçar timeout (deixar falando mais que ~20s do limite de espera): corta
      e retoma a frase de onde parou
- [✅] "Fala ao reconectar" (se configurada) é falada na sessão nova
- [✅] Depois da troca, o hot-swap seguinte é reagendado (ver log "HOT-SWAP
      agendado para daqui a Ns")
- [ n entendi] Derrubar a rede momentaneamente durante o pré-aquecimento → sessão atual
      continua, tenta de novo no próximo ciclo (não trava o app)
      > Esclarecimento (ver PROGRESSO-DEMO.md): DevTools (F12) → Network →
      > "Offline" bem no momento em que o log mostrar "HOT-SWAP:
      > pré-aquecendo nova sessão…", espera uns segundos, desmarca. Teste de
      > robustez, não é crítico pra demo — pode pular.

## 4. Hot-swap — dentro do Google Meet (Camada 3) ⚠️ NOVO

Este fluxo não existia até agora (a página `/meet` nunca trocava de sessão
sozinha) — é implementação nova, então merece atenção extra.

- [✅] Abrir `/meet?...` direto no navegador (mesmos parâmetros que o console
      geraria) com `hs=30` na URL (hot-swap a cada 30s, só pra teste)
- [✅] Sessão troca sozinha após o intervalo, igual ao console
- [✅] Vídeo não fica preto/congelado durante a troca
- [✅] Se estiver falando no momento da troca: espera terminar (ou corta e
      retoma, se estourar o limite) — mesmo comportamento do console
- [✅] Depois de 2 ciclos de troca (~1 min com `hs=30`), a página continua
      respondendo a perguntas normalmente
- [✅] Repetir o mesmo teste com o bot de verdade dentro de uma reunião do Meet
      (não só a página solta no navegador) — ver bloco 5

## 5. Google Meet — ponta a ponta

- [✅] Bot entra na reunião com o nome "Renan" na lista de participantes
- [✅] Câmera (avatar) e áudio chegam corretamente pros outros participantes
- [✅] Modo Reunião (wake word): avatar só responde quando chamado pelo nome
- [✅] Modo Conversa: avatar responde tudo, sem precisar do nome
- [✅] Modo Entrevistador: acumula a fala e só responde após o silêncio configurado
- [✅] Botão "Escuta ON/OFF": pausa/retoma a captura sem derrubar o bot
- [ ✅] Botão "Remover avatar": sai do Meet de forma limpa
- [ ✅] Sessão contínua de 10+ minutos (2 ciclos de hot-swap em produção seria
      9 min, mas pra teste use `hs` baixo) sem cair e sem duplicar fala
- [ senti um problema só, ele esta chegando varias respostas do n8n de vez em quando, então ele basicamente ta falando algo, e depois fala outra coisa, como se fosse varias chamadas e varias chegadas e fica feio] Nenhum bug conhecido sobrando ao final deste bloco (esse é o critério de
      "pronto" do item 5 do pedido original)

## 6. Avatar / preview / listas HeyGen

- [✅] Painel "Avatar & Voz" → botão "Carregar avatares e vozes" funciona **sem**
      precisar digitar a API key (usa a do servidor)
- [✅] Se der erro, a mensagem agora mostra o status HTTP real (não mais "lista
      vazia" silenciosa)
- [✅] Selecionar um avatar da lista preenche o preview (`posterUrl`) automaticamente
- [nao achei, mas nao precisa ja esta legal o pôster automatico] Botão "📸 Capturar frame atual como poster" com o avatar conectado: captura
      e persiste (recarregar a página e o poster capturado continua lá)
- [✅] Sem nenhum poster configurado/capturado: aparece o placeholder estático
      (`/avatar-poster.png`) em vez de tela quebrada/preta
- [ gostei de como esta] ⚠️ O PNG atual é um placeholder genérico gerado por mim — trocar por um
      frame real do avatar assim que possível (usar o próprio botão de captura
      resolve isso, é só rodar uma vez com o avatar conectado)

## 7. Layout 16:10 observacao que notei: clicar no botão restaurar padrões, nao vai para o layout padrão somente se eu clicar em layout e clicar em padrão.

- [✅] Redimensionar a janela do navegador para ~1440×900 (ou testar direto no
      MacBook do Renan) — nenhum painel corta conteúdo nem exige scroll horizontal
- [ ✅] Arrastar/redimensionar um painel funciona normalmente
- [ ✅] Fechar e reabrir o navegador: posições persistem (localStorage)
- [ ✅] Botão "↺ Padrão" restaura o layout novo (16:10), não o antigo
- [ ✅] ⚠️ Se o layout não encaixar perfeitamente no MacBook real do Renan: ajustar
      manualmente os painéis do jeito que preferir e rodar `__dumpLayout()` no
      console do navegador — ele imprime os valores prontos pra colar como novo
      padrão (ver `PROGRESSO-DEMO.md` para o passo a passo)

## 8. URL pública / config

- [ ✅] Configurações → "URL pública do avatar" mostra `https://renante.gravidadezero.ai`
      (não mais `mic-speak-pal.vercel.app` nem nada de "mixpeak")
- [ ✅] Em um navegador que JÁ tinha usado o app antes (config antiga salva no
      localStorage): recarregar a página migra automaticamente pra URL nova
      (conferir no painel de Configurações após reload)
- [✅] Bot do Recall.ai (Camada 3) abre a URL nova ao entrar com avatar no Meet —
      **isso só funciona depois do deploy em produção** (ver `PROGRESSO-DEMO.md`)

---

## Caminho da demo (checklist rápido — rodar na manhã de quinta)

Este é o roteiro enxuto pra rodar como último check antes do horário da demo,
~10 min:

1. [ ] Abrir o app em produção (`https://renante.gravidadezero.ai`)
2. [ ] Conectar avatar, confirmar vídeo + áudio
3. [ ] Entrar num Google Meet de teste com o bot
4. [ ] Chamar o avatar pelo nome, confirmar resposta
5. [ ] Deixar rodando por 1 ciclo de hot-swap (270s em produção — ou rode este
       passo mais cedo, não nos 10 min finais)
6. [ ] Conferir que não sobrou nenhum log de erro no console/terminal
7. [ ] Remover avatar do Meet, encerrar sessão

---

## Notas

- Os itens marcados ⚠️ **NOVO** ou com observação são código recém-escrito
  hoje (28/07) — merecem mais atenção que o resto, que já era código validado.
- Se algum item do bloco 4 (hot-swap no Meet) falhar, isso é uma peça nova
  (nunca existiu antes), não uma regressão — me avise que ajusto na hora.
