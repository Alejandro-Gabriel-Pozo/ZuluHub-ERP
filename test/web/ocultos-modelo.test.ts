import { describe, expect, it } from "vitest";
import { armarLosOcultos } from "../../apps/web/ui/plantillas/catalogo/modelo-de-ocultos";
import {
  armarElFiltroDeOcultos,
  armarLaLista,
} from "../../apps/web/ui/plantillas/catalogo/modelo-de-productos";
import { FILTROS_POR_DEFECTO } from "../../apps/web/ui/plantillas/catalogo/filtros-de-productos";

const TODO = { local: true, empresa: true };
const SOLO_LOCAL = { local: true, empresa: false };
const o = (productoId: string, local: boolean, empresa: boolean) => ({
  productoId,
  nombre: `P ${productoId}`,
  local,
  empresa,
});

describe("armarLosOcultos (C2)", () => {
  it("cada fila lleva sus avisos (empresa primero) y el botón «Volver a mostrar»", () => {
    const l = armarLosOcultos([o("a", true, false), o("b", false, true), o("c", true, true)], TODO);
    expect(l.boton).toBe("Volver a mostrar");
    expect(l.vacio).toBeNull();
    expect(l.filas.map((f) => f.avisos)).toEqual([
      ["Oculto"],
      ["Oculto en toda la empresa"],
      ["Oculto en toda la empresa", "Oculto"],
    ]);
    expect(l.filas.every((f) => f.puede)).toBe(true);
  });

  it("sin permiso para la empresa, lo que oculta la empresa sale apagado (también si está en los dos alcances); lo del local, no", () => {
    const l = armarLosOcultos(
      [o("a", true, false), o("b", false, true), o("c", true, true)],
      SOLO_LOCAL,
    );
    expect(l.filas.map((f) => f.puede)).toEqual([true, false, false]);
  });

  it("sin ningún permiso todo sale apagado (nace cerrado)", () => {
    const l = armarLosOcultos([o("a", true, false)], { local: false, empresa: false });
    expect(l.filas[0]?.puede).toBe(false);
  });

  it("sin ocultos: «Sin resultados»", () => {
    expect(armarLosOcultos([], TODO).vacio).toBe("Sin resultados");
  });
});

describe("la lista de productos con la marca «Oculto» (C2)", () => {
  const pagina = {
    productos: ["a", "b", "c"].map((id) => ({
      id,
      nombre: id,
      claseDeUso: "VENDIBLE",
      estado: "ACTIVO",
      seccion: null,
      precio: null,
    })),
    siguiente: null,
  };
  it("marca lo oculto en el local y en la empresa; lo demás, sin marca", () => {
    const lista = armarLaLista(
      pagina,
      FILTROS_POR_DEFECTO,
      {},
      new Map([
        ["a", { local: true, empresa: false }],
        ["b", { local: true, empresa: true }],
      ]),
    );
    expect(lista.filas.map((f) => f.avisosDeOculto)).toEqual([
      ["Oculto"],
      ["Oculto en toda la empresa", "Oculto"],
      [],
    ]);
  });

  it("si no se pudo leer dónde está oculto, ninguna marca", () => {
    expect(
      armarLaLista(pagina, FILTROS_POR_DEFECTO).filas.every((f) => f.avisosDeOculto.length === 0),
    ).toBe(true);
  });

  it("el filtro «Oculto» sale solo si se pudo leer; cierra ante la duda", () => {
    expect(armarElFiltroDeOcultos(true)).toEqual({
      href: "/catalogo/productos?oculto=1",
      texto: "Oculto",
    });
    expect(armarElFiltroDeOcultos(false)).toBeNull();
  });
});
