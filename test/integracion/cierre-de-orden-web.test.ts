import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  cargarLaOrdenParaCerrar,
  cerrarLaOrden,
  type DependenciasDeCierreDeOrdenWeb,
} from "../../src/composicion/cierre-de-orden-web";
import { montarProduccion, type MontajeDeProduccion } from "./produccion-apoyo";
import {
  aLaVez,
  firme,
  nuevoId,
  RONDAS,
  valorDe,
  type EscenarioDeStock,
} from "./stock-casos-apoyo";

/**
 * «Cerrar con lo real» de producción en la web (`cierre-de-orden-web.ts`) contra una base real y los roles reales: lo que se muestra para cerrar, el cierre (consumo, producto con lote, costo congelado y estado
 * en UNA transacción), la repetición, dos cierres a la vez, el cierre contra otra salida del mismo insumo (T-3), que una falla no deja nada a medias, el aislamiento y los permisos. Los casos de uso en sí
 * (estados, FEFO, espejo) se prueban en `produccion-ordenes.test.ts` y `produccion-concurrencia.test.ts`; acá, lo que agrega la composición.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const GENERICO = { ok: false, error: { codigo: "PRODUCCION_ACCION_NO_PERMITIDA" } };

describe.skipIf(base === null)("cerrar una orden de producción en la web", () => {
  let c: MontajeDeProduccion;
  let e: EscenarioDeStock;
  let otra: EscenarioDeStock;
  let registrados: string[];
  let d: DependenciasDeCierreDeOrdenWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarProduccion(base);
    e = await c.escenario();
    otra = await c.escenario();
    registrados = [];
    d = {
      consultas: () => c.consultasDeProduccion,
      casosDeUso: () => c.produccion,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
    };
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  type P = Awaited<ReturnType<MontajeDeProduccion["panaderia"]>>;
  /** Una panadería con harina (a $ 1.000 el kilo) y manteca (a $ 9.000) en el origen, en las cantidades pedidas. */
  const con = async (harina = "100", manteca = "50", escenario = e) => {
    const p = await c.panaderia(escenario);
    await c.comprar(escenario, p.origen, p.harina.producto, harina, "1000");
    await c.comprar(escenario, p.origen, p.manteca.producto, manteca, "9000");
    return p;
  };
  const abrir = async (p: P, escenario = e) =>
    valorDe(
      await c.produccion.abrirOrden(escenario.gerente, {
        id: nuevoId(),
        productoId: p.masa.producto,
        cantidad: "16",
        unidadId: "KILOGRAMO",
        depositoId: p.origen,
        depositoDestinoId: p.destino,
      }),
    );
  type Opciones = Readonly<{
    /** Campos que se suman o pisan en el pedido. */
    extra?: Record<string, unknown>;
    harina?: string;
    manteca?: string;
    /** La empresa de la orden (donde se lee la ficha para ordenar los consumos). */
    de?: EscenarioDeStock;
  }>;
  /** El pedido de cierre: lo real de la harina y de la manteca va en el orden de los renglones de la orden (que es el de la base, no el de la receta), porque se manda por posición. */
  const pedido = async (ordenId: string, p: P, o: Opciones = {}) => {
    const ficha = valorDe(
      await c.consultasDeProduccion.fichaDeOrden((o.de ?? e).gerente, { ordenId }),
    );
    return {
      ordenId,
      clave: nuevoId(),
      obtenido: "15",
      consumos: (ficha?.renglones ?? []).map((r) =>
        r.productoId === p.harina.producto ? (o.harina ?? "12") : (o.manteca ?? "4"),
      ),
      ...o.extra,
    };
  };
  const estado = async (id: string) =>
    (
      await c.filas<{ estado: string }>("select estado from orden_de_produccion where id = $1", [
        id,
      ])
    )[0]?.estado;
  const movimientos = (ordenId: string) =>
    c.contar("select count(*) as n from movimiento_de_stock where origen_id = $1", [ordenId]);
  const costoDe = async (ordenId: string, escenario = e) =>
    valorDe(await c.consultasDeProduccion.fichaDeOrden(escenario.gerente, { ordenId }))?.costo;

  it("la orden para cerrar trae un renglón por ingrediente con lo esperado; una cerrada, ajena o inexistente sale como el genérico", async () => {
    const p = await con();
    const a = await abrir(p);
    const r = await cargarLaOrdenParaCerrar(d, e.gerente, { ordenId: a.ordenId });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.dato.id).toBe(a.ordenId);
    expect(r.dato.unidadId).toBe("KILOGRAMO");
    expect(r.dato.renglones.map((x) => [x.esperado, x.unidadId]).sort()).toEqual([
      ["12.0000", "KILOGRAMO"],
      ["4.0000", "KILOGRAMO"],
    ]);
    expect(JSON.stringify(r)).not.toContain(p.origen);
    expect(await cargarLaOrdenParaCerrar(d, otra.gerente, { ordenId: a.ordenId })).toMatchObject(
      GENERICO,
    );
    expect(await cargarLaOrdenParaCerrar(d, e.gerente, { ordenId: nuevoId() })).toMatchObject(
      GENERICO,
    );
    expect((await cerrarLaOrden(d, e.gerente, await pedido(a.ordenId, p))).ok).toBe(true);
    expect(await cargarLaOrdenParaCerrar(d, e.gerente, { ordenId: a.ordenId })).toMatchObject(
      GENERICO,
    );
  });

  it("cerrar con lo real: consume lo real, entra lo obtenido, congela el costo exacto (redondeado una vez) y cierra, todo junto", async () => {
    const p = await con();
    const a = await abrir(p);
    // Se usó menos manteca de la esperada y se obtuvieron 7 kg: costo = (12 × 1000 + 3 × 9000) ÷ 7 = 39000 ÷ 7 = 5571.428571.
    const r = await cerrarLaOrden(
      d,
      e.gerente,
      await pedido(a.ordenId, p, { extra: { obtenido: "7" }, manteca: "3" }),
    );
    expect(r).toEqual({ ok: true, dato: { ordenId: a.ordenId, yaExistia: false } });
    expect(await estado(a.ordenId)).toBe("CERRADA");
    expect(await movimientos(a.ordenId)).toBe(2);
    expect(await c.existencia(p.origen, p.harina.articulo)).toBe("88.0000");
    expect(await c.existencia(p.origen, p.manteca.articulo)).toBe("47.0000");
    expect(await c.existencia(p.destino, p.masa.articulo)).toBe("7.0000");
    expect(await costoDe(a.ordenId)).toMatchObject({
      costoUnitario: "5571.428571",
      costoEstado: "DEFINITIVO",
    });
    // El operador no ve costos.
    const ficha = valorDe(
      await c.consultasDeProduccion.fichaDeOrden(e.operador, { ordenId: a.ordenId }),
    );
    expect(ficha).not.toBeNull();
    expect(ficha?.costo).toBeUndefined();
  });

  it("idempotencia: el mismo gesto (clic doble, reintento) y el mismo contenido con otra clave devuelven el mismo cierre y no duplican nada; otro contenido se rechaza", async () => {
    const p = await con();
    const a = await abrir(p);
    const mismo = await pedido(a.ordenId, p);
    expect(await cerrarLaOrden(d, e.gerente, mismo)).toMatchObject({
      ok: true,
      dato: { yaExistia: false },
    });
    expect(await cerrarLaOrden(d, e.gerente, mismo)).toMatchObject({
      ok: true,
      dato: { yaExistia: true },
    });
    expect(await cerrarLaOrden(d, e.gerente, { ...mismo, clave: nuevoId() })).toMatchObject({
      ok: true,
      dato: { yaExistia: true },
    });
    expect(await movimientos(a.ordenId)).toBe(2);
    expect(await c.existencia(p.origen, p.harina.articulo)).toBe("88.0000");
    expect(await cerrarLaOrden(d, e.gerente, { ...mismo, obtenido: "14" })).toMatchObject(GENERICO);
    expect(
      await cerrarLaOrden(d, e.gerente, { ...mismo, clave: nuevoId(), obtenido: "14" }),
    ).toMatchObject(GENERICO);
    expect(await movimientos(a.ordenId)).toBe(2);
  });

  it("concurrencia: dos cierres a la vez de la misma orden (claves distintas) son uno solo: un consumo, un producto y un costo; el otro devuelve `yaExistia`", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = await con();
      const a = await abrir(p);
      const [uno, dos] = [await pedido(a.ordenId, p), await pedido(a.ordenId, p)];
      const rs = await aLaVez(
        c,
        [
          () => firme(() => cerrarLaOrden(d, e.gerente, uno)),
          () => firme(() => cerrarLaOrden(d, e.gerente, dos)),
        ],
        ronda,
      );
      expect(
        rs.every((r) => r.ok),
        JSON.stringify(rs),
      ).toBe(true);
      expect(rs.map((r) => (r.ok ? r.dato.yaExistia : null)).sort()).toEqual([false, true]);
      expect(await movimientos(a.ordenId)).toBe(2);
      expect(await c.existencia(p.origen, p.harina.articulo)).toBe("88.0000");
      expect(await c.existencia(p.destino, p.masa.articulo)).toBe("15.0000");
    }
  });

  it("T-3: cerrar una orden a la vez que otra salida de stock sobre el mismo insumo, con la existencia justa y AVISAR: gana una; la otra pide confirmar y no deja nada; la existencia nunca queda en negativo ni se pierde un movimiento", async () => {
    // Lo que descuenta una venta pasa por el mismo libro y la misma transacción que una salida de stock: esta prueba usa la salida de stock como el otro actor sobre el insumo.
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const esc = await c.escenario();
      const p = await con("12", "4", esc);
      await c.fijarNivel(esc.empresa, "AVISAR");
      const a = await abrir(p, esc);
      const cierre1 = await pedido(a.ordenId, p, { de: esc });
      type Resultado = { readonly ok: boolean; readonly error?: unknown };
      // `aLaVez` alterna cuál sale primero y devuelve en ese orden: cada resultado lleva su nombre.
      const rs = await aLaVez<readonly ["cierre" | "salida", Resultado]>(
        c,
        [
          () =>
            firme(() => cerrarLaOrden(d, esc.gerente, cierre1)).then((r) => ["cierre", r] as const),
          () =>
            firme(() =>
              c.casos.registrarSalida(esc.gerente, {
                clave: nuevoId(),
                depositoId: p.origen,
                motivo: "MERMA",
                renglones: [
                  { productoId: p.harina.producto, cantidad: "1", unidadId: "KILOGRAMO" },
                ],
              }),
            ).then((r) => ["salida", r] as const),
        ],
        ronda,
      );
      const cierre = rs.find(([quien]) => quien === "cierre")?.[1];
      const salida = rs.find(([quien]) => quien === "salida")?.[1];
      const cierreOk = cierre?.ok === true;
      const salidaOk = salida?.ok === true;
      expect(Number(cierreOk) + Number(salidaOk), JSON.stringify(rs)).toBe(1);
      const harina = await c.existencia(p.origen, p.harina.articulo);
      if (cierreOk) {
        expect(await estado(a.ordenId)).toBe("CERRADA");
        expect(harina).toBe("0.0000");
        expect(salida).toMatchObject({
          ok: false,
          error: { error: "CONTROL_REQUIERE_CONFIRMACION" },
        });
      } else {
        expect(await estado(a.ordenId)).toBe("ABIERTA");
        expect(await movimientos(a.ordenId)).toBe(0);
        expect(harina).toBe("11.0000");
        expect(cierre).toMatchObject({ ok: false, error: { codigo: "STOCK_CONTROL_AVISA" } });
      }
    }
  });

  it("atomicidad: el segundo ingrediente frenado por el control (AVISAR sin confirmar) no deja nada del primero; «Producir igual» (misma clave) cierra y deja las excepciones auditadas", async () => {
    const esc = await c.escenario();
    const p = await con("100", "1", esc);
    // Se abre con faltante de manteca (PERMITIR) y recién ahí el control pasa a AVISAR: al cerrar, el primer ingrediente (harina) alcanza y el segundo no.
    const a = await abrir(p, esc);
    await c.fijarNivel(esc.empresa, "AVISAR");
    const clave = nuevoId();
    const sin = await cerrarLaOrden(
      d,
      esc.gerente,
      await pedido(a.ordenId, p, { de: esc, extra: { clave } }),
    );
    expect(sin).toMatchObject({ ok: false, error: { codigo: "STOCK_CONTROL_AVISA" } });
    expect(await estado(a.ordenId)).toBe("ABIERTA");
    expect(await movimientos(a.ordenId)).toBe(0);
    expect(await c.existencia(p.origen, p.harina.articulo)).toBe("100.0000");
    expect(Number(await c.existencia(p.destino, p.masa.articulo))).toBe(0);
    expect(
      await c.contar("select count(*) as n from lote where empresa_id = $1", [esc.empresa]),
    ).toBe(0);
    const con1 = await cerrarLaOrden(
      d,
      esc.gerente,
      await pedido(a.ordenId, p, { de: esc, extra: { clave, confirmar: "1" } }),
    );
    expect(con1).toMatchObject({ ok: true, dato: { yaExistia: false } });
    expect(await estado(a.ordenId)).toBe("CERRADA");
    expect(await c.existencia(p.origen, p.manteca.articulo)).toBe("-3.0000");
    const excepciones = (await c.auditoria(esc.empresa, "CONTROL_EXCEPCION")).filter(
      (x) => x["entidad_id"] === a.ordenId,
    );
    expect(excepciones).toHaveLength(1);
    await c.fijarNivel(esc.empresa, "PERMITIR");
  });

  it("el vencimiento que falta (artículo con control de lote y vencimiento) sale con su texto aprobado y no deja nada", async () => {
    const esc = await c.escenario();
    const p = await con("100", "50", esc);
    c.encenderPerilla("lotes");
    valorDe(
      await c.casos.controlarLote(esc.gerente, {
        productoId: p.masa.producto,
        modo: "LOTE_Y_VENCIMIENTO",
        conCalidad: false,
      }),
    );
    const a = await abrir(p, esc);
    const r = await cerrarLaOrden(d, esc.gerente, await pedido(a.ordenId, p, { de: esc }));
    if (!r.ok && r.error.codigo === "PRODUCCION_VENCIMIENTO_REQUERIDO") {
      expect(await estado(a.ordenId)).toBe("ABIERTA");
      expect(await movimientos(a.ordenId)).toBe(0);
      const ok = await cerrarLaOrden(
        d,
        esc.gerente,
        await pedido(a.ordenId, p, { de: esc, extra: { vence: "2099-12-31" } }),
      );
      expect(ok).toMatchObject({ ok: true });
      expect(await estado(a.ordenId)).toBe("CERRADA");
    } else {
      throw new Error(`se esperaba el vencimiento requerido: ${JSON.stringify(r)}`);
    }
  });

  it("aislamiento y permisos: otra empresa no cierra la orden; el operador no cierra; renglones de más o de menos no pasan; nada de lo que manda el navegador decide el producto o la unidad", async () => {
    const p = await con();
    const a = await abrir(p);
    const base = await pedido(a.ordenId, p);
    expect(await cerrarLaOrden(d, otra.gerente, base)).toMatchObject({ ok: false });
    expect(await cerrarLaOrden(d, e.operador, base)).toMatchObject({ ok: false });
    expect(
      await cerrarLaOrden(d, e.gerente, { ...base, consumos: base.consumos.slice(1) }),
    ).toMatchObject(GENERICO);
    expect(
      await cerrarLaOrden(d, e.gerente, { ...base, consumos: [...base.consumos, "1"] }),
    ).toMatchObject(GENERICO);
    expect(await estado(a.ordenId)).toBe("ABIERTA");
    expect(await movimientos(a.ordenId)).toBe(0);
    const r = await cerrarLaOrden(d, e.gerente, {
      ...base,
      unidadId: "GRAMO",
      productoId: nuevoId(),
      empresaId: otra.empresa,
    });
    expect(r).toMatchObject({ ok: true });
    expect(await c.existencia(p.origen, p.harina.articulo)).toBe("88.0000");
  });

  it("un fallo inesperado sale sin detalle y con referencia", async () => {
    const roto: DependenciasDeCierreDeOrdenWeb = {
      ...d,
      consultas: () => {
        throw new Error("la base se cayó con datos internos");
      },
    };
    const r = await cerrarLaOrden(roto, e.gerente, {
      ordenId: nuevoId(),
      clave: nuevoId(),
      obtenido: "1",
      consumos: ["1"],
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("datos internos");
    expect(registrados.some((x) => x.includes("datos internos"))).toBe(true);
  });
});
