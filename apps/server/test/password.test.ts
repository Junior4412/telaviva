import { describe, expect, it } from "vitest";
import { hashPassword, safeEquals, verifyPassword } from "../src/password.js";

describe("hashPassword / verifyPassword", () => {
  it("aceita a senha correta", () => {
    const stored = hashPassword("minha-senha-123");
    expect(verifyPassword("minha-senha-123", stored)).toBe(true);
  });

  it("rejeita a senha incorreta", () => {
    const stored = hashPassword("minha-senha-123");
    expect(verifyPassword("senha-diferente", stored)).toBe(false);
  });

  it("não guarda a senha em texto puro", () => {
    const stored = hashPassword("minha-senha-123");
    expect(stored).not.toContain("minha-senha-123");
  });

  it("usa salt aleatório: duas senhas iguais geram hashes distintos", () => {
    const a = hashPassword("mesma-senha");
    const b = hashPassword("mesma-senha");
    expect(a).not.toBe(b);
    // Ambos continuam válidos para a mesma senha.
    expect(verifyPassword("mesma-senha", a)).toBe(true);
    expect(verifyPassword("mesma-senha", b)).toBe(true);
  });

  it("registra o algoritmo e parâmetros para permitir evolução do custo", () => {
    const stored = hashPassword("senha");
    const parts = stored.split("$");
    expect(parts[0]).toBe("scrypt");
    expect(parts.length).toBe(6);
    // N, r, p devem ser numéricos.
    expect(Number.parseInt(parts[1] as string, 10)).toBeGreaterThan(0);
    expect(Number.parseInt(parts[2] as string, 10)).toBeGreaterThan(0);
    expect(Number.parseInt(parts[3] as string, 10)).toBeGreaterThan(0);
  });

  it("retorna false para hash malformado em vez de lançar", () => {
    expect(verifyPassword("senha", "")).toBe(false);
    expect(verifyPassword("senha", "qualquer-coisa")).toBe(false);
    expect(verifyPassword("senha", "scrypt$1$2$3")).toBe(false);
    expect(verifyPassword("senha", "outro-algoritmo$1$8$1$aa$bb")).toBe(false);
    expect(verifyPassword("senha", "scrypt$x$y$z$!!$!!")).toBe(false);
  });

  it("retorna false quando o hash está corrompido mas o formato é válido", () => {
    const stored = hashPassword("senha");
    const parts = stored.split("$");
    // Mantém o formato mas troca o hash derivado por bytes inválidos.
    parts[5] = Buffer.from("dado-corrompido").toString("base64url");
    const corrupted = parts.join("$");

    expect(verifyPassword("senha", corrupted)).toBe(false);
  });

  it("funciona com senhas longas e caracteres especiais", () => {
    const senha = "p@ssw0rd com espaços & símbolos!#%/*+çãõé";
    const stored = hashPassword(senha);
    expect(verifyPassword(senha, stored)).toBe(true);
    expect(verifyPassword(senha + "x", stored)).toBe(false);
  });

  it("distingue senhas que diferem em um único caractere", () => {
    const stored = hashPassword("senha1");
    expect(verifyPassword("senha2", stored)).toBe(false);
  });
});

describe("safeEquals", () => {
  it("compara strings iguais", () => {
    expect(safeEquals("abc", "abc")).toBe(true);
  });

  it("compara strings diferentes", () => {
    expect(safeEquals("abc", "abd")).toBe(false);
  });

  it("compara strings de tamanhos diferentes sem lançar", () => {
    expect(safeEquals("abc", "abcdefgh")).toBe(false);
    expect(safeEquals("", "abc")).toBe(false);
  });

  it("compara strings vazias", () => {
    expect(safeEquals("", "")).toBe(true);
  });
});
