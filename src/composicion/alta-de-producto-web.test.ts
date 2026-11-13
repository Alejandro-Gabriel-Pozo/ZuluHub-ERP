import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { UNIDADES } from "../primitivas/unidades/unidades";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  crearElProducto,
  verLasOpcionesDelAlta,
  type DependenciasDeAltaDeProductoWeb,
} from "./alta-de-producto-web";

/**
 * El alta de un producto (A1, T6) con el módulo simulado: qué ofrece y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real,
 * `test/integracion/alta-de-producto-web.test.ts`.
 */
const CLAVE = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const SECCION = "5c1d2e3f-4a5b-4c6d-8e7f-0a1b2c3d4e5f";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  secciones: () => unknown;
  crear: () => unknown;
};
const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    secciones: () => ok([{ id: SECCION, nombre: "Minutas", orden: 1, activa: true, version: 1 }]),
    crear: () => ok({ productoId: CLAVE, yaExistia: false }),
    ...cambios,
  };
  const d = {
    casosDeUso: () => ({
      crearProducto: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "crear", entrada });
        return Promise.resolve(m.crear());
      },
    }),
    consultas: () => ({
      listarSeccionesDeCarta: () => {
        m.llamadas.push({ que: "secciones", entrada: null });
        return Promise.resolve(m.secciones());
      },
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeAltaDeProductoWeb;
  return { m, d };
};

const PEDIDO = {
  claveDeCreacion: CLAVE,
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  nombre: "Milanesa",
  nombreDeCocina: "",
  codigo: "",
  codigoDeBarras: "",
  alicuota: "21",
  seccionDeCartaId: "",
};

describe("verLasOpcionesDelAlta", () => {
  it("ofrece las cinco clases (con cuáles se venden), las 14 unidades, las seis alícuotas y las secciones, y solo eso", async () => {
    const { d } = montar();
    expect(await verLasOpcionesDelAlta(d, contexto)).toEqual({
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
        secciones: [{ id: SECCION, nombre: "Minutas" }],
      },
    });
    expect(Object.keys(UNIDADES)).toHaveLength(14);
  });

  it("el motivo de la consulta (módulo en desarrollo, sin permiso) sale tal cual, sin dato alguno", async () => {
    for (const motivo of ["MODULO_EN_DESARROLLO", "SIN_PERMISO"]) {
      const { d } = montar({ secciones: () => err(motivo) });
      const r = await verLasOpcionesDelAlta(d, contexto);
      expect(r).toMatchObject({ ok: false, error: { codigo: motivo } });
      expect(JSON.stringify(r)).not.toContain("MATERIA_PRIMA");
    }
  });

  it("una excepción sale sin detalle y con referencia; el detalle va al registro", async () => {
    const { m, d } = montar({
      secciones: () => {
        throw new Error("password authentication failed");
      },
    });
    const r = await verLasOpcionesDelAlta(d, contexto);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r)).not.toContain("password");
    expect(!r.ok && r.error.referencia).toMatch(/^PD-/);
    expect(m.registrados.join(" ")).toContain("password authentication failed");
  });
});

