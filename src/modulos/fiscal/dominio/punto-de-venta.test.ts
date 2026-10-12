import { describe, expect, it } from "vitest";
import {
  DOMICILIO_1,
  DOMICILIO_2,
  EMISOR_1,
  EMISOR_2,
  EMPRESA,
  OTRA_EMPRESA,
  OTRA_SUCURSAL,
  SUCURSAL,
  emisor,
  puntoDeVenta,
} from "../../../../test/utilidades/fiscal";
import { puntoDeVentaId } from "./identificadores";
import {
  RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA,
  activarPuntoDeVenta,
  desactivarPuntoDeVenta,
  editarPuntoDeVenta,
  nuevoPuntoDeVenta,
  puntosDeVentaHabilitados,
  type PuntoDeVenta,
} from "./punto-de-venta";

const sucursal = { id: SUCURSAL, empresaId: EMPRESA };
const datos = { id: puntoDeVentaId("pv-1"), numero: 1, domicilioId: null };

describe("nuevoPuntoDeVenta", () => {
  it("nace INACTIVO, de la empresa del emisor y sin verificar contra ARCA", () => {
    expect(
      nuevoPuntoDeVenta({ ...datos, domicilioId: DOMICILIO_1 }, emisor(), sucursal, []),
    ).toEqual({
      ok: true,
      valor: {
        id: puntoDeVentaId("pv-1"),
        empresaId: EMPRESA,
        emisorId: EMISOR_1,
        sucursalId: SUCURSAL,
        domicilioId: DOMICILIO_1,
        numero: 1,
        estado: "INACTIVO",
        verificacionArca: "NO_VERIFICADO",
        version: 1,
      },
    });
  });

  it("puede nacer sin domicilio (pero entonces no se activa)", () => {
    const r = nuevoPuntoDeVenta(datos, emisor(), sucursal, []);
    expect(r.ok && r.valor.domicilioId).toBeNull();
  });

  it("el rango de números es el supuesto 1 a 99999 y los extremos entran", () => {
    expect(RANGO_DE_NUMERO_DE_PUNTO_DE_VENTA).toEqual({ minimo: 1, maximo: 99999 });
    expect(nuevoPuntoDeVenta({ ...datos, numero: 1 }, emisor(), sucursal, []).ok).toBe(true);
    expect(nuevoPuntoDeVenta({ ...datos, numero: 99999 }, emisor(), sucursal, []).ok).toBe(true);
  });

  it.each([0, -1, 100000, 1.5, Number.NaN, Number.POSITIVE_INFINITY])(
    "el número %s se rechaza",
    (numero) => {
      expect(nuevoPuntoDeVenta({ ...datos, numero }, emisor(), sucursal, [])).toEqual({
        ok: false,
        error: "PUNTO_DE_VENTA_NUMERO_INVALIDO",
      });
    },
  );

  it("el rango es configurable", () => {
    const rango = { minimo: 10, maximo: 20 };
    expect(nuevoPuntoDeVenta({ ...datos, numero: 9 }, emisor(), sucursal, [], rango).ok).toBe(
      false,
    );
    expect(nuevoPuntoDeVenta({ ...datos, numero: 10 }, emisor(), sucursal, [], rango).ok).toBe(
      true,
    );
    expect(nuevoPuntoDeVenta({ ...datos, numero: 20 }, emisor(), sucursal, [], rango).ok).toBe(
      true,
    );
    expect(nuevoPuntoDeVenta({ ...datos, numero: 21 }, emisor(), sucursal, [], rango).ok).toBe(
      false,
    );
  });

  it("el número es único por emisor: el mismo número en el mismo emisor se rechaza", () => {
    const existente = puntoDeVenta({ id: puntoDeVentaId("otro"), numero: 1 });
    expect(nuevoPuntoDeVenta(datos, emisor(), sucursal, [existente])).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_DUPLICADO",
    });
  });

  it("dos emisores pueden tener cada uno su punto de venta 1", () => {
    const delOtroEmisor = puntoDeVenta({
      id: puntoDeVentaId("otro"),
      emisorId: EMISOR_2,
      numero: 1,
    });
    expect(nuevoPuntoDeVenta(datos, emisor(), sucursal, [delOtroEmisor]).ok).toBe(true);
  });

  it("otro número del mismo emisor no molesta", () => {
    const existente = puntoDeVenta({ id: puntoDeVentaId("otro"), numero: 2 });
    expect(nuevoPuntoDeVenta(datos, emisor(), sucursal, [existente]).ok).toBe(true);
  });

  it("la sucursal tiene que ser de la misma empresa", () => {
    expect(
      nuevoPuntoDeVenta(datos, emisor(), { id: OTRA_SUCURSAL, empresaId: OTRA_EMPRESA }, []),
    ).toEqual({ ok: false, error: "SUCURSAL_DE_OTRA_EMPRESA" });
  });

  it("una sucursal puede tener varios puntos de venta (no hay límite en H7)", () => {
    const muchos = [1, 2, 3, 4, 5].map((n) =>
      puntoDeVenta({ id: puntoDeVentaId(`pv-${n + 10}`), numero: n + 10 }),
    );
    expect(nuevoPuntoDeVenta(datos, emisor(), sucursal, muchos).ok).toBe(true);
  });

  it("la sucursal de otra empresa se informa antes que el número inválido", () => {
    expect(
      nuevoPuntoDeVenta(
        { ...datos, numero: 0 },
        emisor(),
        { id: OTRA_SUCURSAL, empresaId: OTRA_EMPRESA },
        [],
      ),
    ).toEqual({ ok: false, error: "SUCURSAL_DE_OTRA_EMPRESA" });
  });

  it("el número inválido se informa antes que el duplicado", () => {
    const existente = puntoDeVenta({ numero: 0 });
    expect(nuevoPuntoDeVenta({ ...datos, numero: 0 }, emisor(), sucursal, [existente])).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NUMERO_INVALIDO",
    });
  });
});

