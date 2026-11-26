import { describe, expect, it } from "vitest";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import {
  abrirElConteo,
  aplicarElConteo,
  cancelarElConteo,
  cargarLoContado,
  lecturaDelConteo,
  revisionDelConteo,
  type DependenciasDeConteoWeb,
} from "./conteo-web";

/** El conteo web con el módulo simulado: qué resuelve la composición (depósito de la sucursal, artículos y unidades del servidor, a ciegas) y qué pide al caso de uso. Contra la base real, `test/integracion/stock-conteo-web.test.ts`. */
const SUC = "11111111-1111-4111-8111-111111111111";
const D1 = "22222222-2222-4222-8222-222222222222";
const D2 = "33333333-3333-4333-8333-333333333333";
const CONTEO = "44444444-4444-4444-8444-444444444444";
const A1 = "55555555-5555-4555-8555-555555555555";
const A2 = "66666666-6666-4666-8666-666666666666";
const ID = "77777777-7777-4777-8777-777777777777";
const HUELLA = "a".repeat(64);
const contexto = { empresaId: "e1" } as unknown as ContextoOperativo;
const GENERICO = "STOCK_ACCION_NO_PERMITIDA";

const codigoDe = (r: { ok: boolean; error?: { codigo: string } }) =>
  r.ok ? "OK" : (r.error?.codigo ?? "?");

type Registro = Readonly<{
  articuloId: string;
  cantidadContada: string;
  vigente: boolean;
  contadoEn: Date;
  existenciaALaHora?: string;
  movidoDesdeLaHora?: string;
  diferenciaBruta?: string;
}>;

const montar = (
  r: {
    registros?: Registro[];
    huella?: string;
    estado?: string;
    explicaciones?: unknown[];
    abiertos?: unknown[];
    ficha?: unknown;
  } = {},
) => {
  const llamadas: { que: string; entrada: unknown }[] = [];
  const d = {
    casosDeUso: () => ({
      abrirConteo: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "abrir", entrada });
        return Promise.resolve(ok({ conteoId: CONTEO, yaExistia: false }));
      },
      registrarConteo: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "registrar", entrada });
        return Promise.resolve(ok({ yaExistia: false }));
      },
      cancelarConteo: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "cancelar", entrada });
        return Promise.resolve(ok({ yaEstaba: false }));
      },
      aplicarConteo: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "aplicar", entrada });
        return Promise.resolve(ok({ movimientoId: null, yaAplicado: false }));
      },
    }),
    consultas: () => ({
      listarDepositos: () =>
        Promise.resolve(
          ok([
            { id: D1, nombre: "Salón", activo: true },
            { id: D2, nombre: "Viejo", activo: false },
          ]),
        ),
      listarConteos: () => Promise.resolve(ok(r.abiertos ?? [{ id: CONTEO }])),
      fichaDeConteo: () =>
        Promise.resolve(
          ok(
            r.ficha !== undefined
              ? r.ficha
              : {
                  conteo: { id: CONTEO, estado: r.estado ?? "ABIERTO" },
                  registros: r.registros ?? [],
                  ...(r.huella === undefined ? {} : { huella: r.huella }),
                  ...(r.explicaciones === undefined ? {} : { explicaciones: r.explicaciones }),
                },
          ),
        ),
      articulosControlados: () =>
        Promise.resolve(
          ok([
            { articuloId: A1, productoId: "p1", nombre: "Harina", unidadId: "KILOGRAMO" },
            { articuloId: A2, productoId: "p2", nombre: "Sal", unidadId: "UNIDAD" },
          ]),
        ),
    }),
    respuesta: { registrar: () => undefined },
  } as unknown as DependenciasDeConteoWeb;
  return { d, llamadas };
};

const en = new Date("2026-10-11T13:10:00.000Z");

describe("lecturaDelConteo", () => {
  it("sin depósito pedido toma el primero activo y trae los artículos con lo ya cargado", async () => {
    const { d } = montar({
      registros: [
        { articuloId: A1, cantidadContada: "5.0000", vigente: true, contadoEn: en },
        { articuloId: A1, cantidadContada: "9.0000", vigente: false, contadoEn: en },
      ],
    });
    const r = await lecturaDelConteo(d, contexto, SUC, {});
    expect(r).toMatchObject({
      ok: true,
      dato: {
        depositoId: D1,
        conteoId: CONTEO,
        depositos: [{ id: D1, nombre: "Salón" }],
        articulos: [
          { articuloId: A1, unidadId: "KILOGRAMO", contado: "5.0000" },
          { articuloId: A2, contado: null },
        ],
      },
    });
  });

  it("un depósito que no es de la sucursal (o inactivo) sale como el genérico", async () => {
    const { d } = montar();
    expect(codigoDe(await lecturaDelConteo(d, contexto, SUC, { depositoId: D2 }))).toBe(GENERICO);
    expect(codigoDe(await lecturaDelConteo(d, contexto, SUC, { depositoId: "x" }))).toBe(GENERICO);
  });

  it("sin conteo abierto devuelve la lista de depósitos y ningún artículo", async () => {
    const { d } = montar({ abiertos: [] });
    expect(await lecturaDelConteo(d, contexto, SUC, { depositoId: D1 })).toMatchObject({
      ok: true,
      dato: { conteoId: null, articulos: [] },
    });
  });

  it("una forma que no es la esperada se rechaza", async () => {
    const { d } = montar();
    expect(codigoDe(await lecturaDelConteo(d, contexto, SUC, { depositoId: D1, otro: 1 }))).toBe(
      GENERICO,
    );
  });
});

