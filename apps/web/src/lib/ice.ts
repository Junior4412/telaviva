import type { IceServerConfig } from "@tela/shared";
import { SERVER_URL } from "./env";

/**
 * STUN público usado como fallback quando o backend não responde.
 *
 * STUN apenas ajuda a descobrir o endereço externo; não faz relay. Sem TURN,
 * conexões atrás de NAT simétrico podem falhar — isso é documentado no
 * README como limitação de conectividade.
 */
const FALLBACK_ICE_SERVERS: IceServerConfig[] = [
  { urls: ["stun:stun.l.google.com:19302"] },
  { urls: ["stun:stun1.l.google.com:19302"] },
];

/**
 * Busca a lista de servidores ICE do backend.
 *
 * As credenciais TURN retornadas são temporárias e foram geradas no servidor,
 * de modo que o segredo de longo prazo nunca chega ao navegador. Se o
 * endpoint falhar, caímos no STUN público para não bloquear o usuário.
 */
export async function fetchIceServers(): Promise<IceServerConfig[]> {
  try {
    const response = await fetch(`${SERVER_URL}/ice`, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: AbortSignal.timeout(6000),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);

    const data = (await response.json()) as { iceServers?: IceServerConfig[] };
    if (!Array.isArray(data.iceServers) || data.iceServers.length === 0) {
      throw new Error("Resposta sem servidores ICE.");
    }
    return data.iceServers;
  } catch {
    return FALLBACK_ICE_SERVERS;
  }
}
