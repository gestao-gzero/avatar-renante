// Leitura da configuração do console, para a tela de chamada (`/chamada`).
//
// REGRA DESTE ARQUIVO: aqui não existe NENHUM valor de configuração. Nada de webhook,
// avatarId, voiceId, saudação ou modo padrão. O console (`/`) é a única fonte da
// verdade; ele grava tudo no `localStorage` a cada alteração e a tela de chamada
// apenas LÊ. Se a tela tivesse defaults próprios, no dia em que o console mudasse um
// webhook ou uma saudação as duas telas passariam a se comportar diferente — e a
// divergência apareceria justamente num evento ao vivo.
//
// Consequência disso: sem configuração salva, a tela de chamada NÃO abre. Ela avisa
// que é preciso configurar no console. Isso é proposital — é melhor recusar do que
// entrar no ar com valores inventados aqui.

export type Mode = "conversa" | "reuniao" | "entrevistador" | "renan";

/** Chaves gravadas pelo console. Precisam bater exatamente com as do `index.tsx`. */
export const SETTINGS_KEY = "liveavatar.settings.v1";
export const MODE_KEY = "liveavatar.mode.v1";
export const AUTH_KEY = "liveavatar.auth.v1";
export const POSTER_KEY = "liveavatar.poster.v1";

/** Fallback estático do poster — arquivo em `public/`, não é configuração. */
export const AVATAR_POSTER_FALLBACK = "/avatar-poster.png";

// ===== constantes de CÓDIGO (não são configuração do usuário) =====
export const SPEAK_TIMEOUT_MS = 60_000;
// Sem mutar, espera este silêncio antes de fechar a fala e mandar ao n8n.
export const SPEECH_FLUSH_SEC_DEFAULT = 5;
// Ao mutar, espera só isto pro último trecho do STT chegar.
export const MUTE_FLUSH_MS = 200;
// Piso do intervalo de hot-swap: menos que isto não dá tempo de pré-aquecer a sessão.
export const HOT_SWAP_MIN_SEC = 20;
// Teto de espera pelo fim da frase antes de forçar a troca.
export const HOT_SWAP_MAX_DEFER_MS = 20_000;
// Rate limit dos envios ao n8n (barra eco/duplicata do reconhecimento de voz).
export const SEND_MIN_GAP_MS = 1000;

/** Comportamento por modo, como o console grava. */
export type CallModeConfig = {
  greeting: string;
  behavior: "wake" | "always";
  bargeIn: boolean;
};

/** Só o subconjunto da configuração do console que a tela de chamada consome. */
export type CallSettings = {
  apiKey: string;
  avatarId: string;
  voiceId: string;
  contextId: string;
  language: string;
  webhookConversa: string;
  webhookReuniao: string;
  webhookEntrevistador: string;
  webhookRenan: string;
  webhookFiller: string;
  hotSwapAfterSec: number;
  sttEngine: "webspeech" | "deepgram";
  deepgramApiKey: string;
  posterUrl: string;
  meetConfigs: Record<Mode, CallModeConfig>;
};

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const bool = (v: unknown, fallback: boolean): boolean => (typeof v === "boolean" ? v : fallback);

function readModeConfig(raw: unknown): CallModeConfig | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  // `behavior` decide se o avatar responde tudo ou só quando chamado pelo nome. Se
  // viesse errado, o avatar responderia a plateia inteira — então não se inventa um
  // valor: config sem `behavior` válido conta como não configurada.
  if (o.behavior !== "wake" && o.behavior !== "always") return null;
  return {
    greeting: str(o.greeting),
    behavior: o.behavior,
    bargeIn: bool(o.bargeIn, true),
  };
}

/**
 * Lê a configuração gravada pelo console.
 *
 * Devolve `null` quando não há configuração salva ou quando ela está incompleta a
 * ponto de não dar pra abrir uma sessão. Quem chama deve tratar `null` como
 * "mande configurar no console" — nunca preencher com valores próprios.
 */
export function readConsoleSettings(): CallSettings | null {
  if (typeof window === "undefined") return null;
  let parsed: Record<string, unknown>;
  try {
    const raw = window.localStorage.getItem(SETTINGS_KEY);
    if (!raw) return null;
    const j = JSON.parse(raw);
    if (!j || typeof j !== "object") return null;
    parsed = j as Record<string, unknown>;
  } catch {
    return null;
  }

  // Sem avatar não há sessão possível — não adianta seguir.
  const avatarId = str(parsed.avatarId);
  if (!avatarId) return null;

  const rawConfigs = (parsed.meetConfigs ?? {}) as Record<string, unknown>;
  const conversa = readModeConfig(rawConfigs.conversa);
  const reuniao = readModeConfig(rawConfigs.reuniao);
  const entrevistador = readModeConfig(rawConfigs.entrevistador);
  // O modo "renan" é mais novo que os outros três: um console que ainda não gravou
  // depois da atualização não tem esta chave. Nesse caso a config NÃO é inválida —
  // só não dá pra usar este modo, e é o que o `readConsoleMode` abaixo checa.
  const renan = readModeConfig(rawConfigs.renan);
  if (!conversa || !reuniao || !entrevistador) return null;

  // Intervalo do hot-swap: sem um valor positivo não dá pra agendar a troca, e chutar
  // um número aqui seria inventar configuração. O console sempre grava este campo.
  const hotSwapAfterSec = num(parsed.hotSwapAfterSec);
  if (hotSwapAfterSec <= 0) return null;

  const engine = parsed.sttEngine === "deepgram" ? "deepgram" : "webspeech";

  return {
    apiKey: str(parsed.apiKey), // vazio é legítimo: o servidor usa a env
    avatarId,
    voiceId: str(parsed.voiceId),
    contextId: str(parsed.contextId),
    language: str(parsed.language),
    webhookConversa: str(parsed.webhookConversa),
    webhookReuniao: str(parsed.webhookReuniao),
    webhookEntrevistador: str(parsed.webhookEntrevistador),
    webhookRenan: str(parsed.webhookRenan),
    webhookFiller: str(parsed.webhookFiller),
    hotSwapAfterSec,
    sttEngine: engine,
    deepgramApiKey: str(parsed.deepgramApiKey),
    posterUrl: str(parsed.posterUrl),
    // Sem config salva do modo "renan" (console anterior à atualização), ele herda a
    // do modo Conversa — que é exatamente o comportamento dele: responde tudo.
    meetConfigs: { conversa, reuniao, entrevistador, renan: renan ?? conversa },
  };
}

/** Modo escolhido no console. O console grava a cada troca de modo. */
export function readConsoleMode(): Mode {
  if (typeof window === "undefined") return "conversa";
  const v = window.localStorage.getItem(MODE_KEY);
  return v === "conversa" || v === "reuniao" || v === "entrevistador" || v === "renan"
    ? v
    : "conversa";
}

/** Webhook n8n do modo — cada modo tem o seu; o filler é global. */
export function webhookForMode(s: CallSettings, mode: Mode): string {
  return mode === "conversa"
    ? s.webhookConversa
    : mode === "entrevistador"
      ? s.webhookEntrevistador
      : mode === "renan"
        ? s.webhookRenan
        : s.webhookReuniao;
}
