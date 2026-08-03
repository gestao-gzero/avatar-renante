// Wake-word do avatar — reconhecimento de "chamaram o Nâner?" a partir da fala.
//
// Compartilhado entre o console (`/`) e a tela de chamada (`/chamada`). É de longe
// a lógica que mais muda no projeto (as variantes abaixo saíram de transcrições
// reais de eventos), então vive num lugar só de propósito: um ajuste aqui vale
// para as duas telas.
//
// Tudo aqui é PURO — sem rede, sem estado, sem React. A decisão do que fazer com
// os sinais (acordar, dormir, mandar pro n8n) fica em quem chama, porque envolve
// await de IA e de fala.

// Variações que o reconhecimento de voz costuma devolver no lugar de "Nâner"
// (troca de consoante inicial, -er/-eir/-or no fim, etc.).
// PROPOSITALMENTE fora da lista: "renan" e "renante". O Renan de verdade está na
// sala — se o nome dele acordasse o avatar, chamar a pessoa acordaria o bot junto.
export const NANER_WAKE =
  "naner|nanner|nanar|naneir|nander|nanor|nener|nane|nana|nanan|nanam|nanna|nanah|nanae|nani|nany|nanni|nene|nenem|nenen|neneh|nenee|nanei|nanne|nada|namir|namyr|namer|raner|ranner|daner|danner|taner|tanner|zaner|vaner";

const WAKE_RE = new RegExp(`\\b(${NANER_WAKE})\\b`);
const WAKE_RE_GLOBAL = new RegExp(`\\b(${NANER_WAKE})\\b`, "g");

// Comando de desligar: correspondência FLEXÍVEL (a fala CONTÉM algo disto), com ou
// sem o nome. Palavras curtas usam limite de palavra p/ evitar falso positivo
// (ex.: "chegamos" não vira "chega").
const END_RE = new RegExp(
  `\\b(desligar|desliga|pode desligar|pode parar|pode encerrar|encerra|encerrar|para (${NANER_WAKE})|chega|tchau|pode ir|era so isso|obrigado por enquanto|dispensar|ja chega|ja deu)\\b`,
);

// "valeu"/"obrigado" sozinhos são ambíguos demais para derrubar a sessão quando ele
// está dormindo — só contam como desligar se ele já estiver ATIVO.
const SOFT_END_RE = /\b(valeu|vlw|obrigado|obrigada|brigado)\b/;

const GREETING_RE = /\b(ola|oi|ei|hey|alo|e ai|eai|opa|fala)\b/g;

/** Minúsculas e sem acento — o formato que todas as regexes daqui esperam. */
export function normalizeUtterance(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

export type WakeSignals = {
  /** A fala contém o nome (ou alguma variante que o STT costuma produzir). */
  hasWake: boolean;
  /** A fala contém um comando de encerrar. */
  hasEnd: boolean;
  /**
   * O que sobra depois de tirar saudação e nome. Serve para saber se veio uma
   * pergunta JUNTO com o chamado ("Nâner, quanto custa?") ou se a pessoa só
   * chamou o nome. Menos de 4 caracteres = só chamou.
   */
  residual: string;
};

/**
 * Lê os sinais de wake-word de uma fala já transcrita.
 *
 * `isActive` é necessário porque "valeu"/"obrigado" só encerram a sessão quando o
 * avatar já está ativo — dormindo, são conversa normal da sala.
 */
export function readWakeSignals(utterance: string, opts: { isActive: boolean }): WakeSignals {
  const low = normalizeUtterance(utterance);

  let hasEnd = END_RE.test(low);
  if (!hasEnd && opts.isActive && SOFT_END_RE.test(low)) {
    hasEnd = true;
  }

  const residual = low
    .replace(GREETING_RE, " ")
    .replace(WAKE_RE_GLOBAL, " ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

  return { hasWake: WAKE_RE.test(low), hasEnd, residual };
}

/** Veio pergunta junto com o chamado? (limiar usado desde a implementação original) */
export function residualHasQuestion(residual: string): boolean {
  return residual.length >= 4;
}
