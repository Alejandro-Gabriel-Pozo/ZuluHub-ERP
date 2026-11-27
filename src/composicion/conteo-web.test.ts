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

// ---- Contra mutantes (grupo «web (stock…)»): qué se le pide a cada consulta, que un error de una consulta salga tal cual y no se siga con lo que no llegó, y los campos que solo existen si vinieron. ----

const CONTROLADOS = [
  { articuloId: A1, productoId: "p1", nombre: "Harina", unidadId: "KILOGRAMO" },
  { articuloId: A2, productoId: "p2", nombre: "Sal", unidadId: "UNIDAD" },
];
type NombreDeConsulta =
  "listarDepositos" | "listarConteos" | "fichaDeConteo" | "articulosControlados";
type Respuestas = Partial<Record<NombreDeConsulta, () => unknown>>;
const DOS_DEPOSITOS = [
  { id: D1, nombre: "Salón", activo: true },
  { id: D2, nombre: "Barra", activo: true },
];
const FICHA_VACIA = { conteo: { id: CONTEO, estado: "ABIERTO" }, registros: [] as Registro[] };
const FALLA = () => err("CONTEO_EN_CURSO");
const CODIGO_DE_LA_FALLA = "STOCK_CONTEO_EN_CURSO";

const montarPropio = (c: Respuestas = {}) => {
  const pedidos: Record<NombreDeConsulta, unknown[]> = {
    listarDepositos: [],
    listarConteos: [],
    fichaDeConteo: [],
    articulosControlados: [],
  };
  const porDefecto: Record<NombreDeConsulta, () => unknown> = {
    listarDepositos: () => ok(DOS_DEPOSITOS),
    listarConteos: () => ok([{ id: CONTEO }]),
    fichaDeConteo: () => ok(FICHA_VACIA),
    articulosControlados: () => ok(CONTROLADOS),
  };
  const consulta = (nombre: NombreDeConsulta) => (_contexto: unknown, entrada: unknown) => {
    pedidos[nombre].push(entrada);
    return Promise.resolve((c[nombre] ?? porDefecto[nombre])());
  };
  const llamadas: { que: string; entrada: unknown }[] = [];
  const d = {
    casosDeUso: () => ({
      abrirConteo: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "abrir", entrada });
        return Promise.resolve(ok({ conteoId: CONTEO, yaExistia: true }));
      },
      registrarConteo: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "registrar", entrada });
        return Promise.resolve(ok({ yaExistia: true }));
      },
      cancelarConteo: () => Promise.resolve(ok({ yaEstaba: true })),
      aplicarConteo: (_c: unknown, entrada: unknown) => {
        llamadas.push({ que: "aplicar", entrada });
        return Promise.resolve(ok({ movimientoId: ID, yaAplicado: true }));
      },
    }),
    consultas: () => ({
      listarDepositos: consulta("listarDepositos"),
      listarConteos: consulta("listarConteos"),
      fichaDeConteo: consulta("fichaDeConteo"),
      articulosControlados: consulta("articulosControlados"),
    }),
    respuesta: { registrar: () => undefined },
  } as unknown as DependenciasDeConteoWeb;
  return { d, pedidos, llamadas };
};
const REGISTRO_CARGADO = (extra: Partial<Registro> = {}): Registro => ({
  articuloId: A1,
  cantidadContada: "5.0000",
  vigente: true,
  contadoEn: en,
  ...extra,
});

