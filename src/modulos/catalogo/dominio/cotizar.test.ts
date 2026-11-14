import fc from "fast-check";
import { describe, expect, it } from "vitest";
import { empresaId, sucursalId } from "../../../primitivas/identificadores/marca";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  armarInstantanea,
  comprobarCantidad,
  comprobarQueSeVende,
  elegirOpciones,
  tienePrecioParaLaCarta,
  type GrupoConOpciones,
} from "./cotizar";
import {
  grupoDeEleccionesId,
  opcionId,
  precioDeVentaId,
  productoId,
  versionDeOpcionId,
} from "./identificadores";
import type { FilaDePrecio, Grupo, Opcion, Producto } from "./modelo";

const SUC = sucursalId("s1");
const producto = (extra: Partial<Producto> = {}): Producto => ({
  id: productoId("p1"),
  empresaId: empresaId("e1"),
  nombre: "Café con leche",
  nombreDeCocina: null,
  descripcionEnCarta: null,
  codigo: null,
  codigoDeBarras: null,
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  unidadDeVentaId: "UNIDAD",
  pasoMinimo: "1.0000",
  porcionesOfrecidas: [],
  alicuota: "21",
  faltaCompletar: false,
  seVende: true,
  seccionDeCartaId: null,
  activo: true,
  versionDeOpciones: 0,
  version: 1,
  ...extra,
});
const grupo = (id: string, extra: Partial<Grupo> = {}): Grupo => ({
  id: grupoDeEleccionesId(id),
  productoId: productoId("p1"),
  clase: "ADICIONAL",
  esTamano: false,
  nombre: id,
  esObligatorio: false,
  admiteVarias: true,
  seMuestraEnCarta: true,
  orden: 0,
  activo: true,
  ...extra,
});
const opcion = (id: string, g: string, extra: Partial<Opcion> = {}): Opcion => ({
  id: opcionId(id),
  grupoId: grupoDeEleccionesId(g),
  orden: 0,
  activa: true,
  versionId: versionDeOpcionId(`v-${id}`),
  numero: 1,
  nombre: id,
  recargo: "0.000000",
  factorDeTamano: "1.0000",
  ...extra,
});
const fila = (
  id: string,
  precio: string | null,
  extra: Partial<FilaDePrecio> = {},
): FilaDePrecio => ({
  id: precioDeVentaId(id),
  productoId: productoId("p1"),
  opcionId: null,
  sucursalId: null,
  precio,
  unidadId: "UNIDAD",
  pasoMinimo: "1.0000",
  vigenteDesde: new Date("2026-01-01T00:00:00Z"),
  ...extra,
});
const cantidad = cantidadDesdeTexto("1");

describe("el producto está para venderse", () => {
  it("activo, de clase que vende y con alícuota; la alta rápida no vende (D2)", () => {
    expect(comprobarQueSeVende(producto())).toMatchObject({ ok: true });
    expect(comprobarQueSeVende(producto({ activo: false }))).toEqual({
      ok: false,
      error: "PRODUCTO_INACTIVO",
    });
    expect(comprobarQueSeVende(producto({ claseDeUso: "INSUMO", alicuota: null }))).toEqual({
      ok: false,
      error: "PRODUCTO_NO_VENDIBLE",
    });
    expect(comprobarQueSeVende(producto({ alicuota: null }))).toEqual({
      ok: false,
      error: "PRODUCTO_SIN_ALICUOTA",
    });
    expect(comprobarQueSeVende(producto({ faltaCompletar: true }))).toEqual({
      ok: false,
      error: "PRODUCTO_SIN_ALICUOTA",
    });
  });
});

describe("la cantidad (D8)", () => {
  it("texto decimal exacto, mayor que cero y múltiplo del paso", () => {
    const medio = producto({ pasoMinimo: "0.5000" });
    expect(comprobarCantidad(medio, "1.5")).toMatchObject({ ok: true });
    expect(comprobarCantidad(medio, "1.25")).toEqual({
      ok: false,
      error: "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO",
    });
    expect(comprobarCantidad(producto(), "0.5")).toEqual({
      ok: false,
      error: "CANTIDAD_NO_ES_MULTIPLO_DEL_PASO",
    });
    for (const mala of ["0", "-1", "abc", "", "1e2", "1.00001"]) {
      expect(comprobarCantidad(producto(), mala), mala).toEqual({
        ok: false,
        error: "CANTIDAD_INVALIDA",
      });
    }
  });
  it("la cantidad tiene que convertir exacta a la unidad base", () => {
    const g = producto({
      unidadBaseId: "KILOGRAMO",
      unidadDeVentaId: "GRAMO",
      pasoMinimo: "0.0001",
    });
    expect(comprobarCantidad(g, "0.0001")).toEqual({ ok: false, error: "CONVERSION_NO_EXACTA" });
    expect(
      comprobarCantidad(producto({ unidadBaseId: "KILOGRAMO", unidadDeVentaId: "GRAMO" }), "5"),
    ).toMatchObject({ ok: true });
  });
});

