import { describe, expect, it } from "vitest";
import { armarElCierre } from "../../apps/web/ui/plantillas/produccion/modelo-de-cierre-de-orden";
import { rutaDeCierreDeLaOrden } from "../../apps/web/ui/plantillas/produccion/filtros-de-ordenes";

/**
 * El modelo de vista de «Cerrar con lo real»: cada ingrediente con su unidad y lo esperado como valor inicial (sin ceros de relleno), lo obtenido con lo esperado de valor inicial, los textos del catálogo (ninguno
 * nuevo) y adónde vuelve «Cancelar». Puro: sin React ni servidor.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const ORDEN = {
  id: ID,
  numero: 14,
  nombre: "Masa de medialuna",
  unidadId: "KILOGRAMO",
  cantidadEsperada: "16.0000",
  renglones: [
    { nombre: "Harina 000", esperado: "12.0000", unidadId: "KILOGRAMO" },
    { nombre: "Manteca", esperado: "2.5000", unidadId: "KILOGRAMO" },
    { nombre: "Sal", esperado: "0.0000", unidadId: "GRAMO" },
  ],
};

describe("armarElCierre", () => {
  it("un renglón por ingrediente, con su unidad dicha y lo esperado sin ceros de relleno como valor inicial", () => {
    expect(armarElCierre(ORDEN).renglones).toEqual([
      { etiqueta: "Harina 000 (Kilogramo)", inicial: "12" },
      { etiqueta: "Manteca (Kilogramo)", inicial: "2.5" },
      { etiqueta: "Sal (Gramo)", inicial: "0" },
    ]);
  });

  it("lo obtenido arranca con lo esperado, en la unidad del producto, y el producto se nombra", () => {
    const c = armarElCierre(ORDEN);
    expect(c.producto).toBe("Masa de medialuna");
    expect(c.unidad).toBe("Kilogramo");
    expect(c.obtenidoInicial).toBe("16");
  });

  it("una unidad que la pantalla no conoce se dice con el propio valor", () => {
    const c = armarElCierre({
      ...ORDEN,
      unidadId: "BARRIL",
      renglones: [{ nombre: "Salsa", esperado: "1.0000", unidadId: "BARRIL" }],
    });
    expect(c.unidad).toBe("BARRIL");
    expect(c.renglones[0]?.etiqueta).toBe("Salsa (BARRIL)");
  });

  it("usa solo los textos ya aprobados del catálogo y «Cancelar» vuelve a la ficha de la orden", () => {
    const c = armarElCierre(ORDEN);
    expect(c.textos).toEqual({
      obtenido: "Cantidad obtenida",
      vence: "Vence",
      consumio: "Consumió",
      cerrar: "Cerrar la orden",
      producirIgual: "Producir igual",
      cancelar: "Cancelar",
    });
    expect(c.hrefDeCancelar).toBe(`/catalogo/produccion/${ID}`);
  });

  it("sin ingredientes, sin renglones", () => {
    expect(armarElCierre({ ...ORDEN, renglones: [] }).renglones).toEqual([]);
  });
});

describe("la dirección del cierre", () => {
  it("cuelga de la ficha de la orden", () => {
    expect(rutaDeCierreDeLaOrden(ID)).toBe(`/catalogo/produccion/${ID}/cerrar`);
  });
});
