import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { fechaDeNegocio } from "../../src/primitivas/tiempo/fecha-de-negocio";
import { crearBaseAparte } from "./entorno";
import { acepta, check, conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import {
  HUELLA,
  ZONA,
  asegurarJornada,
  claveNueva,
  crearEscenario,
  type Escenario,
} from "./caja-apoyo";
import type { SesionDePrueba } from "./sesiones";

/**
 * La fecha de negocio (e3 §3.4 y §5.1 #5): la función de la base `fecha_de_negocio` (que usa el disparador del sello de la sesión) da lo mismo
 * que `fechaDeNegocio` de TypeScript (`primitivas/tiempo`) en más de diez mil instantes —con cortes 00:00, 05:30, 06:00 y 23:59, los bordes
 * exactos (05:59:59.999 y 06:00:00.000) y zonas con horario de verano—, y la base rechaza un sello que no es el que da la fórmula.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

/** Generador congruencial determinista (la prueba no usa azar real: los fallos tienen que reproducirse). */
function semilla(inicial: number): () => number {
  let x = inicial >>> 0;
  return () => {
    x = (Math.imul(x, 1664525) + 1013904223) >>> 0;
    return x / 0x1_0000_0000;
  };
}

const CORTES = ["00:00", "05:30", "06:00", "23:59"] as const;
const MS_POR_DIA = 86_400_000;

describe.skipIf(base === null)("fecha de negocio: TypeScript y base dan lo mismo", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  /** Compara `instantes` (en ms) para una zona y un corte: devuelve los que difieren. */
  const diferencias = async (
    instantes: readonly number[],
    zona: string,
    corte: string,
  ): Promise<string[]> => {
    const { rows } = await dueno.query<{ f: string }>(
      `select fecha_de_negocio(t, $2, $3::time)::text as f
         from unnest($1::timestamptz[]) with ordinality as u(t, n) order by n`,
      [instantes.map((i) => new Date(i).toISOString()), zona, corte],
    );
    expect(rows).toHaveLength(instantes.length);
    const malos: string[] = [];
    instantes.forEach((i, k) => {
      const ts = fechaDeNegocio(new Date(i), zona, corte);
      const enTs = ts.ok ? ts.valor : `error ${ts.error}`;
      if (enTs !== rows[k]?.f)
        malos.push(`${new Date(i).toISOString()} ${zona} ${corte}: TS ${enTs} / SQL ${rows[k]?.f}`);
    });
    return malos;
  };

  it("diez mil instantes al azar (2020 a 2032) con cada corte, en Buenos Aires: mismos resultados", async () => {
    const azar = semilla(20261109);
    const desde = Date.parse("2020-01-01T00:00:00Z");
    const hasta = Date.parse("2032-01-01T00:00:00Z");
    let total = 0;
    for (const corte of CORTES) {
      const instantes = Array.from({ length: 2_600 }, () =>
        Math.floor(desde + azar() * (hasta - desde)),
      );
      expect(await diferencias(instantes, ZONA, corte)).toEqual([]);
      total += instantes.length;
    }
    expect(total).toBeGreaterThanOrEqual(10_000);
  });

  it("los bordes exactos: un milisegundo antes del corte es la jornada anterior; en el corte, la nueva (cien días por corte)", async () => {
    for (const corte of CORTES) {
      const [h, mi] = corte.split(":").map(Number) as [number, number];
      const instantes: number[] = [];
      for (let dia = 0; dia < 100; dia++) {
        // Buenos Aires es UTC−3 todo el año: el corte local `h:mi` es `h+3:mi` UTC.
        const corteUtc = Date.UTC(2026, 0, 1 + dia, h + 3, mi, 0, 0);
        instantes.push(corteUtc - 1, corteUtc, corteUtc + 1, corteUtc - 60_000, corteUtc + 60_000);
      }
      expect(await diferencias(instantes, ZONA, corte)).toEqual([]);
      // Y el resultado es el esperado en sí (no solo coincidente): 05:59:59.999 con corte 06:00 es el día anterior.
      if (corte === "06:00") {
        const antes = fechaDeNegocio(new Date("2026-11-10T08:59:59.999Z"), ZONA, corte);
        const justo = fechaDeNegocio(new Date("2026-11-10T09:00:00.000Z"), ZONA, corte);
        expect(antes).toEqual({ ok: true, valor: "2026-11-09" });
        expect(justo).toEqual({ ok: true, valor: "2026-11-10" });
      }
    }
  });

  it("también con zonas de horario de verano y de media hora, y con un corte dentro del salto de horario (la fórmula es general)", async () => {
    const azar = semilla(7);
    const desde = Date.parse("2024-01-01T00:00:00Z");
    const hasta = Date.parse("2028-01-01T00:00:00Z");
    for (const zona of [
      "UTC",
      "America/New_York",
      "Europe/Madrid",
      "Asia/Kolkata",
      "Pacific/Auckland",
    ]) {
      for (const corte of ["00:00", "02:30", "06:00", "23:59"]) {
        const instantes = Array.from({ length: 500 }, () =>
          Math.floor(desde + azar() * (hasta - desde)),
        );
        // Una grilla de cinco minutos sobre los dos días de cambio de hora de Nueva York de 2026.
        for (const dia of [Date.UTC(2026, 2, 8), Date.UTC(2026, 10, 1)]) {
          for (let t = dia; t < dia + 2 * MS_POR_DIA; t += 5 * 60_000) instantes.push(t);
        }
        expect(await diferencias(instantes, zona, corte)).toEqual([]);
      }
    }
  });

  describe("el sello de la sesión lo verifica la base con la misma fórmula", () => {
    const insertar = (
      s: SesionDePrueba,
      mundo: Mundo,
      e: Escenario,
      c: { fecha: string; corte: string; abiertaEn: string },
    ) =>
      s.intentar(
        `insert into sesion_caja (empresa_id, caja_id, fecha_negocio, hora_de_corte, zona_horaria, abierta_en, abierta_por,
                                 clave_idempotencia, huella)
         values ($1, $2, $3, $4::time, $5, $6, $7, $8, $9)`,
        [
          mundo.empresa,
          e.caja,
          c.fecha,
          c.corte,
          ZONA,
          c.abiertaEn,
          mundo.persona,
          claveNueva(),
          HUELLA,
        ],
      );
    const diaMas = (fecha: string, n: number): string =>
      new Date(Date.parse(`${fecha}T00:00:00Z`) + n * MS_POR_DIA).toISOString().slice(0, 10);

    it("con cada corte, los instantes de borde toman la fecha que da TypeScript; la de un día antes o después se rechaza", async () => {
      for (const corte of CORTES) {
        const mundo = await crearMundo(dueno);
        const e = await crearEscenario(dueno, mundo);
        await dueno.query("update sucursal set hora_de_corte = $2::time where id = $1", [
          mundo.sucursal,
          corte,
        ]);
        const [h, mi] = corte.split(":").map(Number) as [number, number];
        const corteUtc = Date.UTC(2026, 10, 10, h + 3, mi, 0, 0);
        await conAppDe(propia.base, mundo, async (s) => {
          for (const instante of [
            corteUtc - 1,
            corteUtc,
            corteUtc + 1,
            corteUtc - 3_600_000,
            corteUtc + 3_600_000,
          ]) {
            const abiertaEn = new Date(instante).toISOString();
            const ts = fechaDeNegocio(new Date(instante), ZONA, corte);
            expect(ts.ok).toBe(true);
            const fecha = ts.ok ? ts.valor : "";
            for (const f of [fecha, diaMas(fecha, -1), diaMas(fecha, 1)])
              await asegurarJornada(s, mundo, f);
            check(
              await insertar(s, mundo, e, { fecha: diaMas(fecha, -1), corte, abiertaEn }),
              "sesion_caja_fecha_negocio_invalida",
            );
            check(
              await insertar(s, mundo, e, { fecha: diaMas(fecha, 1), corte, abiertaEn }),
              "sesion_caja_fecha_negocio_invalida",
            );
            acepta(await s.directo("savepoint dentro"));
            acepta(await insertar(s, mundo, e, { fecha, corte, abiertaEn }));
            acepta(await s.directo("rollback to savepoint dentro"));
          }
        });
      }
    });

    it("cambiar la hora de corte no cambia las sesiones existentes: sesión abierta con 00:00, se cambia a 06:00 y se cobra a la 01:30: todo cae en el sello de la apertura", async () => {
      const mundo = await crearMundo(dueno);
      const e = await crearEscenario(dueno, mundo);
      // Abre a las 20:00 del 09/11 con corte 00:00: jornada 09/11 (sello 00:00).
      const abierta = "2026-11-09T23:00:00Z"; // 20:00 en Buenos Aires
      let sesion = "";
      await conAppDe(propia.base, mundo, async (s) => {
        await asegurarJornada(s, mundo, "2026-11-09");
        acepta(
          await insertar(s, mundo, e, { fecha: "2026-11-09", corte: "00:00", abiertaEn: abierta }),
        );
        const r = await s.intentar("select id from sesion_caja where empresa_id = $1", [
          mundo.empresa,
        ]);
        sesion = r.ok ? String(r.rows[0]?.["id"]) : "";
        expect((await s.confirmar()).ok).toBe(true);
      });
      // El gerente cambia el corte a 06:00; a la 01:30 del 10/11 entra un cobro en la sesión abierta: la sesión conserva su sello.
      await dueno.query("update sucursal set hora_de_corte = '06:00' where id = $1", [
        mundo.sucursal,
      ]);
      const { rows } = await dueno.query<{ f: string; corte: string }>(
        "select fecha_negocio::text as f, hora_de_corte::text as corte from sesion_caja where id = $1",
        [sesion],
      );
      expect(rows).toEqual([{ f: "2026-11-09", corte: "00:00:00" }]);
      // Un cobro a la 01:30 (04:30Z) con el corte nuevo caería en el 09/11; con el sello viejo (00:00) caería en el 10/11: la sesión manda.
      const nuevo = fechaDeNegocio(new Date("2026-11-10T04:30:00Z"), ZONA, "06:00");
      const viejo = fechaDeNegocio(new Date("2026-11-10T04:30:00Z"), ZONA, "00:00");
      expect(nuevo).toEqual({ ok: true, valor: "2026-11-09" });
      expect(viejo).toEqual({ ok: true, valor: "2026-11-10" });
      // Y la inversa: una sesión nueva sí toma el corte nuevo.
      await conAppDe(propia.base, mundo, async (s) => {
        await asegurarJornada(s, mundo, "2026-11-09");
        check(
          await insertar(s, mundo, e, {
            fecha: "2026-11-10",
            corte: "00:00",
            abiertaEn: "2026-11-10T04:30:00Z",
          }),
          "sesion_caja_sello_invalido",
        );
      });
    });
  });
});
