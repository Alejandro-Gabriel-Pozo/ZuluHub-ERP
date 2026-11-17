import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { ORIGENES_DE_EGRESO, ORIGENES_DE_INGRESO } from "../../src/modulos/caja/publico";
import { acepta, check, clave, conAppDe, crearMundo, type Mundo } from "./fiscal-apoyo";
import {
  AHORA,
  HUELLA,
  abrirSesion,
  claveNueva,
  crearEscenario,
  movimiento,
  type Escenario,
} from "./caja-apoyo";
import { crearBaseAparte } from "./entorno";
import type { BaseDePruebas } from "./global";
import type { SesionDePrueba } from "./sesiones";

/**
 * Migración 0072 (LB-5b) contra una base real. Bloque 1 (aprobado 17/11/2026): un movimiento no se anula a sí mismo. Bloque 2 (pendiente de aprobación): `origen_tipo` y `origen_id`
 * nulables en `movimiento_caja`, con su forma, su lista cerrada (paridad con `origen-de-movimiento.ts`), su sentido contra la clase y un movimiento por origen y empresa; la reversión
 * frena si hay movimientos con origen, se puede repetir y reaplicar la migración vuelve a dejar todo.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const CARPETA = join(import.meta.dirname, "../../migraciones");
const MIGRACION = "0072_caja_origen_y_anulacion_distinta.sql";
const REVERSION = join(CARPETA, "reversiones/0072_revertir_caja_origen_y_anulacion_distinta.sql");

/** Inserta un movimiento de efectivo con origen (los demás campos como el apoyo de caja). */
const conOrigen = (
  s: SesionDePrueba,
  esc: Escenario,
  sesion: string,
  d: {
    clase: string;
    importe: string;
    tipo: string | null;
    id: string | null;
    clave?: string;
    empresa?: string;
  },
) =>
  s.intentar(
    `insert into movimiento_caja (empresa_id, sesion_id, clase, medio_de_pago_id, importe, motivo, registrado_en, registrado_por,
                                  clave_idempotencia, huella, origen_tipo, origen_id)
     values ($1, $2, $3, $4, $5, 'Motivo', $6, $7, $8, $9, $10, $11) returning id`,
    [
      d.empresa ?? esc.m.empresa,
      sesion,
      d.clase,
      esc.medios.EFECTIVO,
      d.importe,
      AHORA,
      esc.m.persona,
      d.clave ?? claveNueva(),
      HUELLA,
      d.tipo,
      d.id,
    ],
  );

