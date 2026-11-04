import { randomBytes, randomInt } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ErrorDeConfiguracion } from "../adaptadores/postgres/errores";
import { leerClaveDeCertificados } from "./clave-de-certificados";

/** Claves al azar de cada corrida: ninguna es un valor de verdad. */
const hexAlAzar = () => randomBytes(32).toString("hex");
const contexto = (hex: string) => `1:${hex}`;

const mensajeDe = (llamar: () => unknown): string => {
  try {
    llamar();
  } catch (error) {
    expect(error).toBeInstanceOf(ErrorDeConfiguracion);
    return (error as Error).message;
  }
  throw new Error("tendría que haber lanzado");
};

describe("leerClaveDeCertificados", () => {
  it("acepta una clave al azar distinta de la de contexto", () => {
    const hex = hexAlAzar();
    const clave = leerClaveDeCertificados(`k1:${hex}`, contexto(hexAlAzar()));
    expect(clave.kid).toBe("k1");
    expect(clave.clave.toString("hex")).toBe(hex);
  });

  it("rechaza la misma clave que la de contexto (mismos bytes), aunque cambie el kid o las mayúsculas", () => {
    const hex = hexAlAzar();
    for (const otra of [`k1:${hex}`, `otro:${hex}`, `k1:${hex.toUpperCase()}`, ` k1:${hex} `]) {
      const mensaje = mensajeDe(() => leerClaveDeCertificados(otra, contexto(hex)));
      expect(mensaje).toContain("PEDERNAL_CLAVE_CERTIFICADOS");
      expect(mensaje).toContain("PEDERNAL_CLAVE_CONTEXTO");
      expect(mensaje).not.toContain(hex);
      expect(mensaje).not.toContain(hex.toUpperCase());
    }
  });

  it("rechaza una clave con la forma pero casi sin variedad (000…0, abab…, un solo dígito repetido)", () => {
    for (const hex of [
      "0".repeat(64),
      "ab".repeat(32),
      "0123".repeat(16),
      "012345678".padEnd(64, "8"),
    ]) {
      const mensaje = mensajeDe(() => leerClaveDeCertificados(`k1:${hex}`, contexto(hexAlAzar())));
      expect(mensaje).toContain("PEDERNAL_CLAVE_CERTIFICADOS");
      expect(mensaje).toContain("variedad");
      expect(mensaje).not.toContain(hex);
    }
  });

  it("deja pasar lo justo en la variedad: 10 caracteres distintos sí, 9 no", () => {
    const con = (distintos: number) =>
      "0123456789abcdef".slice(0, distintos).repeat(64).slice(0, 64);
    expect(() => leerClaveDeCertificados(`k1:${con(10)}`, contexto(hexAlAzar()))).not.toThrow();
    expect(() => leerClaveDeCertificados(`k1:${con(9)}`, contexto(hexAlAzar()))).toThrow(
      ErrorDeConfiguracion,
    );
  });

  it("no repite el valor ni el largo recibido en ningún rechazo", () => {
    const largos = [0, 5, 63, 65, 200];
    for (const largo of largos) {
      // Solo dígitos: tienen la forma de un hexadecimal y no pueden aparecer por casualidad en el texto del mensaje.
      const basura = Array.from({ length: largo }, () => String(randomInt(10))).join("");
      const mensaje = mensajeDe(() =>
        leerClaveDeCertificados(`k1:${basura}`, contexto(hexAlAzar())),
      );
      if (basura !== "") expect(mensaje).not.toContain(basura);
      expect(mensaje).not.toMatch(new RegExp(`\\b${largo || "NUNCA"}\\b`));
    }
    expect(mensajeDe(() => leerClaveDeCertificados(undefined, contexto(hexAlAzar())))).toContain(
      "PEDERNAL_CLAVE_CERTIFICADOS",
    );
  });

  it("si falta la de contexto, falla nombrándola (no se puede comparar)", () => {
    expect(mensajeDe(() => leerClaveDeCertificados(`k1:${hexAlAzar()}`, undefined))).toContain(
      "PEDERNAL_CLAVE_CONTEXTO",
    );
  });
});
