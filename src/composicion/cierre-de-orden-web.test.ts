import { describe, expect, it, vi } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../test/utilidades/marcas";
import { errorDeCodigo } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { CONTROL_DE_NEGATIVO } from "../modulos/stock/publico";
import { empresaId, personaId } from "../primitivas/identificadores/marca";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  cargarLaOrdenParaCerrar,
  cerrarLaOrden,
  type DependenciasDeCierreDeOrdenWeb,
} from "./cierre-de-orden-web";

/**
 * Lo que agrega la composición de «Cerrar con lo real»: los renglones salen de la orden (el navegador manda lo real por posición), la unidad de lo obtenido es la del producto, la confirmación sale del pedido,
 * la lista blanca de lo que vuelve, el vencimiento con su texto, el genérico y lo inesperado. El caso de uso (consumo, costo, lote, estado) y la base se prueban con la base real en
 * `test/integracion/cierre-de-orden-web.test.ts`; acá son falsos.
 */
const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date("2026-11-26T12:00:00.000Z"),
};
const ORDEN = "11111111-1111-4111-8111-111111111111";
const CLAVE = "22222222-2222-4222-8222-222222222222";
const HARINA = "33333333-3333-4333-8333-333333333333";
const MANTECA = "44444444-4444-4444-8444-444444444444";
const GENERICO = { ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } };

const ficha = (extra: Record<string, unknown> = {}) => ({
  ordenId: ORDEN,
  numero: 14,
  estado: "ABIERTA",
  productoId: "producto-secreto",
  nombre: "Masa de medialuna",
  unidadId: "KILOGRAMO",
  version: 3,
  recetaCambiada: false,
  depositoId: "deposito-secreto",
  depositoDestinoId: "destino-secreto",
  cantidadEsperada: "16.0000",
  cantidadObtenida: null,
  mermaDeLote: null,
  vence: null,
  lote: null,
  renglones: [
    {
      productoId: HARINA,
      nombre: "Harina 000",
      esperado: "12.0000",
      real: null,
      unidadId: "KILOGRAMO",
    },
    {
      productoId: MANTECA,
      nombre: "Manteca",
      esperado: "4.0000",
      real: null,
      unidadId: "KILOGRAMO",
    },
  ],
  movimientos: { consumoId: "secreto" },
  motivo: null,
  abiertaEn: new Date("2026-11-25T12:00:00.000Z"),
  cerradaEn: null,
  fechaDeNegocio: null,
  ...extra,
});

function armar(
  extra: Readonly<{
    ficha?: unknown;
    cerrar?: ReturnType<typeof vi.fn>;
  }> = {},
) {
  const registrados: string[] = [];
  const fichaDeOrden = vi.fn(() => Promise.resolve(extra.ficha ?? ok(ficha())));
  const cerrarOrden =
    extra.cerrar ??
    vi.fn(() =>
      Promise.resolve(
        ok({
          lote: "OP-14",
          costoUnitario: "1.234567",
          costoEstado: "DEFINITIVO",
          mermaDeLote: "1.0000",
          excepciones: [],
          yaExistia: false,
        }),
      ),
    );
  const d = {
    casosDeUso: () => ({ cerrarOrden }),
    consultas: () => ({ fichaDeOrden }),
    respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
  } as unknown as DependenciasDeCierreDeOrdenWeb;
  return { d, registrados, fichaDeOrden, cerrarOrden };
}

const pedido = (extra: Record<string, unknown> = {}) => ({
  ordenId: ORDEN,
  clave: CLAVE,
  obtenido: "15",
  consumos: ["12", "4"],
  ...extra,
});

