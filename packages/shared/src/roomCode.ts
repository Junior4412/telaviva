import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "./constants.js";

/**
 * Gera um código de sala aleatório usando a criptografia do runtime.
 *
 * Usa rejection sampling para evitar viés de módulo, de modo que cada
 * caractere do alfabeto tenha probabilidade idêntica de ser sorteado.
 *
 * Disponível em Node 20+ (`crypto.getRandomValues`) e em qualquer navegador
 * moderno, então o mesmo código funciona nos dois lados.
 */
export function generateRoomCode(length = ROOM_CODE_LENGTH): string {
  const alphabet = ROOM_CODE_ALPHABET;
  const base = alphabet.length;

  const cryptoObj = globalThis.crypto;
  if (!cryptoObj || typeof cryptoObj.getRandomValues !== "function") {
    throw new Error("Crypto seguro indisponível neste runtime.");
  }

  let code = "";
  while (code.length < length) {
    // Rejeita valores que enviesariam o módulo: limita ao maior múltiplo
    // inteiro de `base` cabível em um byte.
    const limit = Math.floor(256 / base) * base;
    const buffer = new Uint8Array(limit);
    cryptoObj.getRandomValues(buffer);

    for (const value of buffer) {
      if (value >= limit) continue;
      code += alphabet[value % base];
      if (code.length === length) break;
    }
  }

  return code;
}

/** Remove espaços, hífens e converte para maiúsculas. */
export function normalizeRoomCode(input: string): string {
  return input.replace(/[\s-]+/g, "").toUpperCase();
}

/** Verifica se uma entrada corresponde ao formato de código de sala. */
export function isValidRoomCode(input: string): boolean {
  if (input.length !== ROOM_CODE_LENGTH) return false;
  for (const char of input) {
    if (!ROOM_CODE_ALPHABET.includes(char)) return false;
  }
  return true;
}

/**
 * Normaliza e valida em um passo. Retorna `null` quando a entrada é inválida,
 * o que simplifica o uso em pontos de validação.
 */
export function sanitizeRoomCode(input: string): string | null {
  const normalized = normalizeRoomCode(input);
  return isValidRoomCode(normalized) ? normalized : null;
}

/** Formata o código para exibição: "K7M 2QX". */
export function formatRoomCode(code: string): string {
  const half = Math.ceil(code.length / 2);
  return `${code.slice(0, half)} ${code.slice(half)}`.trim();
}
