import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  cambiarElPrecioDeUnProducto,
  verLosPreciosDeUnProducto,
  type DependenciasDePreciosDeProductoWeb,
} from "./precios-de-producto-web";

/**
 * Los precios de un producto (A1, T3) con el módulo simulado: qué lee y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real,
 * `test/integracion/precios-de-producto-web.test.ts`.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const CLAVE = "1c2d3e4f-5a6b-4c7d-8e9f-0a1b2c3d4e5f";
const P1 = "2d3e4f5a-6b7c-4d8e-9f0a-1b2c3d4e5f6a";
const P2 = "3e4f5a6b-7c8d-4e9f-8a1b-2c3d4e5f6a7b";
const P3 = "4f5a6b7c-8d9e-4f0a-9b2c-3d4e5f6a7b8c";
const SUC = "5a6b7c8d-9e0f-4a1b-8c3d-4e5f6a7b8c9d";
const OPC = "6b7c8d9e-0f1a-4b2c-9d4e-5f6a7b8c9d0e";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;

const PRODUCTO = {
  id: ID,
  empresaId: "e1",
  nombre: "Milanesa",
  claseDeUso: "VENDIBLE",
  unidadBaseId: "UNIDAD",
  unidadDeVentaId: "UNIDAD",
  pasoMinimo: "1",
  activo: true,
  version: 4,
};
const fila = (
  id: string,
  precio: string | null,
  vigenteDesde: string,
  alcance: { opcionId?: string | null; sucursalId?: string | null } = {},
) => ({
  id,
  productoId: ID,
  opcionId: alcance.opcionId ?? null,
  sucursalId: alcance.sucursalId ?? null,
  precio,
  unidadId: "UNIDAD",
  pasoMinimo: "1",
  vigenteDesde: new Date(vigenteDesde),
});
const histo = (f: ReturnType<typeof fila>) => ({
  precioId: f.id,
  opcionId: f.opcionId,
  sucursalId: f.sucursalId,
  precio: f.precio,
  unidadId: f.unidadId,
  pasoMinimo: f.pasoMinimo,
  desde: f.vigenteDesde,
  cargadoPor: "persona-secreta",
});

const VIGENTE = fila(P2, "13000.000000", "2026-11-02T12:00:00Z");
const ANTERIOR = fila(P1, "11500.000000", "2026-10-15T12:00:00Z");

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  ver: () => unknown;
  cambiar: () => unknown;
};
const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    ver: () =>
      ok({
        producto: PRODUCTO,
        grupos: [],
        preciosVigentes: [VIGENTE],
        historial: [histo(VIGENTE), histo(ANTERIOR)],
      }),
    cambiar: () => ok({ precioId: P3, vigenteDesde: new Date(), yaExistia: false }),
    ...cambios,
  };
  const d = {
    casosDeUso: () => ({
      cambiarPrecio: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "cambiar", entrada });
        return Promise.resolve(m.cambiar());
      },
    }),
    consultas: () => ({
      verProducto: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "ver", entrada });
        return Promise.resolve(m.ver());
      },
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
    nuevoId: () => CLAVE,
  } as unknown as DependenciasDePreciosDeProductoWeb;
  return { m, d };
};

const PEDIDO = { productoId: ID, precioId: CLAVE, precioIdEsperado: P2, precio: "14000.00" };

describe("verLosPreciosDeUnProducto", () => {
  it("trae el vigente, los anteriores y la clave del próximo cambio, y solo lo que la pantalla necesita", async () => {
    const { m, d } = montar();
    const r = await verLosPreciosDeUnProducto(d, contexto, ID);
    expect(r).toEqual({
      ok: true,
      dato: {
        id: ID,
        nombre: "Milanesa",
        tipo: "DE_LA_EMPRESA",
        vigente: { precioId: P2, importe: "13000.000000", desde: "2026-11-02" },
        historial: [{ importe: "11500.000000", desde: "2026-10-15" }],
        claveDelCambio: CLAVE,
      },
    });
    expect(JSON.stringify(r)).not.toContain("persona-secreta");
    expect(m.llamadas).toEqual([{ que: "ver", entrada: { productoId: ID } }]);
  });

  it("la fecha es el día civil de Argentina (UTC-3): 02:30 UTC del 3 de noviembre todavía es el 2", async () => {
    const tarde = fila(P2, "13000.000000", "2026-11-03T02:30:00Z");
    const { d } = montar({
      ver: () =>
        ok({
          producto: PRODUCTO,
          grupos: [],
          preciosVigentes: [tarde],
          historial: [histo(tarde)],
        }),
    });
    const r = await verLosPreciosDeUnProducto(d, contexto, ID);
    expect(r.ok && r.dato.vigente?.desde).toBe("2026-11-02");
    const borde = fila(P2, "13000.000000", "2026-11-03T03:00:00Z");
    const { d: d2 } = montar({
      ver: () =>
        ok({
          producto: PRODUCTO,
          grupos: [],
          preciosVigentes: [borde],
          historial: [histo(borde)],
        }),
    });
    const r2 = await verLosPreciosDeUnProducto(d2, contexto, ID);
    expect(r2.ok && r2.dato.vigente?.desde).toBe("2026-11-03");
  });

  it("solo cuenta el precio de la empresa del producto: los de sucursal y de medida no se ven ni en el vigente ni en el historial", async () => {
    const sucursal = fila(P3, "99.000000", "2026-11-05T12:00:00Z", { sucursalId: SUC });
    const medida = fila(P3, "88.000000", "2026-11-06T12:00:00Z", { opcionId: OPC });
    const { d } = montar({
      ver: () =>
        ok({
          producto: PRODUCTO,
          grupos: [],
          preciosVigentes: [sucursal, VIGENTE, medida],
          historial: [histo(medida), histo(sucursal), histo(VIGENTE), histo(ANTERIOR)],
        }),
    });
    const r = await verLosPreciosDeUnProducto(d, contexto, ID);
    expect(r).toMatchObject({
      ok: true,
      dato: {
        vigente: { precioId: P2 },
        historial: [{ importe: "11500.000000", desde: "2026-10-15" }],
      },
    });
  });

  it("sin ningún precio: vigente nulo e historial vacío (precio abierto)", async () => {
    const { d } = montar({
      ver: () => ok({ producto: PRODUCTO, grupos: [], preciosVigentes: [], historial: [] }),
    });
    expect(await verLosPreciosDeUnProducto(d, contexto, ID)).toMatchObject({
      ok: true,
      dato: { tipo: "DE_LA_EMPRESA", vigente: null, historial: [] },
    });
  });

  it("un precio abierto vigente conserva su fecha y su importe nulo; en el historial también", async () => {
    const abierto = fila(P2, null, "2026-11-02T12:00:00Z");
    const { d } = montar({
      ver: () =>
        ok({
          producto: PRODUCTO,
          grupos: [],
          preciosVigentes: [abierto],
          historial: [histo(abierto), histo(ANTERIOR)],
        }),
    });
    expect(await verLosPreciosDeUnProducto(d, contexto, ID)).toMatchObject({
      ok: true,
      dato: {
        vigente: { precioId: P2, importe: null, desde: "2026-11-02" },
        historial: [{ importe: "11500.000000" }],
      },
    });
  });

  it("con una variante activa es «según medida»: no hay vigente ni historial que editar", async () => {
    const { d } = montar({
      ver: () =>
        ok({
          producto: PRODUCTO,
          grupos: [{ clase: "VARIANTE", activo: true, opciones: [] }],
          preciosVigentes: [VIGENTE],
          historial: [histo(VIGENTE)],
        }),
    });
    expect(await verLosPreciosDeUnProducto(d, contexto, ID)).toEqual({
      ok: true,
      dato: {
        id: ID,
        nombre: "Milanesa",
        tipo: "SEGUN_MEDIDA",
        vigente: null,
        historial: [],
        claveDelCambio: CLAVE,
      },
    });
  });

  it("una variante desactivada, o un grupo que no es variante, no hacen «según medida»", async () => {
    for (const grupo of [
      { clase: "VARIANTE", activo: false },
      { clase: "ADICIONAL", activo: true },
      { clase: "INCLUIDA", activo: true },
    ]) {
      const { d } = montar({
        ver: () =>
          ok({
            producto: PRODUCTO,
            grupos: [grupo],
            preciosVigentes: [VIGENTE],
            historial: [histo(VIGENTE)],
          }),
      });
      const r = await verLosPreciosDeUnProducto(d, contexto, ID);
      expect(r.ok && r.dato.tipo).toBe("DE_LA_EMPRESA");
    }
  });

  it.each(["MATERIA_PRIMA", "INSUMO", "ELABORADO"])(
    "la clase %s no se vende: no tiene solapa de precios, sale como un producto que no está",
    async (claseDeUso) => {
      const { d } = montar({
        ver: () =>
          ok({
            producto: { ...PRODUCTO, claseDeUso },
            grupos: [],
            preciosVigentes: [],
            historial: [],
          }),
      });
      expect(await verLosPreciosDeUnProducto(d, contexto, ID)).toMatchObject({
        ok: false,
        error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
      });
    },
  );

  it("la clase REVENTA sí tiene precios", async () => {
    const { d } = montar({
      ver: () =>
        ok({
          producto: { ...PRODUCTO, claseDeUso: "REVENTA" },
          grupos: [],
          preciosVigentes: [],
          historial: [],
        }),
    });
    expect((await verLosPreciosDeUnProducto(d, contexto, ID)).ok).toBe(true);
  });

  it("un id que no tiene forma de uuid no se consulta: el genérico", async () => {
    const { m, d } = montar();
    expect(await verLosPreciosDeUnProducto(d, contexto, "no-es-un-id")).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
    });
    expect(m.llamadas).toEqual([]);
  });

  it("un producto que no está (o es de otra empresa) sale como el genérico", async () => {
    const { d } = montar({ ver: () => ok(null) });
    expect(await verLosPreciosDeUnProducto(d, contexto, ID)).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
    });
  });

  it("el rechazo del guard (módulo en desarrollo, sin permiso) sale con su motivo y sin datos", async () => {
    const { d } = montar({ ver: () => err("MODULO_EN_DESARROLLO") });
    expect(await verLosPreciosDeUnProducto(d, contexto, ID)).toMatchObject({
      ok: false,
      error: { codigo: "MODULO_EN_DESARROLLO" },
    });
  });

  it("una excepción sale sin detalle y con referencia, y el detalle va al registro", async () => {
    const { m, d } = montar({
      ver: () => {
        throw new Error("secreto de la base");
      },
    });
    const r = await verLosPreciosDeUnProducto(d, contexto, ID);
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(m.registrados.join()).toContain("secreto de la base");
  });
});

describe("cambiarElPrecioDeUnProducto", () => {
  it("pide el cambio del precio de la EMPRESA del producto (sin sucursal ni opción), con la clave y la fila vista, y el importe tal cual como texto", async () => {
    const { m, d } = montar();
    const r = await cambiarElPrecioDeUnProducto(d, contexto, PEDIDO);
    expect(r).toEqual({ ok: true, dato: { productoId: ID } });
    expect(m.llamadas.filter((l) => l.que === "cambiar")).toEqual([
      {
        que: "cambiar",
        entrada: {
          precioId: CLAVE,
          productoId: ID,
          opcionId: null,
          sucursalId: null,
          precioIdEsperado: P2,
          precio: "14000.00",
        },
      },
    ]);
  });

  it("la empresa, la sucursal, la opción y la persona del pedido se descartan: las fija el servidor", async () => {
    const { m, d } = montar();
    await cambiarElPrecioDeUnProducto(d, contexto, {
      ...PEDIDO,
      empresaId: "otra",
      sucursalId: SUC,
      opcionId: OPC,
    });
    expect(m.llamadas.find((l) => l.que === "cambiar")?.entrada).toMatchObject({
      sucursalId: null,
      opcionId: null,
    });
  });

  it("el mismo precio que ya rige no cambia nada: ok sin llamar al caso de uso (aunque venga con otra escala)", async () => {
    for (const igual of ["13000.00", "13000", "13000.000000"]) {
      const { m, d } = montar();
      expect(await cambiarElPrecioDeUnProducto(d, contexto, { ...PEDIDO, precio: igual })).toEqual({
        ok: true,
        dato: { productoId: ID },
      });
      expect(m.llamadas.some((l) => l.que === "cambiar")).toBe(false);
    }
  });

  it("un precio que difiere en el último decimal sí se cambia", async () => {
    const { m, d } = montar();
    await cambiarElPrecioDeUnProducto(d, contexto, { ...PEDIDO, precio: "13000.01" });
    expect(m.llamadas.some((l) => l.que === "cambiar")).toBe(true);
  });

  it("si el vigente es un precio abierto, cualquier precio se cambia; si no hay ninguno, también", async () => {
    const abierto = fila(P2, null, "2026-11-02T12:00:00Z");
    for (const vigentes of [[abierto], []]) {
      const { m, d } = montar({
        ver: () => ok({ producto: PRODUCTO, grupos: [], preciosVigentes: vigentes, historial: [] }),
      });
      await cambiarElPrecioDeUnProducto(d, contexto, { ...PEDIDO, precio: "0" });
      expect(m.llamadas.some((l) => l.que === "cambiar")).toBe(true);
    }
  });

  it("el precio de una sucursal o de una medida no cuenta como «el mismo precio»", async () => {
    const sucursal = fila(P3, "14000.000000", "2026-11-05T12:00:00Z", { sucursalId: SUC });
    const { m, d } = montar({
      ver: () => ok({ producto: PRODUCTO, grupos: [], preciosVigentes: [sucursal], historial: [] }),
    });
    await cambiarElPrecioDeUnProducto(d, contexto, PEDIDO);
    expect(m.llamadas.some((l) => l.que === "cambiar")).toBe(true);
  });

  it("un precio vacío o que no es un precio no se compara: lo rechaza el caso de uso con su texto", async () => {
    for (const mal of ["", "abc", "-1"]) {
      const { m, d } = montar({ cambiar: () => err("PRECIO_INVALIDO") });
      const r = await cambiarElPrecioDeUnProducto(d, contexto, { ...PEDIDO, precio: mal });
      expect(r).toMatchObject({
        ok: false,
        error: { codigo: "CATALOGO_PRECIO_INVALIDO", campo: "precio", presentacion: "AVISO" },
      });
      expect(m.llamadas.some((l) => l.que === "cambiar")).toBe(true);
    }
  });

  it("si otra persona cambió el precio antes: la frase aprobada con el importe vigente, en el campo, y nada más del error", async () => {
    const { d } = montar({
      cambiar: () =>
        err({ error: "PRECIO_DESACTUALIZADO", vigente: { precioId: P3, precio: "15000.000000" } }),
    });
    const r = await cambiarElPrecioDeUnProducto(d, contexto, PEDIDO);
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "CATALOGO_PRECIO_DESACTUALIZADO",
        clave: "catalogo.precio.vigente_ahora",
        presentacion: "AVISO",
        campo: "precio",
        parametros: { importe: "15000.000000" },
      },
    });
    expect(JSON.stringify(r)).not.toContain(P3);
  });

  it.each([
    ["malformado", "Hola"],
    ["con salto de línea final", "13000\n"],
    ["con signo", "-1.000000"],
    ["que no es un texto", 15000],
  ])(
    "el precio vigente %s no sale: el genérico, sin parámetros y sin el marcador del texto",
    async (_caso, precio) => {
      const { d } = montar({
        cambiar: () => err({ error: "PRECIO_DESACTUALIZADO", vigente: { precioId: P3, precio } }),
      });
      const r = await cambiarElPrecioDeUnProducto(d, contexto, PEDIDO);
      expect(r).toEqual({
        ok: false,
        error: {
          codigo: "CATALOGO_ACCION_NO_PERMITIDA",
          clave: "catalogo.error.accion_no_permitida",
          presentacion: "AVISO",
        },
      });
      expect(JSON.stringify(r)).not.toContain("{importe}");
    },
  );

  it("el importe vigente solo sale si el caso de uso lo entrega: sin permiso, aunque la lectura previa traiga el vigente, la respuesta es el motivo del guard y no lleva importe ni parámetros", async () => {
    // El caso de uso autoriza (`productos.cambiar_precio`) ANTES de leer el vigente: acá lo simula rechazando. La composición no agrega nada desde la lectura previa.
    const { m, d } = montar({ cambiar: () => err("SIN_PERMISO") });
    const r = await cambiarElPrecioDeUnProducto(d, contexto, {
      ...PEDIDO,
      precioIdEsperado: P1,
    });
    expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_PERMISO" } });
    expect(r.ok ? null : r.error).not.toHaveProperty("parametros");
    expect(JSON.stringify(r)).not.toContain("13000");
    expect(m.llamadas.map((l) => l.que)).toEqual(["ver", "cambiar"]);
  });

  it.each([
    "ID_REUTILIZADO",
    "PRODUCTO_NO_ENCONTRADO",
    "PRODUCTO_INACTIVO",
    "PRODUCTO_NO_VENDIBLE",
    "PRECIO_DE_PRODUCTO_CON_VARIANTE",
    "IDENTIFICADOR_INVALIDO",
    "SUCURSAL_FUERA_DE_ALCANCE",
  ])("%s sale como el genérico", async (error) => {
    const { d } = montar({ cambiar: () => err(error) });
    expect(await cambiarElPrecioDeUnProducto(d, contexto, PEDIDO)).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
    });
  });

  it("el rechazo del guard (sin permiso, módulo en desarrollo) sale con su motivo", async () => {
    const { d } = montar({ cambiar: () => err("SIN_PERMISO") });
    expect(await cambiarElPrecioDeUnProducto(d, contexto, PEDIDO)).toMatchObject({
      ok: false,
      error: { codigo: "SIN_PERMISO" },
    });
    const { d: d2 } = montar({ ver: () => err("MODULO_EN_DESARROLLO") });
    expect(await cambiarElPrecioDeUnProducto(d2, contexto, PEDIDO)).toMatchObject({
      ok: false,
      error: { codigo: "MODULO_EN_DESARROLLO" },
    });
  });

  it("un pedido sin la forma pedida no llega ni a la lectura: el genérico", async () => {
    const { m, d } = montar();
    for (const malo of [{ ...PEDIDO, precioId: "1" }, null, { ...PEDIDO, precio: 5 }]) {
      expect(await cambiarElPrecioDeUnProducto(d, contexto, malo)).toMatchObject({
        ok: false,
        error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
      });
    }
    expect(m.llamadas).toEqual([]);
  });

  it("un producto que no está en la lectura previa igual pasa por el caso de uso, que decide (PRODUCTO_NO_ENCONTRADO: el genérico)", async () => {
    const { m, d } = montar({ ver: () => ok(null), cambiar: () => err("PRODUCTO_NO_ENCONTRADO") });
    expect(await cambiarElPrecioDeUnProducto(d, contexto, PEDIDO)).toMatchObject({
      ok: false,
      error: { codigo: "CATALOGO_ACCION_NO_PERMITIDA" },
    });
    expect(m.llamadas.some((l) => l.que === "cambiar")).toBe(true);
  });

  it("una excepción sale sin detalle y con referencia", async () => {
    const { m, d } = montar({
      cambiar: () => {
        throw new Error("secreto de la base");
      },
    });
    const r = await cambiarElPrecioDeUnProducto(d, contexto, PEDIDO);
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("secreto");
    expect(m.registrados.join()).toContain("secreto de la base");
  });
});
