import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { codigoDe } from "./concurrencia-apoyo";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import { comprobanteDeBase } from "./compras-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * E9-T10: el pago mínimo de la factura (D142): declararlo, anularlo y que viaje con la compra. Un pago por factura, sin parciales, que NO mueve la caja.
 * Permisos (gerente y administrador), idempotencia por clave, concurrencia (dos pagos a la vez: uno), anulación con registro (se puede declarar otro) y alcance.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: pago de la factura", () => {
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

  /** Una compra N2 con su factura (total 2420,00), lista para pagar. */
  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    const cuit = cuitUnico();
    const compra = (extra: Record<string, unknown> = {}) => ({
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
        cuitDelProveedor: cuit,
      },
      ...extra,
    });
    const r = valorDe(await c.casos.registrarCompraConFactura(e.operador, compra()));
    return {
      e,
      deposito,
      producto,
      proveedor,
      compra,
      recepcionId: r.recepcionId,
      comprobanteId: r.comprobanteId as string,
    };
  };
  const pagoPedido = (m: { comprobanteId: string }, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    comprobanteId: m.comprobanteId,
    fechaDePago: "2026-10-11",
    medio: "TRANSFERENCIA",
    ...extra,
  });
  const pagos = (comprobanteId: string) =>
    c.contar("select count(*) as n from pago_de_comprobante where comprobante_id = $1", [
      comprobanteId,
    ]);

  it("el gerente declara el pago: se copia el total de la factura, queda quién y cuándo, y NO se mueve la caja", async () => {
    const m = await armar();
    const antesDeCaja = await c.contar("select count(*) as n from movimiento_caja");
    const r = valorDe(await c.casos.declararPago(m.e.gerente, pagoPedido(m)));
    expect(r.yaExistia).toBe(false);
    const [pago] = await c.filas<Record<string, unknown>>(
      "select fecha_de_pago::text as fecha, medio, importe::text as importe, moneda, estado, registrado_por from pago_de_comprobante where id = $1",
      [r.pagoId],
    );
    expect(pago).toEqual({
      fecha: "2026-10-11",
      medio: "TRANSFERENCIA",
      importe: "2420.00",
      moneda: "ARS",
      estado: "VIGENTE",
      registrado_por: m.e.gerente.personaId,
    });
    expect((await c.auditoria(m.e.empresa, "PAGO_DECLARADO")).at(-1)).toMatchObject({
      entidad_id: r.pagoId,
      actor_persona_id: m.e.gerente.personaId,
    });
    expect(await c.contar("select count(*) as n from movimiento_caja")).toBe(antesDeCaja);
    const ficha = valorDe(
      await c.consultas.fichaDeCompra(m.e.gerente, { recepcionId: m.recepcionId }),
    );
    expect(ficha?.pagos).toMatchObject([{ id: r.pagoId, estado: "VIGENTE", importe: "2420.00" }]);
    expect(ficha?.comprobante).toMatchObject({
      totalSegunFactura: "2420.00",
      estado: "REGISTRADO",
    });
  });

  it("I5: el mismo pago dos veces (misma clave) deja un pago y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA", async () => {
    const m = await armar();
    const pedido = pagoPedido(m);
    const primero = valorDe(await c.casos.declararPago(m.e.gerente, pedido));
    const auditorias = (await c.auditoria(m.e.empresa, "PAGO_DECLARADO")).length;
    expect(valorDe(await c.casos.declararPago(m.e.administrador, pedido))).toEqual({
      pagoId: primero.pagoId,
      yaExistia: true,
    });
    expect(await pagos(m.comprobanteId)).toBe(1);
    expect((await c.auditoria(m.e.empresa, "PAGO_DECLARADO")).length).toBe(auditorias);
    expect(await c.casos.declararPago(m.e.gerente, { ...pedido, medio: "QR" })).toEqual({
      ok: false,
      error: "CLAVE_REUTILIZADA",
    });
    expect(await pagos(m.comprobanteId)).toBe(1);
  });

  it("una segunda declaración con otra clave es COMPROBANTE_YA_PAGADO con el id del pago vigente", async () => {
    const m = await armar();
    const primero = valorDe(await c.casos.declararPago(m.e.gerente, pagoPedido(m)));
    expect(await c.casos.declararPago(m.e.gerente, pagoPedido(m, { medio: "EFECTIVO" }))).toEqual({
      ok: false,
      error: { error: "COMPROBANTE_YA_PAGADO", pagoId: primero.pagoId },
    });
    expect(await pagos(m.comprobanteId)).toBe(1);
  });

  it("C8: dos pagos de la misma factura a la vez (claves distintas): uno; el otro COMPROBANTE_YA_PAGADO", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      c.armarBarrera(2);
      try {
        const resultados = await Promise.all([
          c.casos.declararPago(m.e.gerente, pagoPedido(m)),
          c.casos.declararPago(m.e.administrador, pagoPedido(m, { medio: "QR" })),
        ]);
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        for (const r of resultados.filter((x) => !x.ok)) {
          expect(["COMPROBANTE_YA_PAGADO", "ConcurrenciaAgotada"]).toContain(codigo(r));
        }
      } finally {
        c.soltarBarrera();
      }
      expect(await pagos(m.comprobanteId)).toBe(1);
    }
  });

  it("I5: anular dos veces el mismo pago deja un solo espejo y la segunda da PAGO_YA_ANULADO; después se puede declarar otro", async () => {
    const m = await armar();
    const primero = valorDe(await c.casos.declararPago(m.e.gerente, pagoPedido(m)));
    expect(
      valorDe(
        await c.casos.anularPago(m.e.administrador, {
          pagoId: primero.pagoId,
          motivo: "Se pagó con otro medio",
        }),
      ),
    ).toEqual({ anulado: true });
    const auditorias = (await c.auditoria(m.e.empresa, "PAGO_ANULADO")).length;
    expect(
      await c.casos.anularPago(m.e.gerente, { pagoId: primero.pagoId, motivo: "Otra vez" }),
    ).toEqual({ ok: false, error: "PAGO_YA_ANULADO" });
    expect((await c.auditoria(m.e.empresa, "PAGO_ANULADO")).length).toBe(auditorias);
    const [anulado] = await c.filas<Record<string, unknown>>(
      "select estado, anulado_por, motivo_de_anulacion from pago_de_comprobante where id = $1",
      [primero.pagoId],
    );
    expect(anulado).toEqual({
      estado: "ANULADO",
      anulado_por: m.e.administrador.personaId,
      motivo_de_anulacion: "Se pagó con otro medio",
    });
    const segundo = valorDe(
      await c.casos.declararPago(m.e.gerente, pagoPedido(m, { medio: "EFECTIVO" })),
    );
    expect(segundo.pagoId).not.toBe(primero.pagoId);
    expect(await pagos(m.comprobanteId)).toBe(2);
  });

  it("anular dos veces a la vez deja una sola anulación", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const pago = valorDe(await c.casos.declararPago(m.e.gerente, pagoPedido(m)));
      c.armarBarrera(2);
      try {
        const resultados = await Promise.all([
          c.casos.anularPago(m.e.gerente, { pagoId: pago.pagoId, motivo: "Una" }),
          c.casos.anularPago(m.e.administrador, { pagoId: pago.pagoId, motivo: "Otra" }),
        ]);
        expect(resultados.filter((r) => r.ok)).toHaveLength(1);
        for (const r of resultados.filter((x) => !x.ok))
          expect(["PAGO_YA_ANULADO", "ConcurrenciaAgotada"]).toContain(codigo(r));
      } finally {
        c.soltarBarrera();
      }
    }
  });

  it("el operador no paga ni anula pagos (SIN_PERMISO); el sistema (sin persona) tampoco", async () => {
    const m = await armar();
    expect(await c.casos.declararPago(m.e.operador, pagoPedido(m))).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    const pago = valorDe(await c.casos.declararPago(m.e.gerente, pagoPedido(m)));
    expect(
      await c.casos.anularPago(m.e.operador, { pagoId: pago.pagoId, motivo: "Quiero" }),
    ).toMatchObject({ ok: false, error: "SIN_PERMISO" });
    expect(
      await c.casos.declararPago({ ...m.e.gerente, personaId: null }, pagoPedido(m)),
    ).toMatchObject({ ok: false });
    expect(await pagos(m.comprobanteId)).toBe(1);
  });

  it("rechaza lo que no se puede pagar: comprobante que no existe, anulado, nota de crédito; fecha futura; medio inválido; ids inválidos", async () => {
    const m = await armar();
    expect(
      await c.casos.declararPago(m.e.gerente, pagoPedido({ comprobanteId: nuevoId() })),
    ).toEqual({ ok: false, error: "COMPROBANTE_NO_ENCONTRADO" });
    expect(
      await c.casos.declararPago(m.e.gerente, pagoPedido(m, { fechaDePago: "2026-10-12" })),
    ).toEqual({ ok: false, error: "FECHA_INVALIDA" });
    expect(await c.casos.declararPago(m.e.gerente, pagoPedido(m, { medio: "CHEQUE" }))).toEqual({
      ok: false,
      error: "MEDIO_INVALIDO",
    });
    expect(await c.casos.declararPago(m.e.gerente, pagoPedido(m, { clave: "x" }))).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    expect(await c.casos.declararPago(m.e.gerente, pagoPedido({ comprobanteId: "x" }))).toEqual({
      ok: false,
      error: "IDENTIFICADOR_INVALIDO",
    });
    const nota = await comprobanteDeBase(
      c.dueno,
      { empresa: m.e.empresa, persona: m.e.personaDelGerente },
      m.proveedor,
      { tipo: "NOTA_CREDITO_A", puntoDeVenta: 5, numero: 777 },
    );
    expect(await c.casos.declararPago(m.e.gerente, pagoPedido({ comprobanteId: nota }))).toEqual({
      ok: false,
      error: "COMPROBANTE_NO_PAGABLE",
    });
    const anulada = valorDe(await c.casos.registrarCompraConFactura(m.e.operador, m.compra()));
    valorDe(
      await c.casos.anularCompra(m.e.gerente, {
        recepcionId: anulada.recepcionId,
        motivo: "Error de carga",
      }),
    );
    expect(
      await c.casos.declararPago(
        m.e.gerente,
        pagoPedido({ comprobanteId: anulada.comprobanteId as string }),
      ),
    ).toEqual({ ok: false, error: "COMPROBANTE_ANULADO" });
    expect(await c.casos.anularPago(m.e.gerente, { pagoId: nuevoId(), motivo: "Quiero" })).toEqual({
      ok: false,
      error: "PAGO_NO_ENCONTRADO",
    });
    expect(await c.casos.anularPago(m.e.gerente, { pagoId: "x", motivo: "Quiero" })).toEqual({
      ok: false,
      error: "PAGO_NO_ENCONTRADO",
    });
    expect(await c.casos.anularPago(m.e.gerente, { pagoId: nuevoId(), motivo: "" })).toEqual({
      ok: false,
      error: "MOTIVO_REQUERIDO",
    });
  });

  it("el pago puede viajar con la compra: queda vigente con el total de la factura; repetir devuelve el mismo pago; sin factura es FACTURA_REQUERIDA; el operador no puede pagar", async () => {
    const m = await armar();
    const pedido = m.compra({ pago: { fechaDePago: "2026-10-11", medio: "EFECTIVO" } });
    expect(await c.casos.registrarCompraConFactura(m.e.operador, pedido)).toMatchObject({
      ok: false,
      error: "SIN_PERMISO",
    });
    const r = valorDe(await c.casos.registrarCompraConFactura(m.e.gerente, pedido));
    expect(r.pagoId).not.toBeNull();
    expect(
      await c.filas(
        "select estado, importe::text as importe, medio from pago_de_comprobante where id = $1",
        [r.pagoId],
      ),
    ).toEqual([{ estado: "VIGENTE", importe: "2420.00", medio: "EFECTIVO" }]);
    expect(valorDe(await c.casos.registrarCompraConFactura(m.e.gerente, pedido))).toEqual({
      ...r,
      yaExistia: true,
    });
    expect(
      await c.casos.declararPago(
        m.e.gerente,
        pagoPedido({ comprobanteId: r.comprobanteId as string }),
      ),
    ).toMatchObject({ ok: false, error: { error: "COMPROBANTE_YA_PAGADO" } });
    const { factura: _f, ...sinFactura } = m.compra({
      pago: { fechaDePago: "2026-10-11", medio: "EFECTIVO" },
    });
    void _f;
    expect(await c.casos.registrarCompraConFactura(m.e.gerente, sinFactura)).toEqual({
      ok: false,
      error: "FACTURA_REQUERIDA",
    });
    // la compra simple (N1) no lleva ni factura ni pago
    expect(
      await c.casos.registrarCompra(
        m.e.gerente,
        m.compra({ pago: { fechaDePago: "2026-10-11", medio: "EFECTIVO" } }),
      ),
    ).toEqual({
      ok: false,
      error: "COMPRA_SIMPLE_NO_LLEVA_FACTURA",
    });
    expect(await c.casos.registrarCompra(m.e.gerente, sinFactura)).toEqual({
      ok: false,
      error: "COMPRA_SIMPLE_NO_LLEVA_FACTURA",
    });
    expect(
      await c.casos.registrarCompraConFactura(
        m.e.gerente,
        m.compra({ pago: { fechaDePago: "2027-01-01", medio: "EFECTIVO" } }),
      ),
    ).toEqual({ ok: false, error: "FECHA_INVALIDA" });
  });

  it("anular la compra anula también su pago vigente", async () => {
    const m = await armar();
    const r = valorDe(
      await c.casos.registrarCompraConFactura(
        m.e.gerente,
        m.compra({ pago: { fechaDePago: "2026-10-11", medio: "QR" } }),
      ),
    );
    valorDe(
      await c.casos.anularCompra(m.e.gerente, { recepcionId: r.recepcionId, motivo: "Devolución" }),
    );
    expect(
      await c.filas("select estado, anulado_por from pago_de_comprobante where id = $1", [
        r.pagoId,
      ]),
    ).toEqual([{ estado: "ANULADO", anulado_por: m.e.gerente.personaId }]);
  });

  it("R6: una empresa B no ve ni toca los pagos de la A; y el alcance de sucursales vale para pagar", async () => {
    const m = await armar();
    const otra = await c.escenario();
    expect(await c.casos.declararPago(otra.gerente, pagoPedido(m))).toEqual({
      ok: false,
      error: "COMPROBANTE_NO_ENCONTRADO",
    });
    const pago = valorDe(await c.casos.declararPago(m.e.gerente, pagoPedido(m)));
    expect(
      await c.casos.anularPago(otra.gerente, { pagoId: pago.pagoId, motivo: "No es mío" }),
    ).toEqual({ ok: false, error: "PAGO_NO_ENCONTRADO" });
    c.alcances.set(m.e.administrador.personaId as string, [m.e.otraSucursal]);
    try {
      expect(
        await c.casos.anularPago(m.e.administrador, {
          pagoId: pago.pagoId,
          motivo: "Fuera de alcance",
        }),
      ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    } finally {
      c.alcances.delete(m.e.administrador.personaId as string);
    }
  });
});
