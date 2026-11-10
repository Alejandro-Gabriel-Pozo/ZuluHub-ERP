import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type { TxDePrueba } from "./entorno";
import { montarVentas, valorDe, type MundoDeVentas } from "./ventas-apoyo";
import {
  crearFiscalDePrueba,
  escenarioFacturable,
  nuevaClaveDeFactura as nuevaClave,
  receptorConsumidorFinal,
  ticketCobrado,
  type EscenarioDeFacturacionDeTickets,
} from "./ventas-facturar-apoyo";

/**
 * E1-T3: facturar un ticket cobrado (`emitirComprobanteDeTicket`) con los casos de uso reales de ventas, el facturador real de la composición,
 * los repositorios de fiscal sobre la MISMA transacción y una base real con el rol de la aplicación. ARCA es falsa y nunca se llama dentro de la
 * transacción (fiscal solo encola). Cubre P1 (doble clic, en secuencia y en paralelo), P2 (dos cajeros a la vez), P3 (atomicidad: una falla
 * después de fiscal no deja ni la factura), P4 (reemisión tras una nota de crédito total), P5 (una nota parcial o todavía sin autorizar no
 * habilita otra factura, DD-2), P6 (ARCA rechaza y se vuelve a facturar), P10 (aislamiento y alcance) y los rechazos de fiscal sin escrituras.
 * La concurrencia más pesada (50 vueltas) corre solo al cerrar el tramo.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

type Fila = Record<string, unknown>;

function falla<E>(r: Readonly<{ ok: true; valor: unknown } | { ok: false; error: E }>): E {
  if (r.ok) throw new Error(`se esperaba un error y vino ok ${JSON.stringify(r.valor)}`);
  return r.error;
}

describe.skipIf(base === null)("ventas: facturar un ticket cobrado", () => {
  let m: MundoDeVentas;
  let fiscal: ReturnType<typeof crearFiscalDePrueba>;
  /** Cuando es `true`, guardar el puntero falla: simula una caída DESPUÉS de que fiscal ya escribió la factura. */
  let fallarAlGuardarElPuntero = false;

  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base, {
      facturacion: true,
      conexiones: 16,
      ajustarTx: (tx: TxDePrueba): TxDePrueba => ({
        ...tx,
        documentos: {
          ...tx.documentos,
          insertar: async (empresa, datos) => {
            if (fallarAlGuardarElPuntero) throw new Error("falla inyectada después de fiscal");
            return await tx.documentos.insertar(empresa, datos);
          },
        },
      }),
    });
    fiscal = crearFiscalDePrueba(m);
  });
  afterAll(async () => {
    await fiscal.cerrar();
    await m.cerrar();
  });

  /** Una empresa facturable, su caja abierta y un ticket cobrado de $1000. */
  async function preparar() {
    const e = await escenarioFacturable(m);
    const caja = await m.cajaAbierta(e);
    const t = await ticketCobrado(m, e, caja);
    // Los datos fiscales de la empresa rigen desde que se armó el escenario: facturar es siempre un instante después (el cobro, en cambio,
    // quedó en la jornada fija de ventas).
    fiscal.adelantar();
    return { e, caja, t };
  }

  const facturar = (
    e: EscenarioDeFacturacionDeTickets,
    ticketId: string,
    cambios: Partial<{
      clave: string;
      puntoDeVentaId: string;
      contexto: ContextoOperativo;
    }> = {},
  ) =>
    m.casos.emitirComprobanteDeTicket(
      { ...(cambios.contexto ?? e.gerente), ahora: fiscal.reloj.ahora() },
      {
        ticketId,
        receptor: receptorConsumidorFinal(),
        puntoDeVentaId: cambios.puntoDeVentaId ?? e.pv,
        clave: cambios.clave ?? nuevaClave(),
      },
    );

  /** Lo que hay escrito de la empresa: comprobantes, punteros y trabajos de validación. */
  const escrituras = async (empresa: string) => ({
    comprobantes: await m.contar("select count(*) as n from comprobante where empresa_id = $1", [
      empresa,
    ]),
    punteros: await m.contar(
      "select count(*) as n from documento_de_ticket where empresa_id = $1",
      [empresa],
    ),
    trabajos: await m.contar(
      "select count(*) as n from trabajo where empresa_id = $1 and starts_with(clave_idempotencia, 'fiscal.validar:')",
      [empresa],
    ),
  });

  const punteros = (ticketId: string) =>
    m.filas<Fila>(
      "select intento, vigente, comprobante_id, clave from documento_de_ticket where ticket_id = $1 order by intento",
      [ticketId],
    );

  // ---- camino feliz -----------------------------------------------------------------------------------------------------------

  it("factura el ticket cobrado: un comprobante por el total cobrado, el puntero y la auditoría en el mismo acto", async () => {
    const { e, t } = await preparar();
    const r = valorDe(await facturar(e, t.ticketId));
    expect(r.yaExistia).toBe(false);
    expect(r.estado).toBe("PENDIENTE");
    const comprobantes = await m.filas<Fila>(
      "select id, total, origen_tipo, estado from comprobante where empresa_id = $1",
      [e.empresa],
    );
    expect(comprobantes).toHaveLength(1);
    expect(comprobantes[0]).toMatchObject({
      id: r.comprobanteId,
      total: "1000.00",
      origen_tipo: "EJEMPLAR_DE_TICKET",
    });
    expect(await punteros(t.ticketId)).toEqual([
      expect.objectContaining({ intento: 1, vigente: true, comprobante_id: r.comprobanteId }),
    ]);
    expect(await m.auditoria(e.empresa, "DOCUMENTO_DE_TICKET_CREADO")).toHaveLength(1);
    expect((await escrituras(e.empresa)).trabajos).toBe(1);
  });

  // ---- P1: doble clic ---------------------------------------------------------------------------------------------------------

  it("P1: repetir emitirComprobanteDeTicket con la misma clave deja una factura, un puntero y un trabajo, y devuelve yaExistia", async () => {
    const { e, t } = await preparar();
    const clave = nuevaClave();
    const primera = valorDe(await facturar(e, t.ticketId, { clave }));
    const antes = await escrituras(e.empresa);
    const segunda = valorDe(await facturar(e, t.ticketId, { clave }));
    expect(segunda.comprobanteId).toBe(primera.comprobanteId);
    expect(segunda.yaExistia).toBe(true);
    expect(await escrituras(e.empresa)).toEqual(antes);
    expect(await m.auditoria(e.empresa, "DOCUMENTO_DE_TICKET_CREADO")).toHaveLength(1);
  });

  it("P1: la misma clave desde seis clics a la vez da un solo comprobante", async () => {
    const { e, t } = await preparar();
    const clave = nuevaClave();
    const rs = await Promise.all(
      Array.from({ length: 6 }, () => facturar(e, t.ticketId, { clave })),
    );
    const ids = new Set(rs.map((r) => valorDe(r).comprobanteId));
    expect(ids.size).toBe(1);
    expect(await escrituras(e.empresa)).toEqual({ comprobantes: 1, punteros: 1, trabajos: 1 });
  });

  it("una clave de otro ticket es CLAVE_REUTILIZADA y no escribe", async () => {
    const { e, caja, t } = await preparar();
    const clave = nuevaClave();
    valorDe(await facturar(e, t.ticketId, { clave }));
    const otro = await ticketCobrado(m, e, caja);
    const antes = await escrituras(e.empresa);
    expect(falla(await facturar(e, otro.ticketId, { clave }))).toBe("CLAVE_REUTILIZADA");
    expect(await escrituras(e.empresa)).toEqual(antes);
  });

  // ---- P2: dos cajeros a la vez -----------------------------------------------------------------------------------------------

  it("P2: dos cajeros con claves distintas sobre el mismo ticket: uno factura y el otro ve TICKET_YA_FACTURADO", async () => {
    // Pocas vueltas de rutina; al cerrar el tramo se corre con `PEDERNAL_VUELTAS_DE_FACTURAR=50`.
    const vueltas = Number(process.env["PEDERNAL_VUELTAS_DE_FACTURAR"] ?? "3");
    for (let vuelta = 0; vuelta < vueltas; vuelta++) {
      const { e, t } = await preparar();
      const [a, b] = await Promise.all([
        facturar(e, t.ticketId),
        facturar(e, t.ticketId, { contexto: e.administrador }),
      ]);
      const oks = [a, b].filter((r) => r.ok);
      const perdedor = [a, b].find((r) => !r.ok);
      expect(oks).toHaveLength(1);
      expect(perdedor).toBeDefined();
      expect(perdedor === undefined ? null : falla(perdedor)).toMatchObject({
        error: "TICKET_YA_FACTURADO",
      });
      expect(await escrituras(e.empresa)).toEqual({ comprobantes: 1, punteros: 1, trabajos: 1 });
    }
  });

  // ---- P3: atomicidad ---------------------------------------------------------------------------------------------------------

  it("P3: si falla guardar el puntero después de que fiscal escribió, no queda ni la factura; el reintento factura", async () => {
    const { e, t } = await preparar();
    const antes = await escrituras(e.empresa);
    fallarAlGuardarElPuntero = true;
    try {
      await expect(facturar(e, t.ticketId)).rejects.toThrow();
    } finally {
      fallarAlGuardarElPuntero = false;
    }
    expect(await escrituras(e.empresa)).toEqual(antes);
    expect(await m.auditoria(e.empresa, "COMPROBANTE_CREADO")).toHaveLength(0);
    valorDe(await facturar(e, t.ticketId));
    expect(await escrituras(e.empresa)).toEqual({ comprobantes: 1, punteros: 1, trabajos: 1 });
  });

  // ---- estados y rechazos que no escriben --------------------------------------------------------------------------------------

  it("un ticket que no está cobrado es TICKET_NO_FACTURABLE; uno que no existe, TICKET_NO_ENCONTRADO", async () => {
    const e = await escenarioFacturable(m);
    const cuenta = crypto.randomUUID();
    valorDe(await m.casos.abrirCuenta(e.gerente, { cuentaId: cuenta, sucursalId: e.sucursal }));
    valorDe(
      await m.casos.agregarLinea(e.gerente, {
        cuentaId: cuenta,
        lineaId: crypto.randomUUID(),
        productoId: e.producto,
        opcionIds: [],
        cantidad: "1",
      }),
    );
    const sinCobrar = valorDe(
      await m.casos.cerrarCuenta(e.gerente, { cuentaId: cuenta, ejemplarId: crypto.randomUUID() }),
    );
    expect(falla(await facturar(e, sinCobrar.ticketId))).toBe("TICKET_NO_FACTURABLE");
    expect(falla(await facturar(e, crypto.randomUUID()))).toBe("TICKET_NO_ENCONTRADO");
    expect(await escrituras(e.empresa)).toEqual({ comprobantes: 0, punteros: 0, trabajos: 0 });
  });

  it("un punto de venta de otra sucursal lo rechaza fiscal y no escribe nada", async () => {
    const { e, t } = await preparar();
    const antes = await escrituras(e.empresa);
    const error = falla(await facturar(e, t.ticketId, { puntoDeVentaId: e.pvDeOtraSucursal }));
    expect(error).toMatchObject({
      error: "FACTURACION_FALLIDA",
      causa: expect.anything() as unknown,
    });
    expect(JSON.stringify(error)).toContain("PUNTO_DE_VENTA_DE_OTRA_SUCURSAL");
    expect(await escrituras(e.empresa)).toEqual(antes);
  });

  it("sin facturador armado, ventas rechaza con FACTURACION_NO_DISPONIBLE", async () => {
    const { e, t } = await preparar();
    const { crearCasosDeUsoDeVentas } = await import("../../src/modulos/ventas/publico");
    const sin = crearCasosDeUsoDeVentas({
      transacciones: m.entorno,
      reglas: (await import("./ventas-apoyo")).REGLAS_DE_PRUEBA,
    });
    const r = await sin.emitirComprobanteDeTicket(e.gerente, {
      ticketId: t.ticketId,
      receptor: receptorConsumidorFinal(),
      puntoDeVentaId: e.pv,
      clave: nuevaClave(),
    });
    expect(falla(r)).toBe("FACTURACION_NO_DISPONIBLE");
    expect((await escrituras(e.empresa)).comprobantes).toBe(0);
  });

  // ---- P4, P5, P6: vigencia ---------------------------------------------------------------------------------------------------

  async function facturaAutorizada() {
    const p = await preparar();
    const r = valorDe(await facturar(p.e, p.t.ticketId));
    return { ...p, comprobanteId: r.comprobanteId };
  }
  it("P4: acreditada por completo con una nota AUTORIZADA, el ticket se puede volver a facturar (intento 2, otro origen)", async () => {
    const f = await facturaAutorizada();
    await fiscal.autorizar(f.e, f.comprobanteId);
    await fiscal.autorizar(f.e, await fiscal.notaDeCredito(f.e, f.comprobanteId, "1000.00"));
    const nueva = valorDe(await facturar(f.e, f.t.ticketId));
    expect(nueva.comprobanteId).not.toBe(f.comprobanteId);
    const ps = await punteros(f.t.ticketId);
    expect(ps).toEqual([
      expect.objectContaining({ intento: 1, vigente: false }),
      expect.objectContaining({ intento: 2, vigente: true, comprobante_id: nueva.comprobanteId }),
    ]);
    const origen = await m.filas<Fila>("select origen_tipo from comprobante where id = $1", [
      nueva.comprobanteId,
    ]);
    expect(origen[0]).toMatchObject({ origen_tipo: "REEMISION_DE_TICKET" });
  });

  it("P5: una nota parcial, o total pero todavía sin autorizar, no habilita otra factura (TICKET_YA_FACTURADO)", async () => {
    const f = await facturaAutorizada();
    await fiscal.autorizar(f.e, f.comprobanteId);
    await fiscal.autorizar(f.e, await fiscal.notaDeCredito(f.e, f.comprobanteId, "400.00"));
    expect(falla(await facturar(f.e, f.t.ticketId))).toMatchObject({
      error: "TICKET_YA_FACTURADO",
      comprobanteId: f.comprobanteId,
    });
    // El resto de la factura, acreditado, pero la nota queda «Validando»: sigue valiendo hasta que ARCA la autorice.
    await fiscal.notaDeCredito(f.e, f.comprobanteId, "600.00");
    expect(falla(await facturar(f.e, f.t.ticketId))).toMatchObject({
      error: "TICKET_YA_FACTURADO",
    });
    expect((await escrituras(f.e.empresa)).punteros).toBe(1);
  });

  it("P6: si ARCA rechaza la factura, el ticket se vuelve a facturar y el puntero anterior queda no vigente", async () => {
    const f = await facturaAutorizada();
    fiscal.falsa.programar("RECHAZA");
    await fiscal.autorizar(f.e, f.comprobanteId);
    const nueva = valorDe(await facturar(f.e, f.t.ticketId));
    expect(nueva.comprobanteId).not.toBe(f.comprobanteId);
    expect((await punteros(f.t.ticketId)).map((p) => [p["intento"], p["vigente"]])).toEqual([
      [1, false],
      [2, true],
    ]);
  });

  it("una reemisión repetida con la misma clave no emite una tercera factura", async () => {
    const f = await facturaAutorizada();
    fiscal.falsa.programar("RECHAZA");
    await fiscal.autorizar(f.e, f.comprobanteId);
    const clave = nuevaClave();
    const a = valorDe(await facturar(f.e, f.t.ticketId, { clave }));
    const b = valorDe(await facturar(f.e, f.t.ticketId, { clave }));
    expect(b.comprobanteId).toBe(a.comprobanteId);
    expect((await escrituras(f.e.empresa)).punteros).toBe(2);
  });

  // ---- P10: aislamiento y alcance ---------------------------------------------------------------------------------------------

  it("P10: el ticket de otra empresa no existe para quien factura, y un operador de otra sucursal no lo alcanza", async () => {
    const a = await preparar();
    const b = await escenarioFacturable(m);
    expect(falla(await facturar(b, a.t.ticketId))).toBe("TICKET_NO_ENCONTRADO");
    // El operador de A solo trabaja en la sucursal principal: un ticket de la otra sucursal queda fuera de su alcance.
    const cajaOtra = await m.cajaAbierta(a.e, { sucursal: a.e.otraSucursal });
    const deOtra = await ticketCobrado(m, { ...a.e, sucursal: a.e.otraSucursal }, cajaOtra);
    const r = await facturar(a.e, deOtra.ticketId, {
      contexto: a.e.operador,
      puntoDeVentaId: a.e.pvDeOtraSucursal,
    });
    expect(falla(r)).not.toMatchObject({ error: "TICKET_YA_FACTURADO" });
    expect(r.ok).toBe(false);
    expect((await escrituras(a.e.empresa)).comprobantes).toBe(0);
    expect((await escrituras(b.empresa)).comprobantes).toBe(0);
  });

  // ---- barrido: lo que facturó ventas y lo que apunta ventas coinciden --------------------------------------------------------

  it("barrido (corre al final, sobre todo lo que dejaron las pruebas): cada factura de un ticket tiene su puntero, y cada puntero su factura", async () => {
    const sinPuntero = await m.filas<Fila>(
      `select c.id from comprobante c
        where c.origen_tipo in ('EJEMPLAR_DE_TICKET', 'REEMISION_DE_TICKET')
          and not exists (select 1 from documento_de_ticket d where d.comprobante_id = c.id and d.empresa_id = c.empresa_id)`,
    );
    expect(sinPuntero, "facturas de ticket sin puntero").toEqual([]);
    const sinFactura = await m.filas<Fila>(
      `select d.id from documento_de_ticket d
        where not exists (select 1 from comprobante c where c.id = d.comprobante_id and c.empresa_id = d.empresa_id)`,
    );
    expect(sinFactura, "punteros sin factura").toEqual([]);
    // Un ticket nunca tiene dos punteros vigentes.
    const dobles = await m.filas<Fila>(
      "select ticket_id from documento_de_ticket where vigente group by ticket_id having count(*) > 1",
    );
    expect(dobles, "tickets con dos punteros vigentes").toEqual([]);
  });
});
