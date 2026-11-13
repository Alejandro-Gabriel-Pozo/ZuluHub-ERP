import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  guardarLaFichaDeProducto,
  verLaFichaDeProducto,
  type DependenciasDeFichaDeProductoWeb,
} from "./ficha-de-producto-web";

/**
 * La ficha de datos de un producto (A1, T2a) con el módulo simulado: qué lee y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real,
 * `test/integracion/ficha-de-producto-web.test.ts`.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;

const PRODUCTO = {
  id: ID,
  empresaId: "e1",
  nombre: "Milanesa",
  nombreDeCocina: "MILA",
  descripcionEnCarta: "Con papas",
  codigo: "MIL-1",
  codigoDeBarras: null,
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  unidadDeVentaId: "UNIDAD",
  pasoMinimo: "1",
  alicuota: "21",
  faltaCompletar: false,
  seVende: true,
  seccionDeCartaId: SECCION,
  activo: true,
  versionDeOpciones: 1,
  version: 4,
};

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  ver: () => unknown;
  secciones: () => unknown;
  editar: () => unknown;
};
const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    ver: () => ok({ producto: PRODUCTO, grupos: [], preciosVigentes: [], historial: [] }),
    secciones: () => ok([{ id: SECCION, nombre: "Minutas", orden: 1, activa: true, version: 1 }]),
    editar: () => ok({ version: 5 }),
    ...cambios,
  };
  const d = {
    casosDeUso: () => ({
      editarProducto: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "editar", entrada });
        return Promise.resolve(m.editar());
      },
    }),
    consultas: () => ({
      verProducto: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "ver", entrada });
        return Promise.resolve(m.ver());
      },
      listarSeccionesDeCarta: () => {
        m.llamadas.push({ que: "secciones", entrada: null });
        return Promise.resolve(m.secciones());
      },
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeFichaDeProductoWeb;
  return { m, d };
};

const PEDIDO = { productoId: ID, versionEsperada: 4, nombre: "Milanesa napolitana" };

describe("verLaFichaDeProducto", () => {
  it("trae los datos del producto y las secciones, y solo lo que la pantalla necesita", async () => {
    const { d } = montar();
    const r = await verLaFichaDeProducto(d, contexto, ID);
    expect(r).toEqual({
      ok: true,
      dato: {
        id: ID,
        version: 4,
        nombre: "Milanesa",
        claseDeUso: "VENDIBLE",
        unidadBaseId: "UNIDAD",
        seVende: true,
        nombreDeCocina: "MILA",
        codigo: "MIL-1",
        codigoDeBarras: null,
        alicuota: "21",
        seccionDeCartaId: SECCION,
        alicuotas: ["21", "10.5", "27", "5", "2.5", "0"],
        secciones: [{ id: SECCION, nombre: "Minutas" }],
      },
    });
  });

  it("una clase que no se vende sale con seVende en falso", async () => {
    const { d } = montar({
      ver: () =>
        ok({
          producto: { ...PRODUCTO, claseDeUso: "INSUMO", alicuota: null },
          grupos: [],
          preciosVigentes: [],
          historial: [],
        }),
    });
    const r = await verLaFichaDeProducto(d, contexto, ID);
    expect(r.ok && r.dato.seVende).toBe(false);
  });

  it("un id que no tiene forma de uuid no se consulta: el genérico", async () => {
    const { m, d } = montar();
    const r = await verLaFichaDeProducto(d, contexto, "no-es-un-id");
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "CATALOGO_ACCION_NO_PERMITIDA",
        clave: "catalogo.error.accion_no_permitida",
        presentacion: "AVISO",
      },
    });
    expect(m.llamadas).toEqual([]);
  });

  it("un producto que no existe (o es de otra empresa) es el genérico, sin decir cuál", async () => {
    const { d } = montar({ ver: () => ok(null) });
    const r = await verLaFichaDeProducto(d, contexto, ID);
    expect(!r.ok && r.error.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
  });

  it("el motivo del guard sale tal cual, sin dato alguno, y no se piden las secciones", async () => {
    const { m, d } = montar({ ver: () => err("MODULO_EN_DESARROLLO") });
    const r = await verLaFichaDeProducto(d, contexto, ID);
    expect(!r.ok && r.error.codigo).toBe("MODULO_EN_DESARROLLO");
    expect(m.llamadas.map((l) => l.que)).toEqual(["ver"]);
  });

  it("si las secciones se rechazan, sale ese motivo", async () => {
    const { d } = montar({ secciones: () => err("SIN_PERMISO") });
    const r = await verLaFichaDeProducto(d, contexto, ID);
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const { m, d } = montar({
      ver: () => {
        throw new Error("password authentication failed");
      },
    });
    const r = await verLaFichaDeProducto(d, contexto, ID);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r)).not.toContain("password");
    expect(!r.ok && r.error.referencia).toMatch(/^PD-/);
    expect(m.registrados.join(" ")).toContain("password authentication failed");
  });
});

describe("guardarLaFichaDeProducto", () => {
  it("lee el producto, pide a editarProducto el pedido completo y devuelve el id y la versión nueva", async () => {
    const { m, d } = montar();
    const r = await guardarLaFichaDeProducto(d, contexto, { ...PEDIDO, alicuota: "10.5" });
    expect(r).toEqual({ ok: true, dato: { productoId: ID, version: 5 } });
    expect(m.llamadas).toEqual([
      { que: "ver", entrada: { productoId: ID } },
      {
        que: "editar",
        entrada: {
          productoId: ID,
          versionEsperada: 4,
          nombre: "Milanesa napolitana",
          nombreDeCocina: "MILA",
          descripcionEnCarta: "Con papas",
          codigo: "MIL-1",
          codigoDeBarras: null,
          alicuota: "10.5",
          seccionDeCartaId: SECCION,
        },
      },
    ]);
  });

  it("un pedido sin la forma pedida es el genérico y no toca el módulo", async () => {
    const { m, d } = montar();
    for (const crudo of [
      null,
      {},
      { ...PEDIDO, productoId: "x" },
      { ...PEDIDO, versionEsperada: -1 },
    ]) {
      const r = await guardarLaFichaDeProducto(d, contexto, crudo);
      expect(!r.ok && r.error.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    }
    expect(m.llamadas).toEqual([]);
  });

  it.each(["", "   ", "\t"])(
    "el nombre vacío (%j) es «Falta el nombre», asociado al campo, sin consultar",
    async (nombre) => {
      const { m, d } = montar();
      const r = await guardarLaFichaDeProducto(d, contexto, { ...PEDIDO, nombre });
      expect(r).toEqual({
        ok: false,
        error: {
          codigo: "CATALOGO_FALTA_EL_NOMBRE",
          clave: "catalogo.error.falta_el_nombre",
          presentacion: "AVISO",
          campo: "nombre",
        },
      });
      expect(m.llamadas).toEqual([]);
    },
  );

  it("un producto que no existe es el genérico y no se escribe", async () => {
    const { m, d } = montar({ ver: () => ok(null) });
    const r = await guardarLaFichaDeProducto(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    expect(m.llamadas.map((l) => l.que)).toEqual(["ver"]);
  });

  it("el motivo del guard al leer sale tal cual y no se escribe", async () => {
    const { m, d } = montar({ ver: () => err("SIN_PERMISO") });
    const r = await guardarLaFichaDeProducto(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("SIN_PERMISO");
    expect(m.llamadas.map((l) => l.que)).toEqual(["ver"]);
  });

  it.each([
    ["PRODUCTO_DUPLICADO", "CATALOGO_NOMBRE_REPETIDO", "nombre"],
    ["CODIGO_DUPLICADO", "CATALOGO_CODIGO_REPETIDO", "codigo"],
    ["CODIGO_DE_BARRAS_INVALIDO", "CATALOGO_CODIGO_DE_BARRAS_INVALIDO", "codigoDeBarras"],
    ["ALICUOTA_REQUERIDA", "CATALOGO_ELEGI_LA_ALICUOTA", "alicuota"],
  ])("el error %s sale como %s, asociado al campo %s", async (error, codigo, campo) => {
    const { d } = montar({ editar: () => err(error) });
    const r = await guardarLaFichaDeProducto(d, contexto, PEDIDO);
    expect(!r.ok && [r.error.codigo, r.error.campo, r.error.presentacion]).toEqual([
      codigo,
      campo,
      "AVISO",
    ]);
  });

  it("dos pestañas: la segunda, con la versión vieja, recibe el genérico (sin decir que es de versión)", async () => {
    const { d } = montar({ editar: () => err("VERSION_DESACTUALIZADA") });
    const r = await guardarLaFichaDeProducto(d, contexto, PEDIDO);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "CATALOGO_ACCION_NO_PERMITIDA",
        clave: "catalogo.error.accion_no_permitida",
        presentacion: "AVISO",
      },
    });
  });

  it("el motivo del guard al escribir (módulo en desarrollo, sin permiso) sale tal cual", async () => {
    const { d } = montar({ editar: () => err("MODULO_EN_DESARROLLO") });
    const r = await guardarLaFichaDeProducto(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("MODULO_EN_DESARROLLO");
  });

  it("un defecto de la base sale como inesperado, con referencia y sin detalle", async () => {
    const { m, d } = montar({ editar: () => err("ERROR_DE_LA_BASE_NO_TRADUCIDO") });
    const r = await guardarLaFichaDeProducto(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
    expect(m.registrados).toHaveLength(1);
  });

  it("una excepción al escribir sale sin detalle y con referencia", async () => {
    const { m, d } = montar({
      editar: () => {
        throw new Error("connection terminated");
      },
    });
    const r = await guardarLaFichaDeProducto(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r)).not.toContain("connection terminated");
    expect(m.registrados.join(" ")).toContain("connection terminated");
  });

  it("una clase que no se vende no manda lo que no admite, aunque el pedido lo traiga", async () => {
    const { m, d } = montar({
      ver: () =>
        ok({
          producto: {
            ...PRODUCTO,
            claseDeUso: "INSUMO",
            nombreDeCocina: null,
            descripcionEnCarta: null,
            alicuota: null,
            seccionDeCartaId: null,
          },
          grupos: [],
          preciosVigentes: [],
          historial: [],
        }),
    });
    await guardarLaFichaDeProducto(d, contexto, { ...PEDIDO, alicuota: "21", nombreDeCocina: "X" });
    const editar = m.llamadas.find((l) => l.que === "editar")?.entrada as Record<string, unknown>;
    expect([editar["nombreDeCocina"], editar["alicuota"], editar["seccionDeCartaId"]]).toEqual([
      null,
      null,
      null,
    ]);
  });
});
