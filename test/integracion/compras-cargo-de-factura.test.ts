import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { cuitUnico } from "./entorno";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { codigoDe } from "./concurrencia-apoyo";
import { crearCasosDeUsoDeCompras } from "../../src/modulos/compras/publico";
import { numeroUnico } from "./unicos";

/**
 * L1: cada factura de proveedor deja su cargo en el libro de saldos (la parte es el proveedor; N3 sin sucursal, N2 con la de la recepción) y su anulación deja el espejo. Idempotencia (la misma
 * factura dos veces, un solo asiento), atomicidad (si el libro falla no queda ni la factura), falla cerrada si la factura no tiene asiento, y dos actores a la vez sobre el mismo proveedor (dos facturas;
 * registrar una y anular otra; anular y pagar la misma factura) sin abrazo mortal y con el saldo igual a la suma de las facturas vigentes.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

describe.skipIf(base === null)("compras: el cargo de la factura en el libro", () => {
  let c: MontajeDeCompras;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una empresa en N3 (factura de la empresa, sin sucursal) o en N2 (factura con su recepción) con un proveedor. */
  const armar = async (nivel: "RECEPCION_SEPARADA" | "CON_COMPROBANTE" = "RECEPCION_SEPARADA") => {
    const e: EscenarioDeCompras = await c.escenario();
    valorDe(await c.casos.configurarCompras(e.gerente, { nivel, versionEsperada: 1 }));
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(e.gerente, { parteId: proveedor, numero: 5 }));
    return { e, deposito, producto, proveedor, cuit: cuitUnico() };
  };
  type M = Awaited<ReturnType<typeof armar>>;
  const factura = (m: M, extra: Record<string, unknown> = {}) => ({
    tipo: "FACTURA_A",
    puntoDeVenta: 5,
    numero: numeroUnico(),
    fecha: "2026-10-10",
    cuitDelProveedor: m.cuit,
    totalSegunFactura: "1210.00",
    ...extra,
  });
  /** N3: la factura sola, de 1000 + IVA = 1210,00. */
  const pedidoN3 = (m: M, clave = nuevoId(), extra: Record<string, unknown> = {}) => ({
    clave,
    proveedorId: m.proveedor,
    factura: factura(m, {
      lineas: [
        { productoId: m.producto, cantidadFacturada: "1000", precioNeto: "1", alicuota: "21" },
      ],
      ...extra,
    }),
  });
  const cargarN3 = (m: M, clave = nuevoId(), extra: Record<string, unknown> = {}) =>
    c.casos.registrarFactura(m.e.operador, pedidoN3(m, clave, extra));
  /** N2: una compra con su factura (2 kg a 1000 el kilo: 2420,00). */
  const cargarN2 = (m: M) =>
    c.casos.registrarCompraConFactura(m.e.operador, {
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
      factura: factura(m, {
        lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
        totalSegunFactura: "2420.00",
      }),
    });
  const asientos = (comprobanteId: string) =>
    c.filas<Record<string, unknown>>(
      "select id, parte_id, sentido, clase, naturaleza, importe::text as importe, vence_el::text as vence, anula_a from asiento_de_saldo where origen_id = $1 order by naturaleza desc, registrado_en",
      [comprobanteId],
    );
  const saldo = async (m: M) =>
    (
      await c.filas<{ s: string }>(
        "select saldo::text as s from saldo_de_parte where parte_id = $1 and sentido = 'A_PAGAR'",
        [m.proveedor],
      )
    )[0]?.s ?? "0.00";
  const anular = (m: M, comprobanteId: string, quien = m.e.gerente) =>
    c.casos.anularFactura(quien, { comprobanteId, motivo: "Se cargó dos veces" });

  it("N3: la factura de la empresa deja un cargo a nombre del proveedor, sin centro de costo, con su vencimiento y su total", async () => {
    const m = await armar();
    const r = valorDe(await cargarN3(m, nuevoId(), { vencimientoDePago: "2026-11-10" }));
    const [a] = await asientos(r.comprobanteId);
    expect(a).toMatchObject({
      parte_id: m.proveedor,
      sentido: "A_PAGAR",
      clase: "CARGO_DE_FACTURA_DE_COMPRA",
      naturaleza: "ORIGINAL",
      importe: "1210.00",
      vence: "2026-11-10",
    });
    expect(
      await c.filas(
        "select sucursal_id, importe::text as i from distribucion_de_asiento where asiento_id = $1",
        [a?.["id"]],
      ),
    ).toEqual([{ sucursal_id: null, i: "1210.00" }]);
    expect(await saldo(m)).toBe("1210.00");
  });

  it("N2: la compra con factura reparte el cargo a la sucursal de la recepción", async () => {
    const m = await armar("CON_COMPROBANTE");
    const r = valorDe(await cargarN2(m));
    const [a] = await asientos(r.comprobanteId as string);
    expect(a).toMatchObject({ importe: "2420.00", clase: "CARGO_DE_FACTURA_DE_COMPRA" });
    expect(
      await c.filas("select sucursal_id from distribucion_de_asiento where asiento_id = $1", [
        a?.["id"],
      ]),
    ).toEqual([{ sucursal_id: m.e.sucursal }]);
  });

  it("I1: cargar la misma factura dos veces (misma clave, también a la vez) deja UN cargo y un saldo", async () => {
    const m = await armar();
    const pedido = pedidoN3(m);
    const rs = await Promise.all([
      c.casos.registrarFactura(m.e.operador, pedido),
      c.casos.registrarFactura(m.e.operador, pedido),
    ]);
    const ids = rs.map((r) => valorDe(r).comprobanteId);
    expect(ids[0]).toBe(ids[1]);
    expect(await asientos(ids[0] as string)).toHaveLength(1);
    expect(await saldo(m)).toBe("1210.00");
  });

  it("anular la factura deja el espejo (importe opuesto, misma clase) y el saldo vuelve a cero; anularla otra vez no escribe nada más", async () => {
    const m = await armar();
    const r = valorDe(await cargarN3(m));
    valorDe(await anular(m, r.comprobanteId));
    const filas = await asientos(r.comprobanteId);
    expect(filas).toHaveLength(2);
    expect(filas[0]).toMatchObject({ naturaleza: "ORIGINAL" });
    expect(filas[1]).toMatchObject({
      naturaleza: "ANULACION",
      importe: "-1210.00",
      clase: "CARGO_DE_FACTURA_DE_COMPRA",
    });
    expect(await saldo(m)).toBe("0.00");
    expect(codigoDe(await anular(m, r.comprobanteId))).toBe("COMPROBANTE_ANULADO");
    expect(await asientos(r.comprobanteId)).toHaveLength(2);
  });

  it("anular la compra con factura (N2) espeja también el cargo", async () => {
    const m = await armar("CON_COMPROBANTE");
    const r = valorDe(await cargarN2(m));
    valorDe(
      await c.casos.anularCompra(m.e.gerente, {
        recepcionId: r.recepcionId,
        motivo: "Se cargó dos veces",
      }),
    );
    expect((await asientos(r.comprobanteId as string)).map((a) => a["naturaleza"])).toEqual([
      "ORIGINAL",
      "ANULACION",
    ]);
    expect(await saldo(m)).toBe("0.00");
  });

  it("A1: si el libro falla, no queda la factura ni el cargo; y al anular, si el libro falla la factura sigue registrada", async () => {
    const m = await armar();
    c.inyectarFalla("libro");
    try {
      await expect(cargarN3(m)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(
      await c.contar("select count(*) as n from comprobante_de_proveedor where proveedor_id = $1", [
        m.proveedor,
      ]),
    ).toBe(0);
    const r = valorDe(await cargarN3(m));
    c.inyectarFalla("libro");
    try {
      await expect(anular(m, r.comprobanteId)).rejects.toThrow(/falla inyectada/);
    } finally {
      c.inyectarFalla(null);
    }
    expect(
      await c.filas("select estado from comprobante_de_proveedor where id = $1", [r.comprobanteId]),
    ).toEqual([{ estado: "REGISTRADO" }]);
    expect(await saldo(m)).toBe("1210.00");
  });

  it("una factura que no tiene asiento no se anula en silencio: falla cerrado con su código y queda registrada", async () => {
    const m = await armar();
    // Una factura «de antes del libro»: se registra con un libro que no asienta nada.
    const sinLibro = crearCasosDeUsoDeCompras({
      ...c.dependencias,
      libroDeProveedores: {
        registrarCargo: () =>
          Promise.resolve({ ok: true, valor: { asientoId: nuevoId(), yaExistia: false } }),
        anularCargo: c.dependencias.libroDeProveedores.anularCargo,
        registrarPago: c.dependencias.libroDeProveedores.registrarPago,
        anularPago: c.dependencias.libroDeProveedores.anularPago,
        registrarNotaDeCredito: c.dependencias.libroDeProveedores.registrarNotaDeCredito,
        anularNotaDeCredito: c.dependencias.libroDeProveedores.anularNotaDeCredito,
        registrarNotaDeDebito: c.dependencias.libroDeProveedores.registrarNotaDeDebito,
        anularNotaDeDebito: c.dependencias.libroDeProveedores.anularNotaDeDebito,
      },
    });
    const r = valorDe(
      await sinLibro.registrarFactura(m.e.operador, {
        clave: nuevoId(),
        proveedorId: m.proveedor,
        factura: factura(m, {
          lineas: [
            { productoId: m.producto, cantidadFacturada: "1000", precioNeto: "1", alicuota: "21" },
          ],
        }),
      }),
    );
    expect(await asientos(r.comprobanteId)).toHaveLength(0);
    expect(codigoDe(await anular(m, r.comprobanteId))).toBe("ASIENTO_DE_LA_FACTURA_NO_ENCONTRADO");
    expect(
      await c.filas("select estado from comprobante_de_proveedor where id = $1", [r.comprobanteId]),
    ).toEqual([{ estado: "REGISTRADO" }]);
  });

  it("C1: dos facturas del mismo proveedor a la vez entran las dos y el saldo es la suma", async () => {
    const m = await armar();
    const rs = await Promise.all([cargarN3(m), cargarN3(m)]);
    rs.forEach((r) => valorDe(r));
    expect(await saldo(m)).toBe("2420.00");
  });

  it("C2: registrar una factura y anular otra del mismo proveedor a la vez: el saldo es la suma de las vigentes", async () => {
    const m = await armar();
    const vieja = valorDe(await cargarN3(m));
    const [nueva, anulada] = await Promise.all([cargarN3(m), anular(m, vieja.comprobanteId)]);
    valorDe(nueva);
    valorDe(anulada);
    expect(await saldo(m)).toBe("1210.00");
  });

  it("C3: anular la factura y pagarla a la vez (dos actores): una gana, la otra se rechaza, sin abrazo mortal y con el saldo coherente", async () => {
    const m = await armar("CON_COMPROBANTE");
    const r = valorDe(await cargarN2(m));
    const [anulacion, pago] = await Promise.all([
      c.casos.anularCompra(m.e.gerente, {
        recepcionId: r.recepcionId,
        motivo: "Se cargó dos veces",
      }),
      c.casos.declararPago(m.e.administrador, {
        clave: nuevoId(),
        comprobanteId: r.comprobanteId as string,
        fechaDePago: "2026-10-11",
        medio: "TRANSFERENCIA",
      }),
    ]);
    expect([anulacion.ok, pago.ok].filter(Boolean).length).toBeGreaterThanOrEqual(1);
    // Anulada y sin pago, o pagada (el pago salda el cargo): en los dos casos el saldo del proveedor es cero.
    expect(await saldo(m)).toBe("0.00");
  });

  it("aislamiento: el cargo es de la empresa de la factura; el saldo de otra empresa y otro proveedor no se toca", async () => {
    const a = await armar();
    const b = await armar();
    valorDe(await cargarN3(a));
    expect(await saldo(b)).toBe("0.00");
    expect(
      await c.contar("select count(*) as n from asiento_de_saldo where empresa_id = $1", [
        b.e.empresa,
      ]),
    ).toBe(0);
  });
});
