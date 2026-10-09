/**
 * Configuração do servidor carregada de variáveis de ambiente.
 *
 * Centralizar aqui garante que valores inválidos falhem cedo, no boot, em vez
 * de causarem um bug sutil em produção.
 */

function readInt(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Variável ${name} inválida: esperado inteiro positivo.`);
  }
  return parsed;
}

function readBool(name: string, fallback: boolean): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw.toLowerCase() === "true" || raw === "1";
}

function readList(name: string, fallback: string[]): string[] {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

const nodeEnv = process.env.NODE_ENV ?? "development";
const isProduction = nodeEnv === "production";

/** Origens padrão para desenvolvimento local. */
const DEV_ORIGINS = ["http://localhost:5173", "http://127.0.0.1:5173"];

export const config = {
  nodeEnv,
  isProduction,
  port: readInt("PORT", 3001),

  /**
   * Origens permitidas no CORS e no handshake do Socket.IO.
   *
   * Em produção isso deve ser a URL do frontend no Vercel. Uma origem vazia ou
   * "*" aqui abriria o servidor para qualquer site se conectar.
   */
  allowedOrigins: readList("ALLOWED_ORIGINS", DEV_ORIGINS),

  /** Servidores ICE (STUN/TURN) entregues aos clientes. */
  iceServers: {
    urls: readList("ICE_URLS", []),
    username: process.env.ICE_USERNAME ?? "",
    credential: process.env.ICE_SECRET ?? "",
    ttlSeconds: readInt("ICE_TTL_SECONDS", 3600),
  },

  debug: readBool("DEBUG", false),
} as const;

export type AppConfig = typeof config;