describe("lecturaDelConteo: lo que pide y cómo falla", () => {
  it("le pide a cada consulta justo lo que necesita: la sucursal, el depósito con su estado y el conteo abierto", async () => {
    const { d, pedidos } = montarPropio();
    const r = await lecturaDelConteo(d, contexto, SUC, {});
    expect(codigoDe(r)).toBe("OK");
    expect(pedidos.listarDepositos).toEqual([{ sucursalId: SUC }]);
    expect(pedidos.listarConteos).toEqual([{ depositoId: D1, estado: "ABIERTO" }]);
    expect(pedidos.fichaDeConteo).toEqual([{ conteoId: CONTEO }]);
  });

  it("acepta cualquiera de los depósitos activos de la sucursal, no solo el primero", async () => {
    const { d, pedidos } = montarPropio();
    const r = await lecturaDelConteo(d, contexto, SUC, { depositoId: D2 });
    expect(r).toMatchObject({ ok: true, dato: { depositoId: D2, conteoId: CONTEO } });
    expect(pedidos.listarConteos).toEqual([{ depositoId: D2, estado: "ABIERTO" }]);
  });

  it("un depósito que no es de la sucursal sale como el genérico y no consulta conteos", async () => {
    const { d, pedidos } = montarPropio();
    const r = await lecturaDelConteo(d, contexto, SUC, { depositoId: ID });
    expect(codigoDe(r)).toBe(GENERICO);
    expect(pedidos.listarConteos).toEqual([]);
  });

  it.each(["listarDepositos", "listarConteos", "fichaDeConteo", "articulosControlados"] as const)(
    "si %s falla, el error sale tal cual y no se sigue con lo que no llegó",
    async (nombre) => {
      const { d } = montarPropio({ [nombre]: FALLA });
      expect(codigoDe(await lecturaDelConteo(d, contexto, SUC, {}))).toBe(CODIGO_DE_LA_FALLA);
    },
  );

  it("una sucursal sin depósitos activos devuelve la lectura vacía y no consulta conteos", async () => {
    const { d, pedidos } = montarPropio({
      listarDepositos: () => ok([{ id: D1, nombre: "Viejo", activo: false }]),
    });
    const r = await lecturaDelConteo(d, contexto, SUC, {});
    expect(r).toEqual({
      ok: true,
      dato: { depositos: [], depositoId: null, conteoId: null, articulos: [] },
    });
    expect(pedidos.listarConteos).toEqual([]);
  });

  it("sin conteo abierto devuelve los depósitos, el elegido y ningún artículo", async () => {
    const { d, pedidos } = montarPropio({ listarConteos: () => ok([]) });
    const r = await lecturaDelConteo(d, contexto, SUC, {});
    expect(r).toEqual({
      ok: true,
      dato: {
        depositos: DOS_DEPOSITOS.map(({ id, nombre }) => ({ id, nombre })),
        depositoId: D1,
        conteoId: null,
        articulos: [],
      },
    });
    expect(pedidos.fichaDeConteo).toEqual([]);
  });

  it("si la ficha del conteo abierto no existe, tampoco hay conteo ni artículos", async () => {
    const { d, pedidos } = montarPropio({ fichaDeConteo: () => ok(null) });
    const r = await lecturaDelConteo(d, contexto, SUC, {});
    expect(r).toEqual({
      ok: true,
      dato: {
        depositos: DOS_DEPOSITOS.map(({ id, nombre }) => ({ id, nombre })),
        depositoId: D1,
        conteoId: null,
        articulos: [],
      },
    });
    expect(pedidos.articulosControlados).toEqual([]);
  });
});

