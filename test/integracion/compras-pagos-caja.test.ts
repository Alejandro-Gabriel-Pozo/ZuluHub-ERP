import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitAlAzar } from "./entorno";

/**
 * E9-T10b: el pago en efectivo que SACA la plata de la caja abierta, en la misma transacción del pago (DEC-0316). Con la caja sin sesión abierta el pago no se
 * declara y se puede pagar por otro medio; repetir el pago no saca la plata dos veces; dos pagos a la vez de la misma factura sacan una sola vez; anular el
 * pago devuelve la plata con un registro nuevo y solo si la caja sigue abierta.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: pago en efectivo desde la caja", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
    !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
      ? String(r.error.error)
      : codigoDe(r);

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
          numero: Math.floor(Math.random() * 1_000_000) + 1,
          fecha: "2026-10-10",
          lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
          totalSegunFactura: "2420.00",
          cuitDelProveedor: cuitAlAzar(),
        },
      }),
    );
    const caja = await c.cajaAbierta(e);
    return { e, caja, comprobanteId: r.comprobanteId as string };
  };
  const salida = (cajaId: string) => ({ cajaId, motivo: "Pago de la factura en efectivo" });
  const pedido = (
    m: { comprobanteId: string },
    cajaId: string | null,
    extra: Record<string, unknown> = {},
  ) => ({
    clave: nuevoId(),
    comprobanteId: m.comprobanteId,
    fechaDePago: "2026-10-11",
    medio: "EFECTIVO",
    ...(cajaId === null ? {} : { salidaDeCaja: salida(cajaId) }),
    ...extra,
  });
  const esperado = async (sesionId: string) =>
    (
      await c.filas<{ t: string }>(
        "select coalesce(sum(importe), 0)::text as t from movimiento_caja where sesion_id = $1",
        [sesionId],
      )
    )[0]?.t;
  const movimientos = (sesionId: string) =>
    c.contar("select count(*) as n from movimiento_caja where sesion_id = $1", [sesionId]);
  const pagos = (comprobanteId: string) =>
    c.contar("select count(*) as n from pago_de_comprobante where comprobante_id = $1", [
      comprobanteId,
    ]);

  it("el pago en efectivo con salida de caja descuenta la caja con un egreso de efectivo y deja quién, cuándo y de dónde", async () => {
    const m = await armar();
    const r = valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)));
    expect(r.yaExistia).toBe(false);
    expect(await esperado(m.caja.sesionId)).toBe("-1420.00");
    const [egreso] = await c.filas<Record<string, unknown>>(
      `select clase, importe::text as importe, motivo, registrado_por, clave_idempotencia, anula_a
         from movimiento_caja where sesion_id = $1 and clase = 'EGRESO_MANUAL'`,
      [m.caja.sesionId],
    );
    expect(egreso).toEqual({
      clase: "EGRESO_MANUAL",
      importe: "-2420.00",
      motivo: "Pago de la factura en efectivo",
      registrado_por: m.e.gerente.personaId,
      clave_idempotencia: `egreso_pago_a_proveedor_${r.pagoId}`,
      anula_a: null,
    });
    expect((await c.auditoria(m.e.empresa, "PAGO_DECLARADO")).at(-1)).toMatchObject({
      entidad_id: r.pagoId,
      despues: expect.objectContaining({ salidaDeCajaId: m.caja.cajaId }) as unknown,
    });
  });

  it("I5: repetir el mismo pago (misma clave) no saca la plata dos veces; con otro motivo es CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const p = pedido(m, m.caja.cajaId);
    const primero = valorDe(await c.casos.declararPago(m.e.gerente, p));
    expect(valorDe(await c.casos.declararPago(m.e.administrador, p))).toEqual({
      pagoId: primero.pagoId,
      yaExistia: true,
    });
    expect(await movimientos(m.caja.sesionId)).toBe(2);
    expect(await esperado(m.caja.sesionId)).toBe("-1420.00");
    expect(
      await c.casos.declararPago(m.e.gerente, {
        ...p,
        salidaDeCaja: { cajaId: m.caja.cajaId, motivo: "Otro motivo" },
      }),
    ).toEqual({ ok: false, error: "CLAVE_REUTILIZADA" });
    expect(await movimientos(m.caja.sesionId)).toBe(2);
  });

  it("C8: dos pagos en efectivo a la vez de la misma factura: un pago y un solo egreso", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      try {
        const resultados = await Promise.all([
          c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)),
          c.casos.declararPago(m.e.administrador, pedido(m, m.caja.cajaId)),
        ]);
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        for (const r of resultados.filter((x) => !x.ok)) {
          expect(["COMPROBANTE_YA_PAGADO", "ConcurrenciaAgotada"]).toContain(codigo(r));
        }
      } finally {
        c.soltarBarrera();
      }
      expect(await pagos(m.comprobanteId)).toBe(1);
      expect(await movimientos(m.caja.sesionId)).toBe(2);
    }
  });

  const cajaSinSesion = async (e: Pick<EscenarioDeCompras, "empresa" | "sucursal">) =>
    (
      await c.filas<{ id: string }>(
        "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Sin abrir') returning id",
        [e.empresa, e.sucursal],
      )
    )[0]?.id as string;

  it("con la caja sin sesión abierta el pago NO se declara (SIN_SESION_ABIERTA) y se puede pagar por otro medio", async () => {
    const m = await armar();
    const cerrada = await cajaSinSesion(m.e);
    const antes = await c.contar("select count(*) as n from movimiento_caja");
    expect(await c.casos.declararPago(m.e.gerente, pedido(m, cerrada))).toEqual({
      ok: false,
      error: "SIN_SESION_ABIERTA",
    });
    expect(await pagos(m.comprobanteId)).toBe(0);
    expect(await c.contar("select count(*) as n from movimiento_caja")).toBe(antes);
    expect((await c.auditoria(m.e.empresa, "PAGO_DECLARADO")).length).toBe(0);
    valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, null, { medio: "TRANSFERENCIA" })));
    expect(await pagos(m.comprobanteId)).toBe(1);
  });

  it("una caja en cierre tampoco deja sacar plata (CAJA_EN_CIERRE) y el pago no se declara", async () => {
    const m = await armar();
    valorDe(await c.cajaCasos.iniciarCierre(m.e.gerente, { sesionId: m.caja.sesionId }));
    const antes = await movimientos(m.caja.sesionId);
    expect(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId))).toEqual({
      ok: false,
      error: "CAJA_EN_CIERRE",
    });
    expect(await pagos(m.comprobanteId)).toBe(0);
    expect(await movimientos(m.caja.sesionId)).toBe(antes);
  });

  it("una caja de otra sucursal o inexistente se rechaza sin pagar", async () => {
    const m = await armar();
    const deOtra = (
      await c.filas<{ id: string }>(
        "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Norte') returning id",
        [m.e.empresa, m.e.otraSucursal],
      )
    )[0]?.id as string;
    expect(await c.casos.declararPago(m.e.gerente, pedido(m, deOtra))).toEqual({
      ok: false,
      error: "CAJA_DE_OTRA_SUCURSAL",
    });
    expect(await c.casos.declararPago(m.e.gerente, pedido(m, nuevoId()))).toEqual({
      ok: false,
      error: "CAJA_NO_ENCONTRADA",
    });
    expect(await pagos(m.comprobanteId)).toBe(0);
  });

  it("la salida de caja solo vale con el medio efectivo y con una caja y un motivo bien escritos", async () => {
    const m = await armar();
    expect(
      await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId, { medio: "QR" })),
    ).toEqual({ ok: false, error: "SALIDA_DE_CAJA_SOLO_EN_EFECTIVO" });
    for (const mala of [
      { cajaId: "no-es-un-uuid", motivo: "Pago" },
      { cajaId: m.caja.cajaId, motivo: "" },
      { cajaId: m.caja.cajaId },
      "texto",
      [],
    ]) {
      expect(
        await c.casos.declararPago(m.e.gerente, pedido(m, null, { salidaDeCaja: mala })),
      ).toEqual({ ok: false, error: "SALIDA_DE_CAJA_INVALIDA" });
    }
    expect(await pagos(m.comprobanteId)).toBe(0);
    expect(await movimientos(m.caja.sesionId)).toBe(1);
  });

  it("el operador no paga ni saca plata de la caja (SIN_PERMISO)", async () => {
    const m = await armar();
    expect(await c.casos.declararPago(m.e.operador, pedido(m, m.caja.cajaId))).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(await movimientos(m.caja.sesionId)).toBe(1);
  });

  it("anular el pago devuelve la plata con un registro nuevo de caja (el egreso queda), y anular otra vez no mueve nada", async () => {
    const m = await armar();
    const pago = valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)));
    valorDe(
      await c.casos.anularPago(m.e.administrador, {
        pagoId: pago.pagoId,
        motivo: "Error de carga",
      }),
    );
    expect(await esperado(m.caja.sesionId)).toBe("1000.00");
    const [espejo] = await c.filas<Record<string, unknown>>(
      `select clase, importe::text as importe, motivo, registrado_por, (anula_a is not null) as anula
         from movimiento_caja where sesion_id = $1 and clase = 'ANULACION'`,
      [m.caja.sesionId],
    );
    expect(espejo).toEqual({
      clase: "ANULACION",
      importe: "2420.00",
      motivo: "Error de carga",
      registrado_por: m.e.administrador.personaId,
      anula: true,
    });
    expect(await movimientos(m.caja.sesionId)).toBe(3);
    expect(
      await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Otra vez" }),
    ).toEqual({ ok: false, error: "PAGO_YA_ANULADO" });
    expect(await movimientos(m.caja.sesionId)).toBe(3);
    // Se puede volver a pagar por la caja: el egreso nuevo es de otro pago.
    const otro = valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)));
    expect(otro.pagoId).not.toBe(pago.pagoId);
    expect(await esperado(m.caja.sesionId)).toBe("-1420.00");
  });

  it("anular dos veces a la vez un pago pagado con la caja devuelve la plata una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const pago = valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)));
      c.armarBarrera(2);
      try {
        const resultados = await Promise.all([
          c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Una" }),
          c.casos.anularPago(m.e.administrador, { pagoId: pago.pagoId, motivo: "Otra" }),
        ]);
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        for (const r of resultados.filter((x) => !x.ok)) {
          expect(["PAGO_YA_ANULADO", "ConcurrenciaAgotada"]).toContain(codigo(r));
        }
      } finally {
        c.soltarBarrera();
      }
      expect(await esperado(m.caja.sesionId)).toBe("1000.00");
      expect(await movimientos(m.caja.sesionId)).toBe(3);
    }
  });

  it("con la caja ya en cierre el pago NO se anula (la plata no vuelve sola): queda vigente y sin registros nuevos", async () => {
    const m = await armar();
    const pago = valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, m.caja.cajaId)));
    valorDe(await c.cajaCasos.iniciarCierre(m.e.gerente, { sesionId: m.caja.sesionId }));
    expect(
      await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Error de carga" }),
    ).toEqual({ ok: false, error: "EGRESO_DE_CAJA_NO_ANULABLE" });
    const [estado] = await c.filas<{ estado: string }>(
      "select estado from pago_de_comprobante where id = $1",
      [pago.pagoId],
    );
    expect(estado?.estado).toBe("VIGENTE");
    expect(await movimientos(m.caja.sesionId)).toBe(2);
  });

  it("un pago sin salida de caja se anula sin tocar la caja", async () => {
    const m = await armar();
    const pago = valorDe(await c.casos.declararPago(m.e.gerente, pedido(m, null)));
    valorDe(await c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Se pagó mal" }));
    expect(await movimientos(m.caja.sesionId)).toBe(1);
  });
});