describe("la orden para cerrar", () => {
  it("sale solo lo que dibuja el formulario: la orden y un renglón por ingrediente (sin ids de producto, depósito ni movimiento)", async () => {
    const { d, fichaDeOrden } = armar();
    const r = await cargarLaOrdenParaCerrar(d, contexto, { ordenId: ORDEN });
    expect(r).toEqual({
      ok: true,
      dato: {
        id: ORDEN,
        numero: 14,
        nombre: "Masa de medialuna",
        unidadId: "KILOGRAMO",
        cantidadEsperada: "16.0000",
        renglones: [
          { nombre: "Harina 000", esperado: "12.0000", unidadId: "KILOGRAMO" },
          { nombre: "Manteca", esperado: "4.0000", unidadId: "KILOGRAMO" },
        ],
      },
    });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(fichaDeOrden).toHaveBeenCalledWith(contexto, { ordenId: ORDEN });
  });

  it.each(["CERRADA", "CANCELADA", "ANULADA"])(
    "una orden %s no se puede cerrar: el genérico",
    async (estado) => {
      const { d } = armar({ ficha: ok(ficha({ estado })) });
      expect(await cargarLaOrdenParaCerrar(d, contexto, { ordenId: ORDEN })).toMatchObject(
        GENERICO,
      );
    },
  );

  it("una orden que no está o un id mal formado: el genérico, y lo segundo sin consultar", async () => {
    const { d, fichaDeOrden } = armar({ ficha: ok(null) });
    expect(await cargarLaOrdenParaCerrar(d, contexto, { ordenId: ORDEN })).toMatchObject(GENERICO);
    expect(await cargarLaOrdenParaCerrar(d, contexto, { ordenId: "no" })).toMatchObject(GENERICO);
    expect(fichaDeOrden).toHaveBeenCalledTimes(1);
  });

  it("el motivo del guard sale con su texto; una excepción, sin detalle", async () => {
    const { d } = armar({ ficha: err("MODULO_EN_DESARROLLO") });
    expect(await cargarLaOrdenParaCerrar(d, contexto, { ordenId: ORDEN })).toEqual({
      ok: false,
      error: errorDeCodigo("MODULO_EN_DESARROLLO"),
    });
  });
});

