import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN } from "../../src/primitivas/tiempo/dias-de-la-politica-de-plan";
import { crearBaseAparte } from "./entorno";
import {
  asignarPlan,
  CARPETA_DE_MIGRACIONES,
  crearMundoDeMarca,
  crearPlanPublicado,
} from "./marcas-apoyo";

/**
 * La migración 0089 (política de cambio de plan, H-14a) contra una base real: deja la política 1 = 1, 1, 0; las tres tablas son de solo inserción; el tope de días
 * de la base es el de la primitiva (espejo); la base impone lo que el código también controla (versión consecutiva, cambio de origen CAMBIO, un solo arrepentimiento
 * por cambio); y la reversión borra solo lo suyo y se puede volver a aplicar. Previene: un tope que se desfasa entre el servidor y la base, o una tabla que admite
 * editar o borrar el historial.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

const MIGRACION = "0089_politica_de_cambio_de_plan.sql";
const REVERSION = "reversiones/0089_revertir_politica_de_cambio_de_plan.sql";
const TABLAS = [
  "politica_de_cambio_de_plan",
  "condiciones_de_cambio_de_plan",
  "arrepentimiento_de_plan",
] as const;

describe.skipIf(base === null)("0089 política de cambio de plan contra una base real", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let sql: { migracion: string; reversion: string };

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    sql = {
      migracion: await readFile(join(CARPETA_DE_MIGRACIONES, MIGRACION), "utf8"),
      reversion: await readFile(join(CARPETA_DE_MIGRACIONES, REVERSION), "utf8"),
    };
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const definicion = async (restriccion: string): Promise<string> => {
    const filas = (
      await dueno.query<{ d: string }>(
        "select pg_get_constraintdef(oid) as d from pg_constraint where conname = $1",
        [restriccion],
      )
    ).rows;
    expect(filas).toHaveLength(1);
    return filas[0]?.d ?? "";
  };
  const rechaza = async (texto: string, parametros: unknown[] = []): Promise<string> => {
    try {
      await dueno.query(texto, parametros);
    } catch (e) {
      return (e as { message: string }).message;
    }
    throw new Error(`tenía que rechazarse: ${texto}`);
  };

  it("deja la política 1 con 1, 1 y 0 días, definida por el sistema", async () => {
    expect(
      (
        await dueno.query(
          "select version, dias_de_anticipacion_de_suba, dias_de_anticipacion_de_baja, dias_de_arrepentimiento, definida_por from politica_de_cambio_de_plan",
        )
      ).rows,
    ).toEqual([
      {
        version: 1,
        dias_de_anticipacion_de_suba: 1,
        dias_de_anticipacion_de_baja: 1,
        dias_de_arrepentimiento: 0,
        definida_por: "sistema",
      },
    ]);
  });

  it("espejo: el tope de días de la base es exactamente el de la primitiva, y el mínimo es 0", async () => {
    for (const restriccion of [
      "politica_de_cambio_de_plan_suba_ck",
      "politica_de_cambio_de_plan_baja_ck",
      "politica_de_cambio_de_plan_arrepentimiento_ck",
    ]) {
      const texto = await definicion(restriccion);
      const tope = /<= (\d+)\)/.exec(texto);
      expect(tope, texto).not.toBeNull();
      expect(Number(tope?.[1])).toBe(MAXIMO_DE_DIAS_DE_LA_POLITICA_DE_PLAN);
      expect(texto).toContain(">= 0");
    }
  });

  it("la política es de solo inserción (sin UPDATE, DELETE ni TRUNCATE) y las otras dos no se vacían", async () => {
    expect(await rechaza("update politica_de_cambio_de_plan set creado_en = now()")).toMatch(
      /solo|insert|escri/i,
    );
    expect(await rechaza("delete from politica_de_cambio_de_plan")).toMatch(/solo|insert|escri/i);
    for (const tabla of TABLAS) {
      // La política la frena el disparador; las otras dos, además, la clave foránea (PostgreSQL no vacía una tabla referenciada).
      await rechaza(`truncate ${tabla}`);
    }
  });

  it("la versión de la política tiene que ser la siguiente, los días van de 0 a 365 y el motivo no puede estar vacío", async () => {
    const insertar = (version: number, suba: number, motivo = "m") =>
      dueno.query(
        "insert into politica_de_cambio_de_plan (version, dias_de_anticipacion_de_suba, dias_de_anticipacion_de_baja, dias_de_arrepentimiento, motivo, definida_por) values ($1, $2, 1, 0, $3, 'sistema')",
        [version, suba, motivo],
      );
    await expect(insertar(1, 1)).rejects.toThrow(/versión de la política/);
    await expect(insertar(5, 1)).rejects.toThrow(/versión de la política/);
    await expect(insertar(2, 366)).rejects.toThrow(/politica_de_cambio_de_plan_suba_ck/);
    await expect(insertar(2, -1)).rejects.toThrow(/politica_de_cambio_de_plan_suba_ck/);
    await expect(insertar(2, 1, "  ")).rejects.toThrow(/politica_de_cambio_de_plan_motivo_ck/);
    await insertar(2, 365);
    expect(
      (await dueno.query<{ n: string }>("select count(*) as n from politica_de_cambio_de_plan"))
        .rows[0]?.n,
    ).toBe("2");
  });

  it("las condiciones y el arrepentimiento solo existen para un cambio de origen CAMBIO, y un cambio se arrepiente una sola vez", async () => {
    const { tenant } = await crearMundoDeMarca(dueno);
    const { version } = await crearPlanPublicado(dueno, { modulos: [] });
    const alta = await asignarPlan(dueno, tenant, version, { origen: "ALTA" });
    const cambio = await asignarPlan(dueno, tenant, version, { origen: "CAMBIO" });
    const vuelta = await asignarPlan(dueno, tenant, version, { origen: "CAMBIO" });
    const condiciones = (numero: number, sentido = "SUBA") =>
      dueno.query(
        "insert into condiciones_de_cambio_de_plan (tenant_id, numero, sentido, politica_version) values ($1, $2, $3, 1)",
        [tenant, numero, sentido],
      );
    await expect(condiciones(alta)).rejects.toThrow(/origen CAMBIO/);
    await expect(condiciones(cambio, "MIXTO")).rejects.toThrow(
      /condiciones_de_cambio_de_plan_sentido_ck/,
    );
    await expect(condiciones(99)).rejects.toThrow(/condiciones_de_cambio_de_plan_cambio_fkey/);
    await condiciones(cambio);
    await expect(condiciones(cambio)).rejects.toThrow(/condiciones_de_cambio_de_plan_pkey/);

    const arrepentir = (arrepentido: number, nuevo: number) =>
      dueno.query(
        "insert into arrepentimiento_de_plan (tenant_id, numero_arrepentido, numero_nuevo, motivo, registrado_por) values ($1, $2, $3, 'm', 'sistema')",
        [tenant, arrepentido, nuevo],
      );
    await expect(arrepentir(alta, cambio)).rejects.toThrow(/origen CAMBIO/);
    await expect(arrepentir(vuelta, cambio)).rejects.toThrow(/arrepentimiento_de_plan_orden_ck/);
    await arrepentir(cambio, vuelta);
    await expect(arrepentir(cambio, vuelta)).rejects.toThrow(/arrepentimiento_de_plan_pkey/);
    // Con filas, las dos tablas tampoco admiten editar ni borrar: se corrige con otra fila, nunca con una edición.
    for (const tabla of ["condiciones_de_cambio_de_plan", "arrepentimiento_de_plan"]) {
      expect(await rechaza(`update ${tabla} set creado_en = now()`)).toMatch(/solo|insert|escri/i);
      expect(await rechaza(`delete from ${tabla}`)).toMatch(/solo|insert|escri/i);
    }
  });

  it("la reversión borra solo las tres tablas nuevas (plan_de_tenant queda), se puede repetir, y la migración se vuelve a aplicar limpia con la política 1", async () => {
    const asignaciones = async (): Promise<number> =>
      Number(
        (await dueno.query<{ n: string }>("select count(*) as n from plan_de_tenant")).rows[0]?.n,
      );
    const antes = await asignaciones();
    expect(antes).toBeGreaterThan(0);
    await dueno.query(sql.reversion);
    await dueno.query(sql.reversion);
    for (const tabla of TABLAS) {
      expect(
        (
          await dueno.query<{ t: string | null }>("select to_regclass($1) as t", [
            `public.${tabla}`,
          ])
        ).rows[0]?.t,
      ).toBeNull();
    }
    expect(
      (
        await dueno.query<{ n: number }>(
          "select count(*)::int as n from pg_proc where proname in ('cambio_de_plan_validar_origen', 'politica_de_cambio_de_plan_validar_alta')",
        )
      ).rows[0]?.n,
    ).toBe(0);
    expect(await asignaciones()).toBe(antes);
    await dueno.query(sql.migracion);
    expect(
      (
        await dueno.query(
          "select version, dias_de_anticipacion_de_suba as suba, dias_de_anticipacion_de_baja as baja, dias_de_arrepentimiento as arrepentimiento from politica_de_cambio_de_plan",
        )
      ).rows,
    ).toEqual([{ version: 1, suba: 1, baja: 1, arrepentimiento: 0 }]);
  });
});
