import fc from "fast-check";
import { describe, expect, it } from "vitest";
import "../../../../test/propiedades/configuracion";
import type { LetraDeComprobante } from "./comprobante-emitido";
import {
  CONDICIONES_DE_IVA_DEL_RECEPTOR,
  condicionAdmiteLetra,
  esCondicionIvaReceptor,
  type CondicionIvaReceptor,
} from "./condicion-iva-receptor";

/**
 * Oráculo independiente del código: la tabla «Condición Frente al IVA del receptor» de WSFE v4.8
 * (l. 5712-5727), una fila por condición con las columnas que marca con X (A/ALEY, B y C).
 */
const TABLA_DEL_MANUAL: readonly (readonly [
  codigoDeArca: number,
  CondicionIvaReceptor,
  A: boolean,
  B: boolean,
  C: boolean,
])[] = [
  [1, "RESPONSABLE_INSCRIPTO", true, false, true],
  [4, "EXENTO", false, true, true],
  [5, "CONSUMIDOR_FINAL", false, true, true],
  [6, "MONOTRIBUTO", true, false, true],
  [7, "NO_CATEGORIZADO", false, true, true],
  [8, "PROVEEDOR_DEL_EXTERIOR", false, true, true],
  [9, "CLIENTE_DEL_EXTERIOR", false, true, true],
  [10, "IVA_LIBERADO_LEY_19640", false, true, true],
  [13, "MONOTRIBUTISTA_SOCIAL", true, false, true],
  [15, "IVA_NO_ALCANZADO", false, true, true],
  [16, "MONOTRIBUTO_TRABAJADOR_INDEPENDIENTE_PROMOVIDO", true, false, true],
];

const LETRAS: readonly LetraDeComprobante[] = ["A", "B", "C"];

describe("condiciones frente al IVA del receptor", () => {
  it("son las once de la tabla de WSFE v4.8, ni una más", () => {
    expect([...CONDICIONES_DE_IVA_DEL_RECEPTOR].sort()).toEqual(
      TABLA_DEL_MANUAL.map(([, nombre]) => nombre).sort(),
    );
    expect(CONDICIONES_DE_IVA_DEL_RECEPTOR).toHaveLength(11);
  });

  it("se reconocen solo los nombres exactos", () => {
    for (const c of CONDICIONES_DE_IVA_DEL_RECEPTOR) expect(esCondicionIvaReceptor(c)).toBe(true);
    for (const malo of ["", "consumidor_final", "CONSUMIDOR FINAL", "MONOTRIBUTISTA", "IVA"]) {
      expect(esCondicionIvaReceptor(malo)).toBe(false);
    }
  });

  it.each(TABLA_DEL_MANUAL)("el código %i (%s) admite A=%s B=%s C=%s", (_c, nombre, a, b, c) => {
    expect(condicionAdmiteLetra(nombre, "A")).toBe(a);
    expect(condicionAdmiteLetra(nombre, "B")).toBe(b);
    expect(condicionAdmiteLetra(nombre, "C")).toBe(c);
  });

  it("propiedad: toda condición admite exactamente una de A o B, y siempre C", () => {
    fc.assert(
      fc.property(fc.constantFrom(...CONDICIONES_DE_IVA_DEL_RECEPTOR), (condicion) => {
        expect(condicionAdmiteLetra(condicion, "A")).not.toBe(condicionAdmiteLetra(condicion, "B"));
        expect(condicionAdmiteLetra(condicion, "C")).toBe(true);
      }),
    );
  });

  it("cubre las 11 × 3 combinaciones", () => {
    const admitidas = CONDICIONES_DE_IVA_DEL_RECEPTOR.flatMap((c) =>
      LETRAS.filter((l) => condicionAdmiteLetra(c, l)).map((l) => `${c}/${l}`),
    );
    expect(admitidas).toHaveLength(22);
  });
});
