import { describe, expect, it } from "vitest";
import {
  CANTIDAD_MAXIMA_DE_COMPONENTE,
  CANTIDAD_MINIMA_DE_COMPONENTE,
  elegiblesDeSeccion,
  validarContenidoDeConjunto,
  type CandidatoDeSeccion,
  type ComponenteDeConjunto,
} from "./conjuntos";
import { opcionId, productoId, seccionDeCartaId } from "./identificadores";

const SECCION = seccionDeCartaId("seccion-bebidas");
const OTRA = seccionDeCartaId("seccion-postres");
const fijo = (cantidad: number): ComponenteDeConjunto => ({
  tipo: "FIJO",
  cantidad,
  productoId: productoId("p-funghi"),
  varianteOpcionId: null,
});
const eleccion = (cantidad: number): ComponenteDeConjunto => ({
  tipo: "ELECCION_EN_SECCION",
  cantidad,
  seccionDeCartaId: SECCION,
});

describe("validarContenidoDeConjunto", () => {
  it("un combo sin componentes no se guarda", () => {
    expect(validarContenidoDeConjunto([])).toEqual({
      ok: false,
      error: { codigo: "CONJUNTO_SIN_COMPONENTES" },
    });
  });

  it("acepta las cantidades enteras de 1 a 9, fijas y a elegir, y devuelve el mismo contenido", () => {
    const contenido = [
      fijo(CANTIDAD_MINIMA_DE_COMPONENTE),
      eleccion(CANTIDAD_MAXIMA_DE_COMPONENTE),
      {
        tipo: "FIJO",
        cantidad: 2,
        productoId: productoId("p-cafe"),
        varianteOpcionId: opcionId("o-chico"),
      } as const,
    ];
    expect(validarContenidoDeConjunto(contenido)).toEqual({ ok: true, valor: contenido });
  });

  it("rechaza cantidad 0, 10, negativa, con decimales y no numérica, y dice en qué posición (desde 1)", () => {
    for (const cantidad of [0, 10, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(validarContenidoDeConjunto([fijo(1), eleccion(cantidad)]), String(cantidad)).toEqual({
        ok: false,
        error: { codigo: "CANTIDAD_INVALIDA", posicion: 2 },
      });
    }
    expect(validarContenidoDeConjunto([fijo(0)])).toEqual({
      ok: false,
      error: { codigo: "CANTIDAD_INVALIDA", posicion: 1 },
    });
  });

  it("los límites son 1 y 9", () => {
    expect(CANTIDAD_MINIMA_DE_COMPONENTE).toBe(1);
    expect(CANTIDAD_MAXIMA_DE_COMPONENTE).toBe(9);
  });
});

const candidato = (id: string, cambios: Partial<CandidatoDeSeccion> = {}): CandidatoDeSeccion => ({
  productoId: productoId(id),
  claseDeProducto: "SIMPLE",
  activo: true,
  seVende: true,
  seccionDeCartaId: SECCION,
  grupos: [],
  conPrecioVigente: true,
  agotado: false,
  ...cambios,
});

describe("elegiblesDeSeccion", () => {
  it("entran los productos simples, activos, que se venden, de la sección, sin tamaños, con precio y no agotados, en el orden de la entrada", () => {
    expect(elegiblesDeSeccion(SECCION, [candidato("b"), candidato("a")])).toEqual(["b", "a"]);
  });

  it("cada condición excluye por sí sola", () => {
    const excluidos: Partial<CandidatoDeSeccion>[] = [
      { claseDeProducto: "CONJUNTO" },
      { activo: false },
      { seVende: false },
      { seccionDeCartaId: OTRA },
      { seccionDeCartaId: null },
      { grupos: [{ clase: "VARIANTE", activo: true }] },
      { conPrecioVigente: false },
      { agotado: true },
    ];
    for (const cambio of excluidos) {
      expect(elegiblesDeSeccion(SECCION, [candidato("x", cambio)]), JSON.stringify(cambio)).toEqual(
        [],
      );
    }
  });

  it("un grupo de tamaños inactivo no excluye, y los grupos de otra clase tampoco", () => {
    const grupos = [
      { clase: "VARIANTE", activo: false },
      { clase: "INCLUIDA", activo: true },
      { clase: "ADICIONAL", activo: true },
    ] as const;
    expect(elegiblesDeSeccion(SECCION, [candidato("x", { grupos })])).toEqual(["x"]);
  });

  it("sin candidatos no hay elegibles", () => {
    expect(elegiblesDeSeccion(SECCION, [])).toEqual([]);
  });
});
