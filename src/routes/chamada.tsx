import { createFileRoute, Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useCallback, useEffect, useRef, useState } from "react";
import { AgentEventsEnum, LiveAvatarSession, SessionEvent } from "@heygen/liveavatar-web-sdk";
import { getSessionToken, getDeepgramToken } from "@/lib/heygen.functions";
import { checkAuth, isAuthEnabled } from "@/lib/auth.functions";
import {
  AUTH_KEY,
  AVATAR_POSTER_FALLBACK,
  HOT_SWAP_MAX_DEFER_MS,
  HOT_SWAP_MIN_SEC,
  MUTE_FLUSH_MS,
  POSTER_KEY,
  SEND_MIN_GAP_MS,
  SPEAK_TIMEOUT_MS,
  SPEECH_FLUSH_SEC_DEFAULT,
  readConsoleMode,
  readConsoleSettings,
  webhookForMode,
  type CallSettings,
  type Mode,
} from "@/lib/avatar/settings";
import { readWakeSignals, residualHasQuestion } from "@/lib/avatar/wake-word";

export const Route = createFileRoute("/chamada")({
  head: () => ({
    meta: [
      { title: "Chamada" },
      { name: "description", content: "Chamada de vídeo com o avatar." },
    ],
  }),
  component: Chamada,
});

// Esta tela é a CAMADA DE APRESENTAÇÃO: alguém da equipe abre num telão, durante um
// evento, e o público vê o que parece ser uma chamada de vídeo comum. Por isso ela
// não tem log, status, caixa de texto nem qualquer configuração — tudo isso mora no
// console (`/`), que é onde se configura. Aqui só se LÊ a configuração salva.
//
// O motor (sessão HeyGen, hot-swap, STT, n8n) é uma cópia do console, deliberadamente:
// as duas telas divergem em comportamento (aqui não há Recall.ai, nem troca de modo em
// tempo real, nem modo de teste de microfone) e manter uma cópia própria evita que
// mexer numa quebre a outra. O que é volátil e comum de verdade — a wake-word e as
// configurações — vive em `src/lib/avatar/` e é compartilhado.

type Phase = "boot" | "login" | "unconfigured" | "prejoin" | "connecting" | "live";

/** Fase visual do turno — só o que a UI precisa para parecer uma chamada. */
type TurnState = "idle" | "listening" | "speaking";

