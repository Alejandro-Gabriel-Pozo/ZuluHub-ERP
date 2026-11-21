import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { sucursalId } from "../../src/primitivas/identificadores/marca";
import { crearBaseAparte, crearEmpresaActiva, crearEntornoDePrueba } from "./entorno";
import { sucursalDe } from "./fixtures-identidad";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * La migración 0086 (ADR-008 opción b, `BLOQUEAR` deja de ofrecerse) contra una base real. Se parte de la base ya migrada, se corre su reversión (vuelve a admitir `BLOQUEAR`),
 * se siembran filas con `BLOQUEAR` y se vuelve a aplicar: quedan `AVISAR` y la cuenta se informa; repetirla da lo mismo; después `BLOQUEAR` se rechaza; la reversión
 * vuelve a ampliar el CHECK sin tocar filas. Previene: una migración que deje filas `BLOQUEAR` sin convertir o que no angoste el CHECK.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const CONTROL = "stock.existencia_negativa";
const MIGRACION = "0086_niveles_de_control_sin_bloquear.sql";
const REVERSION = "reversiones/0086_revertir_niveles_de_control_sin_bloquear.sql";

describe.skipIf(base === null)("0086 niveles de control sin BLOQUEAR contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let entorno: ReturnType<typeof crearEntornoDePrueba>;
  let dueno: pg.Client;
  let sql: { migracion: string; reversion: string };
  const avisos: string[] = [];

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDePrueba(propia.base, 4);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    dueno.on("notice", (n) => avisos.push(n.message ?? ""));
    await dueno.connect();
    sql = {
      migracion: await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8"),
      reversion: await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8"),
    };
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const escenario = async () => {
    const { empresa } = await crearEmpresaActiva(entorno);
    const central = sucursalId(await sucursalDe(dueno, empresa));
    return { empresa, central };
  };
  const niveles = async (empresa: string) =>
    (
      await dueno.query<{ nivel: string; sucursal_id: string | null; version: number }>(
        "select nivel, sucursal_id, version from nivel_de_control where empresa_id = $1 order by sucursal_id nulls first",
        [empresa],
      )
    ).rows;
  const definicion = async () =>
    (
      await dueno.query<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = 'nivel_de_control_nivel_ck'",
      )
    ).rows[0]?.def ?? "";

  it("las filas BLOQUEAR pasan a AVISAR, la cuenta se informa, las demás no cambian, repetirla da lo mismo, BLOQUEAR se rechaza después y la reversión vuelve a ampliar el CHECK", async () => {
    await dueno.query(sql.reversion);
    expect(await definicion()).toContain("BLOQUEAR");
    const a = await escenario();
    const b = await escenario();
    const sembrar = (empresa: string, sucursal: string | null, control: string, nivel: string) =>
      dueno.query(
        "insert into nivel_de_control (empresa_id, sucursal_id, control, nivel) values ($1, $2, $3, $4)",
        [empresa, sucursal, control, nivel],
      );
    await sembrar(a.empresa, null, CONTROL, "BLOQUEAR");
    await sembrar(a.empresa, a.central, CONTROL, "PERMITIR");
    await sembrar(b.empresa, null, CONTROL, "BLOQUEAR");
    await sembrar(b.empresa, null, "caja.descuadre", "AVISAR");

    avisos.length = 0;
    await dueno.query(sql.migracion);
    expect(avisos.some((m) => m.includes("2 fila(s) con BLOQUEAR pasan a AVISAR"))).toBe(true);
    expect((await niveles(a.empresa)).map((f) => f.nivel)).toEqual(["AVISAR", "PERMITIR"]);
    expect((await niveles(b.empresa)).map((f) => f.nivel)).toEqual(["AVISAR", "AVISAR"]);
    expect((await niveles(a.empresa))[0]?.version).toBe(2);
    expect((await niveles(a.empresa))[1]?.version).toBe(1);
    expect(await definicion()).not.toContain("BLOQUEAR");

    // Repetirla no cambia nada: cuenta cero y las mismas filas.
    avisos.length = 0;
    await dueno.query(sql.migracion);
    expect(avisos.some((m) => m.includes("0 fila(s) con BLOQUEAR"))).toBe(true);
    expect((await niveles(a.empresa))[0]?.version).toBe(2);

    // Después de la migración, BLOQUEAR se rechaza.
    await expect(sembrar(a.empresa, a.central, "caja.otro", "BLOQUEAR")).rejects.toMatchObject({
      constraint: "nivel_de_control_nivel_ck",
    });

    // La reversión vuelve a admitir BLOQUEAR y no toca filas.
    await dueno.query(sql.reversion);
    expect(await definicion()).toContain("BLOQUEAR");
    expect((await niveles(b.empresa)).map((f) => f.nivel)).toEqual(["AVISAR", "AVISAR"]);
    await dueno.query(sql.migracion);
    expect(await definicion()).not.toContain("BLOQUEAR");
  });
});
