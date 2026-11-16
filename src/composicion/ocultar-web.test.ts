import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  ocultarOMostrarUnProducto,
  verLaVisibilidadDelProducto,
  type DependenciasDeOcultarWeb,
} from "./ocultar-web";

/**
 * «Ocultar» de la web (A15) con el módulo simulado: qué lee y qué pide la composición, y qué sale hacia la pantalla en cada resultado. Contra la base real, `test/integracion/ocultar-web.test.ts`.
 */
const ID = "0b9f6a1e-2c3d-4e5f-8a7b-9c0d1e2f3a4b";
const OTRO = "1c0a7b2f-3d4e-4f60-9b8c-0d1e2f3a4b5c";
const LOCAL = "2d1b8c3a-4e5f-4071-8c9d-1e2f3a4b5c6d";
const OTRO_LOCAL = "3e2c9d4b-5f60-4182-9dae-2f3a4b5c6d7e";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const fila = (productoId: string, sucursalId: string | null) => ({
  productoId,
  nombre: "x",
  sucursalId,
  actualizadoPor: null,
  actualizadoEn: new Date(0),
});

type Montaje = {
  llamadas: { que: string; entrada: unknown }[];
  registrados: string[];
  ocultos: () => unknown;
  ocultar: () => unknown;
};
const montar = (cambios: Partial<Montaje> = {}) => {
  const m: Montaje = {
    llamadas: [],
    registrados: [],
    ocultos: () => ok([]),
    ocultar: () => ok({ yaEstaba: false, sigueOcultoPor: null }),
    ...cambios,
  };
  const d = {
    casosDeUso: () => ({
      ocultarProducto: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "ocultar", entrada });
        return Promise.resolve(m.ocultar());
      },
    }),
    consultas: () => ({
      productosOcultos: (_c: unknown, entrada: unknown) => {
        m.llamadas.push({ que: "ocultos", entrada });
        return Promise.resolve(m.ocultos());
      },
    }),
    respuesta: { registrar: (detalle: string) => m.registrados.push(detalle) },
  } as unknown as DependenciasDeOcultarWeb;
  return { m, d };
};
const GENERICO = "CATALOGO_ACCION_NO_PERMITIDA";
const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : r.error?.codigo;

