import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  clasificarUnProducto,
  crearUnNodoDeClasificacion,
  desactivarUnNodoDeClasificacion,
  moverUnNodoDeClasificacion,
  reactivarUnNodoDeClasificacion,
  renombrarUnNodoDeClasificacion,
  verElArbolDeClasificacion,
  verLaClasificacionDeUnProducto,
  type DependenciasDeClasificacionWeb,
} from "./clasificacion-web";

/**
 * La clasificación comercial de la web (A14) con el módulo simulado: qué lee y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real,
 * `test/integracion/clasificacion-web.test.ts`.
 */
const A = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const B = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const C = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const D = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const E = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const PRODUCTO = "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";

type Nodo = Readonly<{
  id: string;
  padreId: string | null;
  nombre: string;
  activo: boolean;
  version: number;
  nivel: number;
}>;
const nodo = (
  id: string,
  nombre: string,
  padreId: string | null,
  nivel: number,
  activo = true,
  version = 1,
): Nodo => ({ id, padreId, nombre, activo, version, nivel });

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  lista: () => unknown;
  ficha: () => unknown;
  caso: Record<string, () => unknown>;
};

const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    lista: () => ok([]),
    ficha: () => ok({ vigente: null }),
    caso: {},
    ...cambios,
  };
  const casoDeUso = (que: string) => (_c: unknown, entrada: unknown) => {
    m.llamadas.push({ que, entrada });
    const hacer = m.caso[que];
    return Promise.resolve(hacer === undefined ? ok({}) : hacer());
  };
  const d = {
    casosDeUso: () => ({
      crearNodoDeClasificacion: casoDeUso("crearNodoDeClasificacion"),
      renombrarNodoDeClasificacion: casoDeUso("renombrarNodoDeClasificacion"),
      moverNodoDeClasificacion: casoDeUso("moverNodoDeClasificacion"),
      desactivarNodoDeClasificacion: casoDeUso("desactivarNodoDeClasificacion"),
      reactivarNodoDeClasificacion: casoDeUso("reactivarNodoDeClasificacion"),
      clasificarProducto: casoDeUso("clasificarProducto"),
    }),
    consultas: () => ({
      listarClasificacion: () => {
        m.llamadas.push({ que: "listarClasificacion", entrada: null });
        return Promise.resolve(m.lista());
      },
      verClasificacionDelProducto: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "verClasificacionDelProducto", entrada });
        return Promise.resolve(m.ficha());
      },
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeClasificacionWeb;
  return { m, d };
};

