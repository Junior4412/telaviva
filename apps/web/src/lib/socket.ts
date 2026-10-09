import { io, type Socket } from "socket.io-client";
import type {
  ClientToServerEvents,
  ServerToClientEvents,
} from "@tela/shared";
import { SERVER_URL } from "./env";

/** Socket.IO tipado com o contrato compartilhado. */
export type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

let socket: AppSocket | null = null;

/**
 * Retorna o socket singleton, criando a conexão se necessário.
 *
 * Usamos um único socket compartilhado porque toda a sinalização pertence à
 * mesma sala. Reaproveitar a conexão evita handshakes duplicados e mantém o
 * estado coerente entre páginas.
 */
export function getSocket(): AppSocket {
  if (socket) return socket;

  socket = io(SERVER_URL, {
    autoConnect: false,
    // Polling como fallback quando o WebSocket é bloqueado por proxy/firewall.
    transports: ["websocket", "polling"],
    reconnection: true,
    // Orçamento de ~2,5 min: no Render free o serviço dorme após 15 min de
    // inatividade e leva ~1 minuto para acordar. Tentativas são o que
    // "chama" o serviço de volta — com 8 tentativas (~30 s) o cliente
    // desistia antes do serviço acordar.
    reconnectionAttempts: 30,
    reconnectionDelay: 800,
    reconnectionDelayMax: 5000,
    timeout: 10_000,
  });

  return socket;
}

/**
 * Conecta o socket se ainda não estiver conectado e aguarda o evento
 * `connect`. Resolve imediatamente se já estiver ativo.
 */
export function ensureConnected(): Promise<void> {
  const s = getSocket();
  if (s.connected) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      cleanup();
      reject(new Error("Tempo esgotado ao conectar ao servidor."));
    }, 12_000);

    const onConnect = (): void => {
      cleanup();
      resolve();
    };

    const onError = (error: Error): void => {
      cleanup();
      reject(error);
    };

    function cleanup(): void {
      clearTimeout(timer);
      s.off("connect", onConnect);
      s.off("connect_error", onError);
    }

    s.on("connect", onConnect);
    s.on("connect_error", onError);
    s.connect();
  });
}

/** Desconecta e descarta o socket atual. */
export function disconnectSocket(): void {
  if (!socket) return;
  socket.removeAllListeners();
  socket.disconnect();
  socket = null;
}
