import { describe, expect, it } from "vitest";
import {
  ESTADOS_DE_PARTE,
  NATURALEZAS_DE_PARTE,
  TRANSICIONES_DE_PARTE,
  esNaturalezaDeParte,
  transicionDePartePermitida,
} from "./estados";

describe("estados y naturalezas de una parte", () => {
  it("las listas son las del DDL", () => {
    expect([...NATURALEZAS_DE_PARTE]).toEqual(["HUMANA", "JURIDICA"]);
    expect([...ESTADOS_DE_PARTE]).toEqual(["ACTIVA", "INACTIVA", "ANONIMIZADA"]);
  });

  it("la tabla de transiciones es exactamente la del disparador de la base", () => {
    expect(TRANSICIONES_DE_PARTE).toEqual({
      ACTIVA: ["INACTIVA", "ANONIMIZADA"],
      INACTIVA: ["ACTIVA", "ANONIMIZADA"],
      ANONIMIZADA: [],
    });
  });

  it("recorre las nueve combinaciones", () => {
    const permitidas = new Set([
      "ACTIVA>INACTIVA",
      "ACTIVA>ANONIMIZADA",
      "INACTIVA>ACTIVA",
      "INACTIVA>ANONIMIZADA",
    ]);
    for (const desde of ESTADOS_DE_PARTE) {
      for (const hacia of ESTADOS_DE_PARTE) {
        expect(transicionDePartePermitida(desde, hacia), `${desde}>${hacia}`).toBe(
          permitidas.has(`${desde}>${hacia}`),
        );
      }
    }
  });

  it("esNaturalezaDeParte solo admite las dos", () => {
    expect(esNaturalezaDeParte("HUMANA")).toBe(true);
    expect(esNaturalezaDeParte("JURIDICA")).toBe(true);
    for (const texto of ["humana", "", "OTRA", "HUMANA "])
      expect(esNaturalezaDeParte(texto)).toBe(false);
  });
});
