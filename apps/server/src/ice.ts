import { createHmac } from "node:crypto";
import type { IceServerConfig } from "@tela/shared";
import { config } from "./config.js";

/**
 * STUN público do Google, usado como fallback quando nenhum TURN está
 * configurado. Não há SLA — para produção séria, configure seu próprio STUN.
 */
const DEFAULT_STUN_URLS = ["stun:stun.l.google.com:19302"];

/** Gera credencial TURN temporária no formato esperado pelo coturn. */
function generateTurnCredentials(): { username: string; credential: string } {
  const { username, credential, ttlSeconds } = config.iceServers;
  const expiry = Math.floor(Date.now() / 1000) + ttlSeconds;
  const turnUsername = `${expiry}:${username}`;
  const hmac = createHmac("sha1", credential);
  hmac.update(turnUsername);
  return { username: turnUsername, credential: hmac.digest("base64") };
}

/**
 * Monta a lista de servidores ICE atual.
 *
 * Chamado por requisição (em vez de no boot) para que as credenciais TURN
 * sejam sempre frescas e tenham TTL curto.
 */
export function buildIceServers(): IceServerConfig[] {
  const servers: IceServerConfig[] = [];

  const { urls, username, credential } = config.iceServers;
  if (urls.length > 0) {
    if (username && credential) {
      const turn = generateTurnCredentials();
      servers.push({ urls, username: turn.username, credential: turn.credential });
    } else {
      // TURN sem credencial (raro) ou apenas STUN listado em ICE_URLS.
      servers.push({ urls });
    }
  } else {
    servers.push({ urls: DEFAULT_STUN_URLS });
  }

  return servers;
}