describe("activar y desactivar", () => {
  it("activa con domicilio y emisor activo", () => {
    const pv = puntoDeVenta();
    expect(activarPuntoDeVenta(pv, emisor())).toEqual({
      ok: true,
      valor: { puntoDeVenta: { ...pv, estado: "ACTIVO" }, cambio: true },
    });
  });

  it("no se activa sin domicilio", () => {
    expect(activarPuntoDeVenta(puntoDeVenta({ domicilioId: null }), emisor())).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_SIN_DOMICILIO",
    });
  });

  it("no se activa con el emisor inactivo", () => {
    expect(activarPuntoDeVenta(puntoDeVenta(), emisor({ activo: false }))).toEqual({
      ok: false,
      error: "EMISOR_INACTIVO",
    });
  });

  it("sin domicilio se informa antes que el emisor inactivo", () => {
    expect(
      activarPuntoDeVenta(puntoDeVenta({ domicilioId: null }), emisor({ activo: false })),
    ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_SIN_DOMICILIO" });
  });

  it("activar uno ya activo no cambia nada (doble clic)", () => {
    const pv = puntoDeVenta({ estado: "ACTIVO" });
    expect(activarPuntoDeVenta(pv, emisor())).toEqual({
      ok: true,
      valor: { puntoDeVenta: pv, cambio: false },
    });
  });

  it("un punto de venta de otro emisor es un error de programación", () => {
    expect(() => activarPuntoDeVenta(puntoDeVenta({ emisorId: EMISOR_2 }), emisor())).toThrow(
      new RangeError("el punto de venta es de otro emisor"),
    );
  });

  it("desactiva uno activo y repetirlo no cambia nada", () => {
    const pv = puntoDeVenta({ estado: "ACTIVO" });
    expect(desactivarPuntoDeVenta(pv)).toEqual({
      puntoDeVenta: { ...pv, estado: "INACTIVO" },
      cambio: true,
    });
    const inactivo = puntoDeVenta();
    expect(desactivarPuntoDeVenta(inactivo)).toEqual({ puntoDeVenta: inactivo, cambio: false });
  });
});