export default function Chamada() {
  const fetchToken = useServerFn(getSessionToken);
  const callDeepgramToken = useServerFn(getDeepgramToken);
  const callCheckAuth = useServerFn(checkAuth);
  const callIsAuthEnabled = useServerFn(isAuthEnabled);

  // ===== estado de tela =====
  const [phase, setPhase] = useState<Phase>("boot");
  const [turn, setTurn] = useState<TurnState>("idle");
  const [muted, setMuted] = useState(true);
  const [camOn, setCamOn] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  // Só aparece quando a conexão cai de verdade — o hot-swap normal é invisível.
  const [reconnecting, setReconnecting] = useState(false);
  const [fatalError, setFatalError] = useState<string | null>(null);
  const [poster, setPoster] = useState<string>("");

  // ===== vídeo: dois slots para o crossfade do hot-swap =====
  // O console troca o srcObject do MESMO <video>, o que pisca/enegrece por um instante.
  // Aqui a sessão nova é anexada ao slot ocioso e só então fazemos o fade — o público
  // nunca vê a troca, que é o ponto inteiro desta tela.
  const videoARef = useRef<HTMLVideoElement>(null);
  const videoBRef = useRef<HTMLVideoElement>(null);
  const [activeSlot, setActiveSlot] = useState<"a" | "b">("a");
  const activeSlotRef = useRef<"a" | "b">("a");
  const camVideoRef = useRef<HTMLVideoElement>(null);
  const camStreamRef = useRef<MediaStream | null>(null);

  // ===== sessão =====
  const authTokenRef = useRef<string>("");
  const sessionRef = useRef<LiveAvatarSession | null>(null);
  // null = o console nunca salvou configuração neste navegador. A tela não inventa
  // valores próprios; nesse caso ela nem abre (fase "unconfigured").
  const settingsRef = useRef<CallSettings | null>(null);
  const modeRef = useRef<Mode>("conversa");
  const isAvatarSpeakingRef = useRef(false);
  const meetingActiveRef = useRef(false);
  const currentUtteranceRef = useRef<{ text: string; startedAt: number } | null>(null);
  const swapInProgressRef = useRef(false);
  const hotSwapTimerRef = useRef<number | null>(null);
  const prewarmSwapRef = useRef<() => void>(() => {});
  const endedByUserRef = useRef(false);

  // ===== STT =====
  const recognitionRef = useRef<any>(null);
  const isRecognitionRunningRef = useRef(false);
  const shouldListenRef = useRef(false);
  const isMutedRef = useRef(true);
  const bargeInRef = useRef(false);
  const speechBufferRef = useRef("");
  const speechTimerRef = useRef<number | null>(null);
  const handleVoiceUtteranceRef = useRef<((text: string) => Promise<void>) | null>(null);
  const dgWsRef = useRef<WebSocket | null>(null);
  const dgCtxRef = useRef<AudioContext | null>(null);
  const dgProcRef = useRef<ScriptProcessorNode | null>(null);
  const dgSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const dgStreamRef = useRef<MediaStream | null>(null);
  const dgKeepAliveRef = useRef<number | null>(null);
  const dgStartRef = useRef<(reason: string) => void>(() => {});

  // ===== n8n =====
  const fillerHistoryRef = useRef<string[]>([]);
  const lastSendRef = useRef<{ text: string; timestamp: number }>({ text: "", timestamp: 0 });

  // Sem painel de log na tela: o diagnóstico vai só pro console do navegador, que
  // continua disponível pra quem estiver operando (F12) sem aparecer no telão.
  const log = useCallback((msg: string, kind: "info" | "ok" | "err" = "info") => {
    const line = `${new Date().toISOString()} [chamada] ${msg}`;
    if (kind === "err") console.error(line);
    else if (kind === "ok") console.info(line);
    else console.log(line);
  }, []);

  const logError = useCallback(
    (label: string, error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error);
      log(`${label}: ${msg}`, "err");
      return msg;
    },
    [log],
  );

  // ===== boot: autenticação + configuração salva =====
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Config e modo vêm do console, via localStorage (mesma origem). Se não houver
      // nada salvo, a tela para aqui em vez de assumir valores próprios.
      const s = readConsoleSettings();
      const m = readConsoleMode();
      settingsRef.current = s;
      modeRef.current = m;
      if (!s) {
        setPhase("unconfigured");
        return;
      }
      bargeInRef.current = s.meetConfigs[m].bargeIn;
      try {
        const captured = window.localStorage.getItem(POSTER_KEY) || "";
        setPoster(s.posterUrl || captured || AVATAR_POSTER_FALLBACK);
      } catch {
        setPoster(s.posterUrl || AVATAR_POSTER_FALLBACK);
      }

      try {
        const { enabled } = await callIsAuthEnabled();
        if (cancelled) return;
        if (!enabled) {
          authTokenRef.current = "";
          setPhase("prejoin");
          return;
        }
        const stored = window.localStorage.getItem(AUTH_KEY) || "";
        if (!stored) {
          setPhase("login");
          return;
        }
        const { ok } = await callCheckAuth({ data: { token: stored } });
        if (cancelled) return;
        if (ok) {
          authTokenRef.current = stored;
          setPhase("prejoin");
        } else {
          window.localStorage.removeItem(AUTH_KEY);
          setPhase("login");
        }
      } catch {
        if (!cancelled) setPhase("login");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [callIsAuthEnabled, callCheckAuth]);

  // ===== helpers de vídeo =====
  const slotEl = useCallback(
    (slot: "a" | "b") => (slot === "a" ? videoARef.current : videoBRef.current),
    [],
  );

  const playSlot = useCallback(
    async (slot: "a" | "b") => {
      const v = slotEl(slot);
      if (!v) return;
      try {
        v.autoplay = true;
        v.playsInline = true;
        v.muted = false;
        await v.play();
      } catch (e) {
        // Só acontece se o navegador bloquear o autoplay. Como só chegamos aqui
        // depois do clique em "Entrar", na prática não deve ocorrer.
        logError("video.play() bloqueado", e);
      }
    },
    [slotEl, logError],
  );

  // ===== eventos do SDK =====
  // `slot` diz em qual <video> esta sessão deve se anexar quando o stream ficar pronto.
  const registerSdkEvents = useCallback(
    (session: LiveAvatarSession, slot: "a" | "b") => {
      session.on(SessionEvent.SESSION_STATE_CHANGED, (state: any) => {
        if (session !== sessionRef.current) return; // sessão antiga durante o swap
        if (state === "CONNECTED") setReconnecting(false);
      });
      session.on(SessionEvent.SESSION_STREAM_READY, () => {
        try {
          const el = slotEl(slot);
          if (el) session.attach(el);
        } catch (e) {
          logError("attach do vídeo falhou", e);
        }
        void playSlot(slot);
      });
      session.on(SessionEvent.SESSION_DISCONNECTED, () => {
        if (session !== sessionRef.current) return; // descarte do hot-swap
        // Queda real (não é o hot-swap, que promove antes de encerrar a antiga).
        if (!swapInProgressRef.current && !endedByUserRef.current) setReconnecting(true);
      });
      session.on(AgentEventsEnum.AVATAR_SPEAK_STARTED, () => {
        isAvatarSpeakingRef.current = true;
        setTurn("speaking");
      });
      session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, () => {
        isAvatarSpeakingRef.current = false;
        if (session === sessionRef.current) currentUtteranceRef.current = null;
        setTurn(shouldListenRef.current && !isMutedRef.current ? "listening" : "idle");
      });
    },
    [slotEl, playSlot, logError],
  );

  // ===== fala =====
  const waitForAvatarEnd = useCallback((timeoutMs = SPEAK_TIMEOUT_MS) => {
    return new Promise<void>((resolve, reject) => {
      const session = sessionRef.current;
      if (!session || !isAvatarSpeakingRef.current) {
        resolve();
        return;
      }
      const timer = window.setTimeout(() => {
        session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, onEnd);
        reject(new Error(`Timeout aguardando avatar.speak_ended após ${timeoutMs}ms`));
      }, timeoutMs);
      const onEnd = () => {
        window.clearTimeout(timer);
        session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, onEnd);
        resolve();
      };
      session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, onEnd);
    });
  }, []);

  const speakAndWait = useCallback(
    async (txt: string) => {
      const session = sessionRef.current;
      if (!session) throw new Error("Sem sessão para falar");
      const clean = txt.trim();
      if (!clean) return;
      if (isAvatarSpeakingRef.current) await waitForAvatarEnd();
      const ended = new Promise<void>((resolve, reject) => {
        const timer = window.setTimeout(() => {
          session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, onEnd);
          reject(new Error(`Timeout aguardando avatar.speak_ended após ${SPEAK_TIMEOUT_MS}ms`));
        }, SPEAK_TIMEOUT_MS);
        const onEnd = () => {
          window.clearTimeout(timer);
          session.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, onEnd);
          resolve();
        };
        session.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, onEnd);
      });
      currentUtteranceRef.current = { text: clean, startedAt: Date.now() };
      session.repeat(clean);
      await ended;
      currentUtteranceRef.current = null;
    },
    [waitForAvatarEnd],
  );

  // ===== IA classificadora (Reunião) =====
  // Só roda quando o regex JÁ achou o nome, pra não virar uma chamada de LLM por frase
  // da plateia. FAIL-OPEN: se cair ou demorar, assume que foi chamado.
  const classificarChamada = useCallback(
    async (texto: string): Promise<boolean> => {
      const wr = settingsRef.current?.webhookReuniao;
      if (!wr) return true;
      const url = wr.replace(/\/[^/]*$/, "/naner-classificar");
      const ctrl = new AbortController();
      const timer = window.setTimeout(() => ctrl.abort(), 2500);
      try {
        const r = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question: texto }),
          signal: ctrl.signal,
        });
        const j: any = await r.json();
        const decisao = (j?.decisao ?? "").toString().toUpperCase();
        return decisao !== "IGNORAR";
      } catch (e) {
        logError("classificadora falhou — assumindo que É chamado", e);
        return true;
      } finally {
        window.clearTimeout(timer);
      }
    },
    [logError],
  );

  // ===== envio ao n8n =====
  const handleSend = useCallback(
    async (rawText: string, opts?: { responder?: boolean }) => {
      const question = rawText.trim();
      if (!question) return;

      // Rate limit: no máx 1 envio/seg (= ~2 chamadas/seg ao n8n contando o filler).
      // Barra duplicata/eco do STT sem comparar texto.
      const nowMs = Date.now();
      const sinceLast = nowMs - lastSendRef.current.timestamp;
      if (sinceLast < SEND_MIN_GAP_MS) {
        log(`[THROTTLED] envio ignorado (${sinceLast}ms desde o último): "${question}"`);
        return;
      }
      lastSendRef.current = { text: question, timestamp: nowMs };

      const s = settingsRef.current;
      if (!sessionRef.current || !s) return;

      const currentMode = modeRef.current;
      const nanerUrl = webhookForMode(s, currentMode);

      const responder = currentMode === "reuniao" ? (opts?.responder ?? true) : undefined;
      const willSpeak =
        currentMode === "conversa" ||
        currentMode === "entrevistador" ||
        (currentMode === "reuniao" && responder === true);
      const useFiller = willSpeak && currentMode !== "entrevistador";

      const sessionId = currentMode;
      const body: Record<string, unknown> = { question, sessionId };
      if (responder !== undefined) body.responder = responder;

      const nanerP = fetch(nanerUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      })
        .then(async (response) => {
          const txt = await response.text();
          if (!response.ok) throw new Error(`Naner HTTP ${response.status}: ${txt}`);
          try {
            return JSON.parse(txt);
          } catch {
            return { output: txt };
          }
        })
        .catch((error) => {
          logError("erro Naner", error);
          return { output: "" };
        });

      const fillerHistorico = [...fillerHistoryRef.current];
      const fillerP = useFiller
        ? fetch(s.webhookFiller, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ question, sessionId, historico_filler: fillerHistorico }),
          })
            .then(async (response) => {
              const txt = await response.text();
              if (!response.ok) throw new Error(`Filler HTTP ${response.status}: ${txt}`);
              try {
                return JSON.parse(txt);
              } catch {
                return { filler: txt };
              }
            })
            .catch((error) => {
              logError("erro filler", error);
              return { filler: "" };
            })
        : Promise.resolve({ filler: "" });

      // Reunião dormindo: só grava contexto, não fala nada.
      if (!willSpeak) {
        await nanerP;
        return;
      }

      // Filler fala assim que chegar, cobrindo o tempo do agente. É ele que evita o
      // silêncio parado que, numa tela sem log, o público lê como "travou".
      let fillerSpeakP: Promise<void> | null = null;
      if (useFiller) {
        fillerSpeakP = fillerP.then(async (fillerJson: any) => {
          const fillerText = (fillerJson?.filler ?? "").toString().trim();
          if (!fillerText) return;
          fillerHistoryRef.current = [...fillerHistoryRef.current, fillerText].slice(-3);
          try {
            await speakAndWait(fillerText);
          } catch (error) {
            logError("erro no filler", error);
          }
        });
      }

      const nanerJson: any = await nanerP;
      const nanerText = (nanerJson?.output ?? nanerJson?.text ?? nanerJson?.message ?? "")
        .toString()
        .trim();
      if (!nanerText) {
        if (fillerSpeakP) await fillerSpeakP.catch(() => {});
        return;
      }
      if (fillerSpeakP) await fillerSpeakP.catch(() => {});
      try {
        await speakAndWait(nanerText);
      } catch (error) {
        logError("erro ao falar a resposta", error);
      }
    },
    [log, logError, speakAndWait],
  );

  // ===== roteamento da fala reconhecida (wake-word da Reunião) =====
  const handleVoiceUtterance = useCallback(
    async (utter: string) => {
      const t = utter.trim();
      if (!t) return;
      const currentMode = modeRef.current;
      const modeCfg = settingsRef.current?.meetConfigs[currentMode];
      const useWake = modeCfg?.behavior === "wake";

      if (!useWake) {
        await handleSend(t);
        return;
      }

      const isActive = meetingActiveRef.current;
      const { hasWake, hasEnd, residual } = readWakeSignals(t, { isActive });

      // ATIVO + comando de desligar → dorme, com despedida fixa (sem n8n).
      if (isActive && hasEnd) {
        meetingActiveRef.current = false;
        try {
          await speakAndWait("Beleza, tô saindo. É só me chamar.");
        } catch (e) {
          logError("despedida", e);
        }
        return;
      }

      // DORMINDO + nome → a IA confirma se foi chamado ou só menção.
      if (!isActive && hasWake && !hasEnd) {
        const querFalar = await classificarChamada(t);
        if (!querFalar) {
          await handleSend(t, { responder: false }); // grava contexto, não fala
          return;
        }
        meetingActiveRef.current = true;
        if (residualHasQuestion(residual)) {
          await handleSend(t, { responder: true });
        } else {
          try {
            await speakAndWait("Oi, tô aqui!");
          } catch (e) {
            logError("saudação de wake", e);
          }
        }
        return;
      }

      // ATIVO + fala normal → responde. DORMINDO + fala normal → só contexto.
      await handleSend(t, { responder: isActive });
    },
    [handleSend, speakAndWait, logError, classificarChamada],
  );

  useEffect(() => {
    handleVoiceUtteranceRef.current = handleVoiceUtterance;
  }, [handleVoiceUtterance]);

  // ===== acúmulo de fala: só envia depois de um silêncio real =====
  const flushSpeech = useCallback(() => {
    if (speechTimerRef.current !== null) {
      window.clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    const buffered = speechBufferRef.current.trim();
    speechBufferRef.current = "";
    if (buffered) void handleVoiceUtteranceRef.current?.(buffered);
  }, []);

  const scheduleSpeechFlush = useCallback(() => {
    if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
    const ms = isMutedRef.current ? MUTE_FLUSH_MS : SPEECH_FLUSH_SEC_DEFAULT * 1000;
    speechTimerRef.current = window.setTimeout(flushSpeech, ms);
  }, [flushSpeech]);

  const routeInterim = useCallback(
    (partial: string) => {
      if (!partial) return;
      if (isAvatarSpeakingRef.current && !bargeInRef.current) return;
      scheduleSpeechFlush();
    },
    [scheduleSpeechFlush],
  );

  const routeFinal = useCallback(
    (done: string) => {
      if (!done) return;
      if (isAvatarSpeakingRef.current && !bargeInRef.current) return;
      if (isAvatarSpeakingRef.current && bargeInRef.current) {
        try {
          (sessionRef.current as any)?.interrupt?.();
        } catch (e) {
          logError("interrupt() falhou no barge-in", e);
        }
      }
      speechBufferRef.current = `${speechBufferRef.current} ${done}`.trim();
      scheduleSpeechFlush();
    },
    [scheduleSpeechFlush, logError],
  );

  // ===== Web Speech =====
  const maybeStartListening = useCallback(() => {
    if (settingsRef.current?.sttEngine === "deepgram") return;
    if (
      shouldListenRef.current &&
      !isMutedRef.current &&
      recognitionRef.current &&
      !isRecognitionRunningRef.current
    ) {
      try {
        recognitionRef.current.start();
      } catch {
        // Corrida start()/onstart — o reconhecimento já estava rodando. Ignora.
      }
    }
  }, []);

  useEffect(() => {
    const SR = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.lang = "pt-BR";
    rec.interimResults = true;
    rec.continuous = true;
    rec.maxAlternatives = 1;

    rec.onstart = () => {
      isRecognitionRunningRef.current = true;
    };
    rec.onresult = (event: any) => {
      try {
        let interim = "";
        const finals: string[] = [];
        for (let i = event.resultIndex; i < event.results.length; i++) {
          const transcript = (event.results[i]?.[0]?.transcript ?? "").trim();
          if (!transcript) continue;
          if (event.results[i].isFinal) finals.push(transcript);
          else interim += transcript + " ";
        }
        const partial = interim.trim();
        if (partial) routeInterim(partial);
        for (const done of finals) routeFinal(done);
      } catch (error) {
        logError("erro no onresult", error);
      }
    };
    rec.onerror = (event: any) => {
      const err = event?.error ?? "desconhecido";
      if (err === "not-allowed" || err === "service-not-allowed") {
        isMutedRef.current = true;
        shouldListenRef.current = false;
        setMuted(true);
      }
    };
    rec.onend = () => {
      isRecognitionRunningRef.current = false;
      maybeStartListening(); // a Web Speech para sozinha às vezes
    };

    recognitionRef.current = rec;
    return () => {
      try {
        rec.stop();
      } catch {}
      recognitionRef.current = null;
    };
  }, [routeInterim, routeFinal, maybeStartListening, logError]);

  // ===== Deepgram =====
  const stopDeepgram = useCallback((opts?: { graceful?: boolean }) => {
    if (dgKeepAliveRef.current !== null) {
      window.clearInterval(dgKeepAliveRef.current);
      dgKeepAliveRef.current = null;
    }
    try {
      dgProcRef.current?.disconnect();
    } catch {}
    try {
      dgSourceRef.current?.disconnect();
    } catch {}
    try {
      dgStreamRef.current?.getTracks().forEach((t) => t.stop());
    } catch {}
    try {
      void dgCtxRef.current?.close();
    } catch {}
    dgProcRef.current = null;
    dgSourceRef.current = null;
    dgStreamRef.current = null;
    dgCtxRef.current = null;

    const ws = dgWsRef.current;
    dgWsRef.current = null;
    if (!ws) return;
    if (opts?.graceful && ws.readyState === WebSocket.OPEN) {
      // Deixa o WS aberto por um instante pra receber a transcrição FINAL da última
      // fala — senão, ao mutar logo depois de falar, a frase se perde.
      try {
        ws.send(JSON.stringify({ type: "CloseStream" }));
      } catch {}
      window.setTimeout(() => {
        try {
          ws.close();
        } catch {}
      }, 600);
      return;
    }
    try {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "CloseStream" }));
    } catch {}
    try {
      ws.close();
    } catch {}
  }, []);

  const startDeepgram = useCallback(
    async (reason: string) => {
      const key = (settingsRef.current?.deepgramApiKey || "").trim();
      shouldListenRef.current = true;
      isMutedRef.current = false;
      setMuted(false);
      stopDeepgram();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        dgStreamRef.current = stream;

        const { token } = await callDeepgramToken({
          data: { apiKey: key, authToken: authTokenRef.current },
        });

        const AudioCtx = (window as any).AudioContext || (window as any).webkitAudioContext;
        const ctx: AudioContext = new AudioCtx();
        dgCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        dgSourceRef.current = source;
        const proc = ctx.createScriptProcessor(4096, 1, 1);
        dgProcRef.current = proc;

        const params = new URLSearchParams({
          model: "nova-2",
          language: "pt-BR",
          encoding: "linear16",
          sample_rate: String(Math.round(ctx.sampleRate)),
          channels: "1",
          interim_results: "true",
          smart_format: "true",
          punctuate: "true",
          endpointing: "300",
        });
        const ws = new WebSocket(`wss://api.deepgram.com/v1/listen?${params.toString()}`, [
          "token",
          token,
        ]);
        ws.binaryType = "arraybuffer";
        dgWsRef.current = ws;

        // Buffer do áudio capturado antes do WS abrir, pra não comer as primeiras palavras.
        const preOpenChunks: ArrayBuffer[] = [];
        const MAX_PREOPEN = 120;

        ws.onopen = () => {
          setTurn((t) => (t === "speaking" ? t : "listening"));
          log(`Deepgram conectado (${reason})`, "ok");
          for (const buf of preOpenChunks) {
            try {
              ws.send(buf);
            } catch {}
          }
          preOpenChunks.length = 0;
          dgKeepAliveRef.current = window.setInterval(() => {
            try {
              if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify({ type: "KeepAlive" }));
            } catch {}
          }, 8000);
        };
        ws.onmessage = (ev) => {
          try {
            if (typeof ev.data !== "string") return;
            const msg = JSON.parse(ev.data);
            if (msg?.type !== "Results") return;
            const txt = (msg.channel?.alternatives?.[0]?.transcript ?? "").trim();
            if (!txt) return;
            if (msg.is_final) routeFinal(txt);
            else routeInterim(txt);
          } catch {}
        };
        ws.onerror = (e) => logError("Deepgram WS erro", e);
        ws.onclose = () => {
          if (dgKeepAliveRef.current !== null) {
            window.clearInterval(dgKeepAliveRef.current);
            dgKeepAliveRef.current = null;
          }
          // Reconecta se o mic ainda deveria estar ligado (queda de rede etc.).
          if (shouldListenRef.current && !isMutedRef.current) {
            window.setTimeout(() => {
              if (shouldListenRef.current && !isMutedRef.current) dgStartRef.current("reconexão");
            }, 1000);
          }
        };

        proc.onaudioprocess = (e) => {
          const input = e.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const x = Math.max(-1, Math.min(1, input[i]));
            pcm[i] = x < 0 ? x * 0x8000 : x * 0x7fff;
          }
          const ws2 = dgWsRef.current;
          if (!ws2) return;
          if (ws2.readyState === WebSocket.CONNECTING) {
            if (preOpenChunks.length < MAX_PREOPEN) preOpenChunks.push(pcm.buffer);
            return;
          }
          if (ws2.readyState !== WebSocket.OPEN) return;
          try {
            ws2.send(pcm.buffer);
          } catch {}
        };
        source.connect(proc);
        proc.connect(ctx.destination);
      } catch (e) {
        logError("startDeepgram falhou", e);
        stopDeepgram();
      }
    },
    [callDeepgramToken, log, logError, routeFinal, routeInterim, stopDeepgram],
  );

  useEffect(() => {
    dgStartRef.current = startDeepgram;
  }, [startDeepgram]);

  const startListening = useCallback(async () => {
    if (settingsRef.current?.sttEngine === "deepgram") {
      void startDeepgram("entrando na chamada");
      return;
    }
    shouldListenRef.current = true;
    isMutedRef.current = false;
    setMuted(false);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      stream.getTracks().forEach((t) => t.stop());
    } catch (e) {
      logError("permissão de microfone negada", e);
      isMutedRef.current = true;
      shouldListenRef.current = false;
      setMuted(true);
      return;
    }
    maybeStartListening();
    setTurn((t) => (t === "speaking" ? t : "listening"));
  }, [startDeepgram, maybeStartListening, logError]);

  const muteMic = useCallback(() => {
    isMutedRef.current = true;
    setMuted(true);
    shouldListenRef.current = false;
    try {
      recognitionRef.current?.stop();
    } catch {}
    stopDeepgram({ graceful: true });
    // Mutar = "terminei de falar" → fecha a fala com a graça curta.
    scheduleSpeechFlush();
    setTurn((t) => (t === "speaking" ? t : "idle"));
  }, [stopDeepgram, scheduleSpeechFlush]);

  const toggleMute = useCallback(() => {
    if (muted) void startListening();
    else muteMic();
  }, [muted, startListening, muteMic]);

  // ===== hot-swap com crossfade =====
  const scheduleHotSwap = useCallback(() => {
    if (hotSwapTimerRef.current !== null) window.clearTimeout(hotSwapTimerRef.current);
    const configured = settingsRef.current?.hotSwapAfterSec;
    if (!configured) return; // sem config não há o que agendar
    const sec = Math.max(HOT_SWAP_MIN_SEC, configured);
    hotSwapTimerRef.current = window.setTimeout(() => prewarmSwapRef.current?.(), sec * 1000);
    log(`hot-swap agendado para daqui a ${sec}s`);
  }, [log]);

  const prewarmAndSwap = useCallback(async () => {
    if (swapInProgressRef.current) return;
    const oldSession = sessionRef.current;
    if (!oldSession) return;
    swapInProgressRef.current = true;

    const speakOn = (sess: LiveAvatarSession, txt: string) =>
      new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
          if (done) return;
          done = true;
          window.clearTimeout(timer);
          try {
            sess.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, finish);
          } catch {}
          resolve();
        };
        const timer = window.setTimeout(finish, SPEAK_TIMEOUT_MS);
        sess.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, finish);
        try {
          sess.repeat(txt);
        } catch {
          finish();
        }
      });

    try {
      // Espera ele terminar a frase antes de trocar — cortar no meio é o que mais
      // denuncia que não é uma pessoa.
      let forcedCut = false;
      if (isAvatarSpeakingRef.current) {
        const ended = await new Promise<boolean>((resolve) => {
          let done = false;
          const finish = (val: boolean) => {
            if (done) return;
            done = true;
            window.clearTimeout(timer);
            try {
              oldSession.off(AgentEventsEnum.AVATAR_SPEAK_ENDED, onEnd);
            } catch {}
            resolve(val);
          };
          const onEnd = () => finish(true);
          const timer = window.setTimeout(() => finish(false), HOT_SWAP_MAX_DEFER_MS);
          oldSession.on(AgentEventsEnum.AVATAR_SPEAK_ENDED, onEnd);
        });
        if (!ended) forcedCut = true;
      }

      const pending = forcedCut ? currentUtteranceRef.current : null;

      const s = settingsRef.current;
      if (!s) throw new Error("sem configuração do console");
      const tokenResult = await fetchToken({
        data: {
          apiKey: s.apiKey,
          avatarId: s.avatarId,
          voiceId: s.voiceId,
          contextId: s.contextId,
          language: s.language,
          authToken: authTokenRef.current,
        },
      });
      const nextSlot: "a" | "b" = activeSlotRef.current === "a" ? "b" : "a";
      const newSession = new LiveAvatarSession(tokenResult.session_token, { voiceChat: false });
      registerSdkEvents(newSession, nextSlot);

      const promote = () => {
        newSession.off(SessionEvent.SESSION_STREAM_READY, promote);
        const cutElapsedMs = pending ? Date.now() - pending.startedAt : 0;
        try {
          const el = slotEl(nextSlot);
          if (el) newSession.attach(el);
        } catch (e) {
          logError("hot-swap: attach falhou", e);
        }
        sessionRef.current = newSession;
        void playSlot(nextSlot);

        // O fade: o slot novo já está tocando por baixo; só agora ele vem pra frente.
        activeSlotRef.current = nextSlot;
        setActiveSlot(nextSlot);
        log("hot-swap: troca concluída", "ok");

        // Só encerra a antiga DEPOIS do fade terminar — se parasse agora, o quadro
        // que ainda está visível durante a transição ficaria preto.
        window.setTimeout(() => {
          void oldSession.stop().catch((e) => logError("hot-swap: stop da antiga falhou", e));
        }, 700);

        swapInProgressRef.current = false;
        scheduleHotSwap();

        void (async () => {
          // Suprime a saudação automática do HeyGen na sessão nova.
          for (let i = 0; i < 4; i++) {
            try {
              (newSession as any)?.interrupt?.();
            } catch {}
            await new Promise((r) => window.setTimeout(r, 250));
          }
          // A "fala ao reconectar" existe pro console, onde a troca é percebida. Aqui
          // ela denunciaria a troca — a tela toda existe pra que ninguém perceba. Só
          // retomamos a frase se o swap tiver realmente cortado no meio.
          if (pending?.text) {
            const words = pending.text.trim().split(/\s+/).filter(Boolean);
            const WORDS_PER_SEC = 2.7;
            let spoken = Math.floor((cutElapsedMs / 1000) * WORDS_PER_SEC) - 2;
            if (spoken < 0) spoken = 0;
            const remaining = spoken < words.length ? words.slice(spoken).join(" ") : "";
            if (remaining) await speakOn(newSession, remaining);
          }
        })();
      };
      newSession.on(SessionEvent.SESSION_STREAM_READY, promote);
      await newSession.start();
    } catch (e) {
      logError("hot-swap falhou; mantendo a sessão atual", e);
      swapInProgressRef.current = false;
      scheduleHotSwap();
    }
  }, [fetchToken, registerSdkEvents, slotEl, playSlot, scheduleHotSwap, log, logError]);

  useEffect(() => {
    prewarmSwapRef.current = prewarmAndSwap;
  }, [prewarmAndSwap]);

  // ===== entrar / sair =====
  const joinCall = useCallback(async () => {
    if (sessionRef.current) return;
    endedByUserRef.current = false;
    setFatalError(null);
    setPhase("connecting");
    try {
      const s = settingsRef.current;
      if (!s) throw new Error("sem configuração do console");
      const tokenResult = await fetchToken({
        data: {
          apiKey: s.apiKey,
          avatarId: s.avatarId,
          voiceId: s.voiceId,
          contextId: s.contextId,
          language: s.language,
          authToken: authTokenRef.current,
        },
      });
      const session = new LiveAvatarSession(tokenResult.session_token, { voiceChat: false });
      sessionRef.current = session;
      registerSdkEvents(session, "a");
      activeSlotRef.current = "a";
      setActiveSlot("a");
      await session.start();
      setPhase("live");

      // Saudação: interrompe a fala automática do HeyGen e diz a frase configurada.
      const greeting = (s.meetConfigs[modeRef.current]?.greeting ?? "").trim();
      if (greeting) {
        for (let i = 0; i < 4; i++) {
          try {
            (session as any)?.interrupt?.();
          } catch {}
          await new Promise((r) => window.setTimeout(r, 250));
        }
        try {
          session.repeat(greeting);
        } catch (e) {
          logError("saudação inicial falhou", e);
        }
      }
      swapInProgressRef.current = false;
      scheduleHotSwap();

      void startListening();
    } catch (error) {
      const msg = logError("não foi possível iniciar a chamada", error);
      setFatalError(msg);
      try {
        await sessionRef.current?.stop();
      } catch {}
      sessionRef.current = null;
      setPhase("prejoin");
    }
  }, [fetchToken, registerSdkEvents, scheduleHotSwap, startListening, logError]);

  const leaveCall = useCallback(async () => {
    endedByUserRef.current = true;
    if (hotSwapTimerRef.current !== null) {
      window.clearTimeout(hotSwapTimerRef.current);
      hotSwapTimerRef.current = null;
    }
    swapInProgressRef.current = false;
    shouldListenRef.current = false;
    isMutedRef.current = true;
    setMuted(true);
    try {
      recognitionRef.current?.stop();
    } catch {}
    stopDeepgram();
    if (speechTimerRef.current !== null) {
      window.clearTimeout(speechTimerRef.current);
      speechTimerRef.current = null;
    }
    speechBufferRef.current = "";
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    setCamOn(false);
    try {
      await sessionRef.current?.stop();
    } catch (e) {
      logError("stop da sessão falhou", e);
    }
    sessionRef.current = null;
    meetingActiveRef.current = false;
    setReconnecting(false);
    setTurn("idle");
    setPhase("prejoin");
  }, [stopDeepgram, logError]);

  // ===== câmera local (self-view) =====
  const toggleCamera = useCallback(async () => {
    if (camOn) {
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      camStreamRef.current = null;
      setCamOn(false);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      camStreamRef.current = stream;
      setCamOn(true);
    } catch (e) {
      logError("câmera indisponível", e);
    }
  }, [camOn, logError]);

  useEffect(() => {
    const v = camVideoRef.current;
    if (v && camStreamRef.current) {
      v.srcObject = camStreamRef.current;
      v.play?.().catch(() => {});
    }
  }, [camOn, phase]);

  // ===== controles somem sozinhos, como numa chamada de verdade =====
  useEffect(() => {
    if (phase !== "live") {
      setControlsVisible(true);
      return;
    }
    let timer: number | null = null;
    const show = () => {
      setControlsVisible(true);
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => setControlsVisible(false), 3500);
    };
    show();
    window.addEventListener("mousemove", show);
    window.addEventListener("touchstart", show);
    window.addEventListener("keydown", show);
    return () => {
      if (timer !== null) window.clearTimeout(timer);
      window.removeEventListener("mousemove", show);
      window.removeEventListener("touchstart", show);
      window.removeEventListener("keydown", show);
    };
  }, [phase]);

  // ===== limpeza ao sair da rota =====
  useEffect(() => {
    return () => {
      if (hotSwapTimerRef.current !== null) window.clearTimeout(hotSwapTimerRef.current);
      if (speechTimerRef.current !== null) window.clearTimeout(speechTimerRef.current);
      try {
        recognitionRef.current?.stop();
      } catch {}
      camStreamRef.current?.getTracks().forEach((t) => t.stop());
      void sessionRef.current?.stop().catch(() => {});
      sessionRef.current = null;
    };
  }, []);

  // ================= UI =================

  if (phase === "boot") {
    return <div className="fixed inset-0 bg-black" />;
  }

  if (phase === "login") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <p className="text-lg font-medium">Sessão expirada</p>
        <p className="max-w-sm text-sm text-white/60">
          Entre pelo console primeiro — a chamada usa a mesma sessão.
        </p>
        <Link
          to="/"
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          Ir para o console
        </Link>
      </div>
    );
  }

  // Sem configuração salva neste navegador. A tela não tem valores próprios de
  // propósito — usar defaults inventados aqui faria a chamada se comportar diferente
  // do console, e a diferença só apareceria ao vivo.
  if (phase === "unconfigured") {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-4 bg-black px-6 text-center text-white">
        <p className="text-lg font-medium">Configuração não encontrada</p>
        <p className="max-w-md text-sm text-white/60">
          Esta tela usa a configuração do console — avatar, voz, modo e webhooks. Abra o console
          neste navegador e salve a configuração antes de iniciar a chamada.
        </p>
        <Link
          to="/"
          className="rounded-full bg-white px-5 py-2 text-sm font-semibold text-black transition-opacity hover:opacity-90"
        >
          Abrir o console
        </Link>
      </div>
    );
  }

  const isLive = phase === "live";

  return (
    <div className="fixed inset-0 select-none overflow-hidden bg-black text-white">
      {/* ===== Avatar em tela cheia — dois slots que se cruzam no hot-swap ===== */}
      <video
        ref={videoARef}
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
        style={{ opacity: isLive && activeSlot === "a" ? 1 : 0 }}
      />
      <video
        ref={videoBRef}
        autoPlay
        playsInline
        className="absolute inset-0 h-full w-full object-cover transition-opacity duration-500"
        style={{ opacity: isLive && activeSlot === "b" ? 1 : 0 }}
      />

      {/* Pré-chamada: o poster do avatar cobre a tela enquanto ninguém entrou.
          Também é ele que aparece durante o "connecting", cobrindo o quadro preto. */}
      {!isLive && (
        <div
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: poster ? `url(${poster})` : undefined,
            backgroundColor: "#0a0c0f",
            filter: "blur(2px) brightness(.55)",
          }}
        />
      )}

      {/* ===== Pré-chamada ===== */}
      {(phase === "prejoin" || phase === "connecting") && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center gap-6 px-6 text-center">
          <div className="h-28 w-28 overflow-hidden rounded-full border border-white/20 bg-black/40 shadow-2xl">
            {poster ? <img src={poster} alt="" className="h-full w-full object-cover" /> : null}
          </div>
          <div>
            <p className="text-2xl font-semibold">Renan</p>
            <p className="mt-1 text-sm text-white/60">
              {phase === "connecting" ? "Conectando…" : "Pronto para começar"}
            </p>
          </div>

          {fatalError && (
            <p className="max-w-sm rounded-lg border border-red-400/30 bg-red-500/10 px-4 py-2 text-sm text-red-200">
              {fatalError}
            </p>
          )}

          <button
            onClick={() => void joinCall()}
            disabled={phase === "connecting"}
            className="rounded-full bg-white px-8 py-3 text-base font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-50"
          >
            {phase === "connecting" ? "Entrando…" : "Entrar agora"}
          </button>
        </div>
      )}

      {/* ===== Nome, como numa chamada de verdade ===== */}
      {isLive && (
        <div
          className={`absolute bottom-5 left-5 z-20 rounded-md bg-black/45 px-3 py-1.5 text-sm font-medium backdrop-blur-sm transition-opacity duration-300 ${
            controlsVisible ? "opacity-100" : "opacity-0"
          }`}
        >
          Renan
        </div>
      )}

      {/* Anel de "falando" — o mesmo sinal que o Meet dá, e que faz a tela ler
          como chamada em vez de vídeo em tela cheia. */}
      {isLive && turn === "speaking" && (
        <div className="pointer-events-none absolute inset-0 z-10 ring-4 ring-inset ring-sky-400/70 transition-opacity duration-300" />
      )}

      {/* Queda real de conexão (o hot-swap normal nunca chega aqui). */}
      {isLive && reconnecting && (
        <div className="absolute left-1/2 top-6 z-30 -translate-x-1/2 rounded-full bg-black/70 px-4 py-2 text-sm backdrop-blur">
          Reconectando…
        </div>
      )}

      {/* ===== Self-view ===== */}
      {isLive && camOn && (
        <div className="absolute bottom-24 right-5 z-20 h-32 w-52 overflow-hidden rounded-xl border border-white/20 bg-black shadow-2xl">
          <video
            ref={camVideoRef}
            autoPlay
            playsInline
            muted
            className="h-full w-full object-cover [transform:scaleX(-1)]"
          />
        </div>
      )}

      {/* ===== Barra de controles ===== */}
      {isLive && (
        <div
          className={`absolute inset-x-0 bottom-6 z-30 flex items-center justify-center gap-4 transition-opacity duration-300 ${
            controlsVisible ? "opacity-100" : "pointer-events-none opacity-0"
          }`}
        >
          <button
            onClick={toggleMute}
            title={muted ? "Ativar microfone" : "Desativar microfone"}
            aria-label={muted ? "Ativar microfone" : "Desativar microfone"}
            className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
              muted
                ? "border-transparent bg-red-500 hover:bg-red-600"
                : "border-white/20 bg-white/15 hover:bg-white/25"
            }`}
          >
            {muted ? <IconMicOff /> : <IconMic />}
          </button>

          <button
            onClick={() => void toggleCamera()}
            title={camOn ? "Desligar câmera" : "Ligar câmera"}
            aria-label={camOn ? "Desligar câmera" : "Ligar câmera"}
            className={`flex h-14 w-14 items-center justify-center rounded-full border transition-colors ${
              camOn
                ? "border-white/20 bg-white/15 hover:bg-white/25"
                : "border-transparent bg-red-500 hover:bg-red-600"
            }`}
          >
            {camOn ? <IconCam /> : <IconCamOff />}
          </button>

          <button
            onClick={() => void leaveCall()}
            title="Sair da chamada"
            aria-label="Sair da chamada"
            className="flex h-14 items-center justify-center rounded-full bg-red-500 px-7 transition-colors hover:bg-red-600"
          >
            <IconEnd />
          </button>
        </div>
      )}
    </div>
  );
}

/* ===== ícones (traço fino, no estilo do Meet) ===== */

function IconMic() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 fill-none stroke-white stroke-[1.8]"
      strokeLinecap="round"
    >
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

function IconMicOff() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 fill-none stroke-white stroke-[1.8]"
      strokeLinecap="round"
    >
      <path d="M9 9V6a3 3 0 0 1 6 0v5M5 11a7 7 0 0 0 11 5.5M12 18v3" />
      <path d="M4 4l16 16" />
    </svg>
  );
}

function IconCam() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 fill-none stroke-white stroke-[1.8]"
      strokeLinecap="round"
    >
      <rect x="3" y="6" width="12" height="12" rx="2" />
      <path d="M15 10l6-3v10l-6-3z" />
    </svg>
  );
}

function IconCamOff() {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6 fill-none stroke-white stroke-[1.8]"
      strokeLinecap="round"
    >
      <path d="M3 8a2 2 0 0 1 2-2h7M15 10l6-3v10M15 13v3a2 2 0 0 1-2 2H6" />
      <path d="M3 3l18 18" />
    </svg>
  );
}

function IconEnd() {
  return (
    <svg viewBox="0 0 24 24" className="h-6 w-6 fill-white">
      <path d="M3 11a13 13 0 0 1 18 0l-2.2 2.2a2 2 0 0 1-2.6.2l-1.8-1.3a1.5 1.5 0 0 1-.6-1.2V9.4a11 11 0 0 0-4 0v1.7a1.5 1.5 0 0 1-.6 1.2L7.8 13.4a2 2 0 0 1-2.6-.2L3 11z" />
    </svg>
  );
}
