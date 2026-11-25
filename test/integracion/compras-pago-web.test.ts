import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { REGLAS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  fichaDeLaCompra,
  type DependenciasDeComprasListaWeb,
} from "../../src/composicion/compras-lista-web";
import {
  anularElPago,
  cajasAbiertasParaPagar,
  declararElPago,
  type DependenciasDePagoDeFacturaWeb,
} from "../../src/composicion/pago-de-factura-web";
import { crearConsultasDeCaja } from "../../src/modulos/caja/publico";
import { crearConsultasDeIdentidad } from "../../src/modulos/identidad/publico";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Compras PR 8: «Declarar pago» y anular el pago de una factura para la pantalla, con una base real y conexiones reales. Se prueba la IDEMPOTENCIA (el mismo envío dos veces, también a la vez: UN pago, UN egreso de
 * caja, UNA auditoría; anular dos veces: UNA anulación y UN reintegro), la CONCURRENCIA (dos personas pagan la misma factura a la vez desde dos cajas: una gana y la otra no mueve ninguna caja), la ATOMICIDAD (efectivo
 * con la caja cerrada, o sin caja: ni pago, ni egreso, ni auditoría), la autorización (solo gerente y administrador, validada en el servidor aunque el navegador mande el pedido), el aislamiento entre empresas,
 * que un pedido con campos de más (importe, empresa) no llega y que las cajas para elegir son solo las abiertas de la sucursal.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
/** Un rechazo: el genérico de compras (o el de caja, para su lectura). Nunca un texto por cada motivo. */
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({
    ok: false,
    error: { codigo: expect.stringMatching(/^(COMPRAS|CAJA)_ACCION_NO_PERMITIDA$/) as unknown },
  });
/** La falta de permiso la dice el guard con su propio código (la pantalla lo muestra con el genérico). */
const sinPermiso = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });

describe.skipIf(base === null)("composición web: declarar y anular el pago de una factura", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDePagoDeFacturaWeb;
  let lectura: DependenciasDeComprasListaWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    const consultasDeCaja = crearConsultasDeCaja({
      transacciones: c.entorno,
      reglas: REGLAS_DE_EMPRESA,
      tickets: { ticketsPorCobranza: () => Promise.resolve([]) },
    });
    d = {
      casosDeUso: () => c.casos,
      consultasDeCaja: () => consultasDeCaja,
      respuesta: { registrar: (x) => registrados.push(x) },
    };
    lectura = {
      consultas: () => c.consultas,
      consultasDeIdentidad: () =>
        crearConsultasDeIdentidad({ transacciones: c.entorno, reglas: REGLAS_DE_EMPRESA }),
      respuesta: { registrar: (x) => registrados.push(x) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una compra N2 con su factura (total 2420,00) y una caja de su sucursal con la sesión abierta y 1000,00 de fondo. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const r = valorDe(
      await c.casos.registrarCompraConFactura(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
        proveedorId: proveedor,
        depositoId: deposito,
        renglones: [
          {
            productoId: producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
        factura: {
          tipo: "FACTURA_A",
          puntoDeVenta: 5,
          numero: numeroUnico(),
          fecha: "2026-10-10",
          lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
          totalSegunFactura: "2420.00",
          cuitDelProveedor: cuitUnico(),
        },
      }),
    );
    const caja = await c.cajaAbierta(e);
    return { e, caja, comprobanteId: r.comprobanteId as string, recepcionId: r.recepcionId };
  };
  const hoy = () => new Date().toISOString().slice(0, 10);
  const enEfectivo = (
    comprobanteId: string,
    cajaId: string,
    extra: Record<string, unknown> = {},
  ) => ({
    clave: nuevoId(),
    comprobanteId,
    fechaDePago: "2026-10-11",
    medio: "EFECTIVO",
    cajaId,
    motivo: "Pago de la factura en efectivo",
    ...extra,
  });
  const porTransferencia = (comprobanteId: string, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    comprobanteId,
    fechaDePago: "2026-10-11",
    medio: "TRANSFERENCIA",
    ...extra,
  });
  const pagos = (comprobanteId: string) =>
    c.contar("select count(*) as n from pago_de_comprobante where comprobante_id = $1", [
      comprobanteId,
    ]);
  const movimientos = (sesionId: string) =>
    c.contar("select count(*) as n from movimiento_caja where sesion_id = $1", [sesionId]);
  const saldo = async (sesionId: string) =>
    (
      await c.filas<{ t: string }>(
        "select coalesce(sum(importe), 0)::text as t from movimiento_caja where sesion_id = $1",
        [sesionId],
      )
    )[0]?.t;
  const auditorias = async (e: EscenarioDeCompras, accion: string) =>
    (await c.auditoria(e.empresa, accion)).length;
  const ficha = async (e: EscenarioDeCompras, recepcionId: string) => {
    const r = await fichaDeLaCompra(lectura, e.gerente, recepcionId);
    if (!r.ok) throw new Error(`la ficha tenía que salir: ${JSON.stringify(r.error)}`);
    return r.dato;
  };

  it("el gerente declara el pago por transferencia: el importe es el total de la factura (lo copia el servidor), la ficha lo muestra con el correo y queda una auditoría; sin tocar la caja", async () => {
    const m = await armar();
    const antes = await movimientos(m.caja.sesionId);
    const r = await declararElPago(d, m.e.gerente, porTransferencia(m.comprobanteId));
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const f = await ficha(m.e, m.recepcionId);
    expect(f.factura?.comprobanteId).toBe(m.comprobanteId);
    expect(f.pagos).toMatchObject([
      {
        fechaDePago: "2026-10-11",
        medio: "TRANSFERENCIA",
        importe: { moneda: "ARS", monto: "2420.00" },
        estado: "VIGENTE",
        anuladoPor: null,
        anuladoEn: null,
      },
    ]);
    expect(typeof f.pagos[0]?.declaradoPor).toBe("string");
    expect(await auditorias(m.e, "PAGO_DECLARADO")).toBe(1);
    expect(await movimientos(m.caja.sesionId)).toBe(antes);
  });

  it("EFECTIVO con caja abierta: el pago y el egreso de caja son una sola transacción (la caja baja 2420,00)", async () => {
    const m = await armar();
    const r = await declararElPago(d, m.e.gerente, enEfectivo(m.comprobanteId, m.caja.cajaId));
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(await pagos(m.comprobanteId)).toBe(1);
    expect(await saldo(m.caja.sesionId)).toBe("-1420.00");
  });

  it("IDEMPOTENCIA: el mismo envío dos veces seguidas y también a la vez (doble toque) deja UN pago, UN egreso y UNA auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const unico = enEfectivo(m.comprobanteId, m.caja.cajaId);
      const [a, b] = await Promise.all([
        declararElPago(d, m.e.gerente, unico),
        declararElPago(d, m.e.gerente, unico),
      ]);
      expect([a.ok, b.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
      // La que no ganó se repite sola: la misma clave y el mismo contenido devuelven el mismo pago.
      const otra = await declararElPago(d, m.e.gerente, unico);
      expect(otra).toMatchObject({ ok: true, dato: { yaExistia: true } });
      expect(await pagos(m.comprobanteId)).toBe(1);
      expect(await movimientos(m.caja.sesionId)).toBe(2);
      expect(await saldo(m.caja.sesionId)).toBe("-1420.00");
      expect(await auditorias(m.e, "PAGO_DECLARADO")).toBe(1);
    }
  });

  it("CONCURRENCIA: dos personas pagan la misma factura a la vez desde DOS cajas: una gana, la otra recibe el genérico y NINGUNA caja se mueve de más", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const otraCaja = await c.cajaAbierta(m.e);
      const [a, b] = await Promise.all([
        declararElPago(d, m.e.gerente, enEfectivo(m.comprobanteId, m.caja.cajaId)),
        declararElPago(d, m.e.administrador, enEfectivo(m.comprobanteId, otraCaja.cajaId)),
      ]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      esGenerico(a.ok ? b : a);
      expect(await pagos(m.comprobanteId)).toBe(1);
      const egresos = (await saldo(m.caja.sesionId)) === "-1420.00" ? 1 : 0;
      const egresosDeLaOtra = (await saldo(otraCaja.sesionId)) === "-1420.00" ? 1 : 0;
      expect(egresos + egresosDeLaOtra).toBe(1);
      expect(await auditorias(m.e, "PAGO_DECLARADO")).toBe(1);
    }
  });

  it("ATOMICIDAD: efectivo con la caja sin sesión abierta, o sin caja, deja el genérico y NADA escrito (ni pago, ni egreso, ni auditoría); se puede pagar por otro medio", async () => {
    const m = await armar();
    const { rows } = await c.dueno.query<{ id: string }>(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Sin abrir') returning id",
      [m.e.empresa, m.e.sucursal],
    );
    const cerrada = rows[0]?.id as string;
    const antes = await movimientos(m.caja.sesionId);
    esGenerico(await declararElPago(d, m.e.gerente, enEfectivo(m.comprobanteId, cerrada)));
    const sinCaja = await declararElPago(d, m.e.gerente, {
      clave: nuevoId(),
      comprobanteId: m.comprobanteId,
      fechaDePago: "2026-10-11",
      medio: "EFECTIVO",
    });
    esGenerico(sinCaja);
    expect(await pagos(m.comprobanteId)).toBe(0);
    expect(await movimientos(m.caja.sesionId)).toBe(antes);
    expect(await auditorias(m.e, "PAGO_DECLARADO")).toBe(0);
    expect(await declararElPago(d, m.e.gerente, porTransferencia(m.comprobanteId))).toMatchObject({
      ok: true,
    });
  });

  it("una fecha futura, un medio fuera de la lista y un pedido con campos de más (importe, empresa, sucursal) son el genérico y no escriben nada", async () => {
    const m = await armar();
    const mañana = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString().slice(0, 10);
    for (const malo of [
      porTransferencia(m.comprobanteId, { fechaDePago: mañana }),
      porTransferencia(m.comprobanteId, { medio: "CHEQUE" }),
      porTransferencia(m.comprobanteId, { importe: "1.00" }),
      porTransferencia(m.comprobanteId, { empresaId: m.e.empresa }),
      porTransferencia(m.comprobanteId, { sucursalId: m.e.sucursal }),
      porTransferencia(m.comprobanteId, { cajaId: m.caja.cajaId, motivo: "No va" }),
    ]) {
      esGenerico(await declararElPago(d, m.e.gerente, malo));
    }
    expect(await pagos(m.comprobanteId)).toBe(0);
    expect(await auditorias(m.e, "PAGO_DECLARADO")).toBe(0);
    expect(hoy()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it("AUTORIZACIÓN: quien opera llama directo a la acción del gerente y se rechaza en el servidor, sin escribir; también al anular", async () => {
    const m = await armar();
    sinPermiso(await declararElPago(d, m.e.operador, porTransferencia(m.comprobanteId)));
    expect(await pagos(m.comprobanteId)).toBe(0);
    const pagado = valorDe(
      await c.casos.declararPago(m.e.gerente, {
        ...porTransferencia(m.comprobanteId),
      }),
    );
    sinPermiso(await anularElPago(d, m.e.operador, { pagoId: pagado.pagoId, motivo: "No puede" }));
    expect((await ficha(m.e, m.recepcionId)).pagos[0]?.estado).toBe("VIGENTE");
  });

  it("AISLAMIENTO: pagar la factura de OTRA empresa es indistinguible de una que no existe (el genérico) y no escribe en ninguna", async () => {
    const a = await armar();
    const b = await armar();
    esGenerico(await declararElPago(d, a.e.gerente, porTransferencia(b.comprobanteId)));
    expect(await pagos(b.comprobanteId)).toBe(0);
    expect(await pagos(a.comprobanteId)).toBe(0);
    esGenerico(await declararElPago(d, a.e.gerente, porTransferencia(nuevoId())));
  });

  it("anular el pago en efectivo devuelve la plata con un registro nuevo; anular dos veces (a la vez y después) deja UNA anulación, UN reintegro y UNA auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const pagado = valorDe(
        await c.casos.declararPago(m.e.gerente, {
          clave: nuevoId(),
          comprobanteId: m.comprobanteId,
          fechaDePago: "2026-10-11",
          medio: "EFECTIVO",
          salidaDeCaja: { cajaId: m.caja.cajaId, motivo: "Pago de la factura" },
        }),
      );
      const pedido = { pagoId: pagado.pagoId, motivo: "Se pagó dos veces" };
      const [x, y] = await Promise.all([
        anularElPago(d, m.e.gerente, pedido),
        anularElPago(d, m.e.administrador, pedido),
      ]);
      expect([x.ok, y.ok].sort()).toEqual([false, true]);
      esGenerico(x.ok ? y : x);
      esGenerico(await anularElPago(d, m.e.gerente, pedido));
      expect(await saldo(m.caja.sesionId)).toBe("1000.00");
      expect(await movimientos(m.caja.sesionId)).toBe(3);
      expect(await auditorias(m.e, "PAGO_ANULADO")).toBe(1);
      const f = await ficha(m.e, m.recepcionId);
      expect(f.pagos).toMatchObject([
        { estado: "ANULADO", motivoDeAnulacion: "Se pagó dos veces" },
      ]);
      expect(typeof f.pagos[0]?.anuladoPor).toBe("string");
      // Después se puede declarar otro.
      expect(await declararElPago(d, m.e.gerente, porTransferencia(m.comprobanteId))).toMatchObject(
        {
          ok: true,
        },
      );
    }
  });

  it("anular un pago en efectivo con la caja ya en cierre se rechaza y el pago sigue vigente (se corrige en la caja)", async () => {
    const m = await armar();
    const pagado = valorDe(
      await c.casos.declararPago(m.e.gerente, {
        clave: nuevoId(),
        comprobanteId: m.comprobanteId,
        fechaDePago: "2026-10-11",
        medio: "EFECTIVO",
        salidaDeCaja: { cajaId: m.caja.cajaId, motivo: "Pago de la factura" },
      }),
    );
    valorDe(await c.cajaCasos.iniciarCierre(m.e.gerente, { sesionId: m.caja.sesionId }));
    esGenerico(await anularElPago(d, m.e.gerente, { pagoId: pagado.pagoId, motivo: "Tarde" }));
    expect((await ficha(m.e, m.recepcionId)).pagos[0]?.estado).toBe("VIGENTE");
    expect(await auditorias(m.e, "PAGO_ANULADO")).toBe(0);
  });

  it("las cajas para elegir son solo las ABIERTAS de la sucursal: una sin sesión no se ofrece, y la sucursal ajena es el genérico", async () => {
    const m = await armar();
    await c.dueno.query(
      "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Sin abrir')",
      [m.e.empresa, m.e.sucursal],
    );
    const r = await cajasAbiertasParaPagar(d, m.e.gerente, m.e.sucursal);
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.dato.cajas.map((x) => x.cajaId)).toEqual([m.caja.cajaId]);
    const otra = await armar();
    esGenerico(await cajasAbiertasParaPagar(d, m.e.gerente, otra.e.sucursal));
  });
});