describe("editarPuntoDeVenta", () => {
  const libre = { tieneNumerosUsados: false, delEmisor: [] as readonly PuntoDeVenta[] };

  it("cambia número, sucursal y domicilio", () => {
    const pv = puntoDeVenta();
    expect(
      editarPuntoDeVenta(
        pv,
        {
          numero: 7,
          sucursal: { id: OTRA_SUCURSAL, empresaId: EMPRESA },
          domicilioId: DOMICILIO_2,
        },
        libre,
      ),
    ).toEqual({
      ok: true,
      valor: {
        puntoDeVenta: { ...pv, numero: 7, sucursalId: OTRA_SUCURSAL, domicilioId: DOMICILIO_2 },
        cambio: true,
      },
    });
  });

  it("cada campo cambia por separado y no toca los otros", () => {
    const pv = puntoDeVenta();
    const soloNumero = editarPuntoDeVenta(pv, { numero: 9 }, libre);
    expect(soloNumero.ok && soloNumero.valor.puntoDeVenta).toEqual({ ...pv, numero: 9 });
    const soloSucursal = editarPuntoDeVenta(
      pv,
      { sucursal: { id: OTRA_SUCURSAL, empresaId: EMPRESA } },
      libre,
    );
    expect(soloSucursal.ok && soloSucursal.valor.puntoDeVenta).toEqual({
      ...pv,
      sucursalId: OTRA_SUCURSAL,
    });
    const soloDomicilio = editarPuntoDeVenta(pv, { domicilioId: DOMICILIO_2 }, libre);
    expect(soloDomicilio.ok && soloDomicilio.valor.puntoDeVenta).toEqual({
      ...pv,
      domicilioId: DOMICILIO_2,
    });
  });

  it("el emisor, el estado y la verificación no se tocan", () => {
    const pv = puntoDeVenta({ estado: "ACTIVO" });
    const r = editarPuntoDeVenta(pv, { numero: 5 }, libre);
    expect(r.ok && r.valor.puntoDeVenta).toMatchObject({
      emisorId: EMISOR_1,
      estado: "ACTIVO",
      verificacionArca: "NO_VERIFICADO",
    });
  });

  it("no cambiar nada es un no-op", () => {
    const pv = puntoDeVenta();
    for (const cambios of [
      {},
      { numero: 1 },
      { sucursal: sucursal },
      { domicilioId: DOMICILIO_1 },
    ]) {
      expect(editarPuntoDeVenta(pv, cambios, libre)).toEqual({
        ok: true,
        valor: { puntoDeVenta: pv, cambio: false },
      });
    }
  });

  it("con números usados el número no cambia, pero la sucursal y el domicilio sí", () => {
    const pv = puntoDeVenta();
    const usado = { ...libre, tieneNumerosUsados: true };
    expect(editarPuntoDeVenta(pv, { numero: 2 }, usado)).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NUMERO_INMUTABLE",
    });
    expect(editarPuntoDeVenta(pv, { numero: 1, domicilioId: DOMICILIO_2 }, usado).ok).toBe(true);
    expect(
      editarPuntoDeVenta(pv, { sucursal: { id: OTRA_SUCURSAL, empresaId: EMPRESA } }, usado).ok,
    ).toBe(true);
  });

  it("el número nuevo tiene que estar en rango", () => {
    expect(editarPuntoDeVenta(puntoDeVenta(), { numero: 0 }, libre)).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NUMERO_INVALIDO",
    });
    expect(editarPuntoDeVenta(puntoDeVenta(), { numero: 100000 }, libre)).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NUMERO_INVALIDO",
    });
    expect(editarPuntoDeVenta(puntoDeVenta(), { numero: 99999 }, libre).ok).toBe(true);
  });

  it("el rango es configurable al editar", () => {
    expect(
      editarPuntoDeVenta(puntoDeVenta(), { numero: 50 }, libre, { minimo: 1, maximo: 10 }),
    ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_NUMERO_INVALIDO" });
  });

  it("el número nuevo no puede ser de otro punto de venta del mismo emisor", () => {
    const otro = puntoDeVenta({ id: puntoDeVentaId("pv-2"), numero: 2 });
    expect(
      editarPuntoDeVenta(puntoDeVenta(), { numero: 2 }, { ...libre, delEmisor: [otro] }),
    ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_DUPLICADO" });
  });

  it("el número de un punto de venta de otro emisor no cuenta", () => {
    const deOtroEmisor = puntoDeVenta({
      id: puntoDeVentaId("pv-2"),
      emisorId: EMISOR_2,
      numero: 2,
    });
    expect(
      editarPuntoDeVenta(puntoDeVenta(), { numero: 2 }, { ...libre, delEmisor: [deOtroEmisor] }).ok,
    ).toBe(true);
  });

  it("él mismo en la lista no cuenta como duplicado", () => {
    const pv = puntoDeVenta();
    expect(editarPuntoDeVenta(pv, { numero: 3 }, { ...libre, delEmisor: [pv] }).ok).toBe(true);
  });

  it("la sucursal tiene que ser de la misma empresa", () => {
    expect(
      editarPuntoDeVenta(
        puntoDeVenta(),
        { sucursal: { id: OTRA_SUCURSAL, empresaId: OTRA_EMPRESA } },
        libre,
      ),
    ).toEqual({ ok: false, error: "SUCURSAL_DE_OTRA_EMPRESA" });
  });

  it("orden de los errores: sucursal, número inválido, número inmutable, duplicado", () => {
    const otro = puntoDeVenta({ id: puntoDeVentaId("pv-2"), numero: 0 });
    const contexto = { tieneNumerosUsados: true, delEmisor: [otro] };
    const ajena = { id: OTRA_SUCURSAL, empresaId: OTRA_EMPRESA };
    expect(editarPuntoDeVenta(puntoDeVenta(), { numero: 0, sucursal: ajena }, contexto)).toEqual({
      ok: false,
      error: "SUCURSAL_DE_OTRA_EMPRESA",
    });
    expect(editarPuntoDeVenta(puntoDeVenta(), { numero: 0 }, contexto)).toEqual({
      ok: false,
      error: "PUNTO_DE_VENTA_NUMERO_INVALIDO",
    });
    const otro2 = puntoDeVenta({ id: puntoDeVentaId("pv-2"), numero: 2 });
    expect(
      editarPuntoDeVenta(
        puntoDeVenta(),
        { numero: 2 },
        { tieneNumerosUsados: true, delEmisor: [otro2] },
      ),
    ).toEqual({ ok: false, error: "PUNTO_DE_VENTA_NUMERO_INMUTABLE" });
  });
});