describe("el árbol", () => {
  const ARBOL = [
    nodo(A, "Restaurante", null, 1, true, 3),
    nodo(B, "Bebidas", A, 2, true, 5),
    nodo(C, "Cafés", B, 3),
    nodo(D, "De especialidad", C, 4),
    nodo(E, "Alojamiento", null, 1, false),
  ];

  it("cada nodo sale con su nivel, su versión y lo que se puede hacer con él (la misma regla del servidor, calculada una vez)", async () => {
    const { m, d } = montar({ lista: () => ok(ARBOL) });
    const r = await verElArbolDeClasificacion(d, contexto);
    expect(r).toEqual({
      ok: true,
      dato: {
        nodos: [
          { ...ARBOL[0], admiteHijos: true, destinos: [] },
          { ...ARBOL[1], admiteHijos: true, destinos: [A] },
          { ...ARBOL[2], admiteHijos: true, destinos: [A, B].sort() },
          { ...ARBOL[3], admiteHijos: false, destinos: [A, B, C].sort() },
          { ...ARBOL[4], admiteHijos: false, destinos: [] },
        ],
      },
    });
    expect(m.llamadas).toEqual([{ que: "listarClasificacion", entrada: null }]);
  });

  it("los destinos salen ordenados y un departamento desactivado no es destino", async () => {
    // El orden de la lista es el contrario al de los ids: los destinos salen igual ordenados.
    const dos = [nodo(B, "B", null, 1), nodo(A, "A", null, 1), nodo(C, "C", B, 2)];
    const { d } = montar({ lista: () => ok(dos) });
    const r = await verElArbolDeClasificacion(d, contexto);
    expect(r.ok && r.dato.nodos.find((n) => n.id === C)?.destinos).toEqual([A, B].sort());
    const apagado = [nodo(A, "A", null, 1, false), nodo(B, "B", null, 1), nodo(C, "C", B, 2)];
    const otra = await verElArbolDeClasificacion(montar({ lista: () => ok(apagado) }).d, contexto);
    expect(otra.ok && otra.dato.nodos.find((n) => n.id === C)?.destinos).toEqual([B]);
  });

  it("sin nodos, un árbol vacío", async () => {
    const { d } = montar();
    expect(await verElArbolDeClasificacion(d, contexto)).toEqual({ ok: true, dato: { nodos: [] } });
  });

  it("el error de la consulta sale traducido (el motivo del guard, tal cual)", async () => {
    const { d } = montar({ lista: () => err("SIN_PERMISO") });
    expect(await verElArbolDeClasificacion(d, contexto)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
  });

  it("un nodo sin nivel (árbol dañado) es un defecto: sale como inesperado, con referencia, y no se dibuja nada", async () => {
    const { m, d } = montar({ lista: () => ok([nodo(A, "Roto", B, 0), nodo(B, "Ok", null, 1)]) });
    const r = await verElArbolDeClasificacion(d, contexto);
    expect(r).toMatchObject({ ok: false, error: { presentacion: "INESPERADO" } });
    expect(m.registrados).toHaveLength(1);
    expect(m.registrados[0]).toContain("ARBOL_DE_CLASIFICACION_INCONSISTENTE");
    expect(JSON.stringify(r)).not.toContain("Roto");
  });

  it("un fallo de la base sale sin detalle y con referencia", async () => {
    const { m, d } = montar({
      lista: () => {
        throw new Error("conexión caída");
      },
    });
    const r = await verElArbolDeClasificacion(d, contexto);
    expect(r).toMatchObject({ ok: false, error: { presentacion: "INESPERADO" } });
    expect(JSON.stringify(r)).not.toContain("conexión caída");
    expect(m.registrados[0]).toContain("conexión caída");
  });
});

describe("la clasificación de un producto", () => {
  const LISTA = [
    nodo(A, "Restaurante", null, 1),
    nodo(B, "Comidas", A, 2),
    nodo(C, "Postres", A, 2, false),
  ];
  const vigente = (desde: Date, camino: { id: string; nombre: string }[]) => ({
    vigente: { vinculoId: "v1", nodoId: camino.at(-1)?.id ?? null, desde, camino },
  });

  it("sin clasificar no hay vigente, y se ofrecen solo los nodos activos con lo mínimo", async () => {
    const { m, d } = montar({ lista: () => ok(LISTA) });
    expect(await verLaClasificacionDeUnProducto(d, contexto, PRODUCTO)).toEqual({
      ok: true,
      dato: {
        productoId: PRODUCTO,
        vigente: null,
        nodos: [
          { id: A, padreId: null, nombre: "Restaurante" },
          { id: B, padreId: A, nombre: "Comidas" },
        ],
      },
    });
    expect(m.llamadas).toEqual([
      { que: "verClasificacionDelProducto", entrada: { productoId: PRODUCTO } },
      { que: "listarClasificacion", entrada: null },
    ]);
  });

  it("la vigente sale con su camino, si cada nodo está activo, y el día civil de Argentina (UTC-3) desde el que rige", async () => {
    const desde = new Date("2026-11-03T02:00:00Z");
    const { d } = montar({
      lista: () => ok(LISTA),
      ficha: () =>
        ok(
          vigente(desde, [
            { id: A, nombre: "Restaurante" },
            { id: C, nombre: "Postres" },
          ]),
        ),
    });
    expect(await verLaClasificacionDeUnProducto(d, contexto, PRODUCTO)).toMatchObject({
      ok: true,
      dato: {
        vigente: {
          desde: "2026-11-02",
          camino: [
            { id: A, nombre: "Restaurante", activo: true },
            { id: C, nombre: "Postres", activo: false },
          ],
        },
      },
    });
  });

  it("un nodo del camino que ya no está en la lista se dice desactivado: nunca se asume activo", async () => {
    const { d } = montar({
      lista: () => ok([]),
      ficha: () => ok(vigente(new Date("2026-11-03T15:00:00Z"), [{ id: A, nombre: "Viejo" }])),
    });
    const r = await verLaClasificacionDeUnProducto(d, contexto, PRODUCTO);
    expect(r.ok && r.dato.vigente?.camino).toEqual([{ id: A, nombre: "Viejo", activo: false }]);
    expect(r.ok && r.dato.vigente?.desde).toBe("2026-11-03");
  });

  it("volver a «Sin elegir» sale como un vigente con el camino vacío", async () => {
    const { d } = montar({ ficha: () => ok(vigente(new Date("2026-11-03T15:00:00Z"), [])) });
    const r = await verLaClasificacionDeUnProducto(d, contexto, PRODUCTO);
    expect(r.ok && r.dato.vigente).toEqual({ desde: "2026-11-03", camino: [] });
  });

  it("un id que no es un uuid no se consulta y sale como el genérico", async () => {
    const { m, d } = montar();
    expect(await verLaClasificacionDeUnProducto(d, contexto, "no-es-un-id")).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(m.llamadas).toEqual([]);
  });

  it("un producto que no está (o es de otra empresa) sale como el genérico y no pide el árbol", async () => {
    const { m, d } = montar({ ficha: () => ok(null) });
    expect(await verLaClasificacionDeUnProducto(d, contexto, PRODUCTO)).toMatchObject({
      ok: false,
      error: { codigo: GENERICO },
    });
    expect(m.llamadas.map((l) => l.que)).toEqual(["verClasificacionDelProducto"]);
  });

  it("el error de cada consulta sale traducido", async () => {
    const a = montar({ ficha: () => err("SIN_PERMISO") });
    expect(await verLaClasificacionDeUnProducto(a.d, contexto, PRODUCTO)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const b = montar({ lista: () => err("MODULO_EN_DESARROLLO") });
    expect(await verLaClasificacionDeUnProducto(b.d, contexto, PRODUCTO)).toMatchObject({
      ok: false,
      error: { codigo: "MODULO_EN_DESARROLLO" },
    });
  });

  it("un instante sin día civil o un fallo de la base salen como inesperados, sin detalle", async () => {
    const sinDia = montar({ ficha: () => ok(vigente(new Date(Number.NaN), [])) });
    expect(await verLaClasificacionDeUnProducto(sinDia.d, contexto, PRODUCTO)).toMatchObject({
      ok: false,
      error: { presentacion: "INESPERADO" },
    });
    expect(sinDia.m.registrados[0]).toContain("INSTANTE_SIN_DIA_CIVIL");
    const caida = montar({
      ficha: () => {
        throw new Error("base caída");
      },
    });
    const r = await verLaClasificacionDeUnProducto(caida.d, contexto, PRODUCTO);
    expect(r).toMatchObject({ ok: false, error: { presentacion: "INESPERADO" } });
    expect(JSON.stringify(r)).not.toContain("base caída");
  });
});

type Caso = Readonly<{
  nombre: string;
  hacer: (d: DependenciasDeClasificacionWeb, crudo: unknown) => Promise<unknown>;
  casoDeUso: string;
  pedido: Readonly<Record<string, unknown>>;
  /** Lo que devuelve el caso de uso y lo que sale hacia la pantalla. */
  salida: unknown;
  dato: unknown;
}>;

const CASOS: readonly Caso[] = [
  {
    nombre: "crear un nodo",
    hacer: (d, crudo) => crearUnNodoDeClasificacion(d, contexto, crudo),
    casoDeUso: "crearNodoDeClasificacion",
    pedido: { id: A, padreId: B, nombre: "Comidas" },
    salida: { nodoId: C, yaExistia: false },
    dato: { nodoId: C },
  },
  {
    nombre: "renombrar un nodo",
    hacer: (d, crudo) => renombrarUnNodoDeClasificacion(d, contexto, crudo),
    casoDeUso: "renombrarNodoDeClasificacion",
    pedido: { nodoId: A, versionEsperada: 3, nombre: "Platos" },
    salida: { version: 4 },
    dato: { nodoId: A },
  },
  {
    nombre: "mover un nodo",
    hacer: (d, crudo) => moverUnNodoDeClasificacion(d, contexto, crudo),
    casoDeUso: "moverNodoDeClasificacion",
    pedido: { nodoId: A, versionEsperada: 3, nuevoPadreId: B },
    salida: { version: 4, yaEstaba: false },
    dato: { nodoId: A },
  },
  {
    nombre: "desactivar un nodo",
    hacer: (d, crudo) => desactivarUnNodoDeClasificacion(d, contexto, crudo),
    casoDeUso: "desactivarNodoDeClasificacion",
    pedido: { nodoId: A },
    salida: { yaEstaba: false },
    dato: { nodoId: A },
  },
  {
    nombre: "reactivar un nodo",
    hacer: (d, crudo) => reactivarUnNodoDeClasificacion(d, contexto, crudo),
    casoDeUso: "reactivarNodoDeClasificacion",
    pedido: { nodoId: A },
    salida: { yaEstaba: false },
    dato: { nodoId: A },
  },
  {
    nombre: "clasificar un producto",
    hacer: (d, crudo) => clasificarUnProducto(d, contexto, crudo),
    casoDeUso: "clasificarProducto",
    pedido: { id: A, productoId: PRODUCTO, nodoId: null },
    salida: { vinculoId: A, vigenteDesde: new Date(), yaExistia: false },
    dato: { productoId: PRODUCTO },
  },
];

describe.each(CASOS)("$nombre", ({ hacer, casoDeUso, pedido, salida, dato }) => {
  it("pide al caso de uso solo lo que declara el pedido y devuelve lo mínimo hacia la pantalla", async () => {
    const { m, d } = montar({ caso: { [casoDeUso]: () => ok(salida) } });
    const r = await hacer(d, { ...pedido, empresaId: "otra", personaId: "otra" });
    expect(r).toEqual({ ok: true, dato });
    expect(m.llamadas).toEqual([{ que: casoDeUso, entrada: pedido }]);
  });

  it("un pedido sin la forma pedida sale como el genérico y no llega al caso de uso", async () => {
    const { m, d } = montar();
    for (const malo of [
      null,
      {},
      "x",
      { ...pedido, [Object.keys(pedido)[0] ?? "id"]: "no-es-un-uuid" },
    ]) {
      expect(await hacer(d, malo)).toMatchObject({ ok: false, error: { codigo: GENERICO } });
    }
    expect(m.llamadas).toEqual([]);
  });

  it("cada rechazo del caso de uso sale traducido: el motivo del guard tal cual y lo demás como el genérico", async () => {
    for (const [error, codigo] of [
      ["SIN_PERMISO", "SIN_PERMISO"],
      ["MODULO_EN_DESARROLLO", "MODULO_EN_DESARROLLO"],
      ["VERSION_DESACTUALIZADA", GENERICO],
      ["NODO_INEXISTENTE", GENERICO],
      ["CICLO", GENERICO],
      ["ID_REUTILIZADO", GENERICO],
    ] as const) {
      const { d } = montar({ caso: { [casoDeUso]: () => err(error) } });
      expect(await hacer(d, pedido)).toMatchObject({ ok: false, error: { codigo } });
    }
  });

  it("«Primero desactivá lo que tiene adentro.» sale con su aviso propio y sin campo", async () => {
    const { d } = montar({ caso: { [casoDeUso]: () => err("TIENE_HIJOS_ACTIVOS") } });
    const r = await hacer(d, pedido);
    expect(r).toMatchObject({
      ok: false,
      error: {
        codigo: "CATALOGO_PRIMERO_DESACTIVA",
        clave: "catalogo.error.primero_desactiva",
        presentacion: "AVISO",
      },
    });
    expect(JSON.stringify(r)).not.toContain('"campo"');
  });

  it("un fallo inesperado sale sin detalle y con referencia", async () => {
    const { m, d } = montar({
      caso: {
        [casoDeUso]: () => {
          throw new Error("base caída");
        },
      },
    });
    const r = await hacer(d, pedido);
    expect(r).toMatchObject({ ok: false, error: { presentacion: "INESPERADO" } });
    expect(JSON.stringify(r)).not.toContain("base caída");
    expect(m.registrados).toHaveLength(1);
  });
});
