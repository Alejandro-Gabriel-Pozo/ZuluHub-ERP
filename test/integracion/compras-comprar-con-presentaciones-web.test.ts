import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cotizarLaCompra,
  registrarLaCompra,
  type DependenciasDeComprarWeb,
  type DependenciasDeRegistrarCompraWeb,
} from "../../src/composicion/comprar-web";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * T0b: «Comprar y recibir» con una PRESENTACIÓN elegida («caja de 6»), por la composición web y con una base real. Prueba lo que agrega la pantalla: la presentación viaja por la frontera, entra al stock
 * la cantidad convertida a la unidad base (nunca «la caja»), el precio por la presentación, el peso real de una presentación de peso variable, y lo que el dueño pidió siempre: IDEMPOTENCIA (el mismo
 * envío dos veces, también a la vez: una compra, una entrada), ATOMICIDAD (un rechazo no deja nada), AISLAMIENTO (la presentación de otra empresa no existe) y una presentación DESACTIVADA entre que se
 * cargó la pantalla y se envió.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const RONDAS = 3;
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

describe.skipIf(base === null)("composición web: Comprar y recibir con presentaciones", () => {
  let c: MontajeDeCompras;
  let d: DependenciasDeRegistrarCompraWeb;
  let dc: DependenciasDeComprarWeb;
  const registrados: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    d = { casosDeUso: () => c.casos, respuesta: { registrar: (x) => registrados.push(x) } };
    dc = { consultas: () => c.consultas, respuesta: { registrar: (x) => registrados.push(x) } };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** Una gaseosa (reventa, base «unidad») con «Caja ×6» y una carne (base gramo) con «Pieza» de peso variable y «Bolsa» de peso fijo. */
  const armar = async (x: EscenarioDeCompras) => {
    const deposito = await c.deposito(x);
    const gaseosa = await c.articulo(x, { unidadBase: "UNIDAD", dimension: "CONTEO" });
    const carne = await c.articulo(x, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(x.operador);
    const nueva = async (productoId: string, nombre: string, cantidad: string, variable: boolean) =>
      valorDe(
        await c.catalogoCasos.crearPresentacion(x.gerente, {
          productoId,
          nombre,
          cantidad,
          dePesoVariable: variable,
        }),
      ).presentacion;
    return {
      deposito,
      gaseosa,
      carne,
      proveedor,
      caja: await nueva(gaseosa.producto, "Caja de 6", "6", false),
      pieza: await nueva(carne.producto, "Pieza", "4000", true),
      bolsa: await nueva(carne.producto, "Bolsa", "25000", false),
    };
  };
  type Montaje = Awaited<ReturnType<typeof armar>>;
  const mundo = async () => {
    const x = await c.escenario();
    return { x, m: await armar(x) };
  };

  const renglonDeCaja = (m: Montaje, extra: Record<string, unknown> = {}) => ({
    productoId: m.gaseosa.producto,
    presentacionId: m.caja.id,
    unidadDeCompraId: "UNIDAD",
    cantidad: "2",
    precioPor: "PRESENTACION",
    precio: "12000.00",
    ...extra,
  });
  const pedido = (m: Montaje, renglon: Record<string, unknown>) => ({
    clave: nuevoId(),
    proveedorId: m.proveedor,
    renglones: [renglon],
  });
  const comprar = (x: EscenarioDeCompras, crudo: unknown) =>
    registrarLaCompra(d, x.operador, x.sucursal, crudo);
  const recepciones = (m: Montaje) =>
    c.contar("select count(*) as n from recepcion where proveedor_id = $1", [m.proveedor]);
  const movimientos = (m: Montaje) =>
    c.contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [m.deposito]);

  it("2 cajas ×6 a $ 12.000 la caja: entran 12 unidades (no «2 cajas») al stock y el costo por unidad es $ 2.000", async () => {
    const { x, m } = await mundo();
    const r = await comprar(x, pedido(m, renglonDeCaja(m)));
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(await c.existencia(m.deposito, m.gaseosa.articulo)).toBe("12.0000");
    const [linea] = await c.filas<{ presentacion_id: string; costo: string }>(
      "select presentacion_id, costo_por_unidad_de_stock::text as costo from linea_de_recepcion where empresa_id = $1",
      [x.empresa],
    );
    expect(linea?.presentacion_id).toBe(m.caja.id);
    expect(Number(linea?.costo)).toBe(2000);
  });

  it("I2: el mismo envío dos veces (doble toque, reintento) es UNA compra y UNA entrada de stock; la segunda dice yaExistia", async () => {
    const { x, m } = await mundo();
    const mismo = pedido(m, renglonDeCaja(m));
    const primera = await comprar(x, mismo);
    const segunda = await comprar(x, mismo);
    expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(await recepciones(m)).toBe(1);
    expect(await movimientos(m)).toBe(1);
    expect(await c.existencia(m.deposito, m.gaseosa.articulo)).toBe("12.0000");
  });

  it("C1: el mismo envío con presentación DOS VECES A LA VEZ deja una sola compra y entra el stock una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const mismo = pedido(m, renglonDeCaja(m));
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([comprar(x, mismo), comprar(x, mismo)]);
      } finally {
        c.soltarBarrera();
      }
      expect(resultados.some((r) => r.ok && !r.dato.yaExistia)).toBe(true);
      expect(await recepciones(m)).toBe(1);
      expect(await movimientos(m)).toBe(1);
      expect(await c.existencia(m.deposito, m.gaseosa.articulo)).toBe("12.0000");
    }
  });

  it("C2: dos compras DISTINTAS de la misma presentación a la vez: las dos quedan y el stock suma las dos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          comprar(x, pedido(m, renglonDeCaja(m))),
          registrarLaCompra(d, x.gerente, x.sucursal, pedido(m, renglonDeCaja(m))),
        ]);
      } finally {
        c.soltarBarrera();
      }
      for (const r of resultados) expect(r.ok).toBe(true);
      expect(await recepciones(m)).toBe(2);
      expect(await c.existencia(m.deposito, m.gaseosa.articulo)).toBe("24.0000");
    }
  });

  it("peso variable: sin peso real se rechaza y no escribe nada; con peso entra el PESO, no los 4 kg aproximados ni «la pieza»", async () => {
    const { x, m } = await mundo();
    const pieza = {
      productoId: m.carne.producto,
      presentacionId: m.pieza.id,
      unidadDeCompraId: "GRAMO",
      cantidad: "2",
      precioPor: "UNIDAD",
      unidadDePrecioId: "KILOGRAMO",
      precio: "10000.00",
    };
    esGenerico(await comprar(x, pedido(m, pieza)));
    expect(await recepciones(m)).toBe(0);
    expect(await movimientos(m)).toBe(0);
    const r = await comprar(x, pedido(m, { ...pieza, pesoReal: "8350" }));
    expect(r).toMatchObject({ ok: true });
    expect(await c.existencia(m.deposito, m.carne.articulo)).toBe("8350.0000");
  });

  it("peso fijo: con un peso real se rechaza y no escribe nada; sin peso entra la cantidad fija por cada bolsa", async () => {
    const { x, m } = await mundo();
    const bolsa = {
      productoId: m.carne.producto,
      presentacionId: m.bolsa.id,
      unidadDeCompraId: "GRAMO",
      cantidad: "2",
      precioPor: "PRESENTACION",
      precio: "45000.00",
    };
    esGenerico(await comprar(x, pedido(m, { ...bolsa, pesoReal: "50000" })));
    expect(await recepciones(m)).toBe(0);
    expect(await movimientos(m)).toBe(0);
    expect(await comprar(x, pedido(m, bolsa))).toMatchObject({ ok: true });
    expect(await c.existencia(m.deposito, m.carne.articulo)).toBe("50000.0000");
  });

  it("una presentación DESACTIVADA entre que se cargó la pantalla y se envió se rechaza: no se compra ni entra stock", async () => {
    const { x, m } = await mundo();
    // La pantalla ya la tenía cargada en el renglón…
    const envio = pedido(m, renglonDeCaja(m));
    // …y el gerente la desactiva antes de «Comprar y recibir».
    valorDe(
      await c.catalogoCasos.editarPresentacion(x.gerente, {
        presentacionId: m.caja.id,
        nombre: m.caja.nombre,
        activa: false,
        versionEsperada: m.caja.version,
      }),
    );
    esGenerico(await comprar(x, envio));
    expect(await recepciones(m)).toBe(0);
    expect(await movimientos(m)).toBe(0);
    expect(await c.existencia(m.deposito, m.gaseosa.articulo)).toBe("0");
  });

  it("A2: la presentación de otro producto o de otra empresa es indistinguible de una que no existe y no escribe nada", async () => {
    const { x, m } = await mundo();
    const otra = await c.escenario();
    const ajena = await armar(otra);
    // De otra empresa.
    esGenerico(await comprar(x, pedido(m, renglonDeCaja(m, { presentacionId: ajena.caja.id }))));
    // De otro producto de la misma empresa (la bolsa es de la carne, no de la gaseosa).
    esGenerico(await comprar(x, pedido(m, renglonDeCaja(m, { presentacionId: m.bolsa.id }))));
    // Un identificador que no existe.
    esGenerico(await comprar(x, pedido(m, renglonDeCaja(m, { presentacionId: nuevoId() }))));
    expect(await recepciones(m)).toBe(0);
    expect(await c.existencia(ajena.deposito, ajena.gaseosa.articulo)).toBe("0");
  });

  it("precioPor inválido o «por presentación» sin presentación se rechaza con el genérico y no escribe nada", async () => {
    const { x, m } = await mundo();
    esGenerico(await comprar(x, pedido(m, renglonDeCaja(m, { precioPor: "CAJA" }))));
    esGenerico(
      await comprar(
        x,
        pedido(m, renglonDeCaja(m, { presentacionId: null, precioPor: "PRESENTACION" })),
      ),
    );
    expect(await recepciones(m)).toBe(0);
    expect(await movimientos(m)).toBe(0);
  });

  it("la cotización antes de guardar usa la misma cuenta: 2 cajas ×6 a $ 12.000 la caja entran 12 y cuestan $ 24.000", async () => {
    const { x, m } = await mundo();
    const r = await cotizarLaCompra(dc, x.operador, { renglones: [renglonDeCaja(m)] });
    expect(r).toMatchObject({
      ok: true,
      dato: {
        total: "24000.00",
        renglones: [{ productoId: m.gaseosa.producto, cantidadEnStock: "12.0000" }],
      },
    });
    // Mirar no escribe.
    expect(await recepciones(m)).toBe(0);
    expect(await movimientos(m)).toBe(0);
  });
});
