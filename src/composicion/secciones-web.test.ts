import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  cambiarElEstadoDeLaSeccion,
  crearLaSeccion,
  moverUnaSeccion,
  renombrarLaSeccion,
  verLaSeccion,
  verLasSecciones,
  verUnaSeccion,
  type DependenciasDeSeccionesWeb,
} from "./secciones-web";

/**
 * La pantalla «Secciones de la carta» (A8, parte 1) con el módulo simulado: qué lee y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real,
 * `test/integracion/secciones-web.test.ts`.
 */
const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const C = "7d2e1f00-1111-4222-8333-944455556666";
const NUEVA = "9a8b7c6d-1111-4222-8333-944455556666";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;

const SECCIONES = [
  { id: A, nombre: "Cafés", orden: 0, activa: true, version: 3, productos: 2 },
  { id: B, nombre: "Postres", orden: 4, activa: false, version: 1, productos: 1 },
  { id: C, nombre: "Bebidas", orden: 7, activa: true, version: 5, productos: 0 },
];

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  lista: () => unknown;
  productos: () => unknown;
  crear: () => unknown;
  editar: () => unknown;
  desactivar: () => unknown;
  reactivar: () => unknown;
  reordenar: () => unknown;
};
const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    lista: () => ok(SECCIONES),
    productos: () => ok({ productos: [], siguiente: null }),
    crear: () => ok({ seccionId: NUEVA, yaExistia: false }),
    editar: () => ok({ version: 4 }),
    desactivar: () => ok({ yaEstaba: false }),
    reactivar: () => ok({ yaEstaba: false }),
    reordenar: () => ok({ movidas: 2 }),
    ...cambios,
  };
  const registrar = (que: string, entrada: unknown, resultado: () => unknown) => {
    m.llamadas.push({ que, entrada });
    return Promise.resolve(resultado());
  };
  const d = {
    casosDeUso: () => ({
      crearSeccionDeCarta: (_c: unknown, e: unknown) => registrar("crear", e, m.crear),
      editarSeccionDeCarta: (_c: unknown, e: unknown) => registrar("editar", e, m.editar),
      desactivarSeccionDeCarta: (_c: unknown, e: unknown) =>
        registrar("desactivar", e, m.desactivar),
      reactivarSeccionDeCarta: (_c: unknown, e: unknown) => registrar("reactivar", e, m.reactivar),
      reordenarSeccionesDeCarta: (_c: unknown, e: unknown) =>
        registrar("reordenar", e, m.reordenar),
    }),
    consultas: () => ({
      listarSeccionesParaGestionar: () => registrar("lista", null, m.lista),
      listarProductos: (_c: unknown, e: unknown) => registrar("productos", e, m.productos),
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeSeccionesWeb;
  return { m, d };
};

const GENERICO = {
  ok: false,
  error: {
    codigo: "CATALOGO_ACCION_NO_PERMITIDA",
    clave: "catalogo.error.accion_no_permitida",
    presentacion: "AVISO",
  },
};
const FALTA_EL_NOMBRE = {
  ok: false,
  error: {
    codigo: "CATALOGO_FALTA_EL_NOMBRE",
    clave: "catalogo.error.falta_el_nombre",
    presentacion: "AVISO",
    campo: "nombre",
  },
};
const queLlamo = (m: Montaje) => m.llamadas.map((l) => l.que);

describe("verLasSecciones", () => {
  it("trae todas, activas y desactivadas, en el orden que da el servidor y solo con lo que la pantalla necesita", async () => {
    const { d } = montar();
    expect(await verLasSecciones(d, contexto)).toEqual({
      ok: true,
      dato: {
        secciones: [
          { id: A, nombre: "Cafés", activa: true, version: 3 },
          { id: B, nombre: "Postres", activa: false, version: 1 },
          { id: C, nombre: "Bebidas", activa: true, version: 5 },
        ],
      },
    });
  });

  it("el motivo del guard sale tal cual, sin dato alguno", async () => {
    const { d } = montar({ lista: () => err("MODULO_EN_DESARROLLO") });
    const r = await verLasSecciones(d, contexto);
    expect(!r.ok && r.error.codigo).toBe("MODULO_EN_DESARROLLO");
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const { m, d } = montar({
      lista: () => {
        throw new Error("password authentication failed");
      },
    });
    const r = await verLasSecciones(d, contexto);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r)).not.toContain("password");
    expect(!r.ok && r.error.referencia).toMatch(/^PD-/);
    expect(m.registrados.join(" ")).toContain("password authentication failed");
  });
});

