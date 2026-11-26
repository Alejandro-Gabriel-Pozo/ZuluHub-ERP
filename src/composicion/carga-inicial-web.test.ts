import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  entradaDeCargaInicial,
  opcionesParaLaCargaInicial,
  registrarLaCargaInicial,
  type DependenciasDeCargaInicialWeb,
} from "./carga-inicial-web";

/** La carga inicial con el módulo simulado: qué resuelve la composición (depósito `Normal` de la sucursal, artículos y unidades del servidor), el aviso de existencia previa y qué pide al caso de uso. Contra la base real, `test/integracion/stock-carga-inicial-web.test.ts`. */
const SUC = "11111111-1111-4111-8111-111111111111";
const D1 = "22222222-2222-4222-8222-222222222222";
const D2 = "33333333-3333-4333-8333-333333333333";
const A1 = "55555555-5555-4555-8555-555555555555";
const A2 = "66666666-6666-4666-8666-666666666666";
const CLAVE = "77777777-7777-4777-8777-777777777777";
const MOV = "88888888-8888-4888-8888-888888888888";
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

const articulo = (
  articuloId: string,
  productoId: string,
  unidadId: string,
  controlDeLote: "LOTE" | "LOTE_Y_VENCIMIENTO" | null = null,
) => ({
  articuloId,
  productoId,
  nombre: productoId,
  unidadId,
  controlDeLote,
});
const base = (cambios: Record<string, unknown> = {}) => ({
  clave: CLAVE,
  depositoId: D1,
  renglones: [
    { articuloId: A1, cantidad: "10", costoUnitario: "12.5" },
    { articuloId: A2, cantidad: "2.5", costoUnitario: "" },
  ],
  ...cambios,
});

const montar = (r: { entrada?: () => unknown; depositos?: unknown[] } = {}) => {
  const llamadas: { que: string; entrada: unknown }[] = [];
  const registrados: string[] = [];
  const d = {
    casosDeUso: () => ({
      registrarEntrada: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "entrada", entrada });
        return Promise.resolve(
          (r.entrada ?? (() => ok({ movimientoId: MOV, yaExistia: false })))(),
        );
      },
    }),
    consultas: () => ({
      listarDepositos: () =>
        Promise.resolve(
          ok(
            r.depositos ?? [
              { id: D1, nombre: "Salón", uso: "NORMAL", activo: true },
              { id: D2, nombre: "Cuarentena", uso: "CUARENTENA", activo: true },
              { id: "inactivo", nombre: "Viejo", uso: "NORMAL", activo: false },
            ],
          ),
        ),
      articulosControlados: () =>
        Promise.resolve(ok([articulo(A1, "p1", "KILOGRAMO"), articulo(A2, "p2", "UNIDAD")])),
    }),
    respuesta: { registrar: (detalle: string) => registrados.push(detalle) },
  } as unknown as DependenciasDeCargaInicialWeb;
  return { d, llamadas, registrados };
};
const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : (r.error?.codigo ?? "?");

describe("entradaDeCargaInicial (la frontera)", () => {
  it("un costo en blanco es «sin costo» y la confirmación solo vale «1»", () => {
    const r = entradaDeCargaInicial(base({ confirmar: "1" }));
    expect(r).toEqual({
      ok: true,
      valor: {
        clave: CLAVE,
        depositoId: D1,
        renglones: [
          { articuloId: A1, cantidad: "10", costoUnitario: "12.5" },
          { articuloId: A2, cantidad: "2.5", costoUnitario: undefined },
        ],
        confirmar: true,
      },
    });
    expect(entradaDeCargaInicial(base()).ok && entradaDeCargaInicial(base())).toMatchObject({
      valor: { confirmar: false },
    });
    expect(entradaDeCargaInicial(base({ confirmar: "" }))).toMatchObject({
      valor: { confirmar: false },
    });
    for (const malo of ["0", "true", 1, true]) {
      expect(entradaDeCargaInicial(base({ confirmar: malo })).ok).toBe(false);
    }
  });

  it("de 1 a 9.999 renglones: 0 y 10.000 se rechazan; lo que trae campos de más o ids rotos, también", () => {
    const filas = (n: number) =>
      Array.from({ length: n }, () => ({ articuloId: A1, cantidad: "1" }));
    expect(entradaDeCargaInicial(base({ renglones: filas(9_999) })).ok).toBe(true);
    expect(entradaDeCargaInicial(base({ renglones: filas(10_000) })).ok).toBe(false);
    expect(entradaDeCargaInicial(base({ renglones: [] })).ok).toBe(false);
    expect(entradaDeCargaInicial(base({ motivo: "COMPRA" })).ok).toBe(false);
    expect(entradaDeCargaInicial(base({ depositoId: "x" })).ok).toBe(false);
    expect(
      entradaDeCargaInicial(base({ renglones: [{ articuloId: A1, cantidad: "1", motivo: "x" }] }))
        .ok,
    ).toBe(false);
    expect(
      entradaDeCargaInicial(base({ renglones: [{ articuloId: "x", cantidad: "1" }] })).ok,
    ).toBe(false);
  });
});

