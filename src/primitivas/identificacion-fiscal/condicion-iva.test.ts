import { describe, expect, it } from "vitest";
import { CONDICIONES_DE_IVA, esCondicionIva } from "./condicion-iva";

/** Los nombres de la tabla «Condición Frente al IVA del receptor» de WSFE v4.8 (l. 5712-5727), con su código. */
const TABLA_DEL_MANUAL = [
  [1, "RESPONSABLE_INSCRIPTO"],
  [4, "EXENTO"],
  [5, "CONSUMIDOR_FINAL"],
  [6, "MONOTRIBUTO"],
  [7, "NO_CATEGORIZADO"],
  [8, "PROVEEDOR_DEL_EXTERIOR"],
  [9, "CLIENTE_DEL_EXTERIOR"],
  [10, "IVA_LIBERADO_LEY_19640"],
  [13, "MONOTRIBUTISTA_SOCIAL"],
  [15, "IVA_NO_ALCANZADO"],
  [16, "MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO"],
] as const;

describe("condiciones frente al IVA", () => {
  it("son las once de la tabla de WSFE v4.8, ni una más y sin repetir", () => {
    expect([...CONDICIONES_DE_IVA].sort()).toEqual(TABLA_DEL_MANUAL.map(([, n]) => n).sort());
    expect(new Set(CONDICIONES_DE_IVA).size).toBe(11);
    expect(CONDICIONES_DE_IVA).toHaveLength(11);
  });

  it.each(TABLA_DEL_MANUAL)("el código %i es %s y se reconoce", (_codigo, nombre) => {
    expect(esCondicionIva(nombre)).toBe(true);
  });

  it.each([
    "",
    " ",
    "consumidor_final",
    "Consumidor_Final",
    "CONSUMIDOR FINAL",
    " CONSUMIDOR_FINAL",
    "CONSUMIDOR_FINAL ",
    "MONOTRIBUTISTA",
    "IVA",
    "constructor",
    "toString",
    "__proto__",
  ])("no se reconoce %j", (texto) => {
    expect(esCondicionIva(texto)).toBe(false);
  });
});
