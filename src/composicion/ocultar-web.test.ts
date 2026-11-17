import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  ocultarOMostrarUnProducto,
  verLaVisibilidadDelProducto,
  verLosProductosOcultos,
  volverAMostrarProductos,
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

const filaN = (productoId: string, nombre: string, sucursalId: string | null) => ({
  ...fila(productoId, sucursalId),
  nombre,
});
const ID3 = "4f3d0e5c-6071-4293-8ebf-3a4b5c6d7e8f";

describe("verLosProductosOcultos", () => {
  it("con local: agrupa por producto (local y/o empresa), ignora locales ajenos y ordena por nombre y luego por id", async () => {
    const { m, d } = montar({
      ocultos: () =>
        ok([
          filaN(OTRO, "Zeta", LOCAL),
          filaN(ID3, "Árbol", LOCAL),
          filaN(ID, "Árbol", null),
          filaN(ID, "Árbol", LOCAL),
          filaN("5a4e1f6d-7182-43a4-9fc0-4b5c6d7e8f90", "Ajeno", OTRO_LOCAL),
        ]),
    });
    const r = await verLosProductosOcultos(d, contexto, LOCAL);
    expect(r).toEqual({
      ok: true,
      dato: [
        { productoId: ID, nombre: "Árbol", local: true, empresa: true },
        { productoId: ID3, nombre: "Árbol", local: true, empresa: false },
        { productoId: OTRO, nombre: "Zeta", local: true, empresa: false },
      ],
    });
    expect(m.llamadas).toEqual([{ que: "ocultos", entrada: { sucursalId: LOCAL } }]);
  });

  it("solo empresa: local false; el nombre se ordena en español (acento) y no por código", async () => {
    const { d } = montar({
      ocultos: () => ok([filaN(OTRO, "Zeta", null), filaN(ID, "Álamo", null)]),
    });
    const r = await verLosProductosOcultos(d, contexto, LOCAL);
    expect(r).toEqual({
      ok: true,
      dato: [
        { productoId: ID, nombre: "Álamo", local: false, empresa: true },
        { productoId: OTRO, nombre: "Zeta", local: false, empresa: true },
      ],
    });
  });

  it("sin local: pregunta sin sucursal y lista solo lo oculto en toda la empresa", async () => {
    const { m, d } = montar({
      ocultos: () => ok([filaN(ID, "A", null), filaN(OTRO, "B", LOCAL)]),
    });
    const r = await verLosProductosOcultos(d, contexto, null);
    expect(r).toEqual({
      ok: true,
      dato: [{ productoId: ID, nombre: "A", local: false, empresa: true }],
    });
    expect(m.llamadas).toEqual([{ que: "ocultos", entrada: {} }]);
  });

  it("nada oculto: lista vacía", async () => {
    const { d } = montar();
    expect(await verLosProductosOcultos(d, contexto, LOCAL)).toEqual({ ok: true, dato: [] });
  });

  it("rechazo de la consulta: su motivo o el genérico; fallo inesperado: sin detalle y registrado", async () => {
    expect(
      codigoDe(
        await verLosProductosOcultos(
          montar({ ocultos: () => err("MODULO_EN_DESARROLLO") }).d,
          contexto,
          LOCAL,
        ),
      ),
    ).toBe("MODULO_EN_DESARROLLO");
    expect(
      codigoDe(
        await verLosProductosOcultos(
          montar({ ocultos: () => err("SUCURSAL_FUERA_DE_ALCANCE") }).d,
          contexto,
          LOCAL,
        ),
      ),
    ).toBe(GENERICO);
    const { m, d } = montar({
      ocultos: () => {
        throw new Error("detalle interno");
      },
    });
    const r = await verLosProductosOcultos(d, contexto, LOCAL);
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalle interno");
    expect(m.registrados).toHaveLength(1);
  });
});

