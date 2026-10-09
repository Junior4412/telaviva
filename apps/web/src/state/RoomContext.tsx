import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ERROR_CODES,
  type AckResult,
  type Participant,
  type ProtocolError,
  type RoomJoinedData,
} from "@tela/shared";
import { ensureConnected, getSocket, type AppSocket } from "../lib/socket";

/** Estado da conexão de rede com o servidor de sinalização. */
export type ConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline";

/** Uma falha de conexão pronta para exibição. */
export interface RoomError {
  code: string;
  message: string;
}

/** Estado consolidado da sala para a UI. */
export interface RoomState {
  status: "idle" | "joining" | "joined" | "error";
  connection: ConnectionStatus;
  roomCode: string | null;
  selfId: string | null;
  participants: Participant[];
  error: RoomError | null;
  /** Indica que a sala exige senha (usado para reexibir o campo). */
  requiresPassword: boolean;
}

const INITIAL_STATE: RoomState = {
  status: "idle",
  connection: "idle",
  roomCode: null,
  selfId: null,
  participants: [],
  error: null,
  requiresPassword: false,
};

/** Converte um erro do protocolo em algo exibível. */
function toRoomError(error: ProtocolError | undefined): RoomError {
  if (!error) {
    return { code: ERROR_CODES.INTERNAL, message: "Erro inesperado. Tente novamente." };
  }
  return { code: error.code, message: error.message };
}

/** Envia um evento com ack e aguarda a resposta, com timeout de segurança. */
function emitWithAck<T>(
  socket: AppSocket,
  event: string,
  payload: unknown,
  timeoutMs = 10_000,
): Promise<AckResult<T>> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("O servidor demorou para responder."));
    }, timeoutMs);

    // `timeout()` do Socket.IO faz o `emit` chamar o callback com um `Error`
    // no primeiro argumento caso não haja resposta no prazo.
    //
    // A tipagem gerada não aceita nome de evento dinâmico, então contornamos
    // com um cast — mas mantemos a chamada como *método* (`socket.emit(...)`)
    // para preservar o `this`. Extrair a referência e chamá-la solta faria o
    // método do Socket.IO perder o `this` e lançar em runtime.
    type EmitWithAck = (
      name: string,
      data: unknown,
      cb: (error: Error | null, response?: AckResult<T>) => void,
    ) => void;

    const emitter = socket.timeout(timeoutMs) as unknown as { emit: EmitWithAck };

    emitter.emit(event, payload, (error, response) => {
      clearTimeout(timer);
      if (error) {
        reject(new Error("O servidor não respondeu a tempo."));
      } else if (!response) {
        reject(new Error("Resposta vazia do servidor."));
      } else {
        resolve(response);
      }
    });
  });
}

interface RoomContextValue {
  state: RoomState;
  createRoom: (input: { name?: string; password?: string }) => Promise<RoomJoinedData>;
  joinRoom: (input: {
    roomCode: string;
    name?: string;
    password?: string;
  }) => Promise<RoomJoinedData>;
  leaveRoom: () => void;
  /** Sai da sala ao desmontar a página, sem derrubar a conexão compartilhada. */
  teardown: () => void;
  socket: React.MutableRefObject<AppSocket | null>;
}

const RoomContext = createContext<RoomContextValue | null>(null);

/**
 * Provedor que guarda o estado da sala em um nível acima do roteador.
 *
 * O estado precisa sobreviver à navegação entre a home e a sala: quem cria uma
 * sala na home já entra nela, e a página da sala deve refletir isso sem pedir
 * a senha de novo. Manter esse estado dentro do componente faria a página da
 * sala montar "zerada" a cada troca de rota.
 */