describe("puntosDeVentaHabilitados", () => {
  const activo = (id: string, numero: number, cambios: Partial<PuntoDeVenta> = {}) =>
    puntoDeVenta({ id: puntoDeVentaId(id), numero, estado: "ACTIVO", ...cambios });
  const puntos = [
    activo("a", 1),
    activo("b", 2, { emisorId: EMISOR_2 }),
    activo("c", 3, { estado: "INACTIVO" }),
    activo("d", 4, { sucursalId: OTRA_SUCURSAL }),
    activo("e", 5),
  ];
  const sucursalActiva = { id: SUCURSAL, activa: true };

  it("son los activos de la sucursal con emisor activo, en el orden de entrada", () => {
    const habilitados = puntosDeVentaHabilitados(
      puntos,
      sucursalActiva,
      new Set([EMISOR_1, EMISOR_2]),
    );
    expect(habilitados.map((p) => p.id)).toEqual(["a", "b", "e"]);
  });

  it("los de un emisor inactivo no están habilitados", () => {
    const habilitados = puntosDeVentaHabilitados(puntos, sucursalActiva, new Set([EMISOR_1]));
    expect(habilitados.map((p) => p.id)).toEqual(["a", "e"]);
  });

  it("con la sucursal inactiva no hay ninguno", () => {
    expect(
      puntosDeVentaHabilitados(
        puntos,
        { id: SUCURSAL, activa: false },
        new Set([EMISOR_1, EMISOR_2]),
      ),
    ).toEqual([]);
  });

  it("sin emisores activos no hay ninguno", () => {
    expect(puntosDeVentaHabilitados(puntos, sucursalActiva, new Set())).toEqual([]);
  });
});
