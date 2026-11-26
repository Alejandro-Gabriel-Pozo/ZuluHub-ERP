import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  cambiarElComprobanteDeLaCompra,
  loQueHayQueDeshacerAntesDeCambiar,
  loQueHayQueDeshacerAntesDeReemplazar,
  reemplazarLaFactura,
  type DependenciasDeReemplazoWeb,
} from "./reemplazo-web";

const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const FACTURA = "0b0b0b0b-1111-4222-8333-444444444444";
const COMPRA = "0c0c0c0c-1111-4222-8333-444444444444";
const VISTA = "0d0d0d0d-1111-4222-8333-444444444444";
const CLAVE = "0e0e0e0e-1111-4222-8333-444444444444";
const PRODUCTO = "0f0f0f0f-1111-4222-8333-444444444444";
const NUEVA = "1a1a1a1a-1111-4222-8333-444444444444";
const PAGO = "1b1b1b1b-1111-4222-8333-444444444444";

type Llamada = Readonly<{ que: string; entrada: unknown }>;

const montar = (opciones: Readonly<{ lectura?: () => unknown; caso?: () => unknown }> = {}) => {
  const llamadas: Llamada[] = [];
  const registrados: string[] = [];
  const lectura = opciones.lectura ?? (() => ok(null));
  const caso = opciones.caso ?? (() => ok({ comprobanteId: NUEVA, yaExistia: false, avisos: [] }));
  const leer = (que: string) => (_c: unknown, entrada: unknown) => {
    llamadas.push({ que, entrada });
    return Promise.resolve(lectura());
  };
  const hacer = (que: string) => (_c: unknown, entrada: unknown) => {
    llamadas.push({ que, entrada });
    return Promise.resolve(caso());
  };
  const d = {
    consultas: () => ({
      queHayQueDeshacerAntes: leer("queHayQueDeshacerAntes"),
      queHayQueDeshacerAntesDeCambiarElComprobante: leer("queHayQueDeshacerAntesDeCambiar"),
    }),
    casosDeUso: () => ({
      reemplazarFactura: hacer("reemplazarFactura"),
      cambiarElComprobanteDeLaCompra: hacer("cambiarElComprobanteDeLaCompra"),
    }),
    respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
  } as unknown as DependenciasDeReemplazoWeb;
  return { d, llamadas, registrados };
};

const GENERICO = { ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } };
const factura = {
  tipo: "FACTURA_A",
  puntoDeVenta: "5",
  numero: "1234",
  fecha: "2026-11-20",
  lineas: [{ productoId: PRODUCTO, cantidadFacturada: "2", precioNeto: "1000.00", alicuota: "21" }],
  totalSegunFactura: "2420.00",
};
const pedidoDeReemplazar = (extra: Record<string, unknown> = {}) => ({
  clave: CLAVE,
  comprobanteId: FACTURA,
  motivo: "Reemplazada por la factura 0005-00001234",
  factura,
  ...extra,
});
const pedidoDeCambiar = (extra: Record<string, unknown> = {}) => ({
  clave: CLAVE,
  recepcionId: COMPRA,
  facturaVigenteVistaId: VISTA,
  motivo: "Reemplazada por la factura 0005-00001234",
  factura: {
    ...factura,
    lineas: [{ renglon: 1, cantidadFacturada: "2", precioNeto: "1000.00", alicuota: "21" }],
  },
  ...extra,
});

describe("loQueHayQueDeshacerAntesDeReemplazar", () => {
  it("pide la lectura con el id y devuelve los frenos en su orden, con el id del pago solo cuando lo hay y sin campos de más", async () => {
    const { d, llamadas } = montar({
      lectura: () =>
        ok({
          comprobanteId: FACTURA,
          anulada: false,
          interno: "no sale",
          frenos: [
            { freno: "PAGO_VIGENTE", pagoId: PAGO, otro: "no sale" },
            { freno: "NOTAS_VIGENTES" },
          ],
        }),
    });
    expect(await loQueHayQueDeshacerAntesDeReemplazar(d, contexto, FACTURA)).toEqual({
      ok: true,
      dato: {
        comprobanteId: FACTURA,
        anulada: false,
        frenos: [{ freno: "PAGO_VIGENTE", pagoId: PAGO }, { freno: "NOTAS_VIGENTES" }],
      },
    });
    expect(llamadas).toEqual([
      { que: "queHayQueDeshacerAntes", entrada: { comprobanteId: FACTURA } },
    ]);
  });

  it("una factura que no existe, es de otra empresa o está fuera del alcance (null) sale como el genérico", async () => {
    const { d } = montar({ lectura: () => ok(null) });
    expect(await loQueHayQueDeshacerAntesDeReemplazar(d, contexto, FACTURA)).toMatchObject(
      GENERICO,
    );
  });

  it("un id que no es UUID no llega a la consulta", async () => {
    const { d, llamadas } = montar();
    expect(await loQueHayQueDeshacerAntesDeReemplazar(d, contexto, "no-es-uuid")).toMatchObject(
      GENERICO,
    );
    expect(llamadas).toEqual([]);
  });

  it("un error de la consulta (sin permiso) sale traducido", async () => {
    const { d } = montar({ lectura: () => err("SIN_PERMISO") });
    expect(await loQueHayQueDeshacerAntesDeReemplazar(d, contexto, FACTURA)).toMatchObject({
      ok: false,
    });
  });
});

