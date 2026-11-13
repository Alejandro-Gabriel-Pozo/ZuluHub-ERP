import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  guardarLaFichaDeProducto,
  verLaFichaDeProducto,
  type DependenciasDeFichaDeProductoWeb,
} from "../../src/composicion/ficha-de-producto-web";
import {
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  productoDeBase,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * La ficha de datos de un producto de la web (`ficha-de-producto-web.ts`, A1 T2a) contra una base real y los roles reales: lo que la pantalla recibe, qué se escribe y qué se
 * audita, que una empresa no toca los productos de otra, que el permiso y el módulo en desarrollo los decide el caso de uso, dos guardados a la vez (uno gana, el otro recibe el
 * genérico, la versión sube una sola vez), el mismo guardado repetido (no escribe ni audita de nuevo) y que lo que esta pantalla no edita (la descripción, una alícuota que no
 * ofrece, una sección desactivada) no se pierde. Los casos de uso en sí tienen sus pruebas en `catalogo-casos-de-uso.test.ts` y `catalogo-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 5;

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("ficha de datos de un producto de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let registrados: string[];
  let d: DependenciasDeFichaDeProductoWeb;

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
  const fila = (id: string) =>
    c.filas("select * from producto where id = $1", [id]).then((f) => f[0]);
  const version = async (id: string) => Number((await fila(id))?.["version"]);
  const auditorias = (id: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where entidad_id = $1 and accion = 'PRODUCTO_EDITADO'",
      [id],
    );
  const ficha = async (id: string, contexto = e.gerente) => {
    const r = await verLaFichaDeProducto(d, contexto, id);
    if (!r.ok) throw new Error(`se esperaba la ficha y vino ${r.error.codigo}`);
    return r.dato;
  };
  const guardar = (
    id: string,
    v: number,
    cambios: Record<string, unknown> = {},
    contexto = e.gerente,
  ) =>
    guardarLaFichaDeProducto(d, contexto, {
      productoId: id,
      versionEsperada: v,
      nombre: nombreAlAzarDeProducto("Editado"),
      ...cambios,
    });
  const codigoDe = (r: Awaited<ReturnType<typeof guardar>>) => (r.ok ? "OK" : r.error.codigo);

  it("la ficha trae los datos, la versión y las secciones activas, y nada de más", async () => {
    const x = await c.escenario();
    const seccionId = nuevoId();
    valorDe(
      await c.casos.crearSeccionDeCarta(x.gerente, { id: seccionId, nombre: "Minutas", orden: 1 }),
    );
    const baja = nuevoId();
    valorDe(await c.casos.crearSeccionDeCarta(x.gerente, { id: baja, nombre: "Vieja", orden: 2 }));
    valorDe(await c.casos.desactivarSeccionDeCarta(x.gerente, { seccionId: baja }));
    const id = await nuevoProducto(
      {
        nombre: "Milanesa",
        nombreDeCocina: "MILA",
        descripcionEnCarta: "Con papas",
        codigo: "MIL-1",
        seccionDeCartaId: seccionId,
      },
      x,
    );
    const f = await ficha(id, x.gerente);
    expect(f).toEqual({
      id,
      version: 1,
      nombre: "Milanesa",
      claseDeUso: "VENDIBLE",
      unidadBaseId: "UNIDAD",
      seVende: true,
      nombreDeCocina: "MILA",
      codigo: "MIL-1",
      codigoDeBarras: null,
      alicuota: "21",
      seccionDeCartaId: seccionId,
      alicuotas: ["21", "10.5", "27", "5", "2.5", "0"],
      secciones: [{ id: seccionId, nombre: "Minutas" }],
    });
    expect(Object.keys(f)).not.toContain("descripcionEnCarta");
  });

  it("guardar escribe lo editado, sube la versión una vez y audita solo lo que cambió; la descripción se conserva", async () => {
    const id = await nuevoProducto({ nombre: "Milanesa", descripcionEnCarta: "Con papas" });
    const r = await guardar(id, 1, {
      nombre: "Milanesa napolitana",
      nombreDeCocina: "MILA NAPO",
      codigo: "MIL-2",
      codigoDeBarras: "12345678",
      alicuota: "10.5",
    });
    expect(r).toEqual({ ok: true, dato: { productoId: id, version: 2 } });
    expect(await fila(id)).toMatchObject({
      nombre: "Milanesa napolitana",
      nombre_de_cocina: "MILA NAPO",
      descripcion_en_carta: "Con papas",
      codigo: "MIL-2",
      codigo_de_barras: "12345678",
      alicuota_iva: "10.5",
      version: 2,
    });
    const audit = (await c.auditoria(e.empresa, "PRODUCTO_EDITADO")).filter(
      (a) => a["entidad_id"] === id,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.["despues"]).not.toHaveProperty("descripcionEnCarta");
    expect(audit[0]?.["despues"]).toMatchObject({
      nombre: "Milanesa napolitana",
      alicuota: "10.5",
    });
  });

  it("repetir el mismo guardado (doble toque, reintento tras un éxito) no escribe ni audita de nuevo, aunque la versión sea vieja", async () => {
    const id = await nuevoProducto();
    const pedido = {
      nombre: nombreAlAzarDeProducto("Fijo"),
      nombreDeCocina: "Cocina",
      alicuota: "27",
    };
    expect(await guardar(id, 1, pedido)).toEqual({
      ok: true,
      dato: { productoId: id, version: 2 },
    });
    const antes = await auditorias(id);
    expect(await guardar(id, 1, pedido)).toEqual({
      ok: true,
      dato: { productoId: id, version: 2 },
    });
    expect(await guardar(id, 2, pedido)).toEqual({
      ok: true,
      dato: { productoId: id, version: 2 },
    });
    expect(await auditorias(id)).toBe(antes);
    expect(await version(id)).toBe(2);
  });

  it("dos pestañas: la que guarda después con la versión vieja recibe el genérico y no escribe", async () => {
    const id = await nuevoProducto();
    expect(codigoDe(await guardar(id, 1, { nombre: "Primera pestaña" }))).toBe("OK");
    const segunda = await guardar(id, 1, { nombre: "Segunda pestaña" });
    expect(segunda).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(JSON.stringify(segunda)).not.toContain("VERSION");
    expect((await fila(id))?.["nombre"]).toBe("Primera pestaña");
    expect(await version(id)).toBe(2);
  });

  it(`dos guardados a la vez con la misma versión (${String(RONDAS)} rondas): uno gana, el otro recibe el genérico, la versión sube una sola vez`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await nuevoProducto();
      const [a, b] = await Promise.all([
        guardar(id, 1, { nombre: `Ganador A ${String(ronda)}` }),
        guardar(id, 1, { nombre: `Ganador B ${String(ronda)}` }),
      ]);
      expect([codigoDe(a), codigoDe(b)].sort()).toEqual([GENERICO, "OK"]);
      expect(await version(id)).toBe(2);
      expect(await auditorias(id)).toBe(1);
      const nombre = String((await fila(id))?.["nombre"]);
      expect([`Ganador A ${String(ronda)}`, `Ganador B ${String(ronda)}`]).toContain(nombre);
    }
  });

  it("el mismo guardado dos veces a la vez (doble clic que llega doble): los dos salen bien y se escribe una sola vez", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const id = await nuevoProducto();
      const pedido = { nombre: `Mismo ${String(ronda)}`, nombreDeCocina: "Cocina" };
      const [a, b] = await Promise.all([guardar(id, 1, pedido), guardar(id, 1, pedido)]);
      expect([codigoDe(a), codigoDe(b)]).toEqual(["OK", "OK"]);
      expect(await version(id)).toBe(2);
      expect(await auditorias(id)).toBe(1);
    }
  });

  it.each([
    [
      "el nombre repetido",
      (otro: string) => ({ nombre: otro }),
      "CATALOGO_NOMBRE_REPETIDO",
      "nombre",
    ],
    ["el código repetido", () => ({ codigo: "REPETIDO-1" }), "CATALOGO_CODIGO_REPETIDO", "codigo"],
    [
      "el código de barras inválido",
      () => ({ codigoDeBarras: "123" }),
      "CATALOGO_CODIGO_DE_BARRAS_INVALIDO",
      "codigoDeBarras",
    ],
    [
      "la alícuota sin elegir en un producto que se vende",
      () => ({ alicuota: "" }),
      "CATALOGO_ELEGI_LA_ALICUOTA",
      "alicuota",
    ],
    ["el nombre vacío", () => ({ nombre: "   " }), "CATALOGO_FALTA_EL_NOMBRE", "nombre"],
  ] as const)(
    "%s sale con su texto y su campo y no escribe",
    async (_caso, cambios, codigo, campo) => {
      const x = await c.escenario();
      const otro = nombreAlAzarDeProducto("Otro");
      await nuevoProducto({ nombre: otro, codigo: "REPETIDO-1" }, x);
      const id = await nuevoProducto({}, x);
      const antes = await fila(id);
      const r = await guardar(id, 1, cambios(otro.toUpperCase()), x.gerente);
      expect(r).toMatchObject({ ok: false, error: { codigo, campo, presentacion: "AVISO" } });
      expect(await fila(id)).toEqual(antes);
    },
  );

  it("un nombre con signos no permitidos y un nombre de cocina inválido salen como el genérico", async () => {
    const id = await nuevoProducto();
    expect(codigoDe(await guardar(id, 1, { nombre: "<b>negrita</b>" }))).toBe(GENERICO);
    expect(codigoDe(await guardar(id, 1, { nombreDeCocina: "<x>" }))).toBe(GENERICO);
    expect(codigoDe(await guardar(id, 1, { alicuota: "33" }))).toBe(GENERICO);
    expect(codigoDe(await guardar(id, 1, { seccionDeCartaId: nuevoId() }))).toBe(GENERICO);
    expect(await version(id)).toBe(1);
  });

  it("una alícuota que el producto no ofrece (Exento) no se pierde si la pantalla no la manda", async () => {
    const id = await nuevoProducto({ alicuota: "EXENTO" });
    expect(await guardar(id, 1, { nombre: "Con exento", codigo: "EX-1" })).toMatchObject({
      ok: true,
    });
    expect(await fila(id)).toMatchObject({
      alicuota_iva: "EXENTO",
      codigo: "EX-1",
      nombre: "Con exento",
    });
  });

  it("una sección desactivada no se pierde si la pantalla no la manda, y no se ofrece", async () => {
    const x = await c.escenario();
    const seccionId = nuevoId();
    valorDe(
      await c.casos.crearSeccionDeCarta(x.gerente, {
        id: seccionId,
        nombre: "Temporada",
        orden: 1,
      }),
    );
    const id = await nuevoProducto({ seccionDeCartaId: seccionId }, x);
    valorDe(await c.casos.desactivarSeccionDeCarta(x.gerente, { seccionId }));
    expect((await ficha(id, x.gerente)).secciones).toEqual([]);
    expect(await guardar(id, 1, { nombre: "Sigue en su sección" }, x.gerente)).toMatchObject({
      ok: true,
    });
    expect((await fila(id))?.["seccion_de_carta_id"]).toBe(seccionId);
  });

  it("lo que llega vacío borra a propósito (el nombre de cocina, el código, la sección)", async () => {
    const x = await c.escenario();
    const seccionId = nuevoId();
    valorDe(
      await c.casos.crearSeccionDeCarta(x.gerente, { id: seccionId, nombre: "Minutas", orden: 1 }),
    );
    const id = await nuevoProducto(
      { nombreDeCocina: "MILA", codigo: "A-1", seccionDeCartaId: seccionId },
      x,
    );
    expect(
      await guardar(id, 1, { nombreDeCocina: "", codigo: "", seccionDeCartaId: "" }, x.gerente),
    ).toMatchObject({ ok: true });
    expect(await fila(id)).toMatchObject({
      nombre_de_cocina: null,
      codigo: null,
      seccion_de_carta_id: null,
    });
  });

  it("la clase decide qué se manda: las que se venden guardan cocina y alícuota; las demás aceptan el pedido y no guardan lo que no admiten", async () => {
    const casos = [
      ["REVENTA", true],
      ["VENDIBLE", true],
      ["MATERIA_PRIMA", false],
      ["INSUMO", false],
      ["ELABORADO", false],
    ] as const;
    for (const [claseDeUso, vende] of casos) {
      const id = await nuevoProducto({ claseDeUso, alicuota: vende ? "21" : undefined });
      const r = await guardar(id, 1, {
        nombre: `Editado ${claseDeUso}`,
        nombreDeCocina: "COCINA",
        alicuota: "10.5",
        codigo: `C-${claseDeUso}`,
      });
      expect(r, claseDeUso).toMatchObject({ ok: true });
      expect(await fila(id), claseDeUso).toMatchObject({
        nombre: `Editado ${claseDeUso}`,
        codigo: `C-${claseDeUso}`,
        nombre_de_cocina: vende ? "COCINA" : null,
        alicuota_iva: vende ? "10.5" : null,
      });
    }
  });

  it("no se cambia la clase ni la unidad, aunque el pedido las traiga", async () => {
    const id = await nuevoProducto();
    await verLaFichaDeProducto(d, e.gerente, id);
    const r = await guardarLaFichaDeProducto(d, e.gerente, {
      productoId: id,
      versionEsperada: 1,
      nombre: "Sigue igual",
      claseDeUso: "INSUMO",
      unidadBaseId: "KILOGRAMO",
    });
    expect(r).toMatchObject({ ok: true });
    expect(await fila(id)).toMatchObject({ clase_de_uso: "VENDIBLE", unidad_base_id: "UNIDAD" });
  });

  it("un producto desactivado, uno que no existe y un id mal escrito salen como el genérico", async () => {
    const id = await nuevoProducto();
    valorDe(await c.casos.desactivarProducto(e.gerente, { productoId: id }));
    expect(codigoDe(await guardar(id, 1))).toBe(GENERICO);
    expect(codigoDe(await guardar(nuevoId(), 1))).toBe(GENERICO);
    expect(codigoDe(await guardar("no-es-un-id", 1))).toBe(GENERICO);
    const sin = await verLaFichaDeProducto(d, e.gerente, nuevoId());
    expect(sin).toMatchObject({ ok: false, error: { codigo: GENERICO } });
  });

  it("aislamiento: una empresa no ve ni toca los productos de otra, y no se distingue de uno que no existe", async () => {
    const otra = await c.escenario();
    const id = await nuevoProducto({ nombre: "Reservado" }, otra);
    const antes = await fila(id);
    const ver = await verLaFichaDeProducto(d, e.gerente, id);
    expect(ver).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    expect(JSON.stringify(ver)).not.toContain("Reservado");
    expect(codigoDe(await guardar(id, 1, { nombre: "Robado" }))).toBe(GENERICO);
    expect(await fila(id)).toEqual(antes);
  });

  it("el permiso lo deciden la consulta y el caso de uso: el operador ve pero no guarda; el administrador de una sola sucursal no guarda (alcance)", async () => {
    const id = await nuevoProducto();
    const antes = await fila(id);
    expect((await ficha(id, e.operador)).nombre).toBeDefined();
    expect(await guardar(id, 1, {}, e.operador)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(await guardar(id, 1, {}, e.administradorDeUnaSucursal)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(
      codigoDe(await guardar(id, 1, { nombre: "Por el administrador" }, e.administrador)),
    ).toBe("OK");
    expect((await fila(id))?.["nombre"]).not.toBe(antes?.["nombre"]);
  });

  it("con el catálogo en desarrollo (hoy, en el catálogo real) todos reciben MODULO_EN_DESARROLLO y ningún dato", async () => {
    const x = await cerrado.escenario();
    // Con SQL del dueño de la base: el caso de uso de alta también está cerrado.
    const id = await productoDeBase(cerrado.dueno, x.empresa, { nombre: "Cerrado" });
    const dependencias: DependenciasDeFichaDeProductoWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const ver = await verLaFichaDeProducto(dependencias, contexto, id);
      expect(ver).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_DESARROLLO", presentacion: "POR_QUE_NO_PUEDO" },
      });
      const guarda = await guardarLaFichaDeProducto(dependencias, contexto, {
        productoId: id,
        versionEsperada: 1,
        nombre: "Cerrado",
      });
      expect(guarda).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(JSON.stringify([ver, guarda])).not.toContain("Cerrado");
    }
  });

  it("ver es una lectura: no escribe ni audita", async () => {
    const id = await nuevoProducto();
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [e.empresa],
    );
    const filaAntes = await fila(id);
    await ficha(id);
    await ficha(id, e.operador);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(antes);
    expect(await fila(id)).toEqual(filaAntes);
  });

  it("un fallo inesperado sale sin detalle y con referencia; el detalle va al registro del servidor", async () => {
    const roto: DependenciasDeFichaDeProductoWeb = {
      ...d,
      consultas: () => {
        throw new Error("la base dijo: relation producto_x does not exist");
      },
    };
    const r = await verLaFichaDeProducto(roto, e.gerente, nuevoId());
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("relation");
    expect(registrados.some((z) => z.includes("relation producto_x"))).toBe(true);
  });
});
