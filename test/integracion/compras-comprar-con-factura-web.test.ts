import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  registrarLaCompra,
  type DependenciasDeRegistrarCompraWeb,
} from "../../src/composicion/comprar-web";
import { RONDAS, nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { cuitUnico } from "./entorno";
import { numeroUnico } from "./unicos";

/**
 * Compras PR 7: «Comprar y recibir con factura» (nivel «Con factura») por la composición web, con una base real. El caso de uso (`registrarCompraConFactura`) ya tiene sus pruebas de servidor; ésta prueba lo que
 * agrega la pantalla: la frontera (la factura tal como la manda el navegador, con lista de permitidos), y de punta a punta IDEMPOTENCIA (el mismo envío dos veces, también a la vez: una compra, UN comprobante, una
 * auditoría), CONCURRENCIA (la misma factura con otra clave a la vez: una gana y la otra recibe «Esa factura ya está cargada»), los avisos que no frenan (total que no coincide, letra no esperada),
 * el punto de venta no declarado, el nivel de la empresa decidido en el servidor, ATOMICIDAD (una factura rechazada no deja compra ni stock) y AISLAMIENTO entre empresas.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

describe.skipIf(base === null)("composición web: Comprar y recibir con factura", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeRegistrarCompraWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    d = { casosDeUso: () => c.casos, respuesta: { registrar: (x) => registrados.push(x) } };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una empresa «Con factura» con su depósito, su producto, un proveedor responsable inscripto con el punto de venta 5 declarado. */
  const mundo = async (nivel: "CON_COMPROBANTE" | "COMPRA_SIMPLE" = "CON_COMPROBANTE") => {
    const x: EscenarioDeCompras = await c.escenario();
    if (nivel === "CON_COMPROBANTE") {
      valorDe(await c.casos.configurarCompras(x.gerente, { nivel, versionEsperada: 1 }));
    }
    const deposito = await c.deposito(x);
    const { producto, articulo } = await c.articulo(x, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(x.operador, { condicionIva: "RESPONSABLE_INSCRIPTO" });
    valorDe(await c.casos.agregarPuntoDeVenta(x.gerente, { parteId: proveedor, numero: 5 }));
    return { x, m: { deposito, producto, articulo, proveedor } };
  };
  type Montaje = Awaited<ReturnType<typeof mundo>>["m"];

  /** 2 kg a 1000 el kilo (entran 2000 g) y su factura A: 2000 g a 1 neto + IVA 21 % = 2420,00. */
  const factura = (extra: Record<string, unknown> = {}) => ({
    tipo: "FACTURA_A",
    puntoDeVenta: "5",
    numero: String(numeroUnico()),
    fecha: "2026-10-10",
    vencimientoDePago: "",
    lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
    percepciones: "",
    totalSegunFactura: "2420.00",
    cuitDelProveedor: cuitUnico(),
    condicionIva: "",
    ...extra,
  });
  const pedido = (m: Montaje, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    proveedorId: m.proveedor,
    renglones: [
      {
        productoId: m.producto,
        unidadDeCompraId: "KILOGRAMO",
        cantidad: "2",
        precioPor: "UNIDAD",
        unidadDePrecioId: "KILOGRAMO",
        precio: "1000.00",
      },
    ],
    factura: factura(),
    ...extra,
  });
  const comprar = (quien: EscenarioDeCompras["operador"], sucursal: string, crudo: unknown) =>
    registrarLaCompra(d, quien, sucursal, crudo);
  const recepciones = (m: Montaje) =>
    c.contar("select count(*) as n from recepcion where proveedor_id = $1", [m.proveedor]);
  const comprobantes = (m: Montaje) =>
    c.contar("select count(*) as n from comprobante_de_proveedor where proveedor_id = $1", [
      m.proveedor,
    ]);
  const movimientos = (m: Montaje) =>
    c.contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [m.deposito]);
  const auditadas = async (x: EscenarioDeCompras) =>
    (await c.auditoria(x.empresa, "COMPRA_REGISTRADA")).length;

  it("registra la compra con su factura, entra el stock y avisa nada cuando el total coincide; la respuesta trae solo lo que la pantalla necesita", async () => {
    const { x, m } = await mundo();
    const r = await comprar(x.operador, x.sucursal, pedido(m));
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false, avisos: [] } });
    if (!r.ok) return;
    expect(Object.keys(r.dato).sort()).toEqual(["avisos", "recepcionId", "yaExistia"]);
    expect(await recepciones(m)).toBe(1);
    expect(await comprobantes(m)).toBe(1);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    const [f] = await c.filas<{ total: string; pv: number }>(
      "select total_segun_factura::text as total, punto_de_venta as pv from comprobante_de_proveedor where proveedor_id = $1",
      [m.proveedor],
    );
    expect(f).toEqual({ total: "2420.00", pv: 5 });
  });

  it("IDEMPOTENCIA: el mismo envío dos veces seguidas y a la vez (doble toque) es UNA compra, UN comprobante, UNA entrada de stock y UNA auditoría", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const mismo = pedido(m);
      const [a, b] = await Promise.all([
        comprar(x.operador, x.sucursal, mismo),
        comprar(x.operador, x.sucursal, mismo),
      ]);
      expect([a.ok, b.ok].some(Boolean)).toBe(true);
      const otra = await comprar(x.operador, x.sucursal, mismo);
      expect(otra).toMatchObject({ ok: true, dato: { yaExistia: true } });
      expect(await recepciones(m)).toBe(1);
      expect(await comprobantes(m)).toBe(1);
      expect(await movimientos(m)).toBe(1);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
      expect((await c.auditoria(x.empresa, "COMPRA_REGISTRADA")).length).toBe(1);
    }
  });

  it("CONCURRENCIA: la misma factura (mismo proveedor, tipo, punto de venta y número) con OTRA clave a la vez: una gana y la otra recibe «Esa factura ya está cargada» sin dejar compra ni stock", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const repetida = factura();
      const [a, b] = await Promise.all([
        comprar(x.operador, x.sucursal, pedido(m, { factura: repetida })),
        comprar(x.operador, x.sucursal, pedido(m, { factura: repetida })),
      ]);
      expect([a.ok, b.ok].sort()).toEqual([false, true]);
      const perdedora = a.ok ? b : a;
      expect(perdedora).toMatchObject({ ok: false, error: { codigo: "COMPRAS_FACTURA_REPETIDA" } });
      expect(await recepciones(m)).toBe(1);
      expect(await comprobantes(m)).toBe(1);
      expect(await movimientos(m)).toBe(1);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
      expect(await auditadas(x)).toBe(1);
    }
  });

  it("un total que no coincide con la suma se guarda igual, «tal como vino», y avisa; una letra que no era la esperada también", async () => {
    const { x, m } = await mundo();
    const r = await comprar(
      x.operador,
      x.sucursal,
      pedido(m, {
        factura: factura({
          tipo: "FACTURA_B",
          lineas: [{ renglon: 1, cantidadFacturada: "2000", precioNeto: "1", alicuota: null }],
          totalSegunFactura: "2500.00",
        }),
      }),
    );
    expect(r).toMatchObject({ ok: true });
    if (!r.ok) return;
    expect(r.dato.avisos).toEqual(
      expect.arrayContaining([
        { tipo: "TOTAL_NO_COINCIDE" },
        { tipo: "LETRA_NO_ESPERADA", esperada: "A" },
      ]),
    );
    expect(await comprobantes(m)).toBe(1);
  });

  it("un punto de venta que la ficha del proveedor no declaró no deja cargar la factura, con su aviso propio, y no escribe nada", async () => {
    const { x, m } = await mundo();
    const r = await comprar(
      x.operador,
      x.sucursal,
      pedido(m, { factura: factura({ puntoDeVenta: "7" }) }),
    );
    expect(r).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_PUNTO_DE_VENTA_NO_DECLARADO" },
    });
    expect(await recepciones(m)).toBe(0);
    expect(await comprobantes(m)).toBe(0);
    expect(await movimientos(m)).toBe(0);
  });

  it("el NIVEL lo decide el servidor: una factura en «Sin factura» es el genérico y no escribe", async () => {
    const sin = await mundo("COMPRA_SIMPLE");
    esGenerico(await comprar(sin.x.operador, sin.x.sucursal, pedido(sin.m)));
    expect(await recepciones(sin.m)).toBe(0);
    expect(await comprobantes(sin.m)).toBe(0);
  });

  it("ATOMICIDAD: una factura rechazada (CUIT inválido, tipo que no es factura, renglón inexistente) no deja compra, ni comprobante, ni stock, ni auditoría", async () => {
    const { x, m } = await mundo();
    for (const mala of [
      factura({ cuitDelProveedor: "11111111111" }),
      factura({ tipo: "NOTA_CREDITO_A" }),
      factura({
        lineas: [{ renglon: 9, cantidadFacturada: "2000", precioNeto: "1", alicuota: "21" }],
      }),
      factura({ totalSegunFactura: "no es un número" }),
    ]) {
      const r = await comprar(x.operador, x.sucursal, pedido(m, { factura: mala }));
      expect(r.ok).toBe(false);
    }
    expect(await recepciones(m)).toBe(0);
    expect(await comprobantes(m)).toBe(0);
    expect(await movimientos(m)).toBe(0);
    expect(await auditadas(x)).toBe(0);
  });

  it("la frontera: un campo de más en la factura (pago, importe calculado, empresa) hace inválido el pedido y no escribe; el pago NO viaja con la compra", async () => {
    const { x, m } = await mundo();
    for (const extra of [
      { pago: { fechaDePago: "2026-10-11", medio: "TRANSFERENCIA" } },
      { totalCalculado: "2420.00" },
      { empresaId: x.empresa },
      { moneda: "USD" },
    ]) {
      esGenerico(await comprar(x.operador, x.sucursal, pedido(m, { factura: factura(extra) })));
    }
    expect(await recepciones(m)).toBe(0);
    // Un `pago` suelto en el pedido no llega al caso de uso (la frontera arma el pedido campo por campo): la compra se hace y NO queda ningún pago.
    const conPagoSuelto = await comprar(
      x.operador,
      x.sucursal,
      pedido(m, { pago: { fechaDePago: "2026-10-11", medio: "TRANSFERENCIA" } }),
    );
    expect(conPagoSuelto).toMatchObject({ ok: true });
    expect(
      (await c.filas("select 1 from pago_de_comprobante where empresa_id = $1", [x.empresa]))
        .length,
    ).toBe(0);
  });

  it("AISLAMIENTO: un proveedor de otra empresa es indistinguible de uno que no existe y no escribe en ninguna", async () => {
    const a = await mundo();
    const b = await mundo();
    const r = await comprar(
      a.x.operador,
      a.x.sucursal,
      pedido({ ...a.m, proveedor: b.m.proveedor }),
    );
    expect(r).toMatchObject({ ok: false });
    expect(await recepciones(b.m)).toBe(0);
    expect(await comprobantes(b.m)).toBe(0);
  });
});
