/**
 * Constantes de domínio e limites operacionais.
 *
 * Estes valores são usados pelo frontend (para UX) e pelo backend (para
 * validação real). A autoridade final é sempre o backend.
 */

/** Tamanho do código de sala, ex.: "K7M2QX". */
export const ROOM_CODE_LENGTH = 6;

/**
 * Alfabeto sem caracteres ambíguos (sem I, L, O, 0, 1). Facilita leitura e
 * digitação manual do código em conversas de texto.
 */
export const ROOM_CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

/** Nome máximo de participante. Valores maiores são truncados no servidor. */
export const MAX_NAME_LENGTH = 24;

/** Senha máxima de sala. */
export const MAX_PASSWORD_LENGTH = 64;

/** Mínimo de caracteres para uma senha de sala ter utilidade. */
export const MIN_PASSWORD_LENGTH = 4;

/**
 * Não há limite de participantes por sala (decisão de produto).
 *
 * A topologia é malha (mesh): cada participante mantém uma conexão WebRTC por
 * par e quem compartilha sobe N-1 streams de vídeo simultâneos. Sem teto
 * imposto pelo servidor, o gargalo passa a ser o uplink e o navegador de quem
 * compartilha — o congestion control do WebRTC degrada a qualidade antes de
 * quebrar a conexão. O abuso de criação/entrada continua contido pelo rate
 * limit por IP (CREATE_ROOM_RATE / JOIN_ROOM_RATE).
 */

/** Tamanho máximo de um payload SDP aceito pelo relay de sinalização. */
export const MAX_SDP_LENGTH = 64 * 1024;

/** Tamanho máximo de um payload de candidato ICE aceito. */
export const MAX_ICE_CANDIDATE_LENGTH = 4 * 1024;

/** Janela e limite de criação de salas por IP. */
export const CREATE_ROOM_RATE = { limit: 10, windowMs: 60_000 } as const;

/** Janela e limite de tentativas de entrada por IP. */
export const JOIN_ROOM_RATE = { limit: 30, windowMs: 60_000 } as const;

/**
 * Tempo após o qual uma sala vazia é removida da memória.
 * Também cobre o caso de o criador nunca ter entrado (link aberto e abandonado).
 */
export const EMPTY_ROOM_TTL_MS = 10 * 60 * 1000;

/** Intervalo do varredor periódico de salas expiradas. */
export const ROOM_SWEEP_INTERVAL_MS = 30_000;

/** Nome usado quando o participante não informa um. */
export const DEFAULT_PARTICIPANT_NAME = "Convidado";
