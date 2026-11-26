import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cuitUnico } from "./entorno";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { crearCasosDeUsoDeCompras } from "../../src/modulos/compras/publico";
import { numeroUnico } from "./unicos";

/**
 * L2: cada pago de una factura deja su asiento de pago en el libro (resta) imputado contra el cargo de la factura, y anular el pago deja el espejo y deshace la imputación. Idempotencia (el mismo pago dos veces,
 * un solo asiento), atomicidad (si el libro falla no queda el pago), falla cerrada si la factura no tiene cargo, la compra N2 con pago, y dos actores a la vez (pagar y anular la factura; anular el pago y anular
 * la factura) sin abrazo mortal y con el saldo coherente.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: el pago de la factura en el libro", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** El código del error, también cuando viene con datos (`{ error, pagoId }`). */
  const codigo = (r: Parameters<typeof codigoDe>[0]): string =>
    !r.ok && typeof r.error === "object" && r.error !== null && "error" in r.error
      ? String(r.error.error)
      : codigoDe(r);

  const armar = async () => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, { nivel: "CON_COMPROBANTE", versionEsperada: 1 }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    return { e, deposito, producto, proveedor, cuit: cuitUnico() };
  };
  type M = Awaited<ReturnType<typeof armar>>;
  /** N2: una compra con su factura de 2420,00, con el pago de la compra si se pide. */
  const pedidoN2 = (m: M, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    sucursalId: m.e.sucursal,
    proveedorId: m.proveedor,
    depositoId: m.deposito,
    renglones: [
      {
        productoId: m.producto,
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
      cuitDelProveedor: m.cuit,
      totalSegunFactura: "2420.00",
      lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
    },
    ...extra,
  });
  const cargar = async (m: M) =>
    valorDe(await c.casos.registrarCompraConFactura(m.e.operador, pedidoN2(m)));
  const pagar = (m: M, comprobanteId: unknown, clave = nuevoId()) =>
    c.casos.declararPago(m.e.gerente, {
      clave,
      comprobanteId: comprobanteId as string,
      fechaDePago: "2026-10-11",
      medio: "TRANSFERENCIA",
    });
  const anularPago = (m: M, pagoId: string, quien = m.e.gerente) =>
    c.casos.anularPago(quien, { pagoId, motivo: "Se pagó mal" });
  /** En N2 la factura se anula con su compra. */
  const anularLaCompra = (m: M, recepcionId: string, quien = m.e.administrador) =>
    c.casos.anularCompra(quien, { recepcionId, motivo: "Se cargó dos veces" });

  const delPago = (pagoId: string) =>
    c.filas<Record<string, unknown>>(
      "select id, empresa_id, parte_id, clase, naturaleza, importe::text as importe from asiento_de_saldo where origen_tipo = 'compras.pago' and origen_id = $1 order by naturaleza desc, registrado_en",
      [pagoId],
    );
  const imputado = async (pagoId: string) =>
    (
      await c.filas<{ t: string }>(
        `select coalesce(sum(i.importe), 0)::text as t from imputacion_de_saldo i
           join asiento_de_saldo a on a.id = i.saldante_id and a.empresa_id = i.empresa_id
          where a.origen_tipo = 'compras.pago' and a.origen_id = $1`,
        [pagoId],
      )
    )[0]?.t;
  const saldo = async (m: M) =>
    (
      await c.filas<{ s: string }>(
        "select saldo::text as s from saldo_de_parte where parte_id = $1 and sentido = 'A_PAGAR'",
        [m.proveedor],
      )
    )[0]?.s ?? "0.00";
  const cuantosPagos = (comprobanteId: unknown) =>
    c.contar("select count(*) as n from pago_de_comprobante where comprobante_id = $1", [
      comprobanteId,
    ]);

  it("pagar deja el asiento de pago a nombre del proveedor, con la distribución del cargo, imputado contra él: el saldo queda en cero", async () => {
    const m = await armar();
    const f = await cargar(m);
    expect(await saldo(m)).toBe("2420.00");
    const r = valorDe(await pagar(m, f.comprobanteId));
    const [a] = await delPago(r.pagoId);
    expect(a).toMatchObject({
      empresa_id: m.e.empresa,
      parte_id: m.proveedor,
      clase: "PAGO_A_PROVEEDOR",
      naturaleza: "ORIGINAL",
      importe: "-2420.00",
    });
    expect(
      await c.filas(
        "select sucursal_id, importe::text as i from distribucion_de_asiento where asiento_id = $1",
        [a?.["id"]],
      ),
    ).toEqual([{ sucursal_id: m.e.sucursal, i: "-2420.00" }]);
    expect(await imputado(r.pagoId)).toBe("2420.00");
    expect(await saldo(m)).toBe("0.00");
    // Cargo y pago netean a cero también por centro de costo (la distribución del pago es la del cargo, negada).
    expect(
      await c.filas(
        `select d.sucursal_id, coalesce(sum(d.importe), 0)::text as t from distribucion_de_asiento d
           join asiento_de_saldo a on a.id = d.asiento_id and a.empresa_id = d.empresa_id
          where a.parte_id = $1 group by d.sucursal_id`,
        [m.proveedor],
      ),
    ).toEqual([{ sucursal_id: m.e.sucursal, t: "0.00" }]);
  });

  it("la compra N2 que viaja con su pago también lo deja en el libro", async () => {
    const m = await armar();
    const r = valorDe(
      await c.casos.registrarCompraConFactura(
        m.e.gerente,
        pedidoN2(m, { pago: { fechaDePago: "2026-10-11", medio: "TRANSFERENCIA" } }),
      ),
    );
    expect(await delPago(r.pagoId as string)).toHaveLength(1);
    expect(await imputado(r.pagoId as string)).toBe("2420.00");
    expect(await saldo(m)).toBe("0.00");
  });

  it("I: repetir el mismo pago (misma clave, también a la vez) deja UN asiento y UNA imputación", async () => {
    const m = await armar();
    const f = await cargar(m);
    const clave = nuevoId();
    c.armarBarrera(2);
    let resultados;
    try {
      resultados = await Promise.all([
        pagar(m, f.comprobanteId, clave),
        pagar(m, f.comprobanteId, clave),
      ]);
    } finally {
      c.soltarBarrera();
    }
    expect(resultados.filter((r) => r.ok).length).toBeGreaterThanOrEqual(1);
    const [pagoId = ""] = resultados.flatMap((r) => (r.ok ? [r.valor.pagoId] : []));
    expect(await delPago(pagoId)).toHaveLength(1);
    expect(await imputado(pagoId)).toBe("2420.00");
    expect(await saldo(m)).toBe("0.00");
    expect(valorDe(await pagar(m, f.comprobanteId, clave))).toMatchObject({ yaExistia: true });
    expect(await delPago(pagoId)).toHaveLength(1);
  });

  it("anular el pago deja el espejo, deshace la imputación y el saldo vuelve al cargo; repetir la anulación no toca el libro; se puede pagar de nuevo", async () => {
    const m = await armar();
    const f = await cargar(m);
    const r = valorDe(await pagar(m, f.comprobanteId));
    valorDe(await anularPago(m, r.pagoId));
    const filas = await delPago(r.pagoId);
    expect(filas.map((x) => [x["naturaleza"], x["importe"]])).toEqual([
      ["ORIGINAL", "-2420.00"],
      ["ANULACION", "2420.00"],
    ]);
    expect(await imputado(r.pagoId)).toBe("0.00");
    expect(await saldo(m)).toBe("2420.00");
    expect(await anularPago(m, r.pagoId)).toEqual({ ok: false, error: "PAGO_YA_ANULADO" });
    expect(await delPago(r.pagoId)).toHaveLength(2);
    const otro = valorDe(await pagar(m, f.comprobanteId));
    expect(otro.pagoId).not.toBe(r.pagoId);
    expect(await saldo(m)).toBe("0.00");
  });

  it("A: si el libro falla al pagar no queda el pago ni sus líneas; si falla al anular, el pago sigue vigente", async () => {
    const m = await armar();
    const f = await cargar(m);
    c.inyectarFalla("libro-pago");
    try {
      await expect(pagar(m, f.comprobanteId)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await cuantosPagos(f.comprobanteId)).toBe(0);
    expect(
      await c.contar("select count(*) as n from medio_de_un_pago where empresa_id = $1", [
        m.e.empresa,
      ]),
    ).toBe(0);
    const r = valorDe(await pagar(m, f.comprobanteId));
    c.inyectarFalla("libro-pago");
    try {
      await expect(anularPago(m, r.pagoId)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(
      await c.filas("select estado from pago_de_comprobante where id = $1", [r.pagoId]),
    ).toEqual([{ estado: "VIGENTE" }]);
    expect(await saldo(m)).toBe("0.00");
  });

  it("una factura sin cargo en el libro (anterior a L1) no se paga en silencio: falla cerrado y no queda el pago", async () => {
    const m = await armar();
    const sinLibro = crearCasosDeUsoDeCompras({
      ...c.dependencias,
      libroDeProveedores: {
        ...c.dependencias.libroDeProveedores,
        registrarCargo: () =>
          Promise.resolve({ ok: true, valor: { asientoId: nuevoId(), yaExistia: false } }),
      },
    });
    const f = valorDe(await sinLibro.registrarCompraConFactura(m.e.operador, pedidoN2(m)));
    expect(codigoDe(await pagar(m, f.comprobanteId))).toBe("ASIENTO_DE_LA_FACTURA_NO_ENCONTRADO");
    expect(await cuantosPagos(f.comprobanteId)).toBe(0);
  });

  it("C1: pagar y anular la misma factura a la vez, sin abrazo mortal: o queda anulada sin pago, o pagada y la anulación rechazada", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const f = await cargar(m);
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          pagar(m, f.comprobanteId),
          anularLaCompra(m, f.recepcionId),
        ]);
      } finally {
        c.soltarBarrera();
      }
      for (const r of resultados.filter((x) => !x.ok)) {
        expect(["COMPROBANTE_ANULADO", "COMPROBANTE_YA_PAGADO", "ConcurrenciaAgotada"]).toContain(
          codigo(r),
        );
        expect(codigo(r)).not.toBe("ConcurrenciaAgotada");
      }
      const pagos = await cuantosPagos(f.comprobanteId);
      const [fila] = await c.filas<{ estado: string }>(
        "select estado from comprobante_de_proveedor where id = $1",
        [f.comprobanteId],
      );
      expect(pagos === 1 ? fila?.estado === "REGISTRADO" : fila?.estado === "ANULADO").toBe(true);
      expect(await saldo(m)).toBe("0.00");
    }
  });

  it("C2: anular el pago y anular su factura a la vez, sin abrazo mortal: el pago queda anulado y la factura, anulada solo si el pago se anuló antes", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const f = await cargar(m);
      const r = valorDe(await pagar(m, f.comprobanteId));
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([anularPago(m, r.pagoId), anularLaCompra(m, f.recepcionId)]);
      } finally {
        c.soltarBarrera();
      }
      for (const x of resultados.filter((y) => !y.ok)) {
        expect(["COMPROBANTE_YA_PAGADO", "ConcurrenciaAgotada"]).toContain(codigo(x));
        expect(codigo(x)).not.toBe("ConcurrenciaAgotada");
      }
      expect(resultados[0]?.ok).toBe(true);
      const [fila] = await c.filas<{ estado: string }>(
        "select estado from comprobante_de_proveedor where id = $1",
        [f.comprobanteId],
      );
      expect(await saldo(m)).toBe(fila?.estado === "ANULADO" ? "0.00" : "2420.00");
    }
  });

  it("C3: anular el pago y declarar otro a la vez sobre la misma factura, sin abrazo mortal: el nuevo se rechaza o entra después de la anulación, y el saldo queda coherente", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const m = await armar();
      const f = await cargar(m);
      const r = valorDe(await pagar(m, f.comprobanteId));
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([anularPago(m, r.pagoId), pagar(m, f.comprobanteId)]);
      } finally {
        c.soltarBarrera();
      }
      expect(resultados[0].ok).toBe(true);
      for (const x of resultados.filter((y) => !y.ok)) {
        expect(codigo(x)).toBe("COMPROBANTE_YA_PAGADO");
      }
      const vigentes = await c.contar(
        "select count(*) as n from pago_de_comprobante where comprobante_id = $1 and estado = 'VIGENTE'",
        [f.comprobanteId],
      );
      expect(vigentes).toBe(resultados[1].ok ? 1 : 0);
      expect(await saldo(m)).toBe(resultados[1].ok ? "0.00" : "2420.00");
    }
  });
});
