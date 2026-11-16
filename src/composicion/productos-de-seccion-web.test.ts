import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  agregarElProducto,
  quitarElProducto,
  verLosCandidatos,
  type DependenciasDeProductosDeSeccionWeb,
} from "./productos-de-seccion-web";

/**
 * Agregar y quitar productos de una sección (A8, parte 2) con el módulo simulado: qué lee y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real,
 * `test/integracion/secciones-web.test.ts`.
 */
const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const NUEVA = "9a8b7c6d-1111-4222-8333-944455556666";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;

const SECCIONES = [
  { id: A, nombre: "Cafés", orden: 0, activa: true, version: 3, productos: 2 },
  { id: B, nombre: "Postres", orden: 4, activa: false, version: 1, productos: 1 },
];

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  lista: () => unknown;
  productos: () => unknown;
  editarProducto: () => unknown;
};
const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    lista: () => ok(SECCIONES),
    productos: () => ok({ productos: [], siguiente: null }),
    editarProducto: () => ok({ version: 8 }),
    ...cambios,
  };
  const registrar = (que: string, entrada: unknown, resultado: () => unknown) => {
    m.llamadas.push({ que, entrada });
    return Promise.resolve(resultado());
  };
  const d = {
    casosDeUso: () => ({
      editarProducto: (_c: unknown, e: unknown) => registrar("producto", e, m.editarProducto),
    }),
    consultas: () => ({
      listarSeccionesParaGestionar: () => registrar("lista", null, m.lista),
      listarProductos: (_c: unknown, e: unknown) => registrar("productos", e, m.productos),
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeProductosDeSeccionWeb;
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
const queLlamo = (m: Montaje) => m.llamadas.map((l) => l.que);

const P1 = "1a1a1a1a-1111-4222-8333-944455556666";
const P2 = "2b2b2b2b-1111-4222-8333-944455556666";
const P3 = "3c3c3c3c-1111-4222-8333-944455556666";

describe("verLosCandidatos", () => {
  const PRODUCTO = (id: string, nombre: string, extra: Record<string, unknown> = {}) => ({
    id,
    nombre,
    version: 2,
    estado: "ACTIVO",
    seccion: null,
    ...extra,
  });
  const PAGINA = {
    productos: [
      PRODUCTO(P1, "Budín", { estado: "FALTA_COMPLETAR" }),
      PRODUCTO(P2, "Cortado", { seccion: { id: A, nombre: "Cafés", activa: true } }),
      PRODUCTO(P3, "Flan", { seccion: { id: B, nombre: "Postres", activa: false } }),
    ],
    siguiente: null,
  };
  const pedido = (cambios: Record<string, unknown> = {}) => ({
    seccionId: A,
    texto: "",
    despues: "",
    ...cambios,
  });

  it("pide solo lo que se vende (VENDIBLE y REVENTA), activo, sin ensanchar el filtro; la primera página no lleva clave de página ni texto", async () => {
    const { m, d } = montar({ productos: () => ok(PAGINA) });
    await verLosCandidatos(d, contexto, pedido());
    expect(m.llamadas[1]).toStrictEqual({
      que: "productos",
      entrada: { claseDeUso: ["VENDIBLE", "REVENTA"], activo: true },
    });
  });

  it("deja afuera los que ya están en esta sección, y de cada uno trae solo id, nombre, versión, si falta completar y su sección de hoy", async () => {
    const { d } = montar({ productos: () => ok(PAGINA) });
    expect(await verLosCandidatos(d, contexto, pedido())).toEqual({
      ok: true,
      dato: {
        seccion: { id: A, nombre: "Cafés", activa: true, version: 3 },
        candidatos: [
          { id: P1, nombre: "Budín", version: 2, faltaCompletar: true, seccion: null },
          { id: P3, nombre: "Flan", version: 2, faltaCompletar: false, seccion: "Postres" },
        ],
        siguiente: null,
      },
    });
  });

  it("el texto buscado se recorta y pasa por la primitiva de búsqueda; el de la página pide la siguiente; y sale la clave de la que sigue", async () => {
    const { m, d } = montar({
      productos: () => ok({ ...PAGINA, siguiente: { nombreClave: "flan", id: P3 } }),
    });
    const r = await verLosCandidatos(
      d,
      contexto,
      pedido({ texto: "  Cor  ", despues: `${B}:cortado` }),
    );
    expect(r.ok && r.dato.siguiente).toBe(`${P3}:flan`);
    expect(m.llamadas[1]).toEqual({
      que: "productos",
      entrada: {
        claseDeUso: ["VENDIBLE", "REVENTA"],
        activo: true,
        texto: "Cor",
        despuesDe: { id: B, nombreClave: "cortado" },
      },
    });
  });

  it.each([
    ["un texto de búsqueda inválido", { texto: "+uno" }],
    ["una página que la consulta no pudo dar", { despues: "no-es-una-pagina" }],
  ])(
    "%s muestra la lista vacía y no consulta productos (nunca se ensancha)",
    async (_nombre, cambios) => {
      const { m, d } = montar({ productos: () => ok(PAGINA) });
      const r = await verLosCandidatos(d, contexto, pedido(cambios));
      expect(r).toEqual({
        ok: true,
        dato: {
          seccion: { id: A, nombre: "Cafés", activa: true, version: 3 },
          candidatos: [],
          siguiente: null,
        },
      });
      expect(queLlamo(m)).toEqual(["lista"]);
    },
  );

  it("una sección desactivada también se ofrece (el servidor decide al agregar)", async () => {
    const { d } = montar({ productos: () => ok(PAGINA) });
    const r = await verLosCandidatos(d, contexto, pedido({ seccionId: B }));
    expect(r.ok && r.dato.seccion.activa).toBe(false);
  });

  it("un pedido sin la forma pedida, un id sin forma de uuid o de otra empresa es el genérico y no consulta productos", async () => {
    const { m, d } = montar();
    expect(await verLosCandidatos(d, contexto, { seccionId: A })).toEqual(GENERICO);
    expect(await verLosCandidatos(d, contexto, pedido({ seccionId: "x" }))).toEqual(GENERICO);
    expect(await verLosCandidatos(d, contexto, pedido({ seccionId: NUEVA }))).toEqual(GENERICO);
    expect(queLlamo(m)).toEqual(["lista"]);
  });

  it("el motivo del guard sale tal cual; una excepción sale sin detalle y con referencia", async () => {
    const { d } = montar({ productos: () => err("SIN_PERMISO") });
    const r = await verLosCandidatos(d, contexto, pedido());
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
    const { d: d2 } = montar({
      productos: () => {
        throw new Error("boom");
      },
    });
    const r2 = await verLosCandidatos(d2, contexto, pedido());
    expect(!r2.ok && r2.error.codigo).toBe("ERROR_INTERNO");
  });

  it("el motivo del guard al leer las secciones sale tal cual y no se piden productos", async () => {
    const { m, d } = montar({ lista: () => err("MODULO_EN_DESARROLLO") });
    const r = await verLosCandidatos(d, contexto, pedido());
    expect(!r.ok && r.error.codigo).toBe("MODULO_EN_DESARROLLO");
    expect(queLlamo(m)).toEqual(["lista"]);
  });
});

describe.each([
  ["agregarElProducto", agregarElProducto, A],
  ["quitarElProducto", quitarElProducto, null],
] as const)("%s", (_nombre, funcion, seccionPedida) => {
  const PEDIDO = {
    seccionId: A,
    vistas: [
      { productoId: P1, versionEsperada: 2 },
      { productoId: P2, versionEsperada: 7 },
    ],
    productoId: P2,
  };

  it("edita solo la sección del producto, con la versión que la persona vio de ESE producto", async () => {
    const { m, d } = montar();
    const r = await funcion(d, contexto, PEDIDO);
    expect(r).toEqual({ ok: true, dato: { productoId: P2, version: 8 } });
    expect(m.llamadas).toStrictEqual([
      {
        que: "producto",
        entrada: { productoId: P2, versionEsperada: 7, seccionDeCartaId: seccionPedida },
      },
    ]);
  });

  it("un producto que la persona no vio, o un pedido sin la forma pedida, es el genérico y no toca el módulo", async () => {
    const { m, d } = montar();
    expect(await funcion(d, contexto, { ...PEDIDO, productoId: P3 })).toEqual(GENERICO);
    expect(await funcion(d, contexto, { ...PEDIDO, vistas: "x" })).toEqual(GENERICO);
    expect(await funcion(d, contexto, { ...PEDIDO, productoId: "x" })).toEqual(GENERICO);
    expect(await funcion(d, contexto, null)).toEqual(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it.each([
    "VERSION_DESACTUALIZADA",
    "SECCION_NO_ENCONTRADA",
    "PRODUCTO_NO_ENCONTRADO",
    "PRODUCTO_INACTIVO",
    "ALICUOTA_REQUERIDA",
    "PRODUCTO_DUPLICADO",
    "CODIGO_DUPLICADO",
  ])(
    "el error %s sale como el genérico (sin campo: esta pantalla no tiene esos campos)",
    async (error) => {
      const { d } = montar({ editarProducto: () => err(error) });
      expect(await funcion(d, contexto, PEDIDO)).toEqual(GENERICO);
    },
  );

  it.each([null, { tipo: "desconocido" }, { error: "OTRO", campo: "x" }])(
    "un error que no es un texto (%j) es el genérico: cierra ante la duda",
    async (error) => {
      const { d } = montar({ editarProducto: () => err(error) });
      expect(await funcion(d, contexto, PEDIDO)).toEqual(GENERICO);
    },
  );

  it.each(["SIN_PERMISO", "MODULO_EN_DESARROLLO"])(
    "el motivo del guard %s sale tal cual",
    async (motivo) => {
      const { d } = montar({ editarProducto: () => err(motivo) });
      const r = await funcion(d, contexto, PEDIDO);
      expect(!r.ok && r.error.codigo).toBe(motivo);
    },
  );

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const { m, d } = montar({
      editarProducto: () => {
        throw new Error("password authentication failed");
      },
    });
    const r = await funcion(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r)).not.toContain("password");
    expect(m.registrados.join(" ")).toContain("password authentication failed");
  });
});
