import { describe, expect, it } from "vitest";
import { huellaDeComando } from "../dominio/huella";
import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import {
  leerRenglones,
  lotesDeLaEntrada,
  renglonesDeHuella,
  resolverRenglones,
} from "./movimientos-comun";
import type { LoteLeido } from "./lotes-del-pedido";

/**
 * La huella de la entrada con lotes (STK-E2a). Lo que no puede romperse: un renglón SIN lotes da, byte a byte, la huella de siempre (los valores de abajo son los del formato anterior, armados a mano con `huellaDeComando`,
 * que no cambió), así el reintento de un pedido viejo con la misma clave sigue siendo una repetición. Con lotes la huella cambia con cualquier código, fecha o cantidad, y no con el orden.
 */
const P = "11111111-1111-4111-8111-111111111111";
const Q = "22222222-2222-4222-8222-222222222222";
const D = "33333333-3333-4333-8333-333333333333";
const GOLDEN_SIN_COSTO = "6f791d63bbcaecee1a41e17fedfe21ba76c97e825ab5f3609bde021351f460f3";
const GOLDEN_CON_COSTO = "137bb30ae9bc2d68d8de5f49d831da701e262d6135d09bccd4f669aa85473738";

const huellaDe = (renglones: unknown, motivo = "COMPRA", detalle: string | null = null) => {
  const leidos = leerRenglones(renglones, true, true);
  if (!leidos.ok) throw new Error(JSON.stringify(leidos));
  return huellaDeComando("entrada", [D, motivo, detalle, null], renglonesDeHuella(leidos.valor));
};
const lotes = (...l: Record<string, unknown>[]) => l;

describe("huella de un renglón sin lotes (no cambia)", () => {
  it("sin costo, igual a la de siempre", () => {
    expect(
      huellaDe([
        { productoId: P, cantidad: "5", unidadId: "UNIDAD" },
        { productoId: Q, cantidad: "2.5", unidadId: "KILOGRAMO" },
      ]),
    ).toBe(GOLDEN_SIN_COSTO);
  });

  it("con costo, igual a la de siempre; el orden de los renglones no importa", () => {
    expect(
      huellaDe(
        [{ productoId: P, cantidad: "5", unidadId: "UNIDAD", costoUnitario: "12.5" }],
        "COMPRA",
        "llegó",
      ),
    ).toBe(GOLDEN_CON_COSTO);
    expect(
      huellaDe([
        { productoId: Q, cantidad: "2.5", unidadId: "KILOGRAMO" },
        { productoId: P, cantidad: "5", unidadId: "UNIDAD" },
      ]),
    ).toBe(GOLDEN_SIN_COSTO);
  });
});

describe("huella de un renglón con lotes", () => {
  const con = (l: Record<string, unknown>[], extra: Record<string, unknown> = {}) => [
    { productoId: P, cantidad: "5", unidadId: "UNIDAD", lotes: l, ...extra },
  ];
  const base = lotes(
    { codigo: "A", fechaDeVencimiento: "2099-01-01", cantidad: "3" },
    { codigo: "B", fechaDeVencimiento: "2099-02-01", cantidad: "2" },
  );

  it("es distinta de la del mismo renglón sin lotes (no se puede confundir un pedido con otro)", () => {
    expect(huellaDe(con(base))).not.toBe(
      huellaDe([{ productoId: P, cantidad: "5", unidadId: "UNIDAD" }]),
    );
  });

  it("los mismos lotes en otro orden: la misma huella; cualquier lote, fecha o cantidad distinto: otra", () => {
    const referencia = huellaDe(con(base));
    expect(huellaDe(con([base[1] ?? {}, base[0] ?? {}]))).toBe(referencia);
    const B = { codigo: "B", fechaDeVencimiento: "2099-02-01" };
    const distintos = [
      lotes(
        { codigo: "A", fechaDeVencimiento: "2099-01-01", cantidad: "4" },
        { ...B, cantidad: "1" },
      ),
      lotes(
        { codigo: "A", fechaDeVencimiento: "2099-01-01", cantidad: "3.0001" },
        { ...B, cantidad: "1.9999" },
      ),
      lotes(
        { codigo: "A", fechaDeVencimiento: "2099-01-02", cantidad: "3" },
        { ...B, cantidad: "2" },
      ),
      lotes(
        { codigo: "C", fechaDeVencimiento: "2099-01-01", cantidad: "3" },
        { ...B, cantidad: "2" },
      ),
      lotes(
        { codigo: "a", fechaDeVencimiento: "2099-01-01", cantidad: "3" },
        { ...B, cantidad: "2" },
      ),
      lotes(
        {
          codigo: "A",
          fechaDeVencimiento: "2099-01-01",
          fechaDeElaboracion: "2098-01-01",
          cantidad: "3",
        },
        { ...B, cantidad: "2" },
      ),
      // Cruzar los vencimientos entre los lotes también es otro pedido.
      lotes(
        { codigo: "A", fechaDeVencimiento: "2099-02-01", cantidad: "3" },
        { codigo: "B", fechaDeVencimiento: "2099-01-01", cantidad: "2" },
      ),
    ];
    for (const d of distintos) expect(huellaDe(con(d)), JSON.stringify(d)).not.toBe(referencia);
  });

  it("con costo y con lotes: el costo también cuenta, y el texto de los lotes no se confunde con un costo", () => {
    const sinCosto = huellaDe(con(base));
    const conCosto = huellaDe(con(base, { costoUnitario: "10" }));
    expect(conCosto).not.toBe(sinCosto);
    expect(huellaDe(con(base, { costoUnitario: "11" }))).not.toBe(conCosto);
    expect(huellaDe(con(base, { costoUnitario: "10" }))).toBe(conCosto);
  });
});