describe("elegir opciones", () => {
  const tamano: GrupoConOpciones = {
    grupo: grupo("tam", {
      clase: "VARIANTE",
      esTamano: true,
      esObligatorio: true,
      admiteVarias: false,
    }),
    opciones: [opcion("chico", "tam"), opcion("grande", "tam")],
  };
  const extras: GrupoConOpciones = {
    grupo: grupo("ext"),
    opciones: [
      opcion("leche", "ext", { recargo: "600.000000" }),
      opcion("viejo", "ext", { activa: false }),
    ],
  };
  it("exige la variante, no admite de más ni repetidas ni ajenas ni inactivas", () => {
    expect(elegirOpciones([tamano, extras], ["chico", "leche"])).toMatchObject({ ok: true });
    expect(elegirOpciones([tamano, extras], ["leche"])).toEqual({
      ok: false,
      error: { error: "OPCIONES_INCOMPLETAS", grupoId: "tam" },
    });
    expect(elegirOpciones([tamano, extras], ["chico", "grande"])).toEqual({
      ok: false,
      error: { error: "OPCIONES_DE_MAS", grupoId: "tam" },
    });
    expect(elegirOpciones([tamano, extras], ["chico", "chico"])).toEqual({
      ok: false,
      error: "OPCION_REPETIDA",
    });
    expect(elegirOpciones([tamano, extras], ["chico", "otra"])).toEqual({
      ok: false,
      error: { error: "OPCION_INVALIDA", opcionId: "otra" },
    });
    expect(elegirOpciones([tamano, extras], ["chico", "viejo"])).toEqual({
      ok: false,
      error: { error: "OPCION_INVALIDA", opcionId: "viejo" },
    });
  });
  it("un grupo desactivado no exige nada y sus opciones no se eligen", () => {
    const apagado: GrupoConOpciones = { ...tamano, grupo: { ...tamano.grupo, activo: false } };
    expect(elegirOpciones([apagado], [])).toMatchObject({ ok: true });
    expect(elegirOpciones([apagado], ["chico"])).toMatchObject({ ok: false });
  });
});

