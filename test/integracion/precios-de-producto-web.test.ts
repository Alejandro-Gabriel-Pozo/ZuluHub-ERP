import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  cambiarElPrecioDeUnProducto,
  verLosPreciosDeUnProducto,
  type DependenciasDePreciosDeProductoWeb,
} from "../../src/composicion/precios-de-producto-web";
import {
  grupoDeBase,
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * Los precios de un producto de la web (`precios-de-producto-web.ts`, A1 T3) contra una base real y los roles reales: lo que la pantalla recibe, qué se escribe y qué se audita,
 * que una empresa no toca los productos de otra, que el permiso y el módulo en desarrollo los decide el caso de uso, dos pestañas (la que llega con la fila vieja recibe el importe
 * vigente y no escribe), dos cambios a la vez (uno gana, el otro ve el precio cambiado; una sola fila nueva), el mismo cambio repetido (una sola fila, una sola auditoría) y que
 * nada se borra: cambiar agrega al historial. Los casos de uso en sí tienen sus pruebas en `catalogo-casos-de-uso.test.ts` y `catalogo-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 5;

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";
const DESACTUALIZADO = "CATALOGO_PRECIO_DESACTUALIZADO";

describe.skipIf(base === null)("precios de un producto de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let registrados: string[];
  let d: DependenciasDePreciosDeProductoWeb;

  beforeAll(async () => {
    if (base === null) return;
    c = await montarCatalogo(base);
    // El catálogo real: `catalogo` sigue `en_desarrollo` y el guard rechaza todo.
    cerrado = await montarCatalogo(base, {
      reglas: { catalogo: CATALOGO_DE_MODULOS, permisos: PERMISOS_DE_EMPRESA },
    });
    e = await c.escenario();
    registrados = [];
    d = {
      casosDeUso: () => c.casos,
      consultas: () => c.consultas,
      respuesta: { registrar: (detalle) => registrados.push(detalle) },
      nuevoId,
    };
  });
  afterAll(async () => {
    if (base === null) return;
    await c.cerrar();
    await cerrado.cerrar();
  });

  const nuevoProducto = async (
    extra: Record<string, unknown> = {},
    x: EscenarioDeCatalogo = e,
  ): Promise<string> =>
    valorDe(
      await c.casos.crearProducto(x.gerente, {
        id: nuevoId(),
        claseDeUso: "VENDIBLE",
        nombre: nombreAlAzarDeProducto(),
        unidadBaseId: "UNIDAD",
        alicuota: "21",
        ...extra,
      }),
    ).productoId;
  const precios = async (id: string, contexto = e.gerente) => {
    const r = await verLosPreciosDeUnProducto(d, contexto, id);
    if (!r.ok) throw new Error(`se esperaban los precios y vino ${r.error.codigo}`);
    return r.dato;
  };
  const filasDelPrecio = (id: string) =>
    c.filas(
      "select id, precio from precio_de_venta where producto_id = $1 and opcion_id is null and sucursal_id is null order by vigente_desde",
      [id],
    );
  const auditorias = (id: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where entidad = 'precio_de_venta' and accion = 'PRECIO_CAMBIADO' and despues->>'productoId' = $1",
      [id],
    );
  /** Cambia con la clave y la fila vista que dé la pantalla (lo normal: una pantalla armada, un toque). */
  const cambiar = (
    id: string,
    precio: string,
    vista: Readonly<{ claveDelCambio: string; vigente: { precioId: string } | null }>,
    contexto = e.gerente,
  ) =>
    cambiarElPrecioDeUnProducto(d, contexto, {
      productoId: id,
      precioId: vista.claveDelCambio,
      precioIdEsperado: vista.vigente === null ? null : vista.vigente.precioId,
      precio,
    });
  const codigoDe = (r: Awaited<ReturnType<typeof cambiar>>) => (r.ok ? "OK" : r.error.codigo);

  it("un producto sin precio: ni vigente ni historial, y una clave de cambio nueva en cada lectura", async () => {
    const id = await nuevoProducto({ nombre: "Milanesa" });
    const a = await precios(id);
    const b = await precios(id);
    expect(a).toMatchObject({
      id,
      nombre: "Milanesa",
      tipo: "DE_LA_EMPRESA",
      vigente: null,
      historial: [],
    });
    expect(a.claveDelCambio).not.toBe(b.claveDelCambio);
  });

  it("cambiar agrega una fila, audita una vez y la pantalla ve el nuevo vigente y el anterior en el historial; nada se borra", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect(await cambiar(id, "11500.00", v0)).toEqual({ ok: true, dato: { productoId: id } });
    const v1 = await precios(id);
    expect(v1.vigente).toMatchObject({ importe: "11500.000000" });
    expect(v1.vigente?.desde).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(v1.historial).toEqual([]);
    expect(await cambiar(id, "13000.5", v1)).toMatchObject({ ok: true });
    const v2 = await precios(id);
    expect(v2.vigente?.importe).toBe("13000.500000");
    expect(v2.historial).toMatchObject([{ importe: "11500.000000" }]);
    expect((await filasDelPrecio(id)).map((f) => f["precio"])).toEqual([
      "11500.000000",
      "13000.500000",
    ]);
    expect(await auditorias(id)).toBe(2);
    expect(JSON.stringify(v2)).not.toContain(e.personaDelGerente);
  });

  it("repetir el mismo cambio (doble toque, reintento tras un éxito): una sola fila y una sola auditoría", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect(await cambiar(id, "2000.00", v0)).toMatchObject({ ok: true });
    expect(await cambiar(id, "2000.00", v0)).toMatchObject({ ok: true });
    expect(await cambiar(id, "2000.00", v0)).toMatchObject({ ok: true });
    expect(await filasDelPrecio(id)).toHaveLength(1);
    expect(await auditorias(id)).toBe(1);
  });

  it("la misma clave con otro precio no pisa lo escrito: sale el genérico", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect(await cambiar(id, "2000.00", v0)).toMatchObject({ ok: true });
    expect(codigoDe(await cambiar(id, "2500.00", v0))).toBe(GENERICO);
    expect((await filasDelPrecio(id)).map((f) => f["precio"])).toEqual(["2000.000000"]);
  });

  it("el mismo precio que ya rige, con otra clave, no agrega una fila repetida", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect(await cambiar(id, "2000.00", v0)).toMatchObject({ ok: true });
    const v1 = await precios(id);
    expect(await cambiar(id, "2000", v1)).toEqual({ ok: true, dato: { productoId: id } });
    expect(await filasDelPrecio(id)).toHaveLength(1);
    expect(await auditorias(id)).toBe(1);
  });

  it("dos pestañas: la que cambia después con la fila vieja recibe el importe vigente en la frase aprobada y no escribe", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect(await cambiar(id, "1000.00", v0)).toMatchObject({ ok: true });
    const segunda = await cambiar(id, "9999.00", { ...v0, claveDelCambio: nuevoId() });
    expect(segunda).toMatchObject({
      ok: false,
      error: {
        codigo: DESACTUALIZADO,
        campo: "precio",
        clave: "catalogo.precio.vigente_ahora",
        parametros: { importe: "1000.000000" },
      },
    });
    expect(JSON.stringify(segunda)).not.toMatch(/(^|[^A-Z_])PRECIO_DESACTUALIZADO/);
    expect((await filasDelPrecio(id)).map((f) => f["precio"])).toEqual(["1000.000000"]);
    expect(await auditorias(id)).toBe(1);
  });

  it("después del rechazo, reintentar con la fila nueva (la pantalla se vuelve a pedir) cambia el precio", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect(await cambiar(id, "1000.00", v0)).toMatchObject({ ok: true });
    expect(codigoDe(await cambiar(id, "9999.00", { ...v0, claveDelCambio: nuevoId() }))).toBe(
      DESACTUALIZADO,
    );
    const vNueva = await precios(id);
    expect(await cambiar(id, "9999.00", vNueva)).toMatchObject({ ok: true });
    expect((await precios(id)).vigente?.importe).toBe("9999.000000");
  });

  it(`dos cambios a la vez sobre la misma fila vista (${String(RONDAS)} rondas): uno gana, el otro ve el precio cambiado y se agrega una sola fila`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await nuevoProducto();
      const v0 = await precios(id);
      const [a, b] = await Promise.all([
        cambiar(id, `100${String(ronda)}.00`, { ...v0, claveDelCambio: nuevoId() }),
        cambiar(id, `200${String(ronda)}.00`, { ...v0, claveDelCambio: nuevoId() }),
      ]);
      expect([codigoDe(a), codigoDe(b)].sort()).toEqual([DESACTUALIZADO, "OK"]);
      expect(await filasDelPrecio(id)).toHaveLength(1);
      expect(await auditorias(id)).toBe(1);
    }
  });

  it("el mismo cambio dos veces a la vez (doble clic que llega doble): los dos salen bien y se escribe una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await nuevoProducto();
      const v0 = await precios(id);
      const [a, b] = await Promise.all([cambiar(id, "3000.00", v0), cambiar(id, "3000.00", v0)]);
      expect([codigoDe(a), codigoDe(b)]).toEqual(["OK", "OK"]);
      expect(await filasDelPrecio(id)).toHaveLength(1);
      expect(await auditorias(id)).toBe(1);
    }
  });

  it.each(["", "abc", "-1", "1e3", "1,5", "0.1234567", "99999999999999999999"])(
    "el precio «%s» sale como «Escribí un precio válido», asociado al campo, y no escribe",
    async (malo) => {
      const id = await nuevoProducto();
      const v0 = await precios(id);
      const r = await cambiar(id, malo, v0);
      expect(r).toMatchObject({
        ok: false,
        error: { codigo: "CATALOGO_PRECIO_INVALIDO", campo: "precio", presentacion: "AVISO" },
      });
      expect(await filasDelPrecio(id)).toEqual([]);
    },
  );

  it("un precio con hasta seis decimales se guarda exacto, como texto", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect(await cambiar(id, "28333.333333", v0)).toMatchObject({ ok: true });
    expect((await precios(id)).vigente?.importe).toBe("28333.333333");
  });

  it("un producto con variante activa es «según medida»: no se ofrece vigente y cambiar el precio del producto sale como el genérico", async () => {
    const id = await nuevoProducto();
    await grupoDeBase(c.dueno, e.empresa, id, { clase: "VARIANTE", esTamano: true });
    const p = await precios(id);
    expect(p).toMatchObject({ tipo: "SEGUN_MEDIDA", vigente: null, historial: [] });
    expect(codigoDe(await cambiar(id, "1000.00", p))).toBe(GENERICO);
    expect(await filasDelPrecio(id)).toEqual([]);
  });

  it("una clase que no se vende no tiene precios: sale como el genérico, y cambiar tampoco", async () => {
    const id = await nuevoProducto({ claseDeUso: "INSUMO", alicuota: undefined });
    expect(await verLosPreciosDeUnProducto(d, e.gerente, id)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(
      codigoDe(
        await cambiar(id, "1000.00", { claveDelCambio: nuevoId(), vigente: null }, e.gerente),
      ),
    ).toBe(GENERICO);
  });

  it("un producto desactivado, uno que no existe y un id mal escrito salen como el genérico", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: id }));
    expect(codigoDe(await cambiar(id, "1000.00", v0))).toBe(GENERICO);
    expect(codigoDe(await cambiar(nuevoId(), "1000.00", v0))).toBe(GENERICO);
    expect(await verLosPreciosDeUnProducto(d, e.gerente, "no-es-un-id")).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(await filasDelPrecio(id)).toEqual([]);
  });

  it("aislamiento: una empresa no ve ni toca los precios de otra, y no se distingue de un producto que no existe", async () => {
    const otra = await c.escenario();
    const id = await nuevoProducto({ nombre: "Reservado" }, otra);
    const mio = await precios(await nuevoProducto());
    const ver = await verLosPreciosDeUnProducto(d, e.gerente, id);
    expect(ver).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(JSON.stringify(ver)).not.toContain("Reservado");
    expect(codigoDe(await cambiar(id, "1.00", mio))).toBe(GENERICO);
    expect(await filasDelPrecio(id)).toEqual([]);
  });

  it("el permiso lo deciden la consulta y el caso de uso: el operador ve pero no cambia; el administrador de una sola sucursal no cambia el precio de la empresa (alcance)", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect((await precios(id, e.operador)).nombre).toBeDefined();
    expect(await cambiar(id, "1000.00", v0, e.operador)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(await cambiar(id, "1000.00", v0, e.administradorDeUnaSucursal)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(await filasDelPrecio(id)).toEqual([]);
    expect(codigoDe(await cambiar(id, "1000.00", v0, e.administrador))).toBe("OK");
  });

  it("el importe vigente solo sale a quien tiene `productos.cambiar_precio`: el operador con una fila vieja recibe el motivo del guard, sin importe; el administrador de una sola sucursal, el genérico", async () => {
    const id = await nuevoProducto();
    const v0 = await precios(id);
    expect(await cambiar(id, "1000.00", v0)).toMatchObject({ ok: true });
    // `v0` ya quedó vieja: con permiso saldría el importe vigente (prueba de las dos pestañas); sin permiso, el caso de uso rechaza antes de mirar el precio.
    for (const sinPermiso of [e.operador, e.administradorDeUnaSucursal]) {
      const r = await cambiar(id, "9999.00", { ...v0, claveDelCambio: nuevoId() }, sinPermiso);
      expect(r).toMatchObject({ ok: false });
      expect(r.ok ? null : r.error).not.toHaveProperty("parametros");
      expect(r.ok ? "" : r.error.codigo).not.toBe(DESACTUALIZADO);
      expect(JSON.stringify(r)).not.toContain("1000");
    }
    expect(await filasDelPrecio(id)).toHaveLength(1);
  });

  it("con el catálogo en desarrollo (hoy, en el catálogo real) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    const id = await productoDeBase(cerrado.dueno, x.empresa, { nombre: "Cerrado" });
    const dependencias: DependenciasDePreciosDeProductoWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const ver = await verLosPreciosDeUnProducto(dependencias, contexto, id);
      expect(ver).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_DESARROLLO", presentacion: "POR_QUE_NO_PUEDO" },
      });
      const cambia = await cambiarElPrecioDeUnProducto(dependencias, contexto, {
        productoId: id,
        precioId: nuevoId(),
        precioIdEsperado: null,
        precio: "1000.00",
      });
      expect(cambia).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(JSON.stringify([ver, cambia])).not.toContain("Cerrado");
    }
  });

  it("ver es una lectura: no escribe ni audita", async () => {
    const id = await nuevoProducto();
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [e.empresa],
    );
    await precios(id);
    await precios(id, e.operador);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(antes);
    expect(await filasDelPrecio(id)).toEqual([]);
  });

  it("un fallo inesperado sale sin detalle y con referencia; el detalle va al registro del servidor", async () => {
    const roto: DependenciasDePreciosDeProductoWeb = {
      ...d,
      consultas: () => {
        throw new Error("la base dijo: relation precio_x does not exist");
      },
    };
    const r = await verLosPreciosDeUnProducto(roto, e.gerente, nuevoId());
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("relation");
    expect(registrados.some((z) => z.includes("relation precio_x"))).toBe(true);
  });
});
