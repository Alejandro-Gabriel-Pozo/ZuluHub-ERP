import { describe, expect, it } from "vitest";
import { UNIDADES } from "../../src/primitivas/unidades/unidades";
import {
  armarElPedido,
  cambiosAlElegirComoSeCompra,
  opcionesDeComoSeCompra,
  opcionesDePrecioPor,
  PRECIO_POR_LA_PRESENTACION,
  presentacionElegida,
  renglonCompleto,
  valorDeComoSeCompra,
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
      presentaciones: [],
      presentacionId: "",
      pesoReal: "",
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
        presentacionId: null,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2.5",
        pesoReal: null,
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

describe("modelo de «Nueva compra»: presentaciones (T0b)", () => {
  const caja = { id: "pr-caja", nombre: "Caja ×12", cantidad: "12.0000", dePesoVariable: false };
  const pieza = { id: "pr-pieza", nombre: "Pieza", cantidad: "4.0000", dePesoVariable: true };
  const gaseosa = {
    productoId: "p2",
    nombre: "Gaseosa",
    unidadBase: "UNIDAD",
    presentaciones: [caja],
  };
  const carne = { ...bife, presentaciones: [pieza] };

  it("«por la presentación» no se confunde con ninguna unidad", () => {
    expect(Object.hasOwn(UNIDADES, PRECIO_POR_LA_PRESENTACION)).toBe(false);
  });

  it("sin presentaciones el selector ofrece lo de siempre", () => {
    const r = renglonNuevo(1, bife);
    expect(opcionesDeComoSeCompra(r)).toEqual(opcionesDeUnidad("KILOGRAMO"));
    expect(opcionesDePrecioPor(r)).toEqual(opcionesDeUnidad("KILOGRAMO"));
    expect(valorDeComoSeCompra(r)).toBe("KILOGRAMO");
    expect(presentacionElegida(r)).toBeNull();
  });

  it("ofrece las presentaciones primero y después las unidades; el rótulo sale del dato", () => {
    const opciones = opcionesDeComoSeCompra(renglonNuevo(1, gaseosa));
    expect(opciones[0]).toEqual({
      valor: "presentacion:pr-caja",
      etiqueta: "Caja ×12 (12 Unidad)",
      apagada: false,
    });
    expect(opciones).toHaveLength(1 + opcionesDeUnidad("UNIDAD").length);
  });

  it("elegir una presentación fija la unidad base, limpia el peso y manda su id; el pedido sale «por unidad» hasta elegir «Precio por» la presentación", () => {
    const r0 = { ...renglonNuevo(1, gaseosa), cantidad: "3" };
    const r = { ...r0, ...cambiosAlElegirComoSeCompra(r0, "presentacion:pr-caja") };
    expect(valorDeComoSeCompra(r)).toBe("presentacion:pr-caja");
    expect(renglonesParaCotizar([r])).toEqual([
      {
        productoId: "p2",
        presentacionId: "pr-caja",
        unidadDeCompraId: "UNIDAD",
        cantidad: "3",
        pesoReal: null,
        precioPor: "UNIDAD",
        unidadDePrecioId: null,
        precio: null,
      },
    ]);
    expect(opcionesDePrecioPor(r)[0]).toEqual({
      valor: PRECIO_POR_LA_PRESENTACION,
      etiqueta: "Caja ×12",
      apagada: false,
    });
  });

  it("precio por la presentación: sale precioPor PRESENTACION y sin unidad de precio", () => {
    const r0 = { ...renglonNuevo(1, gaseosa), cantidad: "2", precio: "12000.00" };
    const r1 = { ...r0, ...cambiosAlElegirComoSeCompra(r0, "presentacion:pr-caja") };
    const r = { ...r1, unidadDePrecio: PRECIO_POR_LA_PRESENTACION };
    expect(renglonesParaCotizar([r])[0]).toMatchObject({
      presentacionId: "pr-caja",
      precioPor: "PRESENTACION",
      unidadDePrecioId: null,
      precio: "12000.00",
    });
  });

  it("volver a una unidad borra la presentación y el peso, y un «Precio por» la presentación vuelve a la base", () => {
    const r0 = { ...renglonNuevo(1, carne), cantidad: "2" };
    const r1 = { ...r0, ...cambiosAlElegirComoSeCompra(r0, "presentacion:pr-pieza") };
    const r2 = { ...r1, pesoReal: "8.5", unidadDePrecio: PRECIO_POR_LA_PRESENTACION };
    const r3 = { ...r2, ...cambiosAlElegirComoSeCompra(r2, "KILOGRAMO") };
    expect(r3).toMatchObject({
      presentacionId: "",
      pesoReal: "",
      unidadDeCompra: "KILOGRAMO",
      unidadDePrecio: "KILOGRAMO",
    });
    expect(renglonesParaCotizar([r3])[0]).toMatchObject({ presentacionId: null, pesoReal: null });
  });

  it("«Recibir» (sin presentaciones) no ofrece ninguna aunque el producto las tenga", () => {
    const r = renglonNuevo(1, gaseosa, false);
    expect(r.presentaciones).toEqual([]);
    expect(opcionesDeComoSeCompra(r)).toEqual(opcionesDeUnidad("UNIDAD"));
  });

  it("una presentación que no es de las ofrecidas no se supone: no cambia nada", () => {
    const r = renglonNuevo(1, gaseosa);
    expect(cambiosAlElegirComoSeCompra(r, "presentacion:otra")).toEqual({});
  });

  it("peso variable: sin peso el renglón está incompleto (no se cotiza ni cuenta para el total); con peso sale el pesoReal", () => {
    const r0 = { ...renglonNuevo(1, carne), cantidad: "2" };
    const r = { ...r0, ...cambiosAlElegirComoSeCompra(r0, "presentacion:pr-pieza") };
    expect(renglonCompleto(r)).toBe(false);
    expect(renglonesParaCotizar([r])).toEqual([]);
    expect(totalDelPie([r], { renglones: [], total: "1.00" }, "Sin precio")).toBeNull();
    const conPeso = { ...r, pesoReal: "8.5" };
    expect(renglonCompleto(conPeso)).toBe(true);
    expect(renglonesParaCotizar([conPeso])[0]).toMatchObject({
      presentacionId: "pr-pieza",
      pesoReal: "8.5",
    });
  });

  it("peso fijo: aunque quedara un peso escrito, no se manda (el servidor lo rechaza)", () => {
    const r0 = { ...renglonNuevo(1, gaseosa), cantidad: "2" };
    const r = {
      ...r0,
      ...cambiosAlElegirComoSeCompra(r0, "presentacion:pr-caja"),
      pesoReal: "5",
    };
    expect(renglonesParaCotizar([r])[0]).toMatchObject({ pesoReal: null });
  });
});
