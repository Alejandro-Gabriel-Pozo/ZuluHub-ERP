import { describe, expect, it } from "vitest";
import {
  armarElPedido,
  conRenglon,
  idSiguiente,
  nombreDeUnidad,
  opcionesDeUnidad,
  renglonNuevo,
  renglonesParaCotizar,
  REMITO_VACIO,
  resumenDeRenglon,
  sinLosYaAgregados,
  totalDelPie,
} from "../../apps/web/ui/plantillas/compras/nueva/modelo-de-nueva-compra";

const TEXTOS = {
  entraATuStock: "Entra a tu stock",
  costoPorUnidadDeStock: "Costo",
  sinPrecio: "Sin precio",
};
const bife = { productoId: "p1", nombre: "Bife", unidadBase: "KILOGRAMO" };

describe("modelo de «Nueva compra»", () => {
  it("compra en la unidad base y sin precio ni cantidad hasta que se escriben", () => {
    expect(renglonNuevo(1, bife)).toEqual({
      id: 1,
      productoId: "p1",
      nombre: "Bife",
      unidadBase: "KILOGRAMO",
      unidadDeCompra: "KILOGRAMO",
      cantidad: "",
      unidadDePrecio: "KILOGRAMO",
      precio: "",
    });
  });

  it("las unidades de otra dimensión aparecen apagadas y las de la misma se pueden elegir", () => {
    const opciones = opcionesDeUnidad("KILOGRAMO");
    expect(opciones.find((o) => o.valor === "GRAMO")?.apagada).toBe(false);
    expect(opciones.find((o) => o.valor === "KILOGRAMO")?.apagada).toBe(false);
    expect(opciones.find((o) => o.valor === "LITRO")?.apagada).toBe(true);
    expect(opciones.find((o) => o.valor === "UNIDAD")?.apagada).toBe(true);
  });

  it("una unidad base que el sistema no conoce no ofrece ninguna unidad", () => {
    expect(opcionesDeUnidad("PARSEC")).toEqual([]);
    expect(nombreDeUnidad("PARSEC")).toBe("");
  });

  it("al servidor sale todo como texto: sin precio no manda unidad de precio y siempre es «por unidad»", () => {
    const r = { ...renglonNuevo(1, bife), cantidad: "2.5" };
    expect(renglonesParaCotizar([r])).toEqual([
      {
        productoId: "p1",
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2.5",
        precioPor: "UNIDAD",
        unidadDePrecioId: null,
        precio: null,
      },
    ]);
    expect(
      renglonesParaCotizar([{ ...r, precio: "1800.00", unidadDePrecio: "GRAMO" }])[0],
    ).toMatchObject({
      precio: "1800.00",
      unidadDePrecioId: "GRAMO",
    });
  });

  it("solo se cotizan los renglones con cantidad, pero el pedido lleva todos: nunca se guarda otra compra que la que se ve", () => {
    const sin = renglonNuevo(1, bife);
    const con = { ...renglonNuevo(2, { ...bife, productoId: "p2" }), cantidad: "1" };
    expect(renglonesParaCotizar([sin, con])).toHaveLength(1);
    const pedido = armarElPedido("prov", null, REMITO_VACIO, [sin, con]);
    expect(pedido.renglones).toHaveLength(2);
    expect(pedido).toMatchObject({ proveedorId: "prov", depositoId: null, remito: REMITO_VACIO });
  });

  it("muestra lo que devolvió el servidor, y «Sin precio» nunca es cero", () => {
    const r = renglonNuevo(1, bife);
    expect(resumenDeRenglon(r, undefined, TEXTOS)).toBeNull();
    expect(
      resumenDeRenglon(
        r,
        {
          productoId: "p1",
          cantidadEnStock: "2.5000",
          importe: "5000.00",
          costoPorUnidadDeStock: "2000.000000",
        },
        TEXTOS,
      ),
    ).toEqual({
      entra: "Entra a tu stock: 2,5 Kilogramo",
      costo: "Costo: $ 2.000,00",
      importe: "$ 5.000,00",
    });
    expect(
      resumenDeRenglon(
        r,
        { productoId: "p1", cantidadEnStock: "2.5000", importe: null, costoPorUnidadDeStock: null },
        TEXTOS,
      ),
    ).toEqual({
      entra: "Entra a tu stock: 2,5 Kilogramo",
      costo: "Costo: Sin precio",
      importe: "Sin precio",
    });
  });

  it("un producto ya agregado no se ofrece otra vez; los ids de renglón no se repiten", () => {
    const a = renglonNuevo(1, bife);
    expect(sinLosYaAgregados([bife, { ...bife, productoId: "p2" }], [a])).toEqual([
      { ...bife, productoId: "p2" },
    ]);
    expect(idSiguiente([])).toBe(1);
    expect(idSiguiente([a, renglonNuevo(7, bife)])).toBe(8);
    expect(conRenglon([a], 1, { cantidad: "3" })[0]?.cantidad).toBe("3");
    expect(conRenglon([a], 99, { cantidad: "3" })[0]?.cantidad).toBe("");
  });

  it("el total del pie es el del servidor: «Sin precio» si falta algún precio, y nada hasta que todos los renglones tengan cantidad", () => {
    const con = { ...renglonNuevo(1, bife), cantidad: "2" };
    const sin = renglonNuevo(2, { ...bife, productoId: "p2" });
    const cotizada = (total: string | null) => ({ renglones: [], total });
    expect(totalDelPie([con], cotizada("22000.00"), "Sin precio")).toBe("$ 22.000,00");
    expect(totalDelPie([con], cotizada(null), "Sin precio")).toBe("Sin precio");
    expect(totalDelPie([con, sin], cotizada("22000.00"), "Sin precio")).toBeNull();
    expect(totalDelPie([], cotizada("1.00"), "Sin precio")).toBeNull();
    expect(totalDelPie([con], null, "Sin precio")).toBeNull();
  });
});
