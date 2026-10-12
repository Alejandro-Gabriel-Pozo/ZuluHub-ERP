import { describe, expect, it } from "vitest";
import { PROVINCIAS, provinciaDesdeCodigo } from "./provincias";

/** Los 24 códigos de ISO 3166-2:AR (iso-codes 4.16.0), escritos a mano e independientes del catálogo. */
const CODIGOS_ISO = [
  "AR-A",
  "AR-B",
  "AR-C",
  "AR-D",
  "AR-E",
  "AR-F",
  "AR-G",
  "AR-H",
  "AR-J",
  "AR-K",
  "AR-L",
  "AR-M",
  "AR-N",
  "AR-P",
  "AR-Q",
  "AR-R",
  "AR-S",
  "AR-T",
  "AR-U",
  "AR-V",
  "AR-W",
  "AR-X",
  "AR-Y",
  "AR-Z",
];

describe("provincias", () => {
  it("son las 24 jurisdicciones de ISO 3166-2:AR, sin repetir", () => {
    expect(PROVINCIAS.map((p) => p.codigo).sort()).toEqual(CODIGOS_ISO);
  });

  it("cada código tiene la forma AR-X y cada nombre es único y sin blancos en los extremos", () => {
    for (const p of PROVINCIAS) {
      expect(p.codigo).toMatch(/^AR-[A-Z]$/);
      expect(p.nombre).toBe(p.nombre.trim());
      expect(p.nombre).not.toBe("");
    }
    expect(new Set(PROVINCIAS.map((p) => p.nombre)).size).toBe(24);
  });

  it("están ordenadas por nombre, como se ofrecen en una lista", () => {
    const nombres = PROVINCIAS.map((p) => p.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, "es")));
  });

  it("nombres de referencia", () => {
    expect(provinciaDesdeCodigo("AR-C")?.nombre).toBe("Ciudad Autónoma de Buenos Aires");
    expect(provinciaDesdeCodigo("AR-B")?.nombre).toBe("Buenos Aires");
    expect(provinciaDesdeCodigo("AR-X")?.nombre).toBe("Córdoba");
    expect(provinciaDesdeCodigo("AR-V")?.nombre).toBe("Tierra del Fuego");
    expect(provinciaDesdeCodigo("AR-Q")?.nombre).toBe("Neuquén");
  });

  it("buscar por código es exacto: lo desconocido, en minúsculas o con blancos no existe", () => {
    expect(provinciaDesdeCodigo("AR-I")).toBeNull();
    expect(provinciaDesdeCodigo("ar-x")).toBeNull();
    expect(provinciaDesdeCodigo(" AR-X")).toBeNull();
    expect(provinciaDesdeCodigo("")).toBeNull();
    expect(provinciaDesdeCodigo("X")).toBeNull();
    expect(provinciaDesdeCodigo("constructor")).toBeNull();
  });

  it("todas las del catálogo se encuentran por su código", () => {
    for (const p of PROVINCIAS) expect(provinciaDesdeCodigo(p.codigo)).toBe(p);
  });
});
