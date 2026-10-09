/** Códigos de erro estáveis usados entre web e server. */
export const ERROR_CODES = {
  /** A sala informada não existe ou já foi encerrada. */
  ROOM_NOT_FOUND: "ROOM_NOT_FOUND",
  /** A sala exige senha e nenhuma (ou a incorreta) foi informada. */
  PASSWORD_REQUIRED: "PASSWORD_REQUIRED",
  /** Formato de código de sala inválido. */
  INVALID_ROOM_CODE: "INVALID_ROOM_CODE",
  /** Tentativas excessivas deste IP. Tente novamente mais tarde. */
  RATE_LIMITED: "RATE_LIMITED",
  /** O cliente não está em nenhuma sala para a operação solicitada. */
  NOT_IN_ROOM: "NOT_IN_ROOM",
  /** O alvo da sinalização não existe mais na sala. */
  PEER_NOT_FOUND: "PEER_NOT_FOUND",
  /** Payload acima do limite aceito. */
  PAYLOAD_TOO_LARGE: "PAYLOAD_TOO_LARGE",
  /** Erro inesperado do servidor. */
  INTERNAL: "INTERNAL",
} as const;

export type ErrorCode = (typeof ERROR_CODES)[keyof typeof ERROR_CODES];

/** Mensagens de erro prontas para exibição, em português. */
export const ERROR_MESSAGES: Record<ErrorCode, string> = {
  ROOM_NOT_FOUND: "Sala não encontrada. Verifique o código e tente novamente.",
  PASSWORD_REQUIRED: "Esta sala é protegida por senha. Informe a senha para entrar.",
  INVALID_ROOM_CODE: "Código de sala inválido.",
  RATE_LIMITED: "Muitas tentativas. Aguarde um minuto antes de tentar de novo.",
  NOT_IN_ROOM: "Você não está em nenhuma sala.",
  PEER_NOT_FOUND: "A pessoa com quem você tentava conectar saiu da sala.",
  PAYLOAD_TOO_LARGE: "Dados de conexão acima do limite aceito.",
  INTERNAL: "Algo deu errado no servidor. Tente novamente.",
};

/** Converte um código de erro na mensagem amigável correspondente. */
export function toUserMessage(code: string): string {
  if (code in ERROR_MESSAGES) {
    return ERROR_MESSAGES[code as ErrorCode];
  }
  return ERROR_MESSAGES.INTERNAL;
}
