import { describe, expect, it } from "vitest";
import {
  empresaId,
  personaId,
  sucursalId,
  type SucursalId,
} from "../../primitivas/identificadores/marca";
import { fechaCivilDesdeTexto } from "../../primitivas/tiempo/fecha-civil";
import { controlesDelAporte, MAXIMO_DE_REFERENCIAS, type JornadaRef } from "../cierre/publico";
import { aporteDeStock, CONTROLES_DE_STOCK, type TxDeAporteDeStock } from "./aporte-al-cierre";
import type { Conteo } from "./persistencia/modelo";
import type { LoteGuardado } from "./persistencia/repositorio-de-lotes";

/**
 * El aporte de stock al cierre del día (E5-T8): dos controles `INFORMA`, sin impedimentos y sin escritura. Con repositorios falsos que devuelven
 * lo que se les arma: lo que se prueba es qué se pregunta (la sucursal de la jornada), cómo se cuenta y cómo se resume.
 */

const SUCURSAL = sucursalId("22222222-2222-4222-8222-222222222222");
const jornada = (sucursal: SucursalId = SUCURSAL): JornadaRef => {
  const fecha = fechaCivilDesdeTexto("2026-11-10");
  if (!fecha.ok) throw new Error("fecha de prueba inválida");
  return {
    empresaId: empresaId("11111111-1111-4111-8111-111111111111"),
    sucursalId: sucursal,
    fechaDeNegocio: fecha.valor,
  };
};

const conteo = (id: string): Conteo => ({
  id,
  depositoId: "d0000000-0000-4000-8000-000000000001",
  estado: "ABIERTO",
  abiertoPor: personaId("33333333-3333-4333-8333-333333333333"),
  abiertoEn: new Date("2026-11-10T10:00:00Z"),
  resueltoPor: null,
  resueltoEn: null,
  motivo: null,
  version: 1,
});

type Datos = Readonly<{
  conteos?: readonly string[];
  negativas?: readonly Readonly<{ deposito: string; articulo: string; existencia: string }>[];
  /** Si el total es mayor que lo listado (más filas que el tope de referencias). */
  totalDeConteos?: number;
  totalDeNegativas?: number;
  /** Saldos de lote con existencia: (vencimiento o null, existencia). */
  lotes?: readonly Readonly<{ vence: string | null; existencia: string }>[];
}>;

/** Los repositorios falsos y lo que les preguntaron. */
function conDatos(datos: Datos = {}) {
  const preguntas: unknown[] = [];
  const tx: TxDeAporteDeStock = {
    conteosDeStock: {
      listar: (empresa, filtro) => {
        preguntas.push(["listar", empresa, filtro]);
        return Promise.resolve((datos.conteos ?? []).map(conteo));
      },
      contarAbiertosDe: (empresa, sucursal) => {
        preguntas.push(["contarAbiertosDe", empresa, sucursal]);
        return Promise.resolve(datos.totalDeConteos ?? (datos.conteos ?? []).length);
      },
    },
    movimientosDeStock: {
      existencias: (empresa, filtro) => {
        preguntas.push(["existencias", empresa, filtro]);
        return Promise.resolve(
          (datos.negativas ?? []).map((n) => ({
            articuloId: n.articulo,
            productoId: "p",
            nombre: "n",
            nombreClave: "n",
            unidadId: "UNIDAD",
            depositoId: n.deposito,
            sucursalId: SUCURSAL,
            existencia: n.existencia,
            uso: "NORMAL" as const,
          })),
        );
      },
      contarNegativasDe: (empresa, sucursal) => {
        preguntas.push(["contarNegativasDe", empresa, sucursal]);
        return Promise.resolve(datos.totalDeNegativas ?? (datos.negativas ?? []).length);
      },
    },
    lotesDeStock: {
      saldosDeLote: (empresa, filtro) => {
        preguntas.push(["saldosDeLote", empresa, filtro]);
        return Promise.resolve(
          (datos.lotes ?? []).map((l, i) => ({
            lote: {
              id: `bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb0${i}`,
              fechaDeVencimiento: l.vence,
            } as LoteGuardado,
            depositoId: "d1",
            sucursalId: SUCURSAL,
            uso: "NORMAL" as const,
            existencia: l.existencia,
          })),
        );
      },
    },
  };
  return { tx, preguntas };
}

const LIBRE = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1";
const OTRO = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2";

