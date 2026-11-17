import { describe, expect, it } from "vitest";
import { LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO } from "./nombre-de-producto";
import { textoDeBusquedaDeProductoDesdeTexto } from "./termino-de-busqueda-de-producto";

describe("texto de búsqueda de productos", () => {
  it("vacío o solo blancos es «sin filtro», no un error", () => {
    expect(textoDeBusquedaDeProductoDesdeTexto("")).toEqual({ ok: true, valor: null });
    expect(textoDeBusquedaDeProductoDesdeTexto("   ")).toEqual({ ok: true, valor: null });
    expect(textoDeBusquedaDeProductoDesdeTexto(" \t")).toEqual({ ok: true, valor: null });
  });

  it("acepta un nombre parcial, con tildes, dígitos y signos de catálogo, sin exigir una letra", () => {
    for (const t of ["caf", "Café con", "7up", "2x1", "50% $500", "¿Papas?"]) {
      expect(textoDeBusquedaDeProductoDesdeTexto(t)).toEqual({ ok: true, valor: t });
    }
  });

  it("recorta los extremos", () => {
    expect(textoDeBusquedaDeProductoDesdeTexto("  pan ")).toEqual({ ok: true, valor: "pan" });
  });

  it("el tope es el del nombre del producto: justo pasa, uno más no", () => {
    const justo = "a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_PRODUCTO);
    expect(textoDeBusquedaDeProductoDesdeTexto(justo)).toEqual({ ok: true, valor: justo });
    expect(textoDeBusquedaDeProductoDesdeTexto(justo + "a")).toEqual({
      ok: false,
      error: "DEMASIADO_LARGO",
    });
  });

  it("rechaza lo que ningún nombre puede tener: controles, invisibles, < > y emojis", () => {
    for (const t of ["a\nb", "a​b", "a<b", "a>b", "a😀", "a=b", "a@b", "+a", "-a"]) {
      expect(textoDeBusquedaDeProductoDesdeTexto(t)).toEqual({
        ok: false,
        error: "CARACTER_PROHIBIDO",
      });
    }
  });
});
