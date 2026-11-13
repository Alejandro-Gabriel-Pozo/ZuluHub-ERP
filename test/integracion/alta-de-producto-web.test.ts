import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { CATALOGO_DE_MODULOS } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA } from "../../src/capacidades/permisos/empresa";
import {
  crearElProducto,
  verLasOpcionesDelAlta,
  type DependenciasDeAltaDeProductoWeb,
} from "../../src/composicion/alta-de-producto-web";
import { UNIDADES } from "../../src/primitivas/unidades/unidades";
import {
  montarCatalogo,
  nombreAlAzarDeProducto,
  nuevoId,
  valorDe,
  type EscenarioDeCatalogo,
} from "./catalogo-apoyo";

/**
 * El alta de un producto de la web (`alta-de-producto-web.ts`, A1 T6) contra una base real y los roles reales: lo que la pantalla recibe, qué se escribe y qué se audita, que una empresa
 * no crea en otra, que el permiso y el módulo en desarrollo los decide el caso de uso, la IDEMPOTENCIA (la misma clave de creación repetida, o a la vez, es un solo producto), la
 * CONCURRENCIA (dos altas a la vez con el mismo nombre son una sola) y que un nombre, código o código de barras repetido no crea nada. Los casos de uso en sí tienen sus pruebas en
 * `catalogo-casos-de-uso.test.ts` y `catalogo-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });
const RONDAS = 5;

const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

describe.skipIf(base === null)("alta de un producto de la web", () => {
  let c: Awaited<ReturnType<typeof montarCatalogo>>;
  let cerrado: Awaited<ReturnType<typeof montarCatalogo>>;
  let e: EscenarioDeCatalogo;
  let registrados: string[];
  let d: DependenciasDeAltaDeProductoWeb;

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

  const pedido = (cambios: Record<string, unknown> = {}) => ({
    claveDeCreacion: nuevoId(),
    claseDeUso: "VENDIBLE",
    unidadBaseId: "UNIDAD",
    nombre: nombreAlAzarDeProducto(),
    nombreDeCocina: "",
    codigo: "",
    codigoDeBarras: "",
    alicuota: "21",
    seccionDeCartaId: "",
    ...cambios,
  });
  const crear = (cambios: Record<string, unknown> = {}, contexto = e.gerente) =>
    crearElProducto(d, contexto, pedido(cambios));
  const fila = (id: string) =>
    c.filas("select * from producto where id = $1", [id]).then((f) => f[0]);
  const filasDeNombre = (empresa: string, nombre: string) =>
    c.contar(
      "select count(*) as n from producto where empresa_id = $1 and lower(nombre) = lower($2)",
      [empresa, nombre],
    );
  const auditorias = (id: string) =>
    c.contar(
      "select count(*) as n from auditoria_empresa where entidad_id = $1 and accion = 'PRODUCTO_CREADO'",
      [id],
    );
  const codigoDe = (r: Awaited<ReturnType<typeof crear>>) => (r.ok ? "OK" : r.error.codigo);

  it("ofrece las cinco clases, las 14 unidades, las seis alícuotas y las secciones ACTIVAS, y nada de más", async () => {
    const x = await c.escenario();
    const activa = nuevoId();
    valorDe(
      await c.casos.crearSeccionDeCarta(x.gerente, { id: activa, nombre: "Minutas", orden: 1 }),
    );
    const baja = nuevoId();
    valorDe(await c.casos.crearSeccionDeCarta(x.gerente, { id: baja, nombre: "Vieja", orden: 2 }));
    valorDe(await c.casos.desactivarSeccionDeCarta(x.gerente, { seccionId: baja }));
    const r = await verLasOpcionesDelAlta(d, x.gerente);
    expect(r).toEqual({
      ok: true,
      dato: {
        clases: [
          { valor: "MATERIA_PRIMA", seVende: false },
          { valor: "INSUMO", seVende: false },
          { valor: "REVENTA", seVende: true },
          { valor: "ELABORADO", seVende: false },
          { valor: "VENDIBLE", seVende: true },
        ],
        unidades: Object.keys(UNIDADES),
        alicuotas: ["21", "10.5", "27", "5", "2.5", "0"],
        secciones: [{ id: activa, nombre: "Minutas" }],
      },
    });
  });

  it("crear escribe el producto completo con la clave como id (por unidad y paso 1, sin descripción, sin «Falta completar») y audita una vez", async () => {
    const x = await c.escenario();
    const seccionId = nuevoId();
    valorDe(
      await c.casos.crearSeccionDeCarta(x.gerente, { id: seccionId, nombre: "Minutas", orden: 1 }),
    );
    const p = pedido({
      nombre: "Milanesa",
      nombreDeCocina: "MILA",
      codigo: "MIL-1",
      codigoDeBarras: "12345678",
      alicuota: "10.5",
      seccionDeCartaId: seccionId,
    });
    expect(await crearElProducto(d, x.gerente, p)).toEqual({
      ok: true,
      dato: { productoId: p.claveDeCreacion, yaExistia: false },
    });
    expect(await fila(p.claveDeCreacion)).toMatchObject({
      empresa_id: x.empresa,
      nombre: "Milanesa",
      nombre_de_cocina: "MILA",
      descripcion_en_carta: null,
      codigo: "MIL-1",
      codigo_de_barras: "12345678",
      alicuota_iva: "10.5",
      seccion_de_carta_id: seccionId,
      clase_de_uso: "VENDIBLE",
      unidad_base_id: "UNIDAD",
      unidad_de_venta_id: "UNIDAD",
      falta_completar: false,
      activo: true,
      version: 1,
    });
    expect(Number((await fila(p.claveDeCreacion))?.["paso_minimo"])).toBe(1);
    const audit = (await c.auditoria(x.empresa, "PRODUCTO_CREADO")).filter(
      (a) => a["entidad_id"] === p.claveDeCreacion,
    );
    expect(audit).toHaveLength(1);
    expect(audit[0]?.["actor_persona_id"]).toBe(x.personaDelGerente);
    expect(audit[0]?.["despues"]).toMatchObject({
      nombre: "Milanesa",
      claseDeUso: "VENDIBLE",
      faltaCompletar: false,
      seVende: true,
    });
  });

  it("no se manda la forma de venta ni la descripción: lo que el pedido traiga de más no llega a la base", async () => {
    const p = {
      ...pedido({ unidadBaseId: "KILOGRAMO", claseDeUso: "REVENTA" }),
      unidadDeVentaId: "GRAMO",
      pasoMinimo: "0.5",
      descripcionEnCarta: "otra",
      faltaCompletar: true,
      empresaId: "otra",
    };
    const r = await crearElProducto(d, e.gerente, p);
    expect(r.ok).toBe(true);
    expect(await fila(p.claveDeCreacion)).toMatchObject({
      empresa_id: e.empresa,
      unidad_base_id: "KILOGRAMO",
      unidad_de_venta_id: "KILOGRAMO",
      descripcion_en_carta: null,
      falta_completar: false,
    });
    expect(Number((await fila(p.claveDeCreacion))?.["paso_minimo"])).toBe(1);
  });

  it("las cinco clases y las 14 unidades se pueden crear; lo que una clase no se vende no lleva cocina, alícuota ni sección", async () => {
    for (const [claseDeUso, vende] of [
      ["REVENTA", true],
      ["VENDIBLE", true],
      ["MATERIA_PRIMA", false],
      ["INSUMO", false],
      ["ELABORADO", false],
    ] as const) {
      const p = pedido({
        claseDeUso,
        nombreDeCocina: "COCINA",
        alicuota: "21",
        codigo: `C-${claseDeUso}-${nuevoId().slice(0, 8)}`,
      });
      const r = await crearElProducto(d, e.gerente, p);
      expect(r, claseDeUso).toMatchObject({ ok: true });
      expect(await fila(p.claveDeCreacion), claseDeUso).toMatchObject({
        clase_de_uso: claseDeUso,
        nombre_de_cocina: vende ? "COCINA" : null,
        alicuota_iva: vende ? "21" : null,
      });
    }
    for (const unidad of Object.keys(UNIDADES)) {
      const p = pedido({ unidadBaseId: unidad, claseDeUso: "MATERIA_PRIMA", alicuota: "" });
      expect(codigoDe(await crearElProducto(d, e.gerente, p)), unidad).toBe("OK");
      expect(await fila(p.claveDeCreacion), unidad).toMatchObject({
        unidad_base_id: unidad,
        unidad_de_venta_id: unidad,
      });
    }
  });

  it("IDEMPOTENCIA: repetir el mismo pedido con la misma clave (reintento tras un éxito) devuelve el producto ya creado, sin escribir ni auditar de nuevo", async () => {
    const p = pedido({ nombre: "Una sola vez" });
    expect(await crearElProducto(d, e.gerente, p)).toEqual({
      ok: true,
      dato: { productoId: p.claveDeCreacion, yaExistia: false },
    });
    const antes = await fila(p.claveDeCreacion);
    expect(await crearElProducto(d, e.gerente, p)).toEqual({
      ok: true,
      dato: { productoId: p.claveDeCreacion, yaExistia: true },
    });
    expect(await filasDeNombre(e.empresa, "Una sola vez")).toBe(1);
    expect(await auditorias(p.claveDeCreacion)).toBe(1);
    expect(await fila(p.claveDeCreacion)).toEqual(antes);
  });

  it(`IDEMPOTENCIA: el mismo envío dos veces a la vez (doble clic que llega doble, ${String(RONDAS)} rondas): los dos salen bien, un solo producto, una sola auditoría`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const p = pedido({ nombre: `Doble clic ${String(ronda)} ${nuevoId().slice(0, 6)}` });
      const [a, b] = await Promise.all([
        crearElProducto(d, e.gerente, p),
        crearElProducto(d, e.gerente, p),
      ]);
      expect([codigoDe(a), codigoDe(b)]).toEqual(["OK", "OK"]);
      expect(await filasDeNombre(e.empresa, p.nombre)).toBe(1);
      expect(await auditorias(p.claveDeCreacion)).toBe(1);
    }
  });

  it("la misma clave con otro contenido no pisa ni duplica: sale el genérico y lo guardado queda igual", async () => {
    const p = pedido({ nombre: "Original" });
    expect(codigoDe(await crearElProducto(d, e.gerente, p))).toBe("OK");
    const antes = await fila(p.claveDeCreacion);
    const otro = { ...p, nombre: "Otro contenido", alicuota: "27" };
    expect(codigoDe(await crearElProducto(d, e.gerente, otro))).toBe(GENERICO);
    expect(await fila(p.claveDeCreacion)).toEqual(antes);
    expect(await filasDeNombre(e.empresa, "Otro contenido")).toBe(0);
  });

  it(`CONCURRENCIA: dos altas a la vez con el mismo nombre y claves distintas (${String(RONDAS)} rondas): una gana y la otra recibe «Ya existe un producto con ese nombre»; queda una sola`, async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const nombre = `Carrera ${String(ronda)} ${nuevoId().slice(0, 6)}`;
      const [a, b] = await Promise.all([
        crear({ nombre }),
        crear({ nombre: nombre.toUpperCase() }),
      ]);
      expect([codigoDe(a), codigoDe(b)].sort()).toEqual(["CATALOGO_NOMBRE_REPETIDO", "OK"]);
      const perdedora = a.ok ? b : a;
      expect(perdedora).toMatchObject({ ok: false, error: { campo: "nombre" } });
      expect(await filasDeNombre(e.empresa, nombre)).toBe(1);
    }
  });

  it("CONCURRENCIA: dos altas a la vez con el mismo código y nombres distintos: una sola", async () => {
    for (let ronda = 0; ronda < RONDAS; ronda += 1) {
      const codigo = `CARRERA-${String(ronda)}-${nuevoId().slice(0, 6)}`;
      const [a, b] = await Promise.all([crear({ codigo }), crear({ codigo })]);
      expect([codigoDe(a), codigoDe(b)].sort()).toEqual(["CATALOGO_CODIGO_REPETIDO", "OK"]);
      expect(
        await c.contar("select count(*) as n from producto where empresa_id = $1 and codigo = $2", [
          e.empresa,
          codigo,
        ]),
      ).toBe(1);
    }
  });

  it.each([
    [
      "el nombre repetido (sin distinguir mayúsculas)",
      (otro: string) => ({ nombre: otro.toUpperCase() }),
      "CATALOGO_NOMBRE_REPETIDO",
      "nombre",
    ],
    [
      "el código repetido",
      () => ({ codigo: "REPETIDO-ALTA-1" }),
      "CATALOGO_CODIGO_REPETIDO",
      "codigo",
    ],
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
    "%s sale con su texto y su campo y no crea nada",
    async (_caso, cambios, codigo, campo) => {
      const x = await c.escenario();
      const otro = nombreAlAzarDeProducto("Otro");
      valorDe(
        await c.casos.crearProducto(x.gerente, {
          id: nuevoId(),
          claseDeUso: "VENDIBLE",
          nombre: otro,
          unidadBaseId: "UNIDAD",
          alicuota: "21",
          codigo: "REPETIDO-ALTA-1",
        }),
      );
      const antes = await c.contar("select count(*) as n from producto where empresa_id = $1", [
        x.empresa,
      ]);
      const r = await crearElProducto(d, x.gerente, pedido(cambios(otro)));
      expect(r).toMatchObject({ ok: false, error: { codigo, campo, presentacion: "AVISO" } });
      expect(
        await c.contar("select count(*) as n from producto where empresa_id = $1", [x.empresa]),
      ).toBe(antes);
    },
  );

  it("el nombre repetido también cuenta contra un producto DESACTIVADO (nada se borra)", async () => {
    const x = await c.escenario();
    const viejo = pedido({ nombre: "Descontinuado" });
    expect(codigoDe(await crearElProducto(d, x.gerente, viejo))).toBe("OK");
    valorDe(await c.casos.desactivarProducto(x.gerente, { productoId: viejo.claveDeCreacion }));
    expect(await crearElProducto(d, x.gerente, pedido({ nombre: "descontinuado" }))).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_NOMBRE_REPETIDO", campo: "nombre" },
    });
  });

  it("un nombre con signos no permitidos, una clase, una unidad o una alícuota inexistentes y una sección que no existe salen como el genérico y no crean nada", async () => {
    const x = await c.escenario();
    const antes = await c.contar("select count(*) as n from producto where empresa_id = $1", [
      x.empresa,
    ]);
    for (const cambios of [
      { nombre: "<b>negrita</b>" },
      { nombreDeCocina: "<x>" },
      { claseDeUso: "OTRA" },
      { unidadBaseId: "PARSEC" },
      { alicuota: "33" },
      { seccionDeCartaId: nuevoId() },
    ]) {
      expect(codigoDe(await crear(cambios, x.gerente)), JSON.stringify(cambios)).toBe(GENERICO);
    }
    expect(
      await c.contar("select count(*) as n from producto where empresa_id = $1", [x.empresa]),
    ).toBe(antes);
  });

  it("aislamiento: el mismo nombre en otra empresa se puede; una sección de otra empresa no se ve (el genérico); la clave de otra empresa no se pisa", async () => {
    const a = await c.escenario();
    const b = await c.escenario();
    const nombre = nombreAlAzarDeProducto("Compartido");
    expect(codigoDe(await crear({ nombre }, a.gerente))).toBe("OK");
    expect(codigoDe(await crear({ nombre }, b.gerente))).toBe("OK");
    const seccionDeB = nuevoId();
    valorDe(
      await c.casos.crearSeccionDeCarta(b.gerente, { id: seccionDeB, nombre: "De B", orden: 1 }),
    );
    expect(codigoDe(await crear({ seccionDeCartaId: seccionDeB }, a.gerente))).toBe(GENERICO);
    const p = pedido();
    expect(codigoDe(await crearElProducto(d, a.gerente, p))).toBe("OK");
    expect(codigoDe(await crearElProducto(d, b.gerente, p))).toBe(GENERICO);
    expect((await fila(p.claveDeCreacion))?.["empresa_id"]).toBe(a.empresa);
  });

  it("el permiso lo deciden la consulta y el caso de uso: el operador no crea; el administrador de una sola sucursal no crea (alcance); gerente y administrador sí", async () => {
    const antes = await c.contar("select count(*) as n from producto where empresa_id = $1", [
      e.empresa,
    ]);
    expect(await crear({}, e.operador)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    expect(await crear({}, e.administradorDeUnaSucursal)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(
      await c.contar("select count(*) as n from producto where empresa_id = $1", [e.empresa]),
    ).toBe(antes);
    expect(codigoDe(await crear({}, e.administrador))).toBe("OK");
    expect(codigoDe(await crear({}, e.gerente))).toBe("OK");
  });

  it("con el catálogo en desarrollo (hoy, en el catálogo real) todos reciben MODULO_EN_DESARROLLO, no se ofrece ni se crea nada", async () => {
    const x = await cerrado.escenario();
    const dependencias: DependenciasDeAltaDeProductoWeb = {
      ...d,
      casosDeUso: () => cerrado.casos,
      consultas: () => cerrado.consultas,
    };
    for (const contexto of [x.gerente, x.administrador, x.operador]) {
      const opciones = await verLasOpcionesDelAlta(dependencias, contexto);
      expect(opciones).toMatchObject({
        ok: false,
        error: { codigo: "MODULO_EN_DESARROLLO", presentacion: "POR_QUE_NO_PUEDO" },
      });
      const p = pedido({ nombre: "Cerrado" });
      const alta = await crearElProducto(dependencias, contexto, p);
      expect(alta).toMatchObject({ ok: false, error: { codigo: "MODULO_EN_DESARROLLO" } });
      expect(JSON.stringify([opciones, alta])).not.toContain("MATERIA_PRIMA");
      expect(await filasDeNombre(x.empresa, "Cerrado")).toBe(0);
    }
  });

  it("ver lo que se ofrece es una lectura: no escribe ni audita", async () => {
    const antes = await c.contar(
      "select count(*) as n from auditoria_empresa where empresa_id = $1",
      [e.empresa],
    );
    await verLasOpcionesDelAlta(d, e.gerente);
    await verLasOpcionesDelAlta(d, e.operador);
    expect(
      await c.contar("select count(*) as n from auditoria_empresa where empresa_id = $1", [
        e.empresa,
      ]),
    ).toBe(antes);
  });

  it("un fallo inesperado sale sin detalle y con referencia; el detalle va al registro del servidor", async () => {
    const roto: DependenciasDeAltaDeProductoWeb = {
      ...d,
      casosDeUso: () => {
        throw new Error("la base dijo: relation producto_x does not exist");
      },
    };
    const r = await crearElProducto(roto, e.gerente, pedido());
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("relation");
    expect(registrados.some((z) => z.includes("relation producto_x"))).toBe(true);
  });
});