describe("cerrar la orden", () => {
  it("arma cada consumo con el producto y la unidad de SU renglón, por posición, y la unidad de lo obtenido es la del producto; devuelve solo lo que la pantalla necesita", async () => {
    const { d, cerrarOrden } = armar();
    const r = await cerrarLaOrden(d, contexto, pedido({ vence: "2026-12-31" }));
    expect(r).toEqual({ ok: true, dato: { ordenId: ORDEN, yaExistia: false } });
    expect(cerrarOrden).toHaveBeenCalledTimes(1);
    expect(cerrarOrden).toHaveBeenCalledWith(contexto, {
      ordenId: ORDEN,
      clave: CLAVE,
      obtenido: "15",
      unidadId: "KILOGRAMO",
      vence: "2026-12-31",
      consumos: [
        { productoId: HARINA, cantidadReal: "12", unidadId: "KILOGRAMO" },
        { productoId: MANTECA, cantidadReal: "4", unidadId: "KILOGRAMO" },
      ],
    });
  });

  it("un consumo en blanco va como cero; sin vencimiento, `null`", async () => {
    const { d, cerrarOrden } = armar();
    await cerrarLaOrden(d, contexto, pedido({ consumos: ["", "4"] }));
    expect(cerrarOrden.mock.calls[0]?.[1]).toMatchObject({
      vence: null,
      consumos: [{ cantidadReal: "0" }, { cantidadReal: "4" }],
    });
  });

  it("la confirmación («Producir igual») viaja solo si se pidió, y es la del control de existencia negativa", async () => {
    const sin = armar();
    await cerrarLaOrden(sin.d, contexto, pedido({ confirmar: "" }));
    expect(sin.cerrarOrden.mock.calls[0]?.[1]).not.toHaveProperty("confirmaciones");
    const con = armar();
    await cerrarLaOrden(con.d, contexto, pedido({ confirmar: "1" }));
    expect(con.cerrarOrden.mock.calls[0]?.[1]).toMatchObject({
      confirmaciones: [CONTROL_DE_NEGATIVO],
    });
  });

  it("lo que manda el navegador (unidad, productos, empresa) no se usa", async () => {
    const { d, cerrarOrden } = armar();
    await cerrarLaOrden(
      d,
      contexto,
      pedido({
        unidadId: "UNIDAD_FALSA",
        productoId: "producto-falso",
        empresaId: "empresa-falsa",
      }),
    );
    for (const falso of ["UNIDAD_FALSA", "producto-falso", "empresa-falsa"]) {
      expect(JSON.stringify(cerrarOrden.mock.calls[0]?.[1])).not.toContain(falso);
    }
  });

  it("otra cantidad de renglones que la de la orden: el genérico y no llega al caso de uso", async () => {
    const { d, cerrarOrden } = armar();
    expect(await cerrarLaOrden(d, contexto, pedido({ consumos: ["12"] }))).toMatchObject(GENERICO);
    expect(await cerrarLaOrden(d, contexto, pedido({ consumos: ["12", "4", "1"] }))).toMatchObject(
      GENERICO,
    );
    expect(cerrarOrden).not.toHaveBeenCalled();
  });

  it("una orden que no está: el genérico; una orden ya cerrada SÍ llega al caso de uso (así el mismo cierre repetido devuelve `yaExistia`)", async () => {
    const sin = armar({ ficha: ok(null) });
    expect(await cerrarLaOrden(sin.d, contexto, pedido())).toMatchObject(GENERICO);
    expect(sin.cerrarOrden).not.toHaveBeenCalled();
    const cerrada = armar({ ficha: ok(ficha({ estado: "CERRADA" })) });
    await cerrarLaOrden(cerrada.d, contexto, pedido());
    expect(cerrada.cerrarOrden).toHaveBeenCalledTimes(1);
  });

  it.each([
    {},
    null,
    "x",
    pedido({ clave: "no" }),
    pedido({ obtenido: 15 }),
    pedido({ consumos: [12] }),
    pedido({ vence: "mañana" }),
    pedido({ confirmar: "si" }),
  ])("%j no tiene la forma pedida: el genérico, sin leer ni escribir", async (crudo) => {
    const { d, cerrarOrden, fichaDeOrden } = armar();
    expect(await cerrarLaOrden(d, contexto, crudo)).toMatchObject(GENERICO);
    expect(fichaDeOrden).not.toHaveBeenCalled();
    expect(cerrarOrden).not.toHaveBeenCalled();
  });

  it("un cierre repetido devuelve `yaExistia`", async () => {
    const { d } = armar({
      cerrar: vi.fn(() =>
        Promise.resolve(
          ok({
            lote: null,
            costoUnitario: null,
            costoEstado: "SIN_COSTO",
            mermaDeLote: "0",
            excepciones: [],
            yaExistia: true,
          }),
        ),
      ),
    });
    expect(await cerrarLaOrden(d, contexto, pedido())).toEqual({
      ok: true,
      dato: { ordenId: ORDEN, yaExistia: true },
    });
  });

  it("el aviso de faltante sale como el aviso de stock (sin el detalle); el vencimiento, con su texto; los demás errores, el genérico", async () => {
    const aviso = armar({
      cerrar: vi.fn(() =>
        Promise.resolve(
          err({ error: "CONTROL_REQUIERE_CONFIRMACION", detalle: [{ productoId: "secreto" }] }),
        ),
      ),
    });
    const r = await cerrarLaOrden(aviso.d, contexto, pedido());
    expect(r).toMatchObject({ ok: false, error: { codigo: "STOCK_CONTROL_AVISA" } });
    expect(JSON.stringify(r)).not.toContain("secreto");
    for (const [error, codigo] of [
      ["VENCIMIENTO_REQUERIDO", "PRODUCCION_VENCIMIENTO_REQUERIDO"],
      ["VENCIMIENTO_PASADO", "PRODUCCION_VENCIMIENTO_PASADO"],
    ] as const) {
      const v = armar({ cerrar: vi.fn(() => Promise.resolve(err(error))) });
      expect(await cerrarLaOrden(v.d, contexto, pedido())).toMatchObject({
        ok: false,
        error: { codigo },
      });
    }
    for (const error of [
      "ORDEN_YA_CERRADA",
      "CLAVE_REUTILIZADA",
      "CONSUMO_FUERA_DE_LA_ORDEN",
      { error: "CONTROL_BLOQUEA" },
    ]) {
      const o = armar({ cerrar: vi.fn(() => Promise.resolve(err(error))) });
      expect(await cerrarLaOrden(o.d, contexto, pedido())).toMatchObject(GENERICO);
    }
  });

  it("el rechazo de la consulta (guard) sale con su motivo; una excepción, sin detalle y con referencia", async () => {
    const rechazada = armar({ ficha: err("MODULO_EN_DESARROLLO") });
    expect(await cerrarLaOrden(rechazada.d, contexto, pedido())).toEqual({
      ok: false,
      error: errorDeCodigo("MODULO_EN_DESARROLLO"),
    });
    expect(rechazada.cerrarOrden).not.toHaveBeenCalled();
    const rota = armar({
      cerrar: vi.fn(() => Promise.reject(new Error("la base dijo secreto-interno"))),
    });
    const r = await cerrarLaOrden(rota.d, contexto, pedido());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secreto-interno");
    expect(rota.registrados.join(" ")).toContain("secreto-interno");
  });
});
