import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { ticketsPorCobranzaDeLaComposicion } from "../../src/composicion/cierre-de-caja";
import { aporteDeVentas } from "../../src/modulos/ventas/publico";
import { empresaId, type SucursalId } from "../../src/primitivas/identificadores/marca";
import { crearConsultasDeCaja } from "../../src/modulos/caja/publico";
import { ok } from "../../src/primitivas/resultado/resultado";
import {
  FECHA_DE_NEGOCIO,
  REGLAS_DE_PRUEBA,
  montarVentas,
  nuevaClave,
  nuevoId,
  valorDe,
  type EscenarioDeVentas,
  type MundoDeVentas,
} from "./ventas-apoyo";

/**
 * Ventas (E4 fase B) con el cierre del día de caja: la unión ticket-cobro con el adaptador REAL de la composición (`ticketsPorCobranza`), sin ventas
 * falsas. P24: cada cobro de caja encuentra su ticket por el `origen.id` (la cobranza) y la diferencia es `cobrado − total vigente`; P27g: anular un
 * ticket cobrado no toca el cobro de caja y aparece como diferencia con `totalVigente = 0`; el aislamiento entre empresas; y que el adaptador falla
 * cerrado si la transacción no trae las lecturas de ventas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const monto = (v: string) => ({ moneda: "ARS", monto: v });

describe.skipIf(base === null)("ventas: el cobro y el cierre del día de caja", () => {
  let m: MundoDeVentas;
  let consultasDeCaja: ReturnType<typeof crearConsultasDeCaja>;
  beforeAll(async () => {
    if (base === null) return;
    m = await montarVentas(base);
    consultasDeCaja = crearConsultasDeCaja({
      transacciones: m.entorno,
      reglas: REGLAS_DE_PRUEBA,
      tickets: ticketsPorCobranzaDeLaComposicion,
    });
  });
  afterAll(async () => {
    if (base !== null) await m.cerrar();
  });

  type Caja = Awaited<ReturnType<MundoDeVentas["cajaAbierta"]>>;
  const vender = async (
    e: EscenarioDeVentas,
    caja: Caja,
    cobros: readonly Readonly<{ medio: string; importe: string }>[] = [
      { medio: "EFECTIVO", importe: "1000.00" },
    ],
  ) =>
    valorDe(
      await m.casos.venderYCobrar(e.gerente, {
        claveIdempotencia: nuevaClave(),
        cuentaId: nuevoId(),
        ejemplarId: nuevoId(),
        sucursalId: e.sucursal,
        lineas: [{ lineaId: nuevoId(), productoId: e.producto, opcionIds: [], cantidad: "1" }],
        totalEsperado: monto("1000.00"),
        cobro: {
          cajaId: caja.cajaId,
          cobros: cobros.map((c) => ({
            medioDePagoId: caja.medios[c.medio] as string,
            cuentaDeCobroId: null,
            importe: monto(c.importe),
          })),
        },
      }),
    );
  const anular = async (e: EscenarioDeVentas, v: Awaited<ReturnType<typeof vender>>) =>
    valorDe(
      await m.casos.anularTicket(e.gerente, {
        claveIdempotencia: nuevaClave(),
        ticketId: v.ticketId,
        ejemplarBaseId: v.ejemplarId,
        ejemplarNuevoId: nuevoId(),
        motivo: "Error del cajero",
      }),
    );
  const conciliacion = async (e: EscenarioDeVentas) =>
    valorDe(
      await consultasDeCaja.conciliacionDeLaJornada(e.gerente, {
        sucursalId: e.sucursal,
        fechaDeNegocio: FECHA_DE_NEGOCIO,
      }),
    );
  const porCobranza = async (e: EscenarioDeVentas, ids: readonly string[]) =>
    valorDe(
      await m.entorno.ejecutar({ contexto: e.gerente }, async (tx) =>
        ok(await ticketsPorCobranzaDeLaComposicion.ticketsPorCobranza(tx, ids)),
      ),
    );

  it("P24: cada cobro encuentra su ticket por la cobranza; lo cobrado de más o de menos que el ticket es diferencia y lo exacto no aparece, también con varios medios", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const exacta = await vender(e, caja);
    const dividida = await vender(e, caja, [
      { medio: "EFECTIVO", importe: "300.00" },
      { medio: "QR", importe: "700.00" },
    ]);
    // La unión por ventas y por el adaptador de la composición traen el ticket correcto y su total.
    const ids = [exacta.cobranzaId as string, dividida.cobranzaId as string];
    const ventas = valorDe(await m.consultas.ticketsPorCobranza(e.gerente, { cobranzaIds: ids }));
    expect(ventas.map((t) => [t.cobranzaId, t.ticketId, t.totalVigente, t.totalCobrado])).toEqual(
      [
        [exacta.cobranzaId, exacta.ticketId, "1000.00", "1000.00"],
        [dividida.cobranzaId, dividida.ticketId, "1000.00", "1000.00"],
      ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))),
    );
    const adaptados = await porCobranza(e, ids);
    expect(adaptados).toHaveLength(2);
    expect(adaptados.find((t) => t.cobranzaId === exacta.cobranzaId)).toMatchObject({
      ticketId: exacta.ticketId,
      totalVigente: { unidades: 100000n },
    });
    // Caja compara lo cobrado por origen (la suma de los dos medios) con el total del ticket: sin diferencias.
    expect((await conciliacion(e)).cobradoContraTicket).toEqual([]);
  });

  it("P27g: anular un ticket cobrado no cambia el cobro de caja y aparece como diferencia con total vigente 0", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const v = await vender(e, caja);
    const otra = await vender(e, caja);
    const cobroAntes = await m.filas(
      "select id, clase, importe::text as importe, sesion_id from movimiento_caja where id = $1",
      [v.cobros[0]?.cobroId],
    );
    await anular(e, v);
    // El cobro de caja es el mismo: no se anula ni se corrige.
    expect(
      await m.filas(
        "select id, clase, importe::text as importe, sesion_id from movimiento_caja where id = $1",
        [v.cobros[0]?.cobroId],
      ),
    ).toEqual(cobroAntes);
    expect(
      await m.contar("select count(*) as n from movimiento_caja where anula_a is not null"),
    ).toBe(0);
    const ventas = valorDe(
      await m.consultas.ticketsPorCobranza(e.gerente, { cobranzaIds: [v.cobranzaId as string] }),
    );
    expect(ventas).toMatchObject([
      { estado: "ANULADO", totalVigente: "0.00", totalCobrado: "1000.00" },
    ]);
    const adaptados = await porCobranza(e, [v.cobranzaId as string]);
    expect(adaptados).toMatchObject([{ ticketId: v.ticketId, totalVigente: { unidades: 0n } }]);
    // En el cierre del día: solo el anulado aparece, con todo lo cobrado como diferencia.
    const c = await conciliacion(e);
    expect(c.cobradoContraTicket).toHaveLength(1);
    expect(c.cobradoContraTicket[0]).toMatchObject({
      origen: { tipo: "ventas.cobranza_de_ticket", id: v.cobranzaId },
      ticketId: v.ticketId,
      cobrado: { monto: "1000.00" },
      totalDelTicket: { monto: "0.00" },
      diferencia: { monto: "1000.00" },
    });
    expect(c.cobradoContraTicket.some((x) => x.ticketId === otra.ticketId)).toBe(false);
  });

  it("nunca se mezclan empresas: otra empresa no ve las cobranzas ajenas, ni por ventas ni por el adaptador", async () => {
    const e = await m.escenario();
    const otra = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const v = await vender(e, caja);
    const ids = [v.cobranzaId as string];
    expect(
      valorDe(await m.consultas.ticketsPorCobranza(otra.gerente, { cobranzaIds: ids })),
    ).toEqual([]);
    expect(await porCobranza(otra, ids)).toEqual([]);
    expect(await porCobranza(e, ids)).toHaveLength(1);
    // Ids que no son uuid o que no existen no devuelven nada (y no rompen).
    expect(await porCobranza(e, ["no-es-uuid", nuevoId()])).toEqual([]);
  });

  it("el adaptador falla cerrado si la transacción no trae las lecturas de ventas (caja lo trata como dato que no se pudo leer)", async () => {
    const contexto = (await m.escenario()).gerente;
    await expect(
      m.entorno.ejecutar({ contexto }, async (tx) => {
        const { lecturasDeVentas: _omitida, ...sinVentas } = tx;
        void _omitida;
        return ok(
          await ticketsPorCobranzaDeLaComposicion.ticketsPorCobranza(
            sinVentas as unknown as typeof tx,
            [nuevoId()],
          ),
        );
      }),
    ).rejects.toThrow("las lecturas de ventas");
  });

  it("hayMovimiento (decisión 178): sin cuentas, tickets, anulaciones ni correcciones en la jornada no hay; una cuenta abierta o una venta cobrada, sí; una venta de otra jornada, no", async () => {
    const e = await m.escenario();
    const caja = await m.cajaAbierta(e);
    const hay = async (sucursal: SucursalId, fecha: string) =>
      valorDe(
        await m.entorno.ejecutar({ contexto: e.gerente }, (tx) =>
          aporteDeVentas.hayMovimiento(tx, {
            empresaId: empresaId(e.empresa),
            sucursalId: sucursal,
            fechaDeNegocio: fecha as never,
          }),
        ),
      );
    expect(await hay(e.sucursal, FECHA_DE_NEGOCIO)).toBe(false);
    expect(await hay(e.otraSucursal, FECHA_DE_NEGOCIO)).toBe(false);
    // Una cuenta abierta en la otra sucursal.
    valorDe(
      await m.casos.abrirCuenta(e.gerente, { cuentaId: nuevoId(), sucursalId: e.otraSucursal }),
    );
    expect(await hay(e.otraSucursal, FECHA_DE_NEGOCIO)).toBe(true);
    expect(await hay(e.sucursal, FECHA_DE_NEGOCIO)).toBe(false);
    // Una venta cobrada del 09 en la sucursal principal: hay movimiento el 09 y no el 10.
    await vender(e, caja);
    expect(await hay(e.sucursal, FECHA_DE_NEGOCIO)).toBe(true);
    expect(await hay(e.sucursal, "2026-11-10")).toBe(false);
  });
});