describe("armar la instantánea (F2 a F5, F7, F8)", () => {
  const tamano: GrupoConOpciones = {
    grupo: grupo("tam", {
      clase: "VARIANTE",
      esTamano: true,
      esObligatorio: true,
      admiteVarias: false,
    }),
    opciones: [
      opcion("chico", "tam", { factorDeTamano: "1.0000" }),
      opcion("grande", "tam", { factorDeTamano: "1.5000" }),
    ],
  };
  const extras: GrupoConOpciones = {
    grupo: grupo("ext"),
    opciones: [opcion("leche", "ext", { recargo: "600.000000" })],
  };
  const armar = (
    opcionIds: string[],
    base: FilaDePrecio | null,
    propios: Array<[string, FilaDePrecio | null]> = [],
    p = producto(),
  ) => {
    const e = elegirOpciones([tamano, extras], opcionIds);
    if (!e.ok) throw new Error("elección inválida de prueba");
    return armarInstantanea({
      producto: p,
      sucursalId: SUC,
      cantidad,
      elegidas: e.valor,
      precioBase: base,
      recargosDeSucursal: new Map(propios),
    });
  };

  it("F3: chico 3000 + adicional 600 = 3600; grande 4000 + 600 = 4600, suma exacta como texto", () => {
    expect(armar(["chico", "leche"], fila("pc", "3000.000000"))).toMatchObject({
      ok: true,
      valor: {
        precioBase: "3000.000000",
        precioUnitario: "3600.000000",
        origenDelPrecio: "EMPRESA",
        precioId: "pc",
      },
    });
    expect(armar(["grande", "leche"], fila("pg", "4000.000000"))).toMatchObject({
      ok: true,
      valor: {
        precioUnitario: "4600.000000",
        variante: { esTamano: true, factorDeTamano: "1.5000", versionDeOpcionId: "v-grande" },
      },
    });
  });
  it("F2: el precio propio de la sucursal da origen SUCURSAL", () => {
    expect(armar(["chico"], fila("ps", "3600.000000", { sucursalId: SUC }))).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "SUCURSAL", precioUnitario: "3600.000000" },
    });
  });
  it("F7: el recargo propio de la sucursal pisa al de la empresa y cada opción dice su origen", () => {
    const propio = fila("rs", "800.000000", { sucursalId: SUC, opcionId: opcionId("leche") });
    const r = armar(["chico", "leche"], fila("pc", "3000.000000"), [["leche", propio]]);
    expect(r).toMatchObject({
      ok: true,
      valor: {
        precioUnitario: "3800.000000",
        opciones: [{ recargo: "800.000000", origenDelRecargo: "SUCURSAL" }],
      },
    });
    // Volver al de la empresa: la fila nula (o ninguna) no cuenta.
    const volvio = armar(["chico", "leche"], fila("pc", "3000.000000"), [
      ["leche", fila("rn", null, { sucursalId: SUC })],
    ]);
    expect(volvio).toMatchObject({
      ok: true,
      valor: {
        precioUnitario: "3600.000000",
        opciones: [{ recargo: "600.000000", origenDelRecargo: "EMPRESA" }],
      },
    });
  });
  it("F4: sin variante y sin precio es precio abierto y se vende; con la fila nula de la empresa también (169)", () => {
    const e = elegirOpciones([], []);
    if (!e.ok) throw new Error("x");
    const sin = armarInstantanea({
      producto: producto(),
      sucursalId: SUC,
      cantidad,
      elegidas: e.valor,
      precioBase: null,
      recargosDeSucursal: new Map(),
    });
    expect(sin).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "ABIERTO", precioId: null, precioBase: null, precioUnitario: null },
    });
    const nula = armarInstantanea({
      producto: producto(),
      sucursalId: SUC,
      cantidad,
      elegidas: e.valor,
      precioBase: fila("pn", null),
      recargosDeSucursal: new Map(),
    });
    expect(nula).toMatchObject({
      ok: true,
      valor: { origenDelPrecio: "ABIERTO", precioId: "pn", precioUnitario: null },
    });
  });
  it("F5: variante sin precio para el tamaño elegido", () => {
    expect(armar(["chico"], null)).toEqual({ ok: false, error: "VARIANTE_SIN_PRECIO" });
  });
  it("una fila de precio en otra forma de venta que la del producto se rechaza (defensa)", () => {
    expect(armar(["chico"], fila("p", "1", { unidadId: "GRAMO" }))).toEqual({
      ok: false,
      error: "PRECIO_EN_OTRA_FORMA_DE_VENTA",
    });
    expect(armar(["chico"], fila("p", "1", { pasoMinimo: "0.5000" }))).toEqual({
      ok: false,
      error: "PRECIO_EN_OTRA_FORMA_DE_VENTA",
    });
  });
  it("sin alícuota no hay instantánea", () => {
    expect(armar(["chico"], fila("p", "1"), [], producto({ alicuota: null }))).toEqual({
      ok: false,
      error: "PRODUCTO_SIN_ALICUOTA",
    });
  });
  it("un total que no entra en el rango se informa, no se trunca", () => {
    const grande = "999999999999.999999";
    expect(
      armar(["chico", "leche"], fila("p", grande), [
        ["leche", fila("rs", grande, { sucursalId: SUC })],
      ]),
    ).toEqual({ ok: false, error: "PRECIO_FUERA_DE_RANGO" });
  });
  it("F3 (propiedad): total = base + Σ recargos para precios y recargos al azar", () => {
    const monto = fc.bigInt({ min: 0n, max: 10n ** 10n });
    const texto = (n: bigint) =>
      `${n / 1_000_000n}.${(n % 1_000_000n).toString().padStart(6, "0")}`;
    fc.assert(
      fc.property(monto, monto, (base, recargo) => {
        const e = elegirOpciones(
          [tamano, { ...extras, opciones: [opcion("leche", "ext", { recargo: texto(recargo) })] }],
          ["chico", "leche"],
        );
        if (!e.ok) throw new Error("x");
        const r = armarInstantanea({
          producto: producto(),
          sucursalId: SUC,
          cantidad,
          elegidas: e.valor,
          precioBase: fila("p", texto(base)),
          recargosDeSucursal: new Map(),
        });
        expect(r).toMatchObject({ ok: true, valor: { precioUnitario: texto(base + recargo) } });
      }),
    );
  });
  it("F8: tienePrecioParaLaCarta: abierto no, con precio sí; con variante basta un tamaño con precio", () => {
    expect(tienePrecioParaLaCarta([null])).toBe(false);
    expect(tienePrecioParaLaCarta([fila("p", null)])).toBe(false);
    expect(tienePrecioParaLaCarta([fila("p", "10")])).toBe(true);
    expect(tienePrecioParaLaCarta([null, fila("p", null), fila("q", "10")])).toBe(true);
    expect(tienePrecioParaLaCarta([null, fila("p", null)])).toBe(false);
    expect(tienePrecioParaLaCarta([])).toBe(false);
  });
});