describe("revisionDelConteo", () => {
  it("con permiso de aplicar trae lo que el sistema creía, lo movido, la diferencia y los motivos del sentido", async () => {
    const { d } = montar({
      huella: HUELLA,
      registros: [
        {
          articuloId: A1,
          cantidadContada: "18.0000",
          vigente: true,
          contadoEn: en,
          existenciaALaHora: "20.0000",
          movidoDesdeLaHora: "-1.0000",
          diferenciaBruta: "-1.0000",
        },
        {
          articuloId: A2,
          cantidadContada: "3.0000",
          vigente: true,
          contadoEn: en,
          existenciaALaHora: "2.0000",
          movidoDesdeLaHora: "0.0000",
          diferenciaBruta: "1.0000",
        },
      ],
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    expect(r.ok && r.dato.huella).toBe(HUELLA);
    expect(r.ok && r.dato.filas[0]).toMatchObject({
      sistema: "20.0000",
      movido: "-1.0000",
      diferencia: "-1.0000",
      contadoEn: en.toISOString(),
    });
    expect(r.ok && r.dato.filas[0]?.motivos?.map((m) => m.codigo)).toEqual([
      "VENTA_NO_REGISTRADA",
      "CONSUMO_INTERNO",
      "MERMA",
      "ROTURA",
      "VENCIMIENTO",
      "OTRA_SALIDA",
    ]);
    expect(r.ok && r.dato.filas[1]?.motivos?.map((m) => m.codigo)).toEqual([
      "DEVOLUCION_DE_CLIENTE",
      "OTRA_ENTRADA",
    ]);
  });

  it("a ciegas: sin permiso, esos campos NO EXISTEN en lo que devuelve", async () => {
    const { d } = montar({
      registros: [{ articuloId: A1, cantidadContada: "18.0000", vigente: true, contadoEn: en }],
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    expect(r.ok && r.dato.huella).toBeNull();
    const fila = r.ok ? r.dato.filas[0] : undefined;
    expect(fila).toBeDefined();
    for (const campo of ["sistema", "movido", "diferencia", "motivos"]) {
      expect(Object.keys(fila ?? {})).not.toContain(campo);
    }
  });

  it("una diferencia en cero no ofrece motivos", async () => {
    const { d } = montar({
      huella: HUELLA,
      registros: [
        {
          articuloId: A1,
          cantidadContada: "3.0000",
          vigente: true,
          contadoEn: en,
          existenciaALaHora: "3.0000",
          movidoDesdeLaHora: "0.0000",
          diferenciaBruta: "0.0000",
        },
      ],
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    expect(Object.keys((r.ok && r.dato.filas[0]) || {})).not.toContain("motivos");
  });

  it("aplicado: trae lo explicado con su motivo y detalle", async () => {
    const { d } = montar({
      estado: "APLICADO",
      explicaciones: [
        {
          articuloId: A1,
          contada: "18.0000",
          diferenciaFinal: "-2.0000",
          motivo: "OTRA_SALIDA",
          detalle: "se cayó",
        },
      ],
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    expect(r).toMatchObject({
      ok: true,
      dato: {
        estado: "APLICADO",
        aplicadas: [
          {
            articuloId: A1,
            nombre: "Harina",
            diferencia: "-2.0000",
            motivo: "OTRA_SALIDA",
            detalle: "se cayó",
          },
        ],
      },
    });
  });

  it("un conteo que no existe (o que no se ve) sale como el genérico", async () => {
    const { d } = montar({ ficha: null });
    expect(codigoDe(await revisionDelConteo(d, contexto, { conteoId: CONTEO }))).toBe(GENERICO);
  });
});

describe("abrirElConteo", () => {
  it("abre el conteo del depósito de la sucursal con el id del gesto", async () => {
    const { d, llamadas } = montar();
    const r = await abrirElConteo(d, contexto, SUC, { id: ID, depositoId: D1 });
    expect(r).toMatchObject({ ok: true, dato: { conteoId: CONTEO, yaExistia: false } });
    expect(llamadas).toEqual([{ que: "abrir", entrada: { id: ID, depositoId: D1 } }]);
  });

  it("un depósito de otra sucursal no llega al caso de uso", async () => {
    const { d, llamadas } = montar();
    const r = await abrirElConteo(d, contexto, SUC, { id: ID, depositoId: D2 });
    expect(codigoDe(r)).toBe(GENERICO);
    expect(llamadas).toEqual([]);
  });
});

describe("cargarLoContado", () => {
  it("el producto y la unidad salen del servidor, nunca del navegador; la hora vacía es «la de la carga»", async () => {
    const { d, llamadas } = montar();
    const r = await cargarLoContado(d, contexto, {
      id: ID,
      conteoId: CONTEO,
      articuloId: A1,
      cantidad: "0",
      hora: "",
    });
    expect(r.ok).toBe(true);
    expect(llamadas[0]).toEqual({
      que: "registrar",
      entrada: {
        id: ID,
        conteoId: CONTEO,
        productoId: "p1",
        cantidadContada: "0",
        unidadId: "KILOGRAMO",
        horaDelConteo: undefined,
      },
    });
  });

  it("la hora viaja como «HH:MM» para que la resuelva el servidor", async () => {
    const { d, llamadas } = montar();
    await cargarLoContado(d, contexto, {
      id: ID,
      conteoId: CONTEO,
      articuloId: A2,
      cantidad: "2.5",
      hora: "10:05",
    });
    expect(llamadas[0]?.entrada).toMatchObject({ productoId: "p2", horaDelConteo: "10:05" });
  });

  it("un artículo que no se controla, o un campo de más (unidad, producto), se rechazan", async () => {
    const { d, llamadas } = montar();
    const base = { id: ID, conteoId: CONTEO, cantidad: "1" };
    expect(codigoDe(await cargarLoContado(d, contexto, { ...base, articuloId: ID }))).toBe(
      GENERICO,
    );
    expect(
      codigoDe(await cargarLoContado(d, contexto, { ...base, articuloId: A1, unidadId: "GRAMO" })),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await cargarLoContado(d, contexto, { ...base, articuloId: A1, cantidad: "9".repeat(41) }),
      ),
    ).toBe(GENERICO);
    expect(llamadas).toEqual([]);
  });
});

describe("cancelarElConteo", () => {
  it("cancela con su motivo", async () => {
    const { d, llamadas } = montar();
    const r = await cancelarElConteo(d, contexto, { conteoId: CONTEO, motivo: "se contó mal" });
    expect(r).toMatchObject({ ok: true, dato: { yaEstaba: false } });
    expect(llamadas[0]).toEqual({
      que: "cancelar",
      entrada: { conteoId: CONTEO, motivo: "se contó mal" },
    });
  });
});

describe("aplicarElConteo", () => {
  it("lleva la huella de lo visto y, por artículo, el motivo y el detalle (vacío es «sin valor»)", async () => {
    const { d, llamadas } = montar();
    const r = await aplicarElConteo(d, contexto, {
      conteoId: CONTEO,
      huella: HUELLA,
      respuestas: [
        { articuloId: A1, motivo: "OTRA_SALIDA", detalle: "se cayó" },
        { articuloId: A2, motivo: "", detalle: "" },
      ],
    });
    expect(r).toMatchObject({ ok: true, dato: { yaAplicado: false } });
    expect(llamadas[0]).toEqual({
      que: "aplicar",
      entrada: {
        conteoId: CONTEO,
        huella: HUELLA,
        respuestas: [
          { productoId: "p1", motivo: "OTRA_SALIDA", detalle: "se cayó" },
          { productoId: "p2", motivo: null, detalle: null },
        ],
      },
    });
  });

  it("una huella que no es un sha256, un artículo ajeno o un renglón de más se rechazan sin llamar al caso de uso", async () => {
    const { d, llamadas } = montar();
    const base = { conteoId: CONTEO, huella: HUELLA, respuestas: [] };
    expect(codigoDe(await aplicarElConteo(d, contexto, { ...base, huella: "x" }))).toBe(GENERICO);
    expect(
      codigoDe(
        await aplicarElConteo(d, contexto, {
          ...base,
          respuestas: [{ articuloId: ID, motivo: "MERMA" }],
        }),
      ),
    ).toBe(GENERICO);
    expect(
      codigoDe(
        await aplicarElConteo(d, contexto, { ...base, respuestas: [{ articuloId: A1 }], x: 1 }),
      ),
    ).toBe(GENERICO);
    expect(llamadas).toEqual([]);
  });

  it("lo que el caso de uso rechaza (revisión desactualizada) llega como error, no como éxito", async () => {
    const { d } = montar();
    const deFalla = {
      ...d,
      casosDeUso: () => ({
        ...d.casosDeUso(),
        aplicarConteo: () => Promise.resolve(err("REVISION_DESACTUALIZADA" as const)),
      }),
    } as unknown as DependenciasDeConteoWeb;
    const r = await aplicarElConteo(deFalla, contexto, {
      conteoId: CONTEO,
      huella: HUELLA,
      respuestas: [],
    });
    expect(r.ok).toBe(false);
  });
});