export function RoomProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<RoomState>(INITIAL_STATE);
  const socketRef = useRef<AppSocket | null>(null);
  const joinedRef = useRef(false);

  /** Aplica um patch parcial ao estado. */
  const patch = useCallback((next: Partial<RoomState>) => {
    setState((current) => ({ ...current, ...next }));
  }, []);

  useEffect(() => {
    const socket = getSocket();
    socketRef.current = socket;

    // O socket é um singleton e pode já estar conectado de uma visita anterior
    // à home. Sem este ajuste, o evento `connect` já teria passado e o status
    // ficaria preso em "idle", aparecendo como "offline" para o usuário.
    if (socket.connected) {
      patch({ connection: "connected" });
    }

    const handleConnect = (): void => {
      patch({ connection: "connected" });
    };

    const handleDisconnect = (): void => {
      patch({ connection: joinedRef.current ? "reconnecting" : "offline" });
    };

    const handleConnectError = (): void => {
      patch({ connection: joinedRef.current ? "reconnecting" : "offline" });
    };

    const handleRoomState = (payload: {
      roomCode: string;
      selfId: string;
      participants: Participant[];
    }): void => {
      setState((current) => ({
        ...current,
        status: "joined",
        roomCode: payload.roomCode,
        selfId: payload.selfId,
        participants: payload.participants,
        error: null,
      }));
    };

    const handlePeerJoined = (payload: { participant: Participant }): void => {
      setState((current) => {
        const exists = current.participants.some((p) => p.id === payload.participant.id);
        if (exists) return current;
        return { ...current, participants: [...current.participants, payload.participant] };
      });
    };

    const handlePeerLeft = (payload: { participantId: string }): void => {
      setState((current) => ({
        ...current,
        participants: current.participants.filter((p) => p.id !== payload.participantId),
      }));
    };

    const handleServerError = (error: ProtocolError): void => {
      patch({ error: toRoomError(error) });
    };

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    socket.on("connect_error", handleConnectError);
    socket.on("room:state", handleRoomState);
    socket.on("peer:joined", handlePeerJoined);
    socket.on("peer:left", handlePeerLeft);
    socket.on("error", handleServerError);

    // Conecta imediatamente; a UI reflete via `connection`.
    void ensureConnected().catch(() => {
      patch({ connection: "offline" });
    });

    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      socket.off("connect_error", handleConnectError);
      socket.off("room:state", handleRoomState);
      socket.off("peer:joined", handlePeerJoined);
      socket.off("peer:left", handlePeerLeft);
      socket.off("error", handleServerError);
    };
  }, [patch]);

  /** Cria uma sala e entra nela. */
  const createRoom = useCallback(
    async (input: { name?: string; password?: string }): Promise<RoomJoinedData> => {
      setState((current) => ({ ...current, status: "joining", error: null }));

      try {
        await ensureConnected();
        const response = await emitWithAck<RoomJoinedData>(
          socketRef.current as AppSocket,
          "room:create",
          { name: input.name, password: input.password },
        );

        if (!response.ok) {
          const error = toRoomError(response.error);
          setState((current) => ({ ...current, status: "error", error }));
          throw error;
        }

        joinedRef.current = true;
        setState((current) => ({
          ...current,
          status: "joined",
          roomCode: response.data.roomCode,
          selfId: response.data.selfId,
          participants: response.data.participants,
          requiresPassword: response.data.requiresPassword,
          error: null,
        }));
        return response.data;
      } catch (caught) {
        const error =
          caught && typeof caught === "object" && "code" in caught
            ? (caught as RoomError)
            : {
                code: ERROR_CODES.INTERNAL,
                message:
                  caught instanceof Error ? caught.message : "Não foi possível criar a sala.",
              };
        setState((current) => ({ ...current, status: "error", error }));
        throw error;
      }
    },
    [],
  );

  /** Entra em uma sala existente. */
  const joinRoom = useCallback(
    async (input: {
      roomCode: string;
      name?: string;
      password?: string;
    }): Promise<RoomJoinedData> => {
      setState((current) => ({ ...current, status: "joining", error: null }));

      try {
        await ensureConnected();
        const response = await emitWithAck<RoomJoinedData>(
          socketRef.current as AppSocket,
          "room:join",
          {
            roomCode: input.roomCode,
            name: input.name,
            password: input.password,
          },
        );

        if (!response.ok) {
          const error = toRoomError(response.error);
          setState((current) => ({ ...current, status: "error", error }));
          throw error;
        }

        joinedRef.current = true;
        setState((current) => ({
          ...current,
          status: "joined",
          roomCode: response.data.roomCode,
          selfId: response.data.selfId,
          participants: response.data.participants,
          requiresPassword: response.data.requiresPassword,
          error: null,
        }));
        return response.data;
      } catch (caught) {
        const error =
          caught && typeof caught === "object" && "code" in caught
            ? (caught as RoomError)
            : {
                code: ERROR_CODES.INTERNAL,
                message:
                  caught instanceof Error ? caught.message : "Não foi possível entrar na sala.",
              };
        setState((current) => ({ ...current, status: "error", error }));
        throw error;
      }
    },
    [],
  );

  /** Sai da sala e limpa o estado local. */
  const leaveRoom = useCallback(() => {
    socketRef.current?.emit("room:leave");
    joinedRef.current = false;
    setState({ ...INITIAL_STATE, connection: "connected" });
  }, []);

  /**
   * Sai da sala ao desmontar a página.
   *
   * Importante: NÃO desconecta o socket. Ele é um singleton compartilhado com
   * a home e o React monta/desmonta componentes em StrictMode (dev), então
   * destruí-lo aqui derrubaria a conexão no meio do fluxo de entrada na sala.
   * Só avisamos o servidor que esta sala foi abandonada.
   */
  const teardown = useCallback(() => {
    socketRef.current?.emit("room:leave");
    joinedRef.current = false;
  }, []);

  const value = useMemo<RoomContextValue>(
    () => ({ state, createRoom, joinRoom, leaveRoom, teardown, socket: socketRef }),
    [state, createRoom, joinRoom, leaveRoom, teardown],
  );

  return <RoomContext.Provider value={value}>{children}</RoomContext.Provider>;
}

/** Acesso ao estado e às ações de sala. Precisa estar dentro de `<RoomProvider>`. */
export function useRoom(): RoomContextValue {
  const context = useContext(RoomContext);
  if (!context) {
    throw new Error("useRoom precisa estar dentro de <RoomProvider>.");
  }
  return context;
}