describe("crearElProducto", () => {
  it("pide a crearProducto el pedido armado, con la clave de creación como id, y devuelve el id y si ya existía", async () => {
    const { m, d } = montar();
    const r = await crearElProducto(d, contexto, PEDIDO);
    expect(r).toEqual({ ok: true, dato: { productoId: CLAVE, yaExistia: false } });
    expect(m.llamadas).toEqual([
      {
        que: "crear",
        entrada: {
          id: CLAVE,
          claseDeUso: "VENDIBLE",
          unidadBaseId: "UNIDAD",
          nombre: "Milanesa",
          nombreDeCocina: "",
          codigo: "",
          codigoDeBarras: "",
          alicuota: "21",
          seccionDeCartaId: "",
        },
      },
    ]);
  });

  it("repetir la misma clave devuelve el producto ya creado (yaExistia), sin error", async () => {
    const { d } = montar({ crear: () => ok({ productoId: CLAVE, yaExistia: true }) });
    expect(await crearElProducto(d, contexto, PEDIDO)).toEqual({
      ok: true,
      dato: { productoId: CLAVE, yaExistia: true },
    });
  });

  it("un pedido sin la forma pedida es el genérico y no toca el módulo", async () => {
    const { m, d } = montar();
    for (const crudo of [null, {}, { ...PEDIDO, claveDeCreacion: "x" }, { ...PEDIDO, nombre: 3 }]) {
      const r = await crearElProducto(d, contexto, crudo);
      expect(!r.ok && r.error.codigo).toBe("CATALOGO_ACCION_NO_PERMITIDA");
    }
    expect(m.llamadas).toEqual([]);
  });

  it.each(["", "   ", "\t"])(
    "el nombre vacío (%j) es «Falta el nombre», asociado al campo, sin llamar al módulo",
    async (nombre) => {
      const { m, d } = montar();
      const r = await crearElProducto(d, contexto, { ...PEDIDO, nombre });
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

  it.each([
    ["PRODUCTO_DUPLICADO", "CATALOGO_NOMBRE_REPETIDO", "nombre"],
    ["CODIGO_DUPLICADO", "CATALOGO_CODIGO_REPETIDO", "codigo"],
    ["CODIGO_DE_BARRAS_INVALIDO", "CATALOGO_CODIGO_DE_BARRAS_INVALIDO", "codigoDeBarras"],
    ["ALICUOTA_REQUERIDA", "CATALOGO_ELEGI_LA_ALICUOTA", "alicuota"],
  ])("el error %s sale como %s, asociado al campo %s", async (error, codigo, campo) => {
    const { d } = montar({ crear: () => err(error) });
    const r = await crearElProducto(d, contexto, PEDIDO);
    expect(!r.ok && [r.error.codigo, r.error.campo, r.error.presentacion]).toEqual([
      codigo,
      campo,
      "AVISO",
    ]);
  });

  it.each([
    "ID_REUTILIZADO",
    "CLASE_INVALIDA",
    "UNIDAD_INVALIDA",
    "FORMA_DE_VENTA_NO_SOPORTADA",
    "CODIGO_DE_BARRAS_DUPLICADO",
    "SECCION_NO_ENCONTRADA",
    "NOMBRE_DE_PRODUCTO_INVALIDO",
    { error: "CAMPO_NO_ADMITIDO_POR_LA_CLASE", campo: "alicuota" },
  ])("el error de negocio %j sale como el genérico, sin decir cuál fue", async (error) => {
    const { d } = montar({ crear: () => err(error) });
    const r = await crearElProducto(d, contexto, PEDIDO);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "CATALOGO_ACCION_NO_PERMITIDA",
        clave: "catalogo.error.accion_no_permitida",
        presentacion: "AVISO",
      },
    });
  });

  it("el motivo del guard (módulo en desarrollo, sin permiso) sale tal cual", async () => {
    for (const motivo of ["MODULO_EN_DESARROLLO", "SIN_PERMISO"]) {
      const { d } = montar({ crear: () => err(motivo) });
      const r = await crearElProducto(d, contexto, PEDIDO);
      expect(!r.ok && r.error.codigo).toBe(motivo);
    }
  });

  it("un defecto de la base sale como inesperado, con referencia y sin detalle", async () => {
    const { m, d } = montar({ crear: () => err("ERROR_DE_LA_BASE_NO_TRADUCIDO") });
    const r = await crearElProducto(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
    expect(m.registrados).toHaveLength(1);
  });

  it("una excepción al escribir sale sin detalle y con referencia", async () => {
    const { m, d } = montar({
      crear: () => {
        throw new Error("connection terminated");
      },
    });
    const r = await crearElProducto(d, contexto, PEDIDO);
    expect(!r.ok && r.error.codigo).toBe("ERROR_INTERNO");
    expect(JSON.stringify(r)).not.toContain("connection terminated");
    expect(m.registrados.join(" ")).toContain("connection terminated");
  });

  it("una clase que no se vende no manda lo que no admite, aunque el pedido lo traiga", async () => {
    const { m, d } = montar();
    await crearElProducto(d, contexto, {
      ...PEDIDO,
      claseDeUso: "INSUMO",
      nombreDeCocina: "X",
      seccionDeCartaId: SECCION,
    });
    const crear = m.llamadas.find((l) => l.que === "crear")?.entrada as Record<string, unknown>;
    expect([crear["nombreDeCocina"], crear["alicuota"], crear["seccionDeCartaId"]]).toEqual([
      null,
      null,
      null,
    ]);
  });
});