describe("leerRenglones con lotes", () => {
  const renglon = (lotesDelRenglon: unknown) => [
    { productoId: P, cantidad: "5", unidadId: "UNIDAD", lotes: lotesDelRenglon },
  ];
  const buenos = [{ codigo: "A", fechaDeVencimiento: "2099-01-01", cantidad: "5" }];

  it("los lotes solo se admiten en una entrada: en cualquier otro movimiento son un pedido mal formado (no se ignoran)", () => {
    expect(leerRenglones(renglon(buenos), false, true).ok).toBe(true);
    expect(leerRenglones(renglon(buenos), false, false)).toEqual({
      ok: false,
      error: "RENGLONES_INVALIDOS",
    });
    expect(leerRenglones(renglon(buenos))).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
  });

  it("lotes que no suman el renglón frenan todo el pedido, aunque otros renglones estén bien", () => {
    const r = leerRenglones(
      [
        { productoId: Q, cantidad: "1", unidadId: "UNIDAD" },
        ...renglon([{ codigo: "A", fechaDeVencimiento: "2099-01-01", cantidad: "4" }]),
      ],
      false,
      true,
    );
    expect(r).toEqual({ ok: false, error: "RENGLONES_INVALIDOS" });
  });

  it("un renglón sin lotes queda con lotes `null`", () => {
    const r = leerRenglones([{ productoId: P, cantidad: "5", unidadId: "UNIDAD" }], false, true);
    expect(r.ok && r.valor[0]?.lotes).toBeNull();
  });
});

describe("resolverRenglones lleva los lotes a la unidad de stock", () => {
  const articulo = { id: "art-1", productoId: P, activo: true, unidadDeStockId: "GRAMO" };
  const tx = {
    articulosDeStock: { porProductos: () => Promise.resolve([articulo]) },
  } as never;
  const contexto = { empresaId: "e1" } as never;

  it("cada lote se convierte con la misma conversión exacta que el renglón y siguen sumando", async () => {
    const leidos = leerRenglones(
      [
        {
          productoId: P,
          cantidad: "3.5",
          unidadId: "KILOGRAMO",
          lotes: [
            { codigo: "A", fechaDeVencimiento: "2099-01-01", cantidad: "1" },
            { codigo: "B", fechaDeVencimiento: "2099-02-01", cantidad: "2.5" },
          ],
        },
      ],
      false,
      true,
    );
    if (!leidos.ok) throw new Error("renglones");
    const r = await resolverRenglones(tx, contexto, leidos.valor);
    expect(r.ok && r.valor[0]?.lotes?.map((l) => [l.codigo, l.cantidad])).toEqual([
      ["A", "1000.0000"],
      ["B", "2500.0000"],
    ]);
    expect(r.ok && r.valor[0]?.cantidad.unidades).toBe(35_000_000n);
  });
});

const cant = (t: string) => cantidadDesdeTexto(t);
const leidos = (
  filas: readonly (readonly [string, string | null, string | null, string])[],
): LoteLeido[] =>
  filas.map(([codigo, vence, elabora, cantidad]) => ({
    codigo,
    fechaDeVencimiento: vence,
    fechaDeElaboracion: elabora,
    cantidad: cant(cantidad),
  }));

describe("lotesDeLaEntrada", () => {
  const A1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  const A2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
  const DEP = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
  const resuelto = (articuloId: string, lotes: LoteLeido[] | null) => ({
    articuloId,
    lotes: lotes === null ? null : lotes.map((l) => ({ ...l, cantidad: "1.0000" })),
  });
  const tx = (controles: Record<string, { activo: boolean }>) =>
    ({
      lotesDeStock: {
        controlesDe: (_e: string, ids: readonly string[]) =>
          Promise.resolve(
            new Map(
              ids.flatMap((id) =>
                controles[id] === undefined ? [] : [[id, controles[id]] as const],
              ),
            ),
          ),
      },
    }) as never;
  const contexto = { empresaId: "e1" } as never;
  const unLote = leidos([["A", "2099-01-01", null, "1"]]);

  it("sin lotes en ningún renglón no devuelve nada: la entrada sigue como siempre", async () => {
    expect(await lotesDeLaEntrada(tx({}), contexto, DEP, [resuelto(A1, null)])).toEqual({
      ok: true,
      valor: undefined,
    });
  });

  it("con lotes en un artículo con control activo los entrega por depósito y artículo, pidiendo mismas fechas", async () => {
    const r = await lotesDeLaEntrada(tx({ [A1]: { activo: true } }), contexto, DEP, [
      resuelto(A1, unLote),
      resuelto(A2, null),
    ]);
    expect(r.ok && r.valor?.exigirMismasFechas).toBe(true);
    expect(r.ok && [...(r.valor?.entradas?.keys() ?? [])]).toEqual([`${DEP}|${A1}`]);
  });

  it("lotes en un artículo sin control (o con el control apagado) se rechazan: nunca se ignoran", async () => {
    for (const controles of [{}, { [A1]: { activo: false } }]) {
      const r = await lotesDeLaEntrada(tx(controles), contexto, DEP, [resuelto(A1, unLote)]);
      expect(r).toEqual({ ok: false, error: "LOTES_SIN_CONTROL" });
    }
  });

  it("el mismo artículo en dos renglones, con lotes en alguno, es ambiguo y se rechaza", async () => {
    const t = tx({ [A1]: { activo: true } });
    for (const renglones of [
      [resuelto(A1, unLote), resuelto(A1, null)],
      [resuelto(A1, unLote), resuelto(A1, unLote)],
    ]) {
      expect(await lotesDeLaEntrada(t, contexto, DEP, renglones)).toEqual({
        ok: false,
        error: "RENGLONES_INVALIDOS",
      });
    }
  });
});