describe("opcionesParaLaCargaInicial", () => {
  it("ofrece solo los depósitos Normal activos y los artículos con su unidad", async () => {
    const { d } = montar();
    expect(await opcionesParaLaCargaInicial(d, contexto, SUC)).toEqual({
      ok: true,
      dato: {
        depositos: [{ id: D1, nombre: "Salón" }],
        articulos: [
          { id: A1, nombre: "p1", unidadId: "KILOGRAMO", controlDeLote: null },
          { id: A2, nombre: "p2", unidadId: "UNIDAD", controlDeLote: null },
        ],
      },
    });
  });
});

describe("registrarLaCargaInicial", () => {
  it("una sola entrada CARGA_INICIAL con todos los renglones (producto y unidad del servidor), sin fecha y con el costo en blanco como ausente", async () => {
    const { d, llamadas } = montar();
    expect(await registrarLaCargaInicial(d, contexto, SUC, base())).toEqual({
      ok: true,
      dato: { movimientoId: MOV, yaExistia: false },
    });
    expect(llamadas.filter((x) => x.que === "entrada")).toEqual([
      {
        que: "entrada",
        entrada: {
          clave: CLAVE,
          depositoId: D1,
          motivo: "CARGA_INICIAL",
          confirmaExistenciaPrevia: false,
          renglones: [
            { productoId: "p1", cantidad: "10", unidadId: "KILOGRAMO", costoUnitario: "12.5" },
            { productoId: "p2", cantidad: "2.5", unidadId: "UNIDAD", costoUnitario: undefined },
          ],
        },
      },
    ]);
    expect(Object.keys(llamadas.find((x) => x.que === "entrada")?.entrada as object)).not.toContain(
      "hechoEn",
    );
  });

  it("un depósito que no es Normal, está inactivo o no es de la sucursal sale como el genérico y no escribe nada", async () => {
    for (const depositoId of [D2, "inactivo", "99999999-9999-4999-8999-999999999999"]) {
      const { d, llamadas } = montar();
      const r = await registrarLaCargaInicial(d, contexto, SUC, base({ depositoId }));
      expect(codigoDe(r), depositoId).toBe(GENERICO);
      expect(llamadas.filter((x) => x.que === "entrada")).toEqual([]);
    }
  });

  it("un artículo que no se puede mover (o de otra empresa) frena toda la tanda: no se escribe ningún renglón", async () => {
    const { d, llamadas } = montar();
    const ajeno = "99999999-9999-4999-8999-999999999999";
    const r = await registrarLaCargaInicial(
      d,
      contexto,
      SUC,
      base({
        renglones: [
          { articuloId: A1, cantidad: "1" },
          { articuloId: ajeno, cantidad: "1" },
        ],
      }),
    );
    expect(codigoDe(r)).toBe(GENERICO);
    expect(llamadas).toEqual([]);
  });

  it("sin confirmar pide al caso de uso SIN confirmación; el aviso del caso de uso sale como STOCK_YA_HAY_EXISTENCIA y no se esconde", async () => {
    const { d, llamadas } = montar({ entrada: () => err({ error: "YA_HAY_EXISTENCIA" }) });
    expect(codigoDe(await registrarLaCargaInicial(d, contexto, SUC, base()))).toBe(
      "STOCK_YA_HAY_EXISTENCIA",
    );
    expect(llamadas.map((x) => x.entrada)).toMatchObject([{ confirmaExistenciaPrevia: false }]);
  });

  it("confirmar reenvía con la MISMA clave y la confirmación; solo «1» confirma", async () => {
    const { d, llamadas } = montar();
    expect((await registrarLaCargaInicial(d, contexto, SUC, base({ confirmar: "1" }))).ok).toBe(
      true,
    );
    expect(llamadas[0]?.entrada).toMatchObject({ clave: CLAVE, confirmaExistenciaPrevia: true });
    const vacio = montar();
    await registrarLaCargaInicial(vacio.d, contexto, SUC, base({ confirmar: "" }));
    expect(vacio.llamadas[0]?.entrada).toMatchObject({ confirmaExistenciaPrevia: false });
  });

  it("un rechazo del caso de uso (permiso, renglón repetido…) no se esconde y una excepción sale sin detalle", async () => {
    const sinPermiso = montar({ entrada: () => err("SIN_PERMISO") });
    expect((await registrarLaCargaInicial(sinPermiso.d, contexto, SUC, base())).ok).toBe(false);
    const repetido = montar({ entrada: () => err("RENGLON_REPETIDO") });
    expect(codigoDe(await registrarLaCargaInicial(repetido.d, contexto, SUC, base()))).toBe(
      GENERICO,
    );
    const rota = montar({
      entrada: () => {
        throw new Error("secreto interno");
      },
    });
    const r = await registrarLaCargaInicial(rota.d, contexto, SUC, base());
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("secreto interno");
  });
});

