import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  abrirLaOrden,
  cargarLaNuevaOrden,
  type DependenciasDeNuevaOrdenWeb,
} from "../../src/composicion/nueva-orden-web";
import { montarProduccion, type MontajeDeProduccion } from "./produccion-apoyo";
import { aLaVez, firme, nuevoId, RONDAS, type EscenarioDeStock } from "./stock-casos-apoyo";

/**
 * «Nueva orden» de producción en la web (`nueva-orden-web.ts`) contra una base real y los roles reales: qué se ofrece, abrir sin mover stock, la repetición (mismo gesto, misma orden), dos aperturas a la vez, una
 * empresa que no toca lo de otra, el permiso, y el aviso «Producir igual». Los casos de uso en sí (esperados, faltantes, estados) se prueban en `produccion-ordenes.test.ts`; acá, lo que agrega la composición.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = { ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("nueva orden de producción en la web", () => {
  let c: MontajeDeProduccion;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let registrados: string[];
  let d: DependenciasDeNuevaOrdenWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarProduccion(base);
    e = await c.escenario();
    otra = await c.escenario();
    registrados = [];
    d = {
      consultas: () => c.consultas,
      casosDeUso: () => c.produccion,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  /** El depósito de venta de cada sucursal (la base admite uno solo): origen y destino de toda orden. */
  const ventas = new Map<string, string>();
  const ventaDe = async (escenario: EscenarioDeStock) => {
    const existente = ventas.get(escenario.empresa);
    if (existente !== undefined) return existente;
    const id = await c.deposito(escenario, { deVenta: true });
    ventas.set(escenario.empresa, id);
    return id;
  };
  /** Una panadería (masa con stock propio y receta, harina y manteca) con stock de sobra en el depósito de venta de la sucursal de `escenario`. */
  const lista = async (escenario = e, conStock = true) => {
    const p = await c.panaderia(escenario);
    const venta = await ventaDe(escenario);
    if (conStock) {
      await c.comprar(escenario, venta, p.harina.producto, "100", "1000");
      await c.comprar(escenario, venta, p.manteca.producto, "50", "9000");
    }
    return { ...p, venta };
  };
  const pedido = (p: Awaited<ReturnType<typeof lista>>, extra: Record<string, unknown> = {}) => ({
    clave: nuevoId(),
    productoId: p.masa.producto,
    cantidad: "16",
    ...extra,
  });
  const ordenes = (escenario: EscenarioDeStock, productoId: string) =>
    c.contar(
      "select count(*) as n from orden_de_produccion where empresa_id = $1 and producto_id = $2",
      [escenario.empresa, productoId],
    );
  const movimientos = (escenario: EscenarioDeStock) =>
    c.contar("select count(*) as n from movimiento_de_stock where empresa_id = $1", [
      escenario.empresa,
    ]);

  it("ofrece solo lo que se produce (receta vigente y artículo propio) y el depósito de venta; sin depósito de venta, el genérico", async () => {
    const sinVenta = await c.escenario();
    await c.panaderia(sinVenta); // depósitos que no son de venta
    expect(await cargarLaNuevaOrden(d, sinVenta.gerente, sinVenta.sucursal)).toMatchObject(
      GENERICO,
    );

    const p = await lista();
    const sinReceta = await c.articulo(e, { clase: "ELABORADO", ...c.kilos });
    const r = await cargarLaNuevaOrden(d, e.gerente, e.sucursal);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato.depositoId).toBe(p.venta);
    const masa = r.dato.productos.find((x) => x.id === p.masa.producto);
    expect(masa?.unidadId).toBe("KILOGRAMO");
    expect(masa?.nombre).not.toBe("");
    const ids = r.dato.productos.map((x) => x.id);
    expect(ids).not.toContain(p.harina.producto); // materia prima: sin receta
    expect(ids).not.toContain(sinReceta.producto); // elaborado sin receta
  });

  it("abrir NO mueve stock: crea la orden con sus esperados, con número y una auditoría", async () => {
    const p = await lista();
    const antes = await movimientos(e);
    const r = await abrirLaOrden(d, e.gerente, e.sucursal, pedido(p));
    expect(r).toMatchObject({ ok: true, dato: { yaExistia: false } });
    if (!r.ok) return;
    expect(r.dato.numero).toBeGreaterThan(0);
    expect(await movimientos(e)).toBe(antes);
    expect(
      await c.contar("select count(*) as n from renglon_de_orden where orden_id = $1", [
        r.dato.ordenId,
      ]),
    ).toBe(2);
    const auditadas = (await c.auditoria(e.empresa, "ORDEN_DE_PRODUCCION_ABIERTA")).filter(
      (a) => a["entidad_id"] === r.dato.ordenId,
    );
    expect(auditadas).toHaveLength(1);
  });

  it("idempotencia: el mismo gesto (clic doble, reintento) devuelve la misma orden y no duplica nada; la misma clave con otro contenido se rechaza", async () => {
    const p = await lista();
    const mismo = pedido(p);
    const a = await abrirLaOrden(d, e.gerente, e.sucursal, mismo);
    const b = await abrirLaOrden(d, e.gerente, e.sucursal, mismo);
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    expect(b.dato).toEqual({ ...a.dato, yaExistia: true });
    expect(await ordenes(e, p.masa.producto)).toBe(1);
    const auditadas = (await c.auditoria(e.empresa, "ORDEN_DE_PRODUCCION_ABIERTA")).filter(
      (x) => x["entidad_id"] === a.dato.ordenId,
    );
    expect(auditadas).toHaveLength(1);
    expect(await abrirLaOrden(d, e.gerente, e.sucursal, { ...mismo, cantidad: "8" })).toMatchObject(
      GENERICO,
    );
    expect(await ordenes(e, p.masa.producto)).toBe(1);
  });

  it("concurrencia: dos aperturas distintas a la vez son dos órdenes con números distintos; el mismo gesto a la vez es una sola", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await lista();
      const rs = await aLaVez(
        c,
        [
          () => firme(() => abrirLaOrden(d, e.gerente, e.sucursal, pedido(p))),
          () => firme(() => abrirLaOrden(d, e.gerente, e.sucursal, pedido(p))),
        ],
        ronda,
      );
      expect(
        rs.every((r) => r.ok),
        JSON.stringify(rs),
      ).toBe(true);
      const numeros = rs.map((r) => (r.ok ? r.dato.numero : 0));
      expect(new Set(numeros).size).toBe(2);
      expect(await ordenes(e, p.masa.producto)).toBe(2);

      const q = await lista();
      const igual = pedido(q);
      const mismos = await aLaVez(
        c,
        [
          () => firme(() => abrirLaOrden(d, e.gerente, e.sucursal, igual)),
          () => firme(() => abrirLaOrden(d, e.gerente, e.sucursal, igual)),
        ],
        ronda,
      );
      expect(
        mismos.every((r) => r.ok),
        JSON.stringify(mismos),
      ).toBe(true);
      expect(mismos.map((r) => (r.ok ? r.dato.yaExistia : null)).sort()).toEqual([false, true]);
      expect(await ordenes(e, q.masa.producto)).toBe(1);
    }
  });

  it("aislamiento: un producto de otra empresa no se ofrece ni se abre, y no deja nada; la otra empresa ve solo lo suyo", async () => {
    const ajena = await lista(otra);
    const mia = await lista();
    const r = await abrirLaOrden(d, e.gerente, e.sucursal, pedido(ajena));
    expect(r).toMatchObject(GENERICO);
    expect(await ordenes(otra, ajena.masa.producto)).toBe(0);
    const oferta = await cargarLaNuevaOrden(d, e.gerente, e.sucursal);
    expect(oferta.ok && oferta.dato.productos.map((x) => x.id)).not.toContain(ajena.masa.producto);
    expect(oferta.ok && oferta.dato.productos.map((x) => x.id)).toContain(mia.masa.producto);
    // Una sucursal que no es la de quien pide (otra empresa): el guard del caso de uso la rechaza.
    expect(await abrirLaOrden(d, e.gerente, otra.sucursal, pedido(mia))).toMatchObject({
      ok: false,
    });
    expect(await ordenes(e, mia.masa.producto)).toBe(0);
  });

  it("lo que manda el navegador no decide nada: un producto que no se ofrece, otra unidad o un depósito en el pedido no cambian el resultado", async () => {
    const p = await lista();
    const sinReceta = await c.articulo(e, { clase: "ELABORADO", ...c.kilos });
    expect(
      await abrirLaOrden(d, e.gerente, e.sucursal, {
        ...pedido(p),
        productoId: sinReceta.producto,
      }),
    ).toMatchObject(GENERICO);
    expect(
      await abrirLaOrden(d, e.gerente, e.sucursal, { clave: "x", productoId: "y", cantidad: "1" }),
    ).toMatchObject(GENERICO);
    const r = await abrirLaOrden(d, e.gerente, e.sucursal, {
      ...pedido(p),
      unidadId: "GRAMO",
      depositoId: p.destino,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const fila = (
      await c.filas<{
        deposito_id: string;
        deposito_destino_id: string;
        cantidad_esperada: string;
      }>(
        "select deposito_id, deposito_destino_id, cantidad_esperada::text from orden_de_produccion where id = $1",
        [r.dato.ordenId],
      )
    )[0];
    expect(fila?.deposito_id).toBe(p.venta);
    expect(fila?.deposito_destino_id).toBe(p.venta);
    expect(Number(fila?.cantidad_esperada)).toBe(16);
  });

  it("permisos: el operador abre en su sucursal (transformaciones.abrir); una cantidad inválida no escribe nada", async () => {
    const p = await lista();
    for (const cantidad of ["0", "-1", "abc", "1.00001", ""]) {
      expect(await abrirLaOrden(d, e.gerente, e.sucursal, pedido(p, { cantidad }))).toMatchObject({
        ok: false,
      });
    }
    expect(await ordenes(e, p.masa.producto)).toBe(0);
    expect(await abrirLaOrden(d, e.operador, e.sucursal, pedido(p))).toMatchObject({ ok: true });
  });

  it("faltante con AVISAR: sin confirmar sale el aviso y no escribe; «Producir igual» (misma clave) abre una sola orden y la excepción queda auditada", async () => {
    const falta = await c.escenario();
    const p = await lista(falta, false);
    await c.comprar(falta, p.venta, p.harina.producto, "5", "1000");
    await c.fijarNivel(falta.empresa, "AVISAR");
    const clave = nuevoId();
    const sin = await abrirLaOrden(d, falta.gerente, falta.sucursal, pedido(p, { clave }));
    expect(sin).toMatchObject({ ok: false, error: { codigo: "STOCK_CONTROL_AVISA" } });
    expect(await ordenes(falta, p.masa.producto)).toBe(0);
    const con = await abrirLaOrden(
      d,
      falta.gerente,
      falta.sucursal,
      pedido(p, { clave, confirmar: "1" }),
    );
    expect(con).toMatchObject({ ok: true, dato: { yaExistia: false } });
    const ordenId = con.ok ? con.dato.ordenId : "";
    // Dos insumos faltantes (harina y manteca): dos excepciones auditadas, y la repetición no suma otras.
    const excepciones = async () =>
      (await c.auditoria(falta.empresa, "CONTROL_EXCEPCION")).filter(
        (a) => a["entidad_id"] === ordenId,
      );
    expect(await excepciones()).toHaveLength(2);
    const otraVez = await abrirLaOrden(
      d,
      falta.gerente,
      falta.sucursal,
      pedido(p, { clave, confirmar: "1" }),
    );
    expect(otraVez).toMatchObject({ ok: true, dato: { yaExistia: true } });
    expect(await excepciones()).toHaveLength(2);
    expect(await ordenes(falta, p.masa.producto)).toBe(1);
    await c.fijarNivel(falta.empresa, "PERMITIR");
  });

  it("un fallo inesperado sale sin detalle y con referencia", async () => {
    const roto: DependenciasDeNuevaOrdenWeb = {
      ...d,
      consultas: () => {
        throw new Error("la base se cayó con datos internos");
      },
    };
    const r = await abrirLaOrden(roto, e.gerente, e.sucursal, {
      clave: nuevoId(),
      productoId: nuevoId(),
      cantidad: "1",
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("datos internos");
    expect(registrados.some((x) => x.includes("datos internos"))).toBe(true);
  });
});