describe("loQueHayQueDeshacerAntesDeCambiar", () => {
  it("pide la lectura con la compra y devuelve la factura vigente que se mira y sus frenos", async () => {
    const { d, llamadas } = montar({
      lectura: () => ok({ comprobanteId: VISTA, anulada: false, frenos: [] }),
    });
    expect(await loQueHayQueDeshacerAntesDeCambiar(d, contexto, COMPRA)).toEqual({
      ok: true,
      dato: { comprobanteId: VISTA, anulada: false, frenos: [] },
    });
    expect(llamadas).toEqual([
      { que: "queHayQueDeshacerAntesDeCambiar", entrada: { recepcionId: COMPRA } },
    ]);
  });

  it("una compra que no existe o fuera del alcance sale como el genérico", async () => {
    const { d } = montar({ lectura: () => ok(null) });
    expect(await loQueHayQueDeshacerAntesDeCambiar(d, contexto, COMPRA)).toMatchObject(GENERICO);
  });
});

describe("reemplazarLaFactura", () => {
  it("arma el pedido campo por campo y devuelve el comprobante nuevo y si ya existía, sin campos de más", async () => {
    const { d, llamadas } = montar({
      caso: () => ok({ comprobanteId: NUEVA, yaExistia: true, avisos: ["no sale"] }),
    });
    expect(await reemplazarLaFactura(d, contexto, pedidoDeReemplazar())).toEqual({
      ok: true,
      dato: { comprobanteId: NUEVA, yaExistia: true },
    });
    expect(llamadas).toHaveLength(1);
    expect(llamadas[0]).toMatchObject({
      que: "reemplazarFactura",
      entrada: {
        clave: CLAVE,
        comprobanteId: FACTURA,
        motivo: "Reemplazada por la factura 0005-00001234",
        factura: { puntoDeVenta: 5, numero: 1234, totalSegunFactura: "2420.00" },
      },
    });
  });

  it("el proveedor, la empresa y la persona que diga el navegador no llegan al caso de uso", async () => {
    const { d, llamadas } = montar();
    for (const extra of [{ proveedorId: PRODUCTO }, { empresaId: "x" }, { personaId: "x" }]) {
      expect(await reemplazarLaFactura(d, contexto, pedidoDeReemplazar(extra))).toMatchObject(
        GENERICO,
      );
    }
    expect(llamadas).toEqual([]);
  });

  it("un rechazo del caso de uso (un freno, una versión vieja) sale como el genérico, sin datos internos", async () => {
    for (const error of [
      { error: "COMPROBANTE_YA_PAGADO", pagoId: PAGO },
      "COMPROBANTE_CONCILIADO",
      { error: "FACTURA_YA_REEMPLAZADA", reemplazoId: NUEVA },
    ]) {
      const { d } = montar({ caso: () => err(error) });
      expect(await reemplazarLaFactura(d, contexto, pedidoDeReemplazar())).toMatchObject(GENERICO);
    }
  });

  it("una excepción del caso de uso sale sin detalle y queda registrada", async () => {
    const { d, registrados } = montar({
      caso: () => {
        throw new Error("falló la base");
      },
    });
    const r = await reemplazarLaFactura(d, contexto, pedidoDeReemplazar());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("falló la base");
    expect(registrados.length).toBeGreaterThan(0);
  });
});

describe("cambiarElComprobanteDeLaCompra", () => {
  it("arma el pedido con la factura que se miraba y devuelve el comprobante nuevo", async () => {
    const { d, llamadas } = montar();
    expect(await cambiarElComprobanteDeLaCompra(d, contexto, pedidoDeCambiar())).toEqual({
      ok: true,
      dato: { comprobanteId: NUEVA, yaExistia: false },
    });
    expect(llamadas[0]).toMatchObject({
      que: "cambiarElComprobanteDeLaCompra",
      entrada: { recepcionId: COMPRA, facturaVigenteVistaId: VISTA, clave: CLAVE },
    });
  });

  it("sin la factura que se miraba, o con campos de más, no llega al caso de uso", async () => {
    const { d, llamadas } = montar();
    expect(
      await cambiarElComprobanteDeLaCompra(
        d,
        contexto,
        pedidoDeCambiar({ facturaVigenteVistaId: undefined }),
      ),
    ).toMatchObject(GENERICO);
    expect(
      await cambiarElComprobanteDeLaCompra(d, contexto, pedidoDeCambiar({ proveedorId: VISTA })),
    ).toMatchObject(GENERICO);
    expect(llamadas).toEqual([]);
  });

  it("FACTURA_YA_REEMPLAZADA (otra persona la cambió antes) sale como el genérico y no filtra el id de la nueva", async () => {
    const { d } = montar({
      caso: () => err({ error: "FACTURA_YA_REEMPLAZADA", reemplazoId: NUEVA }),
    });
    const r = await cambiarElComprobanteDeLaCompra(d, contexto, pedidoDeCambiar());
    expect(r).toMatchObject(GENERICO);
    expect(JSON.stringify(r)).not.toContain(NUEVA);
  });
});