describe.skipIf(base === null)("migración 0072: origen en caja y anulación distinta", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let m: Mundo;
  let otra: Mundo;
  let esc: Escenario;
  let escOtra: Escenario;
  const b = () => propia.base;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    otra = await crearMundo(dueno);
    esc = await crearEscenario(dueno, m);
    escOtra = await crearEscenario(dueno, otra);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  it("bloque 1: un movimiento no puede anularse a sí mismo (restricción movimiento_caja_anula_distinta_ck)", async () => {
    // La aplicación no puede elegir el `id` (no está en su permiso de alta), así que solo el dueño de la base podría armar esa fila: es una defensa de la base, como en stock (0030).
    // Con su propia empresa: la sesión queda confirmada y la caja ya no admite otra abierta.
    const propio = await crearMundo(dueno);
    const escPropio = await crearEscenario(dueno, propio);
    let sesion = "";
    await conAppDe(b(), propio, async (s) => {
      sesion = (await abrirSesion(s, escPropio)).sesion;
      await s.confirmar();
    });
    const id = randomUUID();
    // Ni el dueño llega hasta la restricción por el camino normal (el disparador de alta exige a la persona del contexto): se lo apaga SOLO en esta transacción, que se deshace.
    await dueno.query("begin");
    try {
      await dueno.query("alter table movimiento_caja disable trigger movimiento_caja_alta");
      await expect(
        dueno.query(
          `insert into movimiento_caja (id, empresa_id, sesion_id, clase, medio_de_pago_id, importe, motivo, anula_a, registrado_en, registrado_por,
                                        clave_idempotencia, huella)
           values ($1, $2, $3, 'ANULACION', $4, -5.00, 'Se anula solo', $1, $5, $6, $7, $8)`,
          [
            id,
            propio.empresa,
            sesion,
            escPropio.medios.EFECTIVO,
            AHORA,
            propio.persona,
            claveNueva(),
            HUELLA,
          ],
        ),
      ).rejects.toMatchObject({ constraint: "movimiento_caja_anula_distinta_ck" });
    } finally {
      await dueno.query("rollback");
    }
  });

  it("bloque 1: la anulación de OTRO movimiento sigue valiendo", async () => {
    await conAppDe(b(), m, async (s) => {
      const { sesion } = await abrirSesion(s, esc);
      const ingreso = await movimiento(s, esc, sesion, {
        clase: "INGRESO_MANUAL",
        medio: "EFECTIVO",
        importe: "5.00",
        motivo: "Cambio",
      });
      acepta(ingreso);
      const id = String(ingreso.ok ? ingreso.rows[0]?.["id"] : "");
      acepta(
        await movimiento(s, esc, sesion, {
          clase: "ANULACION",
          medio: "EFECTIVO",
          importe: "-5.00",
          motivo: "Error de carga",
          anulaA: id,
        }),
      );
    });
  });

  it("bloque 2: las columnas son nulables: lo que no tiene origen sigue igual (el fondo y los movimientos de siempre)", async () => {
    await conAppDe(b(), m, async (s) => {
      const { sesion } = await abrirSesion(s, esc);
      acepta(
        await movimiento(s, esc, sesion, {
          clase: "INGRESO_MANUAL",
          medio: "EFECTIVO",
          importe: "5.00",
          motivo: "Cambio",
        }),
      );
      acepta(
        await conOrigen(s, esc, sesion, {
          clase: "INGRESO_MANUAL",
          importe: "7.00",
          tipo: null,
          id: null,
        }),
      );
    });
  });

  it("bloque 2: cada origen de la lista se guarda con su sentido (egreso o ingreso manual)", async () => {
    await conAppDe(b(), m, async (s) => {
      const { sesion } = await abrirSesion(s, esc);
      for (const tipo of ORIGENES_DE_EGRESO) {
        acepta(
          await conOrigen(s, esc, sesion, {
            clase: "EGRESO_MANUAL",
            importe: "-5.00",
            tipo,
            id: randomUUID(),
          }),
        );
      }
      for (const tipo of ORIGENES_DE_INGRESO) {
        acepta(
          await conOrigen(s, esc, sesion, {
            clase: "INGRESO_MANUAL",
            importe: "5.00",
            tipo,
            id: randomUUID(),
          }),
        );
      }
    });
  });

  it("bloque 2: el tipo y el id van juntos, el tipo es de la lista cerrada y el sentido coincide con la clase", async () => {
    await conAppDe(b(), m, async (s) => {
      const { sesion } = await abrirSesion(s, esc);
      const e = { clase: "EGRESO_MANUAL", importe: "-5.00" };
      const i = { clase: "INGRESO_MANUAL", importe: "5.00" };
      check(
        await conOrigen(s, esc, sesion, { ...e, tipo: "PAGO_A_PROVEEDOR", id: null }),
        "movimiento_caja_origen_par_ck",
      );
      check(
        await conOrigen(s, esc, sesion, { ...e, tipo: null, id: randomUUID() }),
        "movimiento_caja_origen_par_ck",
      );
      check(
        await conOrigen(s, esc, sesion, { ...e, tipo: "OTRO", id: randomUUID() }),
        "movimiento_caja_origen_ck",
      );
      check(
        await conOrigen(s, esc, sesion, { ...e, tipo: "pago_a_proveedor", id: randomUUID() }),
        "movimiento_caja_origen_ck",
      );
      // Un origen de ingreso en un egreso, y al revés.
      check(
        await conOrigen(s, esc, sesion, { ...e, tipo: "REINTEGRO_DE_PROVEEDOR", id: randomUUID() }),
        "movimiento_caja_origen_ck",
      );
      check(
        await conOrigen(s, esc, sesion, { ...i, tipo: "ENTREGA_A_RENDIR", id: randomUUID() }),
        "movimiento_caja_origen_ck",
      );
      // Ni el ajuste ni la anulación llevan origen en esta tabla.
      check(
        await conOrigen(s, esc, sesion, {
          clase: "AJUSTE",
          importe: "5.00",
          tipo: "PAGO_A_PROVEEDOR",
          id: randomUUID(),
        }),
        "movimiento_caja_origen_ck",
      );
    });
  });

  it("bloque 2: un solo movimiento por origen, aunque cambie la clave; otra empresa puede usar el mismo origen", async () => {
    const origen = randomUUID();
    await conAppDe(b(), m, async (s) => {
      const { sesion } = await abrirSesion(s, esc);
      acepta(
        await conOrigen(s, esc, sesion, {
          clase: "EGRESO_MANUAL",
          importe: "-5.00",
          tipo: "ENTREGA_A_RENDIR",
          id: origen,
        }),
      );
      clave(
        await conOrigen(s, esc, sesion, {
          clase: "EGRESO_MANUAL",
          importe: "-5.00",
          tipo: "ENTREGA_A_RENDIR",
          id: origen,
        }),
        "movimiento_caja_origen_uk",
      );
      // El mismo uuid con otro tipo es otro origen.
      acepta(
        await conOrigen(s, esc, sesion, {
          clase: "EGRESO_MANUAL",
          importe: "-5.00",
          tipo: "PAGO_A_PROVEEDOR",
          id: origen,
        }),
      );
    });
    await conAppDe(b(), otra, async (s) => {
      const { sesion } = await abrirSesion(s, escOtra);
      acepta(
        await conOrigen(s, escOtra, sesion, {
          clase: "EGRESO_MANUAL",
          importe: "-5.00",
          tipo: "ENTREGA_A_RENDIR",
          id: origen,
        }),
      );
    });
  });

  it("paridad: la lista cerrada de la base es la del código, con su sentido", async () => {
    const { rows } = await dueno.query<{ d: string }>(
      "select pg_get_constraintdef(oid) as d from pg_constraint where conname = 'movimiento_caja_origen_ck'",
    );
    const nombres = [...(rows[0]?.d ?? "").matchAll(/'([A-Z_]+)'/g)].map((x) => x[1]);
    expect(new Set(nombres)).toEqual(
      new Set([...ORIGENES_DE_EGRESO, ...ORIGENES_DE_INGRESO, "EGRESO_MANUAL", "INGRESO_MANUAL"]),
    );
    const definicion = rows[0]?.d ?? "";
    for (const tipo of ORIGENES_DE_EGRESO) {
      expect(definicion).toMatch(new RegExp(`'${tipo}'[^)]*\\)[^']*'EGRESO_MANUAL'`));
    }
    for (const tipo of ORIGENES_DE_INGRESO) {
      expect(definicion).toMatch(new RegExp(`'${tipo}'[^)]*\\)[^']*'INGRESO_MANUAL'`));
    }
  });

  it("la reversión frena si hay movimientos con origen, se confirma, se repite, y reaplicar la migración lo deja todo igual", async () => {
    const aparte = await crearBaseAparte(base as BaseDePruebas);
    const c = new pg.Client({ connectionString: aparte.base.dueno });
    await c.connect();
    try {
      const mundo = await crearMundo(c);
      const escenario = await crearEscenario(c, mundo);
      await conAppDe(aparte.base, mundo, async (s) => {
        const { sesion } = await abrirSesion(s, escenario);
        acepta(
          await conOrigen(s, escenario, sesion, {
            clase: "EGRESO_MANUAL",
            importe: "-5.00",
            tipo: "ENTREGA_A_RENDIR",
            id: randomUUID(),
          }),
        );
        await s.confirmar();
      });
      const sql = await readFile(REVERSION, "utf8");
      await c.query("begin");
      await expect(c.query(sql)).rejects.toMatchObject({ code: "55000" });
      await c.query("rollback");
      for (let vez = 0; vez < 2; vez++) {
        await c.query("begin");
        await c.query("set local pedernal.confirmar_reversion = 'SI'");
        await c.query(sql);
        await c.query("commit");
        const columnas = await c.query(
          "select column_name from information_schema.columns where table_name = 'movimiento_caja' and column_name like 'origen%'",
        );
        expect(columnas.rowCount).toBe(0);
        expect(
          (
            await c.query(
              "select 1 from pg_constraint where conname = 'movimiento_caja_anula_distinta_ck'",
            )
          ).rowCount,
        ).toBe(0);
        expect(
          (await c.query("select 1 from migracion where nombre = $1", [MIGRACION])).rowCount,
        ).toBe(0);
      }
      expect((await aplicarMigraciones(aparte.base.dueno, CARPETA)).aplicadas).toEqual([MIGRACION]);
      const columnas = await c.query(
        "select column_name from information_schema.columns where table_name = 'movimiento_caja' and column_name like 'origen%' order by 1",
      );
      expect(columnas.rows.map((r: { column_name: string }) => r.column_name)).toEqual([
        "origen_id",
        "origen_tipo",
      ]);
    } finally {
      await c.end();
      await aparte.destruir();
    }
  });
});