describe("aporteDeStock", () => {
  it("es el aporte del módulo stock: sin impedimentos y sin efecto al congelar", async () => {
    expect(aporteDeStock.modulo).toBe("stock");
    expect(await aporteDeStock.impedimentos(conDatos().tx, jornada())).toEqual({
      ok: true,
      valor: [],
    });
    expect(await aporteDeStock.congelarEnTx(conDatos().tx, {} as never, jornada(), [])).toEqual({
      ok: true,
      valor: null,
    });
  });

  it("los dos controles son INFORMA, con la clave de stock, y cumplen el contrato que `cierre` exige de un aporte", async () => {
    const r = await aporteDeStock.controles(conDatos().tx, jornada());
    expect(r.ok).toBe(true);
    const controles = r.ok ? r.valor : [];
    expect(controles.map((c) => [c.modulo, c.clave, c.severidad, c.cantidad])).toEqual([
      ["stock", CONTROLES_DE_STOCK.CONTEOS_ABIERTOS, "INFORMA", 0],
      ["stock", CONTROLES_DE_STOCK.EXISTENCIAS_NEGATIVAS, "INFORMA", 0],
      ["stock", CONTROLES_DE_STOCK.LOTES_VENCIDOS_CON_EXISTENCIA, "INFORMA", 0],
    ]);
    expect(CONTROLES_DE_STOCK).toEqual({
      CONTEOS_ABIERTOS: "stock.conteos_abiertos",
      EXISTENCIAS_NEGATIVAS: "stock.existencias_negativas",
      LOTES_VENCIDOS_CON_EXISTENCIA: "stock.lotes_vencidos_con_existencia",
    });
    expect(controlesDelAporte("stock", controles).ok).toBe(true);
  });

  it("pregunta por la sucursal de la jornada y de la empresa: conteos ABIERTOS de esa sucursal y saldos negativos de sus depósitos", async () => {
    const { tx, preguntas } = conDatos({ conteos: [LIBRE] });
    const j = jornada();
    await aporteDeStock.controles(tx, j);
    expect(preguntas).toContainEqual([
      "listar",
      j.empresaId,
      { alcance: [SUCURSAL], estado: "ABIERTO", limite: MAXIMO_DE_REFERENCIAS },
    ]);
    expect(preguntas).toContainEqual(["contarAbiertosDe", j.empresaId, SUCURSAL]);
    expect(preguntas).toContainEqual([
      "existencias",
      j.empresaId,
      {
        alcance: "TODAS",
        sucursalId: SUCURSAL,
        soloNegativas: true,
        limite: MAXIMO_DE_REFERENCIAS,
      },
    ]);
    expect(preguntas).toContainEqual(["contarNegativasDe", j.empresaId, SUCURSAL]);
    expect(preguntas).toContainEqual([
      "saldosDeLote",
      j.empresaId,
      { alcance: "TODAS", sucursalId: SUCURSAL, conExistencia: true },
    ]);
    expect(preguntas).toHaveLength(5);
  });

  it("cuenta el total exacto, aunque se muestren menos filas, y las referencias son las del detalle (conteo y existencia)", async () => {
    const { tx } = conDatos({
      conteos: [LIBRE, OTRO],
      totalDeConteos: 120,
      negativas: [{ deposito: "d1", articulo: "a1", existencia: "-2.0000" }],
      totalDeNegativas: 3,
    });
    const r = await aporteDeStock.controles(tx, jornada());
    const [abiertos, negativas] = r.ok ? r.valor : [];
    expect(abiertos).toMatchObject({
      cantidad: 120,
      referencias: [`stock.conteo:${LIBRE}`, `stock.conteo:${OTRO}`],
    });
    expect(negativas).toMatchObject({
      cantidad: 3,
      referencias: ["stock.existencia:d1:a1"],
    });
  });

  it("es determinista y la huella cambia con el total, con una fila o con su dato; el orden de los controles es el mismo siempre", async () => {
    const huellas = async (datos: Datos) => {
      const r = await aporteDeStock.controles(conDatos(datos).tx, jornada());
      return (r.ok ? r.valor : []).map((c) => c.huellaDelDetalle);
    };
    const base: Datos = {
      conteos: [LIBRE],
      negativas: [{ deposito: "d1", articulo: "a1", existencia: "-2.0000" }],
    };
    const igual = await huellas(base);
    expect(await huellas(base)).toEqual(igual);
    expect(igual[0]).toMatch(/^[0-9a-f]{64}$/);
    expect(igual[0]).not.toBe(igual[1]);
    // Otro conteo abierto: cambia solo la huella del primero.
    const otroConteo = await huellas({ ...base, conteos: [OTRO] });
    expect(otroConteo[0]).not.toBe(igual[0]);
    expect(otroConteo[1]).toBe(igual[1]);
    // El mismo saldo con otra existencia, o con otro total: cambia solo la huella del segundo.
    const otraExistencia = await huellas({
      ...base,
      negativas: [{ deposito: "d1", articulo: "a1", existencia: "-3.0000" }],
    });
    expect(otraExistencia[0]).toBe(igual[0]);
    expect(otraExistencia[1]).not.toBe(igual[1]);
    const masTotal = await huellas({ ...base, totalDeNegativas: 2 });
    expect(masTotal[1]).not.toBe(igual[1]);
    expect(masTotal[0]).toBe(igual[0]);
    const masConteos = await huellas({ ...base, totalDeConteos: 2 });
    expect(masConteos[0]).not.toBe(igual[0]);
  });

  it("lotes vencidos con existencia: vence antes de la fecha de negocio (vence ese día todavía vale), con existencia positiva; sin vencimiento o en negativo no cuenta", async () => {
    const { tx } = conDatos({
      lotes: [
        { vence: "2026-11-09", existencia: "3.0000" },
        { vence: "2026-11-10", existencia: "5.0000" },
        { vence: "2026-11-11", existencia: "1.0000" },
        { vence: null, existencia: "2.0000" },
        { vence: "2026-11-01", existencia: "-1.0000" },
        { vence: "2026-10-31", existencia: "4.0000" },
      ],
    });
    const r = await aporteDeStock.controles(tx, jornada());
    const vencidos = (r.ok ? r.valor : [])[2];
    expect(vencidos).toMatchObject({
      clave: CONTROLES_DE_STOCK.LOTES_VENCIDOS_CON_EXISTENCIA,
      severidad: "INFORMA",
      cantidad: 2,
      referencias: [
        "stock.lote:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb00:d1",
        "stock.lote:bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbb05:d1",
      ],
    });
    expect(
      await aporteDeStock.hayMovimiento(
        conDatos({ lotes: [{ vence: "2026-11-09", existencia: "3.0000" }] }).tx,
        jornada(),
      ),
    ).toEqual({ ok: true, valor: true });
  });

  it("lotes vencidos: el total es exacto y las referencias llegan hasta el tope", async () => {
    const lotes = Array.from({ length: MAXIMO_DE_REFERENCIAS + 5 }, () => ({
      vence: "2026-11-01",
      existencia: "1.0000",
    }));
    const r = await aporteDeStock.controles(conDatos({ lotes }).tx, jornada());
    const vencidos = (r.ok ? r.valor : [])[2];
    expect(vencidos?.cantidad).toBe(MAXIMO_DE_REFERENCIAS + 5);
    expect(vencidos?.referencias).toHaveLength(MAXIMO_DE_REFERENCIAS);
  });

  it("hayMovimiento (decisión 178): hay algo de stock para revisar si algún control tiene filas; sin nada, no", async () => {
    expect(await aporteDeStock.hayMovimiento(conDatos().tx, jornada())).toEqual({
      ok: true,
      valor: false,
    });
    expect(await aporteDeStock.hayMovimiento(conDatos({ conteos: [LIBRE] }).tx, jornada())).toEqual(
      {
        ok: true,
        valor: true,
      },
    );
    expect(
      await aporteDeStock.hayMovimiento(
        conDatos({ negativas: [{ deposito: "d", articulo: "a", existencia: "-1.0000" }] }).tx,
        jornada(),
      ),
    ).toEqual({ ok: true, valor: true });
  });

  it("si una lectura falla, el aporte no está disponible (falla cerrado): el día no se cierra con un dato que no se pudo leer", async () => {
    const { tx } = conDatos();
    const roto: TxDeAporteDeStock = {
      ...tx,
      movimientosDeStock: {
        ...tx.movimientosDeStock,
        contarNegativasDe: () => Promise.reject(new Error("la base no responde")),
      },
    };
    expect(await aporteDeStock.controles(roto, jornada())).toEqual({
      ok: false,
      error: "APORTE_NO_DISPONIBLE",
    });
    expect(await aporteDeStock.hayMovimiento(roto, jornada())).toEqual({
      ok: false,
      error: "APORTE_NO_DISPONIBLE",
    });
  });
});