describe("revisionDelConteo: lo que pide, cómo falla y qué campos existen", () => {
  it("le pide a la consulta el conteo que se revisa", async () => {
    const { d, pedidos } = montarPropio();
    await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    expect(pedidos.fichaDeConteo).toEqual([{ conteoId: CONTEO }]);
  });

  it.each(["fichaDeConteo", "articulosControlados"] as const)(
    "si %s falla, el error sale tal cual",
    async (nombre) => {
      const { d } = montarPropio({ [nombre]: FALLA });
      expect(codigoDe(await revisionDelConteo(d, contexto, { conteoId: CONTEO }))).toBe(
        CODIGO_DE_LA_FALLA,
      );
    },
  );

  it("un artículo que ya no se controla sale con nombre y unidad vacíos, nunca con un texto inventado ni sin campos", async () => {
    const desconocido = "99999999-9999-4999-8999-999999999999";
    const { d } = montarPropio({
      fichaDeConteo: () =>
        ok({
          conteo: { id: CONTEO, estado: "APLICADO" },
          registros: [REGISTRO_CARGADO({ articuloId: desconocido })],
          explicaciones: [
            {
              articuloId: desconocido,
              contada: "5.0000",
              diferenciaFinal: "-1.0000",
              motivo: "MERMA",
              detalle: null,
            },
          ],
        }),
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    expect(r).toMatchObject({ ok: true });
    const dato = (r as { dato: { filas: unknown[]; aplicadas: unknown[] } }).dato;
    expect(dato.filas).toStrictEqual([
      {
        articuloId: desconocido,
        nombre: "",
        unidadId: "",
        contada: "5.0000",
        contadoEn: en.toISOString(),
      },
    ]);
    expect(dato.aplicadas).toStrictEqual([
      {
        articuloId: desconocido,
        nombre: "",
        unidadId: "",
        contada: "5.0000",
        diferencia: "-1.0000",
        motivo: "MERMA",
        detalle: null,
      },
    ]);
  });

  it("un conteo aplicado sin explicaciones no tiene filas aplicadas", async () => {
    const { d } = montarPropio({
      fichaDeConteo: () => ok({ conteo: { id: CONTEO, estado: "APLICADO" }, registros: [] }),
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    expect(r).toMatchObject({
      ok: true,
      dato: { estado: "APLICADO", aplicadas: [], huella: null },
    });
  });

  it("«sistema» y «movido» existen solo si vinieron: sin ellos la fila no los tiene, ni vacíos", async () => {
    const { d } = montarPropio({
      fichaDeConteo: () =>
        ok({
          conteo: { id: CONTEO, estado: "ABIERTO" },
          registros: [
            REGISTRO_CARGADO({ diferenciaBruta: "-2.0000" }),
            REGISTRO_CARGADO({
              articuloId: A2,
              diferenciaBruta: "1.0000",
              existenciaALaHora: "7.0000",
            }),
          ],
        }),
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    const filas = (r as { dato: { filas: Record<string, unknown>[] } }).dato.filas;
    expect(Object.keys(filas[0] as object)).not.toContain("sistema");
    expect(Object.keys(filas[0] as object)).not.toContain("movido");
    expect(filas[1]).toMatchObject({ sistema: "7.0000" });
    expect(Object.keys(filas[1] as object)).not.toContain("movido");
  });

  it("«movido» llega solo, sin «sistema»", async () => {
    const { d } = montarPropio({
      fichaDeConteo: () =>
        ok({
          conteo: { id: CONTEO, estado: "ABIERTO" },
          registros: [REGISTRO_CARGADO({ diferenciaBruta: "1.0000", movidoDesdeLaHora: "3.0000" })],
        }),
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    const fila = (r as { dato: { filas: Record<string, unknown>[] } }).dato.filas[0] as object;
    expect(fila).toMatchObject({ movido: "3.0000" });
    expect(Object.keys(fila)).not.toContain("sistema");
  });

  it("los motivos salen en el orden aprobado, según el sentido de la diferencia", async () => {
    const { d } = montarPropio({
      fichaDeConteo: () =>
        ok({
          conteo: { id: CONTEO, estado: "ABIERTO" },
          registros: [
            REGISTRO_CARGADO({ diferenciaBruta: "-2.0000" }),
            REGISTRO_CARGADO({ articuloId: A2, diferenciaBruta: "2.0000" }),
          ],
        }),
    });
    const r = await revisionDelConteo(d, contexto, { conteoId: CONTEO });
    const [faltante, sobrante] = (
      r as { dato: { filas: { motivos: { codigo: string; pideDetalle: boolean }[] }[] } }
    ).dato.filas;
    expect(faltante?.motivos).toStrictEqual([
      { codigo: "VENTA_NO_REGISTRADA", pideDetalle: false },
      { codigo: "CONSUMO_INTERNO", pideDetalle: false },
      { codigo: "MERMA", pideDetalle: false },
      { codigo: "ROTURA", pideDetalle: false },
      { codigo: "VENCIMIENTO", pideDetalle: false },
      { codigo: "OTRA_SALIDA", pideDetalle: true },
    ]);
    expect(sobrante?.motivos).toStrictEqual([
      { codigo: "DEVOLUCION_DE_CLIENTE", pideDetalle: false },
      { codigo: "OTRA_ENTRADA", pideDetalle: true },
    ]);
  });
});

describe("las acciones del conteo: qué mandan, qué devuelven y cómo fallan", () => {
  it("abrir acepta cualquier depósito activo de la sucursal, manda el id y devuelve el conteo y si ya existía", async () => {
    const { d, llamadas } = montarPropio();
    const r = await abrirElConteo(d, contexto, SUC, { id: ID, depositoId: D2 });
    expect(r).toEqual({ ok: true, dato: { conteoId: CONTEO, yaExistia: true } });
    expect(llamadas).toEqual([{ que: "abrir", entrada: { id: ID, depositoId: D2 } }]);
  });

  it("abrir con un depósito de otra sucursal es el genérico y no abre nada", async () => {
    const { d, llamadas } = montarPropio();
    const r = await abrirElConteo(d, contexto, SUC, { id: ID, depositoId: CONTEO });
    expect(codigoDe(r)).toBe(GENERICO);
    expect(llamadas).toEqual([]);
  });

  it("abrir con la lista de depósitos caída sale con ese error y no abre nada", async () => {
    const { d, llamadas } = montarPropio({ listarDepositos: FALLA });
    const r = await abrirElConteo(d, contexto, SUC, { id: ID, depositoId: D1 });
    expect(codigoDe(r)).toBe(CODIGO_DE_LA_FALLA);
    expect(llamadas).toEqual([]);
  });

  it("cargar lo contado devuelve si ya existía y, con los artículos caídos, no registra nada", async () => {
    const { d, llamadas } = montarPropio();
    const r = await cargarLoContado(d, contexto, {
      id: ID,
      conteoId: CONTEO,
      articuloId: A1,
      cantidad: "5",
      hora: "",
    });
    expect(r).toEqual({ ok: true, dato: { yaExistia: true } });
    expect(llamadas).toHaveLength(1);
    const caido = montarPropio({ articulosControlados: FALLA });
    const f = await cargarLoContado(caido.d, contexto, {
      id: ID,
      conteoId: CONTEO,
      articuloId: A1,
      cantidad: "5",
      hora: "",
    });
    expect(codigoDe(f)).toBe(CODIGO_DE_LA_FALLA);
    expect(caido.llamadas).toEqual([]);
  });

  it("aplicar con los artículos caídos sale con ese error y no aplica nada", async () => {
    const { d, llamadas } = montarPropio({ articulosControlados: FALLA });
    const r = await aplicarElConteo(d, contexto, {
      conteoId: CONTEO,
      huella: HUELLA,
      respuestas: [],
    });
    expect(codigoDe(r)).toBe(CODIGO_DE_LA_FALLA);
    expect(llamadas).toEqual([]);
  });
});

describe("la huella del conteo: la forma exacta (64 de 0-9 a-f, ni antes ni después)", () => {
  it.each([
    ["con texto después", `${HUELLA}zz`],
    ["con texto antes", `zz${HUELLA}`],
    ["una de menos", "a".repeat(63)],
    ["en mayúsculas", "A".repeat(64)],
  ])("una huella %s se rechaza como el genérico y no aplica nada", async (_caso, huella) => {
    const { d, llamadas } = montarPropio();
    const r = await aplicarElConteo(d, contexto, { conteoId: CONTEO, huella, respuestas: [] });
    expect(codigoDe(r)).toBe(GENERICO);
    expect(llamadas).toEqual([]);
  });

  it("una huella bien formada se acepta", async () => {
    const { d, llamadas } = montarPropio();
    const r = await aplicarElConteo(d, contexto, {
      conteoId: CONTEO,
      huella: HUELLA,
      respuestas: [],
    });
    expect(r).toEqual({ ok: true, dato: { movimientoId: ID, yaAplicado: true } });
    expect(llamadas).toHaveLength(1);
  });
});