describe("verLaVisibilidadDelProducto", () => {
  it("con local: pregunta por ese local y dice dónde está oculto el producto, sin mirar los de otros", async () => {
    const { m, d } = montar({
      ocultos: () =>
        ok([fila(ID, LOCAL), fila(OTRO, null), fila(ID, OTRO_LOCAL), fila(OTRO, LOCAL)]),
    });
    expect(await verLaVisibilidadDelProducto(d, contexto, ID, LOCAL)).toEqual({
      ok: true,
      dato: { local: true, empresa: false },
    });
    expect(m.llamadas).toEqual([{ que: "ocultos", entrada: { sucursalId: LOCAL } }]);
  });

  it("oculto en toda la empresa: lo dice, y el local no", async () => {
    const { d } = montar({ ocultos: () => ok([fila(ID, null)]) });
    expect(await verLaVisibilidadDelProducto(d, contexto, ID, LOCAL)).toEqual({
      ok: true,
      dato: { local: false, empresa: true },
    });
  });

  it("visible en todos lados: ni local ni empresa", async () => {
    const { d } = montar();
    expect(await verLaVisibilidadDelProducto(d, contexto, ID, LOCAL)).toEqual({
      ok: true,
      dato: { local: false, empresa: false },
    });
  });

  it("sin local: pregunta sin sucursal y el local sale `null` (no hay dónde ocultar «en este local»)", async () => {
    const { m, d } = montar({ ocultos: () => ok([fila(ID, null), fila(ID, LOCAL)]) });
    expect(await verLaVisibilidadDelProducto(d, contexto, ID, null)).toEqual({
      ok: true,
      dato: { local: null, empresa: true },
    });
    expect(m.llamadas).toEqual([{ que: "ocultos", entrada: {} }]);
  });

  it("un id que no tiene la forma de un id no se consulta: el genérico", async () => {
    const { m, d } = montar();
    expect(codigoDe(await verLaVisibilidadDelProducto(d, contexto, "x", LOCAL))).toBe(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it("un rechazo de la consulta (módulo en desarrollo, sin permiso, local ajeno) sale con su motivo o el genérico, sin datos", async () => {
    const { d } = montar({ ocultos: () => err("MODULO_EN_DESARROLLO") });
    expect(codigoDe(await verLaVisibilidadDelProducto(d, contexto, ID, LOCAL))).toBe(
      "MODULO_EN_DESARROLLO",
    );
    const otro = montar({ ocultos: () => err("SUCURSAL_FUERA_DE_ALCANCE") });
    expect(codigoDe(await verLaVisibilidadDelProducto(otro.d, contexto, ID, null))).toBe(GENERICO);
  });

  it("un fallo inesperado sale sin detalle y queda registrado", async () => {
    const { m, d } = montar({
      ocultos: () => {
        throw new Error("la base no responde");
      },
    });
    const r = await verLaVisibilidadDelProducto(d, contexto, ID, LOCAL);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("la base no responde");
    expect(m.registrados).toHaveLength(1);
  });
});

describe("ocultarOMostrarUnProducto", () => {
  it("en el local: pide el estado al caso de uso con el local de la sesión, y devuelve lo mínimo", async () => {
    const { m, d } = montar();
    const r = await ocultarOMostrarUnProducto(d, contexto, LOCAL, {
      productoId: ID,
      alcance: "LOCAL",
      oculto: true,
    });
    expect(r).toEqual({
      ok: true,
      dato: { productoId: ID, yaEstaba: false, sigueOcultoPorLaEmpresa: false },
    });
    expect(m.llamadas).toEqual([
      {
        que: "ocultar",
        entrada: { productoId: ID, alcance: { tipo: "SUCURSAL", sucursalId: LOCAL }, oculto: true },
      },
    ]);
  });

  it("en toda la empresa: el alcance es EMPRESA y el local de la sesión no se usa", async () => {
    const { m, d } = montar({ ocultar: () => ok({ yaEstaba: true, sigueOcultoPor: null }) });
    const r = await ocultarOMostrarUnProducto(d, contexto, LOCAL, {
      productoId: ID,
      alcance: "EMPRESA",
      oculto: false,
    });
    expect(r).toEqual({
      ok: true,
      dato: { productoId: ID, yaEstaba: true, sigueOcultoPorLaEmpresa: false },
    });
    expect(m.llamadas).toEqual([
      { que: "ocultar", entrada: { productoId: ID, alcance: { tipo: "EMPRESA" }, oculto: false } },
    ]);
  });

  it("en toda la empresa sin local elegido: anda (no depende del local)", async () => {
    const { m, d } = montar();
    const r = await ocultarOMostrarUnProducto(d, contexto, null, {
      productoId: ID,
      alcance: "EMPRESA",
      oculto: true,
    });
    expect(r.ok).toBe(true);
    expect(m.llamadas).toHaveLength(1);
  });

  it("al mostrar en un local lo que la empresa oculta, avisa que la empresa lo sigue ocultando", async () => {
    const { d } = montar({ ocultar: () => ok({ yaEstaba: false, sigueOcultoPor: "EMPRESA" }) });
    const r = await ocultarOMostrarUnProducto(d, contexto, LOCAL, {
      productoId: ID,
      alcance: "LOCAL",
      oculto: false,
    });
    expect(r).toEqual({
      ok: true,
      dato: { productoId: ID, yaEstaba: false, sigueOcultoPorLaEmpresa: true },
    });
  });

  it("alcance LOCAL sin local elegido: cierra con el genérico y no llama al caso de uso (nunca se toma por «toda la empresa»)", async () => {
    const { m, d } = montar();
    const r = await ocultarOMostrarUnProducto(d, contexto, null, {
      productoId: ID,
      alcance: "LOCAL",
      oculto: true,
    });
    expect(codigoDe(r)).toBe(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it.each([
    ["sin forma", null],
    ["alcance inventado", { productoId: ID, alcance: "TODAS", oculto: true }],
    [
      "con el local en el pedido",
      { productoId: ID, alcance: "LOCAL", oculto: true, sucursalId: LOCAL },
    ],
  ])("pedido inválido (%s): el genérico, sin llamar al caso de uso", async (_caso, crudo) => {
    const { m, d } = montar();
    expect(codigoDe(await ocultarOMostrarUnProducto(d, contexto, LOCAL, crudo))).toBe(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it("los dos bloqueos salen con su texto propio y no ocultan; el resto de los errores de negocio, el genérico", async () => {
    const pedido = { productoId: ID, alcance: "LOCAL", oculto: true };
    for (const [error, codigo] of [
      ["PRODUCTO_CON_EXISTENCIA", "CATALOGO_PRODUCTO_CON_EXISTENCIA"],
      ["PRODUCTO_CON_CONTEO_ABIERTO", "CATALOGO_PRODUCTO_CON_CONTEO_ABIERTO"],
      ["PRODUCTO_NO_ENCONTRADO", GENERICO],
      ["SUCURSAL_NO_ENCONTRADA", GENERICO],
    ] as const) {
      const { d } = montar({ ocultar: () => err(error) });
      expect(codigoDe(await ocultarOMostrarUnProducto(d, contexto, LOCAL, pedido))).toBe(codigo);
    }
  });

  it("los motivos del guard (sin permiso, módulo en desarrollo) pasan sin cambios", async () => {
    const pedido = { productoId: ID, alcance: "EMPRESA", oculto: true };
    for (const motivo of ["SIN_PERMISO", "MODULO_EN_DESARROLLO"]) {
      const { d } = montar({ ocultar: () => err(motivo) });
      expect(codigoDe(await ocultarOMostrarUnProducto(d, contexto, null, pedido))).toBe(motivo);
    }
  });

  it("un fallo inesperado sale sin detalle y queda registrado", async () => {
    const { m, d } = montar({
      ocultar: () => {
        throw new Error("boom con datos");
      },
    });
    const r = await ocultarOMostrarUnProducto(d, contexto, LOCAL, {
      productoId: ID,
      alcance: "LOCAL",
      oculto: true,
    });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("boom con datos");
    expect(m.registrados).toHaveLength(1);
  });
});
