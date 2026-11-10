import { describe, expect, it } from "vitest";
import { err, ok } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  ERRORES_DE_LISTAS_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_LISTAS,
} from "./esquema";
import { errorDeListasDeRestriccion, traducirErroresDeListas } from "./traducir";

const check = (restriccion: string | null): ErrorDePersistencia => ({ tipo: "Check", restriccion });
const unicidad = (restriccion: string | null): ErrorDePersistencia => ({
  tipo: "Unicidad",
  restriccion,
});

describe("el mapa de restricciones de las listas", () => {
  it("los disparadores están en el mapa, son distintos y traducen solo lo que el usuario puede provocar", () => {
    const lista: readonly string[] = RESTRICCIONES_DE_DISPARADORES_DE_LISTAS;
    expect(new Set(lista).size).toBe(lista.length);
    for (const nombre of lista) {
      expect(Object.hasOwn(ERRORES_DE_LISTAS_POR_RESTRICCION, nombre)).toBe(true);
    }
    expect(ERRORES_DE_LISTAS_POR_RESTRICCION.valor_de_lista_fija).toBe("VALOR_FIJO");
    expect(ERRORES_DE_LISTAS_POR_RESTRICCION.valor_de_lista_inmutable).toBe("NO_TRADUCIDA");
    expect(ERRORES_DE_LISTAS_POR_RESTRICCION.valor_de_lista_nombre_uk).toBe("VALOR_DUPLICADO");
  });

  it("todo motivo es MAYÚSCULAS_CON_GUION_BAJO o NO_TRADUCIDA", () => {
    for (const [restriccion, codigo] of Object.entries(ERRORES_DE_LISTAS_POR_RESTRICCION)) {
      expect(codigo, restriccion).toMatch(/^[A-Z][A-Z_]*[A-Z]$/);
    }
  });
});

describe("errorDeListasDeRestriccion", () => {
  for (const [restriccion, codigo] of Object.entries(ERRORES_DE_LISTAS_POR_RESTRICCION)) {
    it(`${restriccion} → ${codigo}`, () => {
      for (const tipo of ["Unicidad", "Check"] as const) {
        expect(errorDeListasDeRestriccion({ tipo, restriccion })).toBe(
          codigo === "NO_TRADUCIDA" ? null : codigo,
        );
      }
    });
  }

  it("sin nombre, con uno desconocido, con uno del prototipo o con otro tipo de error no hay traducción", () => {
    expect(errorDeListasDeRestriccion(check(null))).toBeNull();
    expect(errorDeListasDeRestriccion(check("no_existe"))).toBeNull();
    expect(errorDeListasDeRestriccion(unicidad("constructor"))).toBeNull();
    expect(errorDeListasDeRestriccion(unicidad("toString"))).toBeNull();
    for (const tipo of ["Superposicion", "Referencia"] as const) {
      expect(
        errorDeListasDeRestriccion({ tipo, restriccion: "valor_de_lista_nombre_uk" }),
      ).toBeNull();
    }
    for (const error of [
      { tipo: "AccesoDenegado" },
      { tipo: "ConcurrenciaAgotada" },
      { tipo: "Inesperado", sqlstate: null, mensaje: "x" },
    ] as const) {
      expect(errorDeListasDeRestriccion(error)).toBeNull();
    }
  });
});

describe("traducirErroresDeListas", () => {
  it("vuelve motivo la restricción que el caso admite; el resto pasa sin cambios", () => {
    expect(
      traducirErroresDeListas(err(unicidad("valor_de_lista_nombre_uk")), ["VALOR_DUPLICADO"]),
    ).toEqual(err("VALOR_DUPLICADO"));
    expect(traducirErroresDeListas(err(check("valor_de_lista_fija")), ["VALOR_FIJO"])).toEqual(
      err("VALOR_FIJO"),
    );
    // No la admite: sale tal cual, nunca disfrazada.
    const sinAdmitir = err(unicidad("valor_de_lista_nombre_uk"));
    expect(traducirErroresDeListas(sinAdmitir, ["VALOR_FIJO"])).toBe(sinAdmitir);
    const otraBase = err({ tipo: "AccesoDenegado" } as const);
    expect(traducirErroresDeListas(otraBase, ["VALOR_DUPLICADO"])).toBe(otraBase);
    const deNegocio = err("VALOR_NO_ENCONTRADO");
    expect(traducirErroresDeListas(deNegocio, ["VALOR_DUPLICADO"])).toBe(deNegocio);
    const exito = ok(1);
    expect(traducirErroresDeListas(exito, ["VALOR_DUPLICADO"])).toBe(exito);
    const noTraducida = err(check("valor_de_lista_inmutable"));
    expect(traducirErroresDeListas(noTraducida, ["VALOR_DUPLICADO", "VALOR_FIJO"])).toBe(
      noTraducida,
    );
  });
});
