import { describe, expect, it } from "vitest";
import { ROOM_CODE_ALPHABET, ROOM_CODE_LENGTH } from "../src/constants.js";
import {
  formatRoomCode,
  generateRoomCode,
  isValidRoomCode,
  normalizeRoomCode,
  sanitizeRoomCode,
} from "../src/roomCode.js";

describe("generateRoomCode", () => {
  it("gera código do comprimento padrão", () => {
    expect(generateRoomCode()).toHaveLength(ROOM_CODE_LENGTH);
  });

  it("respeita um comprimento customizado", () => {
    expect(generateRoomCode(10)).toHaveLength(10);
  });

  it("usa apenas caracteres do alfabeto permitido", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateRoomCode();
      for (const char of code) {
        expect(ROOM_CODE_ALPHABET).toContain(char);
      }
    }
  });

  it("não gera caracteres ambíguos (I, L, O, 0, 1)", () => {
    const ambiguous = ["I", "L", "O", "0", "1"];
    for (let i = 0; i < 500; i += 1) {
      const code = generateRoomCode();
      for (const char of code) {
        expect(ambiguous).not.toContain(char);
      }
    }
  });

  it("produz resultados variados (sem travar em um valor fixo)", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 300; i += 1) {
      seen.add(generateRoomCode());
    }
    // Com 6 caracteres de 31 opções, a chance de colisão em 300 amostras é
    // desprezível; exigir muitos únicos detecta germes repetidos.
    expect(seen.size).toBeGreaterThan(250);
  });

  it("distribui de forma razoavelmente uniforme o primeiro caractere", () => {
    const counts = new Map<string, number>();
    const samples = 4000;

    for (let i = 0; i < samples; i += 1) {
      const code = generateRoomCode();
      const first = code[0] as string;
      counts.set(first, (counts.get(first) ?? 0) + 1);
    }

    const base = ROOM_CODE_ALPHABET.length;
    const expected = samples / base;

    // Cada caractere deve aparecer com frequência da mesma ordem de grandeza.
    for (const count of counts.values()) {
      expect(count).toBeGreaterThan(expected * 0.5);
      expect(count).toBeLessThan(expected * 1.5);
    }
  });
});

describe("normalizeRoomCode", () => {
  it("converte para maiúsculas", () => {
    expect(normalizeRoomCode("abc234")).toBe("ABC234");
  });

  it("remove espaços", () => {
    expect(normalizeRoomCode("ABC 234")).toBe("ABC234");
    expect(normalizeRoomCode("  ABC234  ")).toBe("ABC234");
  });

  it("remove hífens", () => {
    expect(normalizeRoomCode("ABC-234")).toBe("ABC234");
  });

  it("mantém código já normalizado", () => {
    expect(normalizeRoomCode("ABC234")).toBe("ABC234");
  });
});

describe("isValidRoomCode", () => {
  it("aceita código de comprimento correto com caracteres válidos", () => {
    expect(isValidRoomCode("ABC234")).toBe(true);
  });

  it("rejeita comprimento errado", () => {
    expect(isValidRoomCode("ABC23")).toBe(false);
    expect(isValidRoomCode("ABC2345")).toBe(false);
    expect(isValidRoomCode("")).toBe(false);
  });

  it("rejeita caracteres fora do alfabeto", () => {
    expect(isValidRoomCode("ABC23I")).toBe(false);
    expect(isValidRoomCode("ABC230")).toBe(false);
    expect(isValidRoomCode("ABC231")).toBe(false);
  });

  it("rejeita caracteres minúsculos (não normalizados)", () => {
    expect(isValidRoomCode("abc234")).toBe(false);
  });

  it("rejeita caracteres especiais", () => {
    expect(isValidRoomCode("AB-234")).toBe(false);
    expect(isValidRoomCode("AB 234")).toBe(false);
    expect(isValidRoomCode("AB@234")).toBe(false);
  });
});

describe("sanitizeRoomCode", () => {
  it("devolve o código normalizado quando válido", () => {
    expect(sanitizeRoomCode("abc 234")).toBe("ABC234");
    expect(sanitizeRoomCode("ABC234")).toBe("ABC234");
  });

  it("devolve null quando inválido", () => {
    expect(sanitizeRoomCode("abc")).toBeNull();
    expect(sanitizeRoomCode("")).toBeNull();
    expect(sanitizeRoomCode("ABC230")).toBeNull();
    expect(sanitizeRoomCode("ILO01")).toBeNull();
  });

  it("aceita entrada com hífens no meio", () => {
    expect(sanitizeRoomCode("ABC-234")).toBe("ABC234");
  });
});

describe("formatRoomCode", () => {
  it("separa o código em dois blocos", () => {
    expect(formatRoomCode("ABC234")).toBe("ABC 234");
  });

  it("funciona com comprimentos ímpares", () => {
    // O código é dividido em dois blocos com o primeiro sendo o maior.
    expect(formatRoomCode("ABCDE")).toBe("ABC DE");
  });
});
