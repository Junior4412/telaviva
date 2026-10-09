import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Hash de senha de sala com scrypt.
 *
 * Senhas de sala nunca são guardadas em texto puro. Usamos scrypt com salt
 * aleatório por sala e comparacao `timingSafeEqual` para evitar que um
 * atacante deduza a senha medindo o tempo de comparação.
 */

const SALT_BYTES = 16;
const KEY_LENGTH = 32;
// Custo alto o suficiente para ser lento para brute force, mas abaixo do que
// derrubaria um plano gratuito de hospedagem.
const SCRYPT_COST = { N: 16384, r: 8, p: 1, maxmem: 32 * 1024 * 1024 };

/**
 * Deriva o hash de uma senha. Retorna uma string no formato
 * `scrypt$N$r$p$salt$hash`, o que permite ajustar o custo no futuro sem
 * invalidar senhas já gravadas.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(SALT_BYTES);
  const derived = scryptSync(password, salt, KEY_LENGTH, SCRYPT_COST);
  const { N, r, p } = SCRYPT_COST;
  return [
    "scrypt",
    N,
    r,
    p,
    salt.toString("base64url"),
    derived.toString("base64url"),
  ].join("$");
}

/**
 * Verifica uma senha contra um hash armazenado.
 *
 * Retorna `false` de forma segura para qualquer entrada malformada, em vez
 * de lançar exceção, para que um dado corrompido não derrube a conexão.
 */
export function verifyPassword(password: string, stored: string): boolean {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, rawN, rawR, rawP, rawSalt, rawHash] = parts;
  if (rawN === undefined || rawR === undefined || rawP === undefined) return false;
  if (rawSalt === undefined || rawHash === undefined) return false;

  const N = Number.parseInt(rawN, 10);
  const r = Number.parseInt(rawR, 10);
  const p = Number.parseInt(rawP, 10);
  if (!Number.isFinite(N) || !Number.isFinite(r) || !Number.isFinite(p)) {
    return false;
  }

  try {
    const salt = Buffer.from(rawSalt, "base64url");
    const expected = Buffer.from(rawHash, "base64url");
    if (expected.length === 0 || salt.length === 0) return false;

    const derived = scryptSync(password, salt, expected.length, { N, r, p, maxmem: 32 * 1024 * 1024 });
    return timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/**
 * Compara senhas de forma timing-safe sem depender de hash, para os casos em
 * que precisamos de igualdade exata de strings curtas.
 */
export function safeEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, "utf8");
  const bufferB = Buffer.from(b, "utf8");
  if (bufferA.length !== bufferB.length) {
    // Ainda faz uma comparação para manter o tempo de execução constante.
    timingSafeEqual(bufferA, bufferA);
    return false;
  }
  return timingSafeEqual(bufferA, bufferB);
}