describe("verLaSeccion", () => {
  it("trae la sección pedida, sin sus productos", async () => {
    const { m, d } = montar();
    expect(await verLaSeccion(d, contexto, C)).toEqual({
      ok: true,
      dato: { id: C, nombre: "Bebidas", activa: true, version: 5 },
    });
    expect(queLlamo(m)).toEqual(["lista"]);
  });

  it("una sección desactivada también se trae", async () => {
    const { d } = montar();
    const r = await verLaSeccion(d, contexto, B);
    expect(r.ok && r.dato.activa).toBe(false);
  });

  it("un id sin forma de uuid no se consulta: el genérico", async () => {
    const { m, d } = montar();
    expect(await verLaSeccion(d, contexto, "no-es-un-id")).toEqual(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it("una sección que no está entre las de la empresa (ajena o inexistente) es el genérico, sin decir cuál", async () => {
    const { d } = montar();
    expect(await verLaSeccion(d, contexto, NUEVA)).toEqual(GENERICO);
  });

  it("el motivo del guard sale tal cual", async () => {
    const { d } = montar({ lista: () => err("SIN_PERMISO") });
    const r = await verLaSeccion(d, contexto, A);
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const { d } = montar({
      lista: () => {
        throw new Error("boom");
      },
    });
    const r = await verLaSeccion(d, contexto, A);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
  });
});

describe("verUnaSeccion", () => {
  const PRODUCTOS = {
    productos: [
      { id: "p1", nombre: "Cortado", estado: "ACTIVO", precio: null, seccion: { id: A } },
      { id: "p2", nombre: "Espresso", estado: "ACTIVO", precio: null, seccion: { id: A } },
    ],
    siguiente: null,
  };

  it("trae la sección y sus productos activos (solo id y nombre) con el filtro de la sección", async () => {
    const { m, d } = montar({ productos: () => ok(PRODUCTOS) });
    const r = await verUnaSeccion(d, contexto, { seccionId: A, despues: "" });
    expect(r).toEqual({
      ok: true,
      dato: {
        seccion: { id: A, nombre: "Cafés", activa: true, version: 3 },
        productos: [
          { id: "p1", nombre: "Cortado" },
          { id: "p2", nombre: "Espresso" },
        ],
        siguiente: null,
      },
    });
    // Estricto: la primera página no lleva ni una clave `despuesDe` vacía.
    expect(m.llamadas[1]).toStrictEqual({
      que: "productos",
      entrada: { seccionId: A, activo: true },
    });
  });

  it("una sección desactivada también se ve, con sus productos", async () => {
    const { m, d } = montar();
    const r = await verUnaSeccion(d, contexto, { seccionId: B, despues: "" });
    expect(r.ok && r.dato.seccion.activa).toBe(false);
    expect(queLlamo(m)).toEqual(["lista", "productos"]);
  });

  it("si hay más de una página, sale la clave de la que sigue; y esa clave pide la página siguiente", async () => {
    const { m, d } = montar({
      productos: () => ok({ ...PRODUCTOS, siguiente: { nombreClave: "espresso", id: A } }),
    });
    const r = await verUnaSeccion(d, contexto, { seccionId: A, despues: "" });
    expect(r.ok && r.dato.siguiente).toBe(`${A}:espresso`);
    await verUnaSeccion(d, contexto, { seccionId: A, despues: `${B}:cortado` });
    expect(m.llamadas.at(-1)).toEqual({
      que: "productos",
      entrada: { seccionId: A, activo: true, despuesDe: { id: B, nombreClave: "cortado" } },
    });
  });

  it("una página de la dirección que la consulta no pudo dar muestra la lista vacía, sin consultar productos (nunca se ensancha)", async () => {
    const { m, d } = montar({ productos: () => ok(PRODUCTOS) });
    const r = await verUnaSeccion(d, contexto, { seccionId: A, despues: "no-es-una-pagina" });
    expect(r).toEqual({
      ok: true,
      dato: {
        seccion: { id: A, nombre: "Cafés", activa: true, version: 3 },
        productos: [],
        siguiente: null,
      },
    });
    expect(queLlamo(m)).toEqual(["lista"]);
  });

  it("un id sin forma de uuid o de otra empresa es el genérico y no consulta productos", async () => {
    const { m, d } = montar();
    expect(await verUnaSeccion(d, contexto, { seccionId: "x", despues: "" })).toEqual(GENERICO);
    expect(await verUnaSeccion(d, contexto, { seccionId: NUEVA, despues: "" })).toEqual(GENERICO);
    expect(queLlamo(m)).toEqual(["lista"]);
  });

  it("el motivo del guard al leer los productos sale tal cual", async () => {
    const { d } = montar({ productos: () => err("SIN_PERMISO") });
    const r = await verUnaSeccion(d, contexto, { seccionId: A, despues: "" });
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("el motivo del guard al leer las secciones sale tal cual y no se piden productos", async () => {
    const { m, d } = montar({ lista: () => err("MODULO_EN_DESARROLLO") });
    const r = await verUnaSeccion(d, contexto, { seccionId: A, despues: "" });
    expect(!r.ok && r.error.codigo).toBe("MODULO_EN_DESARROLLO");
    expect(queLlamo(m)).toEqual(["lista"]);
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const { d } = montar({
      productos: () => {
        throw new Error("boom");
      },
    });
    const r = await verUnaSeccion(d, contexto, { seccionId: A, despues: "" });
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
  });
});

describe("crearLaSeccion", () => {
  const PEDIDO = { claveDeCreacion: NUEVA, nombre: "Entradas" };

  it("crea con la clave como id y el orden siguiente al mayor de la lista (también de las desactivadas)", async () => {
    const { m, d } = montar();
    const r = await crearLaSeccion(d, contexto, PEDIDO);
    expect(r).toEqual({ ok: true, dato: { seccionId: NUEVA, yaExistia: false } });
    expect(m.llamadas).toEqual([
      { que: "lista", entrada: null },
      { que: "crear", entrada: { id: NUEVA, nombre: "Entradas", orden: 8 } },
    ]);
  });

  it("la misma creación repetida (el id ya está en la lista) lleva el orden que ya tiene, y devuelve la misma sección", async () => {
    const { m, d } = montar({
      lista: () =>
        ok([
          ...SECCIONES,
          { id: NUEVA, nombre: "Entradas", orden: 8, activa: true, version: 1, productos: 0 },
          { id: A, nombre: "Otra", orden: 99, activa: true, version: 1, productos: 0 },
        ]),
      crear: () => ok({ seccionId: NUEVA, yaExistia: true }),
    });
    const r = await crearLaSeccion(d, contexto, PEDIDO);
    expect(r).toEqual({ ok: true, dato: { seccionId: NUEVA, yaExistia: true } });
    expect(m.llamadas[1]).toEqual({
      que: "crear",
      entrada: { id: NUEVA, nombre: "Entradas", orden: 8 },
    });
  });

  it("sin secciones, la primera lleva el orden 0", async () => {
    const { m, d } = montar({ lista: () => ok([]) });
    await crearLaSeccion(d, contexto, PEDIDO);
    expect(m.llamadas[1]).toEqual({
      que: "crear",
      entrada: { id: NUEVA, nombre: "Entradas", orden: 0 },
    });
  });

  it("un pedido sin la forma pedida es el genérico y no toca el módulo", async () => {
    const { m, d } = montar();
    for (const crudo of [
      null,
      {},
      { ...PEDIDO, claveDeCreacion: "x" },
      { claveDeCreacion: NUEVA },
    ]) {
      expect(await crearLaSeccion(d, contexto, crudo)).toEqual(GENERICO);
    }
    expect(m.llamadas).toEqual([]);
  });

  it.each(["", "   ", "\t"])(
    "el nombre vacío (%j) es «Falta el nombre», asociado al campo, sin consultar",
    async (nombre) => {
      const { m, d } = montar();
      expect(await crearLaSeccion(d, contexto, { ...PEDIDO, nombre })).toEqual(FALTA_EL_NOMBRE);
      expect(m.llamadas).toEqual([]);
    },
  );

  it("el motivo del guard al leer la lista sale tal cual y no se escribe", async () => {
    const { m, d } = montar({ lista: () => err("SIN_PERMISO") });
    const r = await crearLaSeccion(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
    expect(queLlamo(m)).toEqual(["lista"]);
  });

  it.each(["SECCION_DUPLICADA", "ID_REUTILIZADO", "NOMBRE_DE_SECCION_INVALIDO", "ORDEN_INVALIDO"])(
    "el error %s sale como el genérico (hasta que el dueño apruebe un texto propio)",
    async (error) => {
      const { d } = montar({ crear: () => err(error) });
      expect(await crearLaSeccion(d, contexto, PEDIDO)).toEqual(GENERICO);
    },
  );

  it("el motivo del guard al crear sale tal cual", async () => {
    const { d } = montar({ crear: () => err("MODULO_EN_DESARROLLO") });
    const r = await crearLaSeccion(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("MODULO_EN_DESARROLLO");
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const { d } = montar({
      crear: () => {
        throw new Error("boom");
      },
    });
    const r = await crearLaSeccion(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
  });
});

describe("renombrarLaSeccion", () => {
  const PEDIDO = { seccionId: A, versionEsperada: 3, nombre: "Cafetería" };

  it("pide al caso de uso la versión que se vio y el orden que la sección tiene hoy, y devuelve la versión nueva", async () => {
    const { m, d } = montar();
    expect(await renombrarLaSeccion(d, contexto, PEDIDO)).toEqual({
      ok: true,
      dato: { seccionId: A, version: 4 },
    });
    expect(m.llamadas).toEqual([
      { que: "lista", entrada: null },
      {
        que: "editar",
        entrada: { seccionId: A, versionEsperada: 3, nombre: "Cafetería", orden: 0 },
      },
    ]);
  });

  it("una sección con otro orden lleva ese orden (renombrar no la mueve)", async () => {
    const { m, d } = montar();
    await renombrarLaSeccion(d, contexto, { ...PEDIDO, seccionId: C, versionEsperada: 5 });
    expect(m.llamadas[1]?.entrada).toMatchObject({ seccionId: C, orden: 7 });
  });

  it("un pedido sin la forma pedida es el genérico y no toca el módulo", async () => {
    const { m, d } = montar();
    for (const crudo of [
      null,
      {},
      { ...PEDIDO, seccionId: "x" },
      { ...PEDIDO, versionEsperada: -1 },
    ]) {
      expect(await renombrarLaSeccion(d, contexto, crudo)).toEqual(GENERICO);
    }
    expect(m.llamadas).toEqual([]);
  });

  it.each(["", "   "])(
    "el nombre vacío (%j) es «Falta el nombre», sin consultar",
    async (nombre) => {
      const { m, d } = montar();
      expect(await renombrarLaSeccion(d, contexto, { ...PEDIDO, nombre })).toEqual(FALTA_EL_NOMBRE);
      expect(m.llamadas).toEqual([]);
    },
  );

  it("una sección que no es de la empresa es el genérico y no se escribe", async () => {
    const { m, d } = montar();
    expect(await renombrarLaSeccion(d, contexto, { ...PEDIDO, seccionId: NUEVA })).toEqual(
      GENERICO,
    );
    expect(queLlamo(m)).toEqual(["lista"]);
  });

  it("el motivo del guard al leer la lista sale tal cual y no se escribe", async () => {
    const { m, d } = montar({ lista: () => err("SIN_PERMISO") });
    const r = await renombrarLaSeccion(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
    expect(queLlamo(m)).toEqual(["lista"]);
  });

  it.each(["VERSION_DESACTUALIZADA", "SECCION_DUPLICADA", "SECCION_NO_ENCONTRADA"])(
    "el error %s sale como el genérico: dos pestañas, la segunda con la versión vieja, no dice que es de versión",
    async (error) => {
      const { d } = montar({ editar: () => err(error) });
      expect(await renombrarLaSeccion(d, contexto, PEDIDO)).toEqual(GENERICO);
    },
  );

  it("una excepción sale sin detalle y con referencia", async () => {
    const { d } = montar({
      editar: () => {
        throw new Error("boom");
      },
    });
    const r = await renombrarLaSeccion(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
  });
});

describe("cambiarElEstadoDeLaSeccion", () => {
  it("desactivar llama solo a desactivarSeccionDeCarta con la sección", async () => {
    const { m, d } = montar();
    expect(await cambiarElEstadoDeLaSeccion(d, contexto, { seccionId: A }, false)).toEqual({
      ok: true,
      dato: { seccionId: A },
    });
    expect(m.llamadas).toEqual([{ que: "desactivar", entrada: { seccionId: A } }]);
  });

  it("reactivar llama solo a reactivarSeccionDeCarta con la sección", async () => {
    const { m, d } = montar();
    expect(await cambiarElEstadoDeLaSeccion(d, contexto, { seccionId: B }, true)).toEqual({
      ok: true,
      dato: { seccionId: B },
    });
    expect(m.llamadas).toEqual([{ que: "reactivar", entrada: { seccionId: B } }]);
  });

  it("repetirlo (ya estaba) es éxito igual", async () => {
    const { d } = montar({
      desactivar: () => ok({ yaEstaba: true }),
      reactivar: () => ok({ yaEstaba: true }),
    });
    expect((await cambiarElEstadoDeLaSeccion(d, contexto, { seccionId: A }, false)).ok).toBe(true);
    expect((await cambiarElEstadoDeLaSeccion(d, contexto, { seccionId: A }, true)).ok).toBe(true);
  });

  it("del pedido solo se toma la sección: lo demás que mande el navegador no pasa", async () => {
    const { m, d } = montar();
    await cambiarElEstadoDeLaSeccion(
      d,
      contexto,
      { seccionId: A, empresaId: "otra", activa: true },
      false,
    );
    expect(m.llamadas[0]?.entrada).toEqual({ seccionId: A });
  });

  it("un pedido sin la forma pedida es el genérico y no toca el módulo", async () => {
    const { m, d } = montar();
    expect(await cambiarElEstadoDeLaSeccion(d, contexto, { seccionId: "x" }, false)).toEqual(
      GENERICO,
    );
    expect(await cambiarElEstadoDeLaSeccion(d, contexto, null, true)).toEqual(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it("una sección que no es de la empresa sale como el genérico; el motivo del guard sale tal cual", async () => {
    const a = montar({ desactivar: () => err("SECCION_NO_ENCONTRADA") });
    expect(await cambiarElEstadoDeLaSeccion(a.d, contexto, { seccionId: A }, false)).toEqual(
      GENERICO,
    );
    const b = montar({ reactivar: () => err("MODULO_EN_DESARROLLO") });
    const r = await cambiarElEstadoDeLaSeccion(b.d, contexto, { seccionId: A }, true);
    expect(!r.ok && r.error.codigo).toBe("MODULO_EN_DESARROLLO");
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const { d } = montar({
      desactivar: () => {
        throw new Error("boom");
      },
    });
    const r = await cambiarElEstadoDeLaSeccion(d, contexto, { seccionId: A }, false);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
  });
});

describe("moverUnaSeccion", () => {
  const VISTAS = [
    { seccionId: A, versionEsperada: 3 },
    { seccionId: C, versionEsperada: 5 },
  ];
  const PEDIDO = { vistas: VISTAS, seccionId: C, sentido: "ARRIBA" };

  it("pide a reordenar TODAS las activas con el orden nuevo y la versión que se vio de cada una", async () => {
    const { m, d } = montar();
    expect(await moverUnaSeccion(d, contexto, PEDIDO)).toEqual({ ok: true, dato: { movidas: 2 } });
    expect(m.llamadas).toEqual([
      {
        que: "reordenar",
        entrada: {
          secciones: [
            { seccionId: C, versionEsperada: 5 },
            { seccionId: A, versionEsperada: 3 },
          ],
        },
      },
    ]);
  });

  it("en el borde (la primera sube) pide el mismo orden; el caso de uso lo ve como ya aplicado", async () => {
    const { m, d } = montar({ reordenar: () => ok({ movidas: 0 }) });
    const r = await moverUnaSeccion(d, contexto, { ...PEDIDO, seccionId: A });
    expect(r).toEqual({ ok: true, dato: { movidas: 0 } });
    expect(m.llamadas[0]?.entrada).toEqual({ secciones: VISTAS });
  });

  it("un pedido sin la forma pedida es el genérico y no toca el módulo", async () => {
    const { m, d } = montar();
    for (const crudo of [
      null,
      {},
      { ...PEDIDO, sentido: "ADENTRO" },
      { ...PEDIDO, seccionId: "x" },
    ]) {
      expect(await moverUnaSeccion(d, contexto, crudo)).toEqual(GENERICO);
    }
    expect(m.llamadas).toEqual([]);
  });

  it("una sección que la persona no vio es el genérico y no toca el módulo", async () => {
    const { m, d } = montar();
    expect(await moverUnaSeccion(d, contexto, { ...PEDIDO, seccionId: B })).toEqual(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it.each(["VERSION_DESACTUALIZADA", "LISTA_DE_SECCIONES_INCOMPLETA", "SECCION_NO_ENCONTRADA"])(
    "el error %s sale como el genérico",
    async (error) => {
      const { d } = montar({ reordenar: () => err(error) });
      expect(await moverUnaSeccion(d, contexto, PEDIDO)).toEqual(GENERICO);
    },
  );

  it("el motivo del guard sale tal cual", async () => {
    const { d } = montar({ reordenar: () => err("SIN_PERMISO") });
    const r = await moverUnaSeccion(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const { d } = montar({
      reordenar: () => {
        throw new Error("boom");
      },
    });
    const r = await moverUnaSeccion(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
  });
});