describe("registrarLaCargaInicial con lotes (STK-E2b)", () => {
  const renglonesDe = (llamadas: readonly { que: string; entrada: unknown }[]) =>
    (llamadas.find((x) => x.que === "entrada")?.entrada as { renglones: Record<string, unknown>[] })
      .renglones;

  it("una fila con lote manda UN lote con la cantidad de la fila y su vencimiento; las demás filas no llevan `lotes`", async () => {
    const { d, llamadas } = montar();
    const r = await registrarLaCargaInicial(
      d,
      contexto,
      SUC,
      base({
        renglones: [
          {
            articuloId: A1,
            cantidad: "10",
            costoUnitario: "",
            loteCodigo: "L-1",
            loteVence: "2099-06-01",
          },
          { articuloId: A2, cantidad: "2.5", costoUnitario: "", loteCodigo: "", loteVence: "" },
        ],
      }),
    );
    expect(r.ok).toBe(true);
    const renglones = renglonesDe(llamadas);
    expect(renglones[0]?.["lotes"]).toEqual([
      { codigo: "L-1", fechaDeVencimiento: "2099-06-01", cantidad: "10" },
    ]);
    expect(Object.keys(renglones[1] ?? {})).not.toContain("lotes");
  });

  it("un vencimiento sin código es un pedido mal formado: genérico y no se escribe nada de la tanda", async () => {
    const { d, llamadas } = montar();
    const r = await registrarLaCargaInicial(
      d,
      contexto,
      SUC,
      base({
        renglones: [
          { articuloId: A1, cantidad: "10", costoUnitario: "", loteVence: "2099-06-01" },
          { articuloId: A2, cantidad: "2.5", costoUnitario: "" },
        ],
      }),
    );
    expect(codigoDe(r)).toBe(GENERICO);
    expect(llamadas.filter((x) => x.que === "entrada")).toEqual([]);
  });

  it("las opciones traen cómo se controla cada artículo por lote", async () => {
    const { d } = montar();
    const r = await opcionesParaLaCargaInicial(d, contexto, SUC);
    expect(r.ok && r.dato.articulos.map((a) => a.controlDeLote)).toEqual([null, null]);
  });
});