describe("volverAMostrarProductos", () => {
  const ocultoEn = (...f: ReturnType<typeof filaN>[]) => ({ ocultos: () => ok(f) });
  const escrituras = (m: ReturnType<typeof montar>["m"]) =>
    m.llamadas.filter((l) => l.que === "ocultar").map((l) => l.entrada);

  it("oculto en el local y en la empresa: dos escrituras (local y luego empresa), con oculto=false, y cuenta un producto", async () => {
    const { m, d } = montar(ocultoEn(filaN(ID, "A", LOCAL), filaN(ID, "A", null)));
    const r = await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID] });
    expect(r).toEqual({ ok: true, dato: { productoIds: [ID], mostrados: 1 } });
    expect(escrituras(m)).toEqual([
      { productoId: ID, alcance: { tipo: "SUCURSAL", sucursalId: LOCAL }, oculto: false },
      { productoId: ID, alcance: { tipo: "EMPRESA" }, oculto: false },
    ]);
  });

  it("oculto solo en la empresa y con local elegido: una sola escritura, la de la empresa (no se inventa la del local)", async () => {
    const { m, d } = montar(ocultoEn(filaN(ID, "A", null)));
    await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID] });
    expect(escrituras(m)).toEqual([
      { productoId: ID, alcance: { tipo: "EMPRESA" }, oculto: false },
    ]);
  });

  it("sin local: solo el alcance empresa, nunca «todas»", async () => {
    const { m, d } = montar(ocultoEn(filaN(ID, "A", null)));
    const r = await volverAMostrarProductos(d, contexto, null, { productoIds: [ID] });
    expect(r).toEqual({ ok: true, dato: { productoIds: [ID], mostrados: 1 } });
    expect(escrituras(m)).toEqual([
      { productoId: ID, alcance: { tipo: "EMPRESA" }, oculto: false },
    ]);
  });

  it("los que ya están visibles no se escriben ni cuentan; los repetidos se piden una vez", async () => {
    const { m, d } = montar(ocultoEn(filaN(ID, "A", LOCAL)));
    const r = await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID, OTRO, ID] });
    expect(r).toEqual({ ok: true, dato: { productoIds: [ID, OTRO], mostrados: 1 } });
    expect(escrituras(m)).toHaveLength(1);
  });

  it("nada oculto: mostrados 0 y sin escrituras", async () => {
    const { m, d } = montar();
    const r = await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID] });
    expect(r).toEqual({ ok: true, dato: { productoIds: [ID], mostrados: 0 } });
    expect(escrituras(m)).toEqual([]);
  });

  it.each([
    ["sin forma", null],
    ["lista vacía", { productoIds: [] }],
    ["id inválido", { productoIds: ["x"] }],
    ["clave de más", { productoIds: [ID], sucursalId: LOCAL }],
  ])("pedido inválido (%s): el genérico, sin leer ni escribir", async (_c, crudo) => {
    const { m, d } = montar();
    expect(codigoDe(await volverAMostrarProductos(d, contexto, LOCAL, crudo))).toBe(GENERICO);
    expect(m.llamadas).toEqual([]);
  });

  it("si falla la lectura de ocultos: devuelve ese error y no escribe", async () => {
    const { m, d } = montar({ ocultos: () => err("MODULO_EN_DESARROLLO") });
    const r = await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID] });
    expect(codigoDe(r)).toBe("MODULO_EN_DESARROLLO");
    expect(escrituras(m)).toEqual([]);
  });

  it("si una escritura falla: sigue con las demás, no cuenta el producto incompleto y devuelve el PRIMER error", async () => {
    let n = 0;
    const { m, d } = montar({
      ...ocultoEn(filaN(ID, "A", LOCAL), filaN(ID, "A", null), filaN(OTRO, "B", LOCAL)),
      ocultar: () => {
        n += 1;
        if (n === 1) return err("PRODUCTO_CON_EXISTENCIA");
        if (n === 2) return err("SIN_PERMISO");
        return ok({ yaEstaba: false, sigueOcultoPor: null });
      },
    });
    const r = await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID, OTRO] });
    expect(codigoDe(r)).toBe("CATALOGO_PRODUCTO_CON_EXISTENCIA");
    expect(escrituras(m)).toHaveLength(3);
  });

  it("una excepción en una escritura: no corta, queda registrada y sale sin detalle", async () => {
    let n = 0;
    const { m, d } = montar({
      ...ocultoEn(filaN(ID, "A", LOCAL), filaN(OTRO, "B", LOCAL)),
      ocultar: () => {
        n += 1;
        if (n === 1) throw new Error("detalle interno");
        return ok({ yaEstaba: false, sigueOcultoPor: null });
      },
    });
    const r = await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID, OTRO] });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("detalle interno");
    expect(m.registrados).toHaveLength(1);
    expect(escrituras(m)).toHaveLength(2);
  });

  it("repetir el pedido cuando ya no hay nada oculto no duplica nada", async () => {
    const { m, d } = montar();
    await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID] });
    await volverAMostrarProductos(d, contexto, LOCAL, { productoIds: [ID] });
    expect(escrituras(m)).toEqual([]);
  });
});
