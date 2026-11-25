import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  registrarLaCompra,
  type DependenciasDeRegistrarCompraWeb,
} from "../../src/composicion/comprar-web";
import { nuevoId } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";

/**
 * Compras PR 6b: «Comprar y recibir» por la composición web, con una base real. El caso de uso (`registrarCompra`) ya tiene sus pruebas de servidor; ésta prueba lo que agrega la pantalla: la
 * frontera (la clave y el pedido tal como los manda el navegador), la sucursal que pone el servidor, los errores con su texto y, de punta a punta, lo que pidió el dueño: IDEMPOTENCIA (el mismo envío
 * dos veces, también a la vez: una compra, una entrada de stock, una auditoría), CONCURRENCIA (dos compras a la vez del mismo producto: el stock suma las dos), ATOMICIDAD (un fallo a mitad no deja
 * nada), AISLAMIENTO entre empresas y AUTORIZACIÓN en el servidor.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 300_000 });
const RONDAS = 3;
const esGenerico = (r: unknown) =>
  expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_ACCION_NO_PERMITIDA" } });

describe.skipIf(base === null)("composición web: Comprar y recibir", () => {
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

  const armar = async (escenario: EscenarioDeCompras) => {
    const deposito = await c.deposito(escenario);
    const { producto, articulo } = await c.articulo(escenario, {
      unidadBase: "GRAMO",
      dimension: "MASA",
    });
    const proveedor = await c.proveedor(escenario.operador);
    return { deposito, producto, articulo, proveedor };
  };
  type Montaje = Awaited<ReturnType<typeof armar>>;

  /** Lo que manda el navegador: 2 kg a 1000 el kilo (entran 2000 g). Sin depósito: la sucursal tiene uno solo. */
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
    ...extra,
  });
  const comprar = (quien: EscenarioDeCompras["operador"], sucursal: string, crudo: unknown) =>
    registrarLaCompra(d, quien, sucursal, crudo);
  const recepciones = (m: Montaje) =>
    c.contar("select count(*) as n from recepcion where proveedor_id = $1", [m.proveedor]);
  const movimientos = (m: Montaje) =>
    c.contar("select count(*) as n from movimiento_de_stock where deposito_id = $1", [m.deposito]);
  const auditadas = async (x: EscenarioDeCompras) =>
    (await c.auditoria(x.empresa, "COMPRA_REGISTRADA")).length;
  /** Cada prueba, su empresa: una sucursal con dos depósitos de uso normal pide elegir (`DEPOSITO_A_ELEGIR`), y acá se prueba la compra con uno. */
  const mundo = async () => {
    const x = await c.escenario();
    return { x, m: await armar(x) };
  };

  it("registra la compra y entra el stock: la respuesta trae la compra y no trae nada interno de más", async () => {
    const { x, m } = await mundo();
    const r = await comprar(x.operador, x.sucursal, pedido(m));
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
    if (!r.ok) return;
    expect(Object.keys(r.dato).sort()).toEqual(["avisos", "recepcionId", "yaExistia"]);
    expect(await recepciones(m)).toBe(1);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    expect((await c.auditoria(x.empresa, "COMPRA_REGISTRADA")).at(-1)).toMatchObject({
      actor_persona_id: x.personaDelOperador,
      entidad_id: r.dato.recepcionId,
    });
  });

  it("I2: el mismo envío dos veces (doble toque, reintento) es UNA compra, UNA entrada de stock y UNA auditoría; la segunda dice yaExistia", async () => {
    const { x, m } = await mundo();
    const mismo = pedido(m);
    const primera = await comprar(x.operador, x.sucursal, mismo);
    const antes = await auditadas(x);
    const segunda = await comprar(x.operador, x.sucursal, mismo);
    expect(primera).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(segunda).toMatchObject({ ok: true, dato: { yaExistia: true } });
    if (primera.ok && segunda.ok) {
      expect(segunda.dato.recepcionId).toBe(primera.dato.recepcionId);
    }
    expect(await recepciones(m)).toBe(1);
    expect(await movimientos(m)).toBe(1);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    expect(await auditadas(x)).toBe(antes);
  });

  it("C1: el mismo envío DOS VECES A LA VEZ deja una sola compra y entra el stock una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      const mismo = pedido(m);
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          comprar(x.operador, x.sucursal, mismo),
          comprar(x.operador, x.sucursal, mismo),
        ]);
      } finally {
        c.soltarBarrera();
      }
      // Una gana; la otra devuelve la misma compra, o se reintenta sola, o pierde por concurrencia: nunca escribe de más.
      expect(resultados.some((x) => x.ok && !x.dato.yaExistia)).toBe(true);
      expect(await recepciones(m)).toBe(1);
      expect(await movimientos(m)).toBe(1);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
    }
  });

  it("C2: dos compras DISTINTAS del mismo producto a la vez: las dos quedan y el stock suma las dos", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda++) {
      const { x, m } = await mundo();
      c.armarBarrera(2);
      let resultados;
      try {
        resultados = await Promise.all([
          comprar(x.operador, x.sucursal, pedido(m)),
          comprar(x.gerente, x.sucursal, pedido(m)),
        ]);
      } finally {
        c.soltarBarrera();
      }
      for (const r of resultados) expect(r.ok).toBe(true);
      expect(await recepciones(m)).toBe(2);
      expect(await c.existencia(m.deposito, m.articulo)).toBe("4000.0000");
    }
  });

  it("la misma clave con OTRO contenido no escribe nada (el genérico)", async () => {
    const { x, m } = await mundo();
    const clave = nuevoId();
    expect(await comprar(x.operador, x.sucursal, pedido(m, { clave }))).toMatchObject({ ok: true });
    const otra = pedido(m, { clave });
    otra.renglones[0] = { ...otra.renglones[0]!, cantidad: "3" };
    esGenerico(await comprar(x.operador, x.sucursal, otra));
    expect(await recepciones(m)).toBe(1);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
  });

  it("A1: un fallo a mitad de la compra no deja nada: ni la compra, ni el stock, ni la auditoría", async () => {
    const { x, m } = await mundo();
    const antes = await auditadas(x);
    c.inyectarFalla("lineas");
    try {
      const r = await comprar(x.operador, x.sucursal, pedido(m));
      expect(r.ok).toBe(false);
    } finally {
      c.inyectarFalla(null);
    }
    expect(await recepciones(m)).toBe(0);
    expect(await movimientos(m)).toBe(0);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("0");
    expect(await auditadas(x)).toBe(antes);
  });

  it("el remito repetido del mismo proveedor, con otra clave, sale con su texto propio y no escribe nada", async () => {
    const { x, m } = await mundo();
    const remito = { puntoDeVenta: "2", numero: "7842", fecha: "2026-11-05" };
    expect(await comprar(x.operador, x.sucursal, pedido(m, { remito }))).toMatchObject({
      ok: true,
    });
    const r = await comprar(x.operador, x.sucursal, pedido(m, { remito }));
    expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_REMITO_REPETIDO" } });
    expect(await recepciones(m)).toBe(1);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("2000.0000");
  });

  it("un remito a medio llenar se rechaza y no se guarda la compra", async () => {
    const { x, m } = await mundo();
    const r = await comprar(
      x.operador,
      x.sucursal,
      pedido(m, { remito: { puntoDeVenta: "2", numero: "", fecha: "" } }),
    );
    esGenerico(r);
    expect(await recepciones(m)).toBe(0);
  });

  it("cantidad cero y precio inválido salen con su texto propio", async () => {
    const { x, m } = await mundo();
    const conRenglon = (cambio: Record<string, unknown>) => {
      const p = pedido(m);
      p.renglones[0] = { ...p.renglones[0]!, ...cambio };
      return p;
    };
    expect(await comprar(x.operador, x.sucursal, conRenglon({ cantidad: "0" }))).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_CANTIDAD_INVALIDA" },
    });
    expect(await comprar(x.operador, x.sucursal, conRenglon({ precio: "0" }))).toMatchObject({
      ok: false,
      error: { codigo: "COMPRAS_PRECIO_INVALIDO" },
    });
    expect(await recepciones(m)).toBe(0);
  });

  it("sin precio la compra se guarda («Sin precio», nunca cero) y sin renglones no se guarda", async () => {
    const { x, m } = await mundo();
    const p = pedido(m);
    p.renglones[0] = { ...p.renglones[0]!, precio: null, unidadDePrecioId: null } as never;
    expect(await comprar(x.operador, x.sucursal, p)).toMatchObject({ ok: true });
    esGenerico(await comprar(x.operador, x.sucursal, pedido(m, { renglones: [] })));
    expect(await recepciones(m)).toBe(1);
  });

  it("A2: el proveedor de otra empresa es indistinguible de uno que no existe y no escribe nada", async () => {
    const { x, m } = await mundo();
    const otra = await c.escenario();
    const ajeno = await armar(otra);
    const r = await comprar(x.operador, x.sucursal, pedido(m, { proveedorId: ajeno.proveedor }));
    expect(r).toMatchObject({ ok: false, error: { codigo: "COMPRAS_PROVEEDOR_NO_ENCONTRADO" } });
    expect(await recepciones(m)).toBe(0);
    expect(await recepciones(ajeno)).toBe(0);
    // Un producto de otra empresa tampoco.
    const p = pedido(m);
    p.renglones[0] = { ...p.renglones[0]!, productoId: ajeno.producto };
    esGenerico(await comprar(x.operador, x.sucursal, p));
    expect(await c.existencia(ajeno.deposito, ajeno.articulo)).toBe("0");
  });

  it("el navegador no manda la sucursal ni la empresa: lo que mande de más se ignora y la sucursal es la que pone el servidor", async () => {
    const { x, m } = await mundo();
    const r = await comprar(
      x.operador,
      x.sucursal,
      pedido(m, { sucursalId: x.otraSucursal, empresaId: nuevoId(), personaId: nuevoId() }),
    );
    expect(r).toMatchObject({ ok: true });
    const [fila] = await c.filas<{ sucursal_id: string; empresa_id: string }>(
      "select sucursal_id, empresa_id from recepcion where proveedor_id = $1",
      [m.proveedor],
    );
    expect(fila).toEqual({ sucursal_id: x.sucursal, empresa_id: x.empresa });
  });

  it("U1: una sucursal que la persona no puede usar no escribe nada (alcance validado en el servidor)", async () => {
    const { x, m } = await mundo();
    esGenerico(await comprar(x.operador, x.otraSucursal, pedido(m)));
    expect(await recepciones(m)).toBe(0);
    expect(await c.existencia(m.deposito, m.articulo)).toBe("0");
  });

  it("una persona sin sesión de empresa (sin persona) no compra", async () => {
    const { x, m } = await mundo();
    const sinPersona = { ...x.operador, personaId: null } as typeof x.operador;
    const r = await comprar(sinPersona, x.sucursal, pedido(m));
    expect(r.ok).toBe(false);
    expect(await recepciones(m)).toBe(0);
  });

  it("con el módulo de compras apagado no se compra", async () => {
    const { x, m } = await mundo();
    c.apagarModulo("compras");
    try {
      const r = await comprar(x.operador, x.sucursal, pedido(m));
      expect(r.ok).toBe(false);
    } finally {
      c.encenderModulo("compras");
    }
    expect(await recepciones(m)).toBe(0);
  });
});
