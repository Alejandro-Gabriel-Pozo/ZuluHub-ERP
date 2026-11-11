import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { productoDeBase } from "./catalogo-apoyo";
import {
  acepta,
  check,
  clave,
  conAppDe,
  crearMundo,
  denegado,
  intentoDelDueno,
  referencia,
  sinConfirmar,
  type Mundo,
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import {
  baseConMigraciones,
  carpetaCon,
  CARPETA_DE_MIGRACIONES,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import type { Intento, SesionDePrueba } from "./sesiones";
import {
  articuloDeBase,
  depositoDeBase,
  entrada,
  escribirMovimiento,
  espejoDe,
  salida,
  transferencia,
  type Ejecutor,
  type MovimientoDePrueba,
} from "./stock-apoyo";

/**
 * La migración 0032 (E6: lotes, calidad y recetas dentro de recetas) contra una base real, con el rol de la aplicación y el dueño: RLS
 * forzada y una política por comando en cada tabla nueva, nada se borra, la historia de calidad, los lotes de cada renglón y las
 * reasignaciones son de solo inserción, el saldo de lote y la calidad del lote solo los escriben los disparadores, todo renglón de un
 * artículo con control queda cubierto por lotes y Σ lotes = saldo del artículo (diferidos), la anulación repite los lotes, un lote real
 * nunca baja de cero, la apertura al activar el control, los ciclos y los niveles de las recetas (también por SQL directo y con dos
 * guardados cruzados a la vez), los motivos de la producción y la reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = [
  "control_de_lote",
  "lote",
  "calidad_de_lote",
  "renglon_de_lote",
  "saldo_de_lote",
  "reasignacion_de_lote",
] as const;
const COMANDOS_POR_TABLA: Readonly<Record<(typeof TABLAS)[number], readonly string[]>> = {
  control_de_lote: ["SELECT", "INSERT", "UPDATE"],
  lote: ["SELECT", "INSERT", "UPDATE"],
  calidad_de_lote: ["SELECT", "INSERT"],
  renglon_de_lote: ["SELECT", "INSERT"],
  saldo_de_lote: ["SELECT", "INSERT", "UPDATE"],
  reasignacion_de_lote: ["SELECT", "INSERT"],
};

const ARCHIVO = "0032_lotes_y_recetas.sql";
const textoDeLaReversion = () =>
  readFile(
    join(CARPETA_DE_MIGRACIONES, "reversiones", "0032_revertir_lotes_y_recetas.sql"),
    "utf8",
  );
const migracionesPrevias = async () =>
  (await readdir(CARPETA_DE_MIGRACIONES))
    .filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < ARCHIVO)
    .sort();
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

type Escenario = Readonly<{
  m: Mundo;
  d1: string;
  d2: string;
  articulo: string;
  /** El lote «sin asignar» del artículo (ya con control). */
  sinAsignar: string;
}>;

describe.skipIf(base === null)("0032 lotes y recetas: la migración contra una base real", () => {
  let dueno: pg.Client;

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: b().dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  // ---- armado --------------------------------------------------------------------------------------------------------------

  const enApp = <T>(
    m: Pick<Mundo, "empresa" | "persona">,
    trabajo: (s: SesionDePrueba, e: Ejecutor) => Promise<T>,
  ): Promise<T> => conAppDe(b(), m, (s) => trabajo(s, (t, p) => s.intentar(t, p)));

  const controlar = async (
    m: Mundo,
    articulo: string,
    modo = "LOTE_Y_VENCIMIENTO",
    conCalidad = true,
  ): Promise<string> => {
    await dueno.query(
      "insert into control_de_lote (empresa_id, articulo_id, modo, con_calidad) values ($1, $2, $3, $4)",
      [m.empresa, articulo, modo, conCalidad],
    );
    return await crearLote(m, articulo, "SIN_ASIGNAR", null, { sinAsignar: true });
  };
  const crearLote = async (
    m: Mundo,
    articulo: string,
    codigo: string,
    vence: string | null,
    extra: Readonly<{ sinAsignar?: boolean; origen?: string | null; ingreso?: string }> = {},
  ): Promise<string> => {
    const id = randomUUID();
    await dueno.query(
      `insert into lote (id, empresa_id, articulo_id, codigo, referencia_de_origen, fecha_de_vencimiento, es_sin_asignar,
                         fecha_de_primer_ingreso, creado_por, creado_en)
       values ($1, $2, $3, $4, $5, $6::date, $7, $8::date, $9, now())`,
      [
        id,
        m.empresa,
        articulo,
        codigo,
        extra.origen ?? null,
        vence,
        extra.sinAsignar ?? false,
        extra.ingreso ?? "2026-11-09",
        m.persona,
      ],
    );
    return id;
  };
  const escenario = async (conControl = true): Promise<Escenario> => {
    const m = await crearMundo(dueno);
    const d1 = await depositoDeBase(dueno, m, { deVenta: true });
    const d2 = await depositoDeBase(dueno, m);
    const a = await articuloDeBase(dueno, m);
    const sinAsignar = conControl ? await controlar(m, a.articulo) : "";
    return { m, d1, d2, articulo: a.articulo, sinAsignar };
  };
  /** Escribe un movimiento y los lotes de cada renglón (en el orden de los renglones) y devuelve el primer rechazo, o la confirmación. */
  const moverConLotes = async (
    e: Escenario,
    mov: MovimientoDePrueba,
    lotes: ReadonlyArray<ReadonlyArray<readonly [string, string]>>,
    confirmar = true,
  ): Promise<{ id: string; resultado: Intento }> =>
    enApp(e.m, async (s, ex) => {
      const r = await escribirMovimiento(ex, e.m.empresa, mov);
      if (!r.resultado.ok) return r;
      let resultado: Intento = r.resultado;
      for (const [indice, delRenglon] of lotes.entries()) {
        for (const [lote, cantidad] of delRenglon) {
          resultado = await ex(
            `insert into renglon_de_lote (empresa_id, movimiento_id, renglon_numero, lote_id, cantidad) values ($1, $2, $3, $4, $5)`,
            [e.m.empresa, r.id, indice + 1, lote, cantidad],
          );
          if (!resultado.ok) return { id: r.id, resultado };
        }
      }
      return { id: r.id, resultado: confirmar ? await s.confirmar() : resultado };
    });
  const aceptar = async (
    e: Escenario,
    mov: MovimientoDePrueba,
    lotes: ReadonlyArray<ReadonlyArray<readonly [string, string]>>,
  ): Promise<string> => {
    const r = await moverConLotes(e, mov, lotes);
    acepta(r.resultado);
    return r.id;
  };
  const saldoDeLote = async (
    e: Escenario,
    lote: string,
    deposito: string = e.d1,
  ): Promise<string> =>
    String(
      (
        await dueno.query<{ existencia: string }>(
          "select existencia from saldo_de_lote where deposito_id = $1 and lote_id = $2",
          [deposito, lote],
        )
      ).rows[0]?.existencia ?? "sin fila",
    );
  const suma = async (e: Escenario, deposito: string = e.d1): Promise<string> =>
    String(
      (
        await dueno.query<{ s: string }>(
          "select coalesce(sum(existencia), 0) as s from saldo_de_lote where deposito_id = $1 and articulo_id = $2",
          [deposito, e.articulo],
        )
      ).rows[0]?.s,
    );

  // ---- el esquema ----------------------------------------------------------------------------------------------------------

  describe("el esquema", () => {
    it("crea las seis tablas con RLS forzada, una política por comando que la aplicación puede ejecutar, ninguna FOR ALL y sin DELETE ni TRUNCATE para nadie", async () => {
      const tablas = (
        await dueno.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          `select relname, relrowsecurity, relforcerowsecurity from pg_class
            where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)`,
          [[...TABLAS]],
        )
      ).rows;
      expect(tablas.map((t) => t.relname).sort()).toEqual([...TABLAS].sort());
      for (const t of tablas) {
        expect(t.relrowsecurity, t.relname).toBe(true);
        expect(t.relforcerowsecurity, t.relname).toBe(true);
      }
      const politicas = (
        await dueno.query<{ tablename: string; cmd: string; roles: string }>(
          "select tablename, cmd, roles::text from pg_policies where schemaname = 'public' and tablename = any($1)",
          [[...TABLAS]],
        )
      ).rows;
      for (const tabla of TABLAS) {
        const comandos = politicas
          .filter((p) => p.tablename === tabla)
          .map((p) => p.cmd)
          .sort();
        expect(comandos, tabla).toEqual([...COMANDOS_POR_TABLA[tabla]].sort());
        for (const p of politicas.filter((x) => x.tablename === tabla)) {
          expect(p.roles, `${tabla} ${p.cmd}`).toContain("pedernal_app");
        }
      }
      for (const tabla of TABLAS) {
        for (const privilegio of ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"]) {
          const { rows } = await dueno.query<{ tiene: boolean }>(
            "select has_table_privilege('pedernal_app', $1, $2) as tiene",
            [tabla, privilegio],
          );
          expect(rows[0]?.tiene, `${tabla} ${privilegio}`).toBe(false);
        }
      }
    });

    it("la base fija lo que la aplicación no manda: no hay privilegio de escritura sobre lo que llenan los disparadores", async () => {
      const sinPrivilegio: Array<[string, string, "INSERT" | "UPDATE"]> = [
        ["lote", "codigo", "UPDATE"],
        ["lote", "articulo_id", "UPDATE"],
        ["lote", "es_sin_asignar", "UPDATE"],
        ["lote", "version", "INSERT"],
        ["calidad_de_lote", "orden", "INSERT"],
        ["control_de_lote", "articulo_id", "UPDATE"],
        ["saldo_de_lote", "lote_id", "UPDATE"],
        ["saldo_de_lote", "es_sin_asignar", "UPDATE"],
      ];
      for (const [tabla, columna, privilegio] of sinPrivilegio) {
        const { rows } = await dueno.query<{ tiene: boolean }>(
          "select has_column_privilege('pedernal_app', $1, $2, $3) as tiene",
          [tabla, columna, privilegio],
        );
        expect(rows[0]?.tiene, `${tabla}.${columna} ${privilegio}`).toBe(false);
      }
    });

    it("no agrega funciones SECURITY DEFINER y toda función nueva fija su search_path", async () => {
      const { rows } = await dueno.query<{
        proname: string;
        prosecdef: boolean;
        config: string[] | null;
      }>(
        `select proname, prosecdef, proconfig as config from pg_proc
          where pronamespace = 'public'::regnamespace
            and proname = any($1)`,
        [
          [
            "composicion_sin_ciclos",
            "control_de_lote_coherente",
            "control_de_lote_validar",
            "lote_validar",
            "calidad_de_lote_validar",
            "calidad_de_lote_aplicar",
            "renglon_de_lote_validar",
            "renglon_de_lote_aplicar",
            "renglon_cubierto_por_lotes",
            "saldo_de_lote_solo_por_movimientos",
            "saldo_de_lote_no_negativo",
            "saldo_de_lote_cierra_con_el_nucleo",
            "reasignacion_de_lote_validar",
            "reasignacion_de_lote_aplicar",
          ],
        ],
      );
      expect(rows).toHaveLength(14);
      for (const f of rows) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.config?.join(" "), f.proname).toContain("search_path=pg_catalog, public, pg_temp");
      }
    });

    it("la aplicación no puede borrar ni vaciar, y a nadie se le deja (ni al dueño)", async () => {
      const e = await escenario();
      const lote = await crearLote(e.m, e.articulo, "L-1", "2027-01-01");
      for (const tabla of ["lote", "control_de_lote"] as const) {
        await sinConfirmar(dueno, async () => {
          const r = await intentoDelDueno(dueno, `delete from ${tabla} where empresa_id = $1`, [
            e.m.empresa,
          ]);
          expect(r.ok).toBe(false);
        });
      }
      for (const tabla of TABLAS) {
        await sinConfirmar(dueno, async () => {
          const r = await intentoDelDueno(dueno, `truncate ${tabla}`);
          expect(r.ok, tabla).toBe(false);
        });
      }
      await enApp(e.m, async (_s, ex) => {
        denegado(await ex("delete from lote where id = $1", [lote]));
      });
    });
  });

  // ---- lotes y su identidad ------------------------------------------------------------------------------------------------

  describe("lotes", () => {
    it("el mismo código del mismo origen es el mismo lote (también sin origen); con otro origen es otro; el sin asignar es uno solo y su código está reservado", async () => {
      const e = await escenario();
      await crearLote(e.m, e.articulo, "L-1", "2027-01-01", { origen: "Molino Sur" });
      await sinConfirmar(dueno, async () => {
        clave(
          await intentoDelDueno(
            dueno,
            `insert into lote (empresa_id, articulo_id, codigo, referencia_de_origen, fecha_de_vencimiento, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, 'L-1', 'Molino Sur', '2027-01-01', '2026-11-09', $3, now())`,
            [e.m.empresa, e.articulo, e.m.persona],
          ),
          "lote_identidad_uk",
        );
      });
      await crearLote(e.m, e.articulo, "L-1", "2027-01-01", { origen: "Molino Norte" });
      await crearLote(e.m, e.articulo, "L-2", "2027-01-01");
      await sinConfirmar(dueno, async () => {
        clave(
          await intentoDelDueno(
            dueno,
            `insert into lote (empresa_id, articulo_id, codigo, fecha_de_vencimiento, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, 'L-2', '2027-01-01', '2026-11-09', $3, now())`,
            [e.m.empresa, e.articulo, e.m.persona],
          ),
          "lote_identidad_uk",
        );
        clave(
          await intentoDelDueno(
            dueno,
            `insert into lote (empresa_id, articulo_id, codigo, es_sin_asignar, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, 'SIN_ASIGNAR', true, '2026-11-09', $3, now())`,
            [e.m.empresa, e.articulo, e.m.persona],
          ),
          "lote_identidad_uk",
        );
      });
      // El código reservado no lo puede usar un lote común, y un sin asignar no lleva fechas.
      await sinConfirmar(dueno, async () => {
        check(
          await intentoDelDueno(
            dueno,
            `insert into lote (empresa_id, articulo_id, codigo, fecha_de_vencimiento, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, 'SIN_ASIGNAR', '2027-01-01', '2026-11-09', $3, now())`,
            [e.m.empresa, e.articulo, e.m.persona],
          ),
          "lote_codigo_ck",
        );
        check(
          await intentoDelDueno(
            dueno,
            `insert into lote (empresa_id, articulo_id, codigo, fecha_de_vencimiento, es_sin_asignar, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, 'SIN_ASIGNAR', '2027-01-01', true, '2026-11-09', $3, now())`,
            [e.m.empresa, e.articulo, e.m.persona],
          ),
          "lote_sin_asignar_ck",
        );
      });
    });

    it("el código es texto de catálogo; con LOTE_Y_VENCIMIENTO la fecha es obligatoria y no puede ser anterior a la elaboración", async () => {
      const e = await escenario();
      await sinConfirmar(dueno, async () => {
        const intento = (codigo: string, vence: string | null, elabora: string | null = null) =>
          intentoDelDueno(
            dueno,
            `insert into lote (empresa_id, articulo_id, codigo, fecha_de_vencimiento, fecha_de_elaboracion, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, $3, $4::date, $5::date, '2026-11-09', $6, now())`,
            [e.m.empresa, e.articulo, codigo, vence, elabora, e.m.persona],
          );
        check(await intento("<b>", "2027-01-01"), "lote_codigo_ck");
        check(await intento("L_1", "2027-01-01"), "lote_codigo_ck");
        check(await intento("L-9", null), "lote_vencimiento_requerido");
        check(await intento("L-9", "2027-01-01", "2027-02-01"), "lote_fechas_ck");
        acepta(await intento("L-9", "2027-01-01", "2026-12-01"));
      });
      // Con solo LOTE el vencimiento es opcional.
      const solo = await escenario(false);
      await controlar(solo.m, solo.articulo, "LOTE", false);
      await crearLote(solo.m, solo.articulo, "L-9", null);
    });

    it("un artículo sin control, o con el control apagado, no admite lotes", async () => {
      const e = await escenario(false);
      await sinConfirmar(dueno, async () => {
        check(
          await intentoDelDueno(
            dueno,
            `insert into lote (empresa_id, articulo_id, codigo, fecha_de_vencimiento, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, 'L-1', '2027-01-01', '2026-11-09', $3, now())`,
            [e.m.empresa, e.articulo, e.m.persona],
          ),
          "lote_sin_control",
        );
      });
      await controlar(e.m, e.articulo);
      await dueno.query("update control_de_lote set activo = false where articulo_id = $1", [
        e.articulo,
      ]);
      await sinConfirmar(dueno, async () => {
        check(
          await intentoDelDueno(
            dueno,
            `insert into lote (empresa_id, articulo_id, codigo, fecha_de_vencimiento, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, 'L-2', '2027-01-01', '2026-11-09', $3, now())`,
            [e.m.empresa, e.articulo, e.m.persona],
          ),
          "lote_sin_control",
        );
      });
    });

    it("la identidad de un lote no cambia; sí se corrigen sus fechas, y la versión sube", async () => {
      const e = await escenario();
      const lote = await crearLote(e.m, e.articulo, "L-1", "2027-01-01");
      await enApp(e.m, async (_s, ex) => {
        denegado(await ex("update lote set codigo = 'L-2' where id = $1", [lote]));
        acepta(
          await ex("update lote set fecha_de_vencimiento = '2027-02-01' where id = $1", [lote]),
        );
        check(
          await ex("update lote set fecha_de_vencimiento = null where id = $1", [lote]),
          "lote_vencimiento_requerido",
        );
      });
      await sinConfirmar(dueno, async () => {
        check(
          await intentoDelDueno(dueno, "update lote set codigo = 'L-2' where id = $1", [lote]),
          "lote_inmutable",
        );
        check(
          await intentoDelDueno(dueno, "update lote set articulo_id = $2 where id = $1", [
            lote,
            randomUUID(),
          ]),
          "lote_inmutable",
        );
      });
      await dueno.query("update lote set fecha_de_vencimiento = '2027-03-01' where id = $1", [
        lote,
      ]);
      expect((await dueno.query("select version from lote where id = $1", [lote])).rows[0]).toEqual(
        { version: 2 },
      );
    });

    it("la aplicación crea el lote con su persona del contexto y no con la de otro", async () => {
      const e = await escenario();
      await enApp(e.m, async (_s, ex) => {
        const insertar = (persona: string) =>
          ex(
            `insert into lote (id, empresa_id, articulo_id, codigo, fecha_de_vencimiento, fecha_de_primer_ingreso, creado_por, creado_en)
             values ($1, $2, $3, $4, '2027-01-01', '2026-11-09', $5, now())`,
            [randomUUID(), e.m.empresa, e.articulo, `L-${randomUUID().slice(0, 6)}`, persona],
          );
        denegado(await insertar(randomUUID()));
        acepta(await insertar(e.m.persona));
      });
    });
  });

  // ---- calidad -------------------------------------------------------------------------------------------------------------

  describe("calidad", () => {
    it("la historia es de solo inserción, copia el último estado al lote y solo ella lo escribe", async () => {
      const e = await escenario();
      const lote = await crearLote(e.m, e.articulo, "L-1", "2027-01-01");
      const calidadDe = async () =>
        (
          await dueno.query<{ calidad: string | null }>("select calidad from lote where id = $1", [
            lote,
          ])
        ).rows[0]?.calidad;
      expect(await calidadDe()).toBeNull();
      await enApp(e.m, async (s, ex) => {
        const cambiar = (estado: string, motivo = "Revisión de la tanda") =>
          ex(
            `insert into calidad_de_lote (empresa_id, lote_id, estado, motivo, por, en) values ($1, $2, $3, $4, $5, now())`,
            [e.m.empresa, lote, estado, motivo, e.m.persona],
          );
        check(await cambiar("EN_REVISION", ""), "calidad_de_lote_motivo_ck");
        check(await cambiar("BUENO"), "calidad_de_lote_estado_ck");
        acepta(await cambiar("EN_CUARENTENA"));
        acepta(await cambiar("LIBERADO"));
        acepta(await s.confirmar());
      });
      expect(await calidadDe()).toBe("LIBERADO");
      expect(
        (
          await dueno.query(
            "select estado from calidad_de_lote where lote_id = $1 order by orden",
            [lote],
          )
        ).rows,
      ).toEqual([{ estado: "EN_CUARENTENA" }, { estado: "LIBERADO" }]);
      // Nadie la escribe directo (ni la aplicación ni el dueño), y la historia no se edita ni se borra.
      await enApp(e.m, async (_s, ex) => {
        denegado(
          await ex("update calidad_de_lote set estado = 'RECHAZADO' where lote_id = $1", [lote]),
        );
      });
      await sinConfirmar(dueno, async () => {
        const directo = await intentoDelDueno(
          dueno,
          "update lote set calidad = 'RECHAZADO' where id = $1",
          [lote],
        );
        expect(directo.ok).toBe(false);
        if (!directo.ok) expect(directo.restriccion).toBe("lote_calidad_solo_por_historial");
        expect((await intentoDelDueno(dueno, "update calidad_de_lote set motivo = 'x'")).ok).toBe(
          false,
        );
        expect((await intentoDelDueno(dueno, "delete from calidad_de_lote")).ok).toBe(false);
      });
      await sinConfirmar(dueno, async () => {
        const r = await intentoDelDueno(
          dueno,
          `insert into lote (empresa_id, articulo_id, codigo, fecha_de_vencimiento, calidad, fecha_de_primer_ingreso, creado_por, creado_en)
           values ($1, $2, 'L-5', '2027-01-01', 'LIBERADO', '2026-11-09', $3, now())`,
          [e.m.empresa, e.articulo, e.m.persona],
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.restriccion).toBe("lote_calidad_solo_por_historial");
      });
    });

    it("un artículo que no lleva calidad no admite historia, ni el lote sin asignar", async () => {
      const e = await escenario(false);
      await controlar(e.m, e.articulo, "LOTE_Y_VENCIMIENTO", false);
      const lote = await crearLote(e.m, e.articulo, "L-1", "2027-01-01");
      await enApp(e.m, async (_s, ex) => {
        check(
          await ex(
            `insert into calidad_de_lote (empresa_id, lote_id, estado, motivo, por, en) values ($1, $2, 'LIBERADO', 'Revisión', $3, now())`,
            [e.m.empresa, lote, e.m.persona],
          ),
          "calidad_de_lote_sin_calidad",
        );
      });
      const conCalidad = await escenario();
      await enApp(conCalidad.m, async (_s, ex) => {
        check(
          await ex(
            `insert into calidad_de_lote (empresa_id, lote_id, estado, motivo, por, en) values ($1, $2, 'LIBERADO', 'Revisión', $3, now())`,
            [conCalidad.m.empresa, conCalidad.sinAsignar, conCalidad.m.persona],
          ),
          "calidad_de_lote_sin_calidad",
        );
      });
    });
  });

  // ---- el libro con lotes --------------------------------------------------------------------------------------------------

  describe("el libro con lotes", () => {
    it("una entrada con lotes suma al lote y al artículo; los lotes siempre suman el saldo", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      const c = await crearLote(e.m, e.articulo, "L-C", "2027-03-01");
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "10"), [
        [
          [a, "6"],
          [c, "4"],
        ],
      ]);
      expect(await saldoDeLote(e, a)).toBe("6.0000");
      expect(await saldoDeLote(e, c)).toBe("4.0000");
      expect(await suma(e)).toBe("10.0000");
      await aceptar(e, salida(e.m, e.d1, e.articulo, "3"), [[[a, "-3"]]]);
      expect(await saldoDeLote(e, a)).toBe("3.0000");
      expect(await suma(e)).toBe("7.0000");
    });

    it("un renglón sin lotes, o con lotes que no suman su cantidad, no se confirma", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      check(
        (await moverConLotes(e, entrada(e.m, e.d1, e.articulo, "10"), [])).resultado,
        "renglon_sin_lotes_completos",
      );
      check(
        (await moverConLotes(e, entrada(e.m, e.d1, e.articulo, "10"), [[[a, "9"]]])).resultado,
        "renglon_sin_lotes_completos",
      );
      check(
        (await moverConLotes(e, entrada(e.m, e.d1, e.articulo, "10"), [[[a, "11"]]])).resultado,
        "renglon_sin_lotes_completos",
      );
      expect(await suma(e)).toBe("0");
    });

    it("el lote es del artículo del renglón, con el signo del renglón, y el renglón existe", async () => {
      const e = await escenario();
      const otro = await articuloDeBase(dueno, e.m);
      await controlar(e.m, otro.articulo);
      const ajeno = await crearLote(e.m, otro.articulo, "L-X", "2027-01-01");
      const propio = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      check(
        (await moverConLotes(e, entrada(e.m, e.d1, e.articulo, "5"), [[[ajeno, "5"]]], false))
          .resultado,
        "renglon_de_lote_otro_articulo",
      );
      check(
        (await moverConLotes(e, entrada(e.m, e.d1, e.articulo, "5"), [[[propio, "-5"]]], false))
          .resultado,
        "renglon_de_lote_signo_invalido",
      );
      await enApp(e.m, async (_s, ex) => {
        referencia(
          await ex(
            `insert into renglon_de_lote (empresa_id, movimiento_id, renglon_numero, lote_id, cantidad) values ($1, $2, 1, $3, 1)`,
            [e.m.empresa, randomUUID(), propio],
          ),
          "renglon_de_lote_renglon_fkey",
        );
      });
    });

    it("los lotes de un renglón solo entran en la transacción del movimiento", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      const id = await aceptar(e, entrada(e.m, e.d1, e.articulo, "5"), [[[a, "5"]]]);
      await enApp(e.m, async (_s, ex) => {
        check(
          await ex(
            `insert into renglon_de_lote (empresa_id, movimiento_id, renglon_numero, lote_id, cantidad) values ($1, $2, 1, $3, 1)`,
            [e.m.empresa, id, a],
          ),
          "renglon_de_lote_movimiento_confirmado",
        );
      });
    });

    it("un lote real nunca baja de cero; el sin asignar sí puede quedar negativo (y los lotes siguen sumando)", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "2"), [[[a, "2"]]]);
      check(
        (await moverConLotes(e, salida(e.m, e.d1, e.articulo, "3"), [[[a, "-3"]]])).resultado,
        "saldo_de_lote_no_negativo_ck",
      );
      await aceptar(e, salida(e.m, e.d1, e.articulo, "3"), [
        [
          [a, "-2"],
          [e.sinAsignar, "-1"],
        ],
      ]);
      expect(await saldoDeLote(e, a)).toBe("0.0000");
      expect(await saldoDeLote(e, e.sinAsignar)).toBe("-1.0000");
      expect(await suma(e)).toBe("-1.0000");
    });

    it("el saldo de lote no lo escribe la aplicación ni el dueño", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "2"), [[[a, "2"]]]);
      await enApp(e.m, async (_s, ex) => {
        denegado(await ex("update saldo_de_lote set existencia = 99 where lote_id = $1", [a]));
        denegado(
          await ex(
            "insert into saldo_de_lote (empresa_id, deposito_id, articulo_id, lote_id, es_sin_asignar, existencia) values ($1, $2, $3, $4, false, 5)",
            [e.m.empresa, e.d2, e.articulo, a],
          ),
        );
      });
      await sinConfirmar(dueno, async () => {
        const r = await intentoDelDueno(
          dueno,
          "update saldo_de_lote set existencia = 99 where lote_id = $1",
          [a],
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.restriccion).toBe("saldo_de_lote_solo_por_movimientos");
      });
    });

    it("un artículo sin control no escribe lotes y se comporta como en E5", async () => {
      const e = await escenario(false);
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "5"), []);
      await aceptar(e, salida(e.m, e.d1, e.articulo, "2"), []);
      for (const tabla of ["lote", "renglon_de_lote", "saldo_de_lote"]) {
        const { rows } = await dueno.query(`select 1 from ${tabla} where empresa_id = $1`, [
          e.m.empresa,
        ]);
        expect(rows, tabla).toHaveLength(0);
      }
    });

    it("con el control apagado el libro deja de pedir lotes y los saldos quedan congelados", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "5"), [[[a, "5"]]]);
      await dueno.query("update control_de_lote set activo = false where articulo_id = $1", [
        e.articulo,
      ]);
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "3"), []);
      expect(await saldoDeLote(e, a)).toBe("5.0000");
    });

    it("la transferencia lleva los lotes entre depósitos y cada depósito cierra con su saldo", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "10"), [[[a, "10"]]]);
      await aceptar(e, transferencia(e.m, e.d1, e.d2, e.articulo, "4"), [[[a, "-4"]], [[a, "4"]]]);
      expect(await saldoDeLote(e, a, e.d1)).toBe("6.0000");
      expect(await saldoDeLote(e, a, e.d2)).toBe("4.0000");
    });

    it("la anulación repite los lotes del original con el signo contrario; con otros lotes no se confirma", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      const c = await crearLote(e.m, e.articulo, "L-C", "2027-03-01");
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "10"), [
        [
          [a, "5"],
          [c, "5"],
        ],
      ]);
      const original = salida(e.m, e.d1, e.articulo, "4", { id: randomUUID() });
      await aceptar(e, original, [
        [
          [a, "-3"],
          [c, "-1"],
        ],
      ]);
      const espejo = espejoDe(e.m, {
        id: original.id as string,
        deposito: e.d1,
        renglones: original.renglones,
      });
      // Los mismos lotes pero con otro reparto: no es el espejo.
      check(
        (
          await moverConLotes(e, espejo, [
            [
              [a, "2"],
              [c, "2"],
            ],
          ])
        ).resultado,
        "anulacion_no_repite_lotes",
      );
      await aceptar(e, { ...espejo, clave: `clave-${randomUUID()}` }, [
        [
          [a, "3"],
          [c, "1"],
        ],
      ]);
      expect(await saldoDeLote(e, a)).toBe("5.0000");
      expect(await saldoDeLote(e, c)).toBe("5.0000");
    });
  });

  // ---- activar el control, apertura y reasignación -------------------------------------------------------------------------

  describe("apertura y reasignación", () => {
    const aperturar = (
      e: Escenario,
      deposito: string,
      cantidad: string,
      lote: string = e.sinAsignar,
    ) =>
      dueno.query(
        `insert into reasignacion_de_lote (empresa_id, deposito_id, articulo_id, lote_origen_id, lote_destino_id, cantidad, motivo, clave_idempotencia, por, en)
         values ($1, $2, $3, null, $4, $5, 'Apertura del control', $6, $7, now())`,
        [e.m.empresa, deposito, e.articulo, lote, cantidad, `clave-${randomUUID()}`, e.m.persona],
      );

    it("activar el control sobre un artículo con existencia exige la apertura al sin asignar, o no se confirma", async () => {
      const e = await escenario(false);
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "7"), []);
      await sinConfirmar(dueno, async () => {
        await dueno.query(
          "insert into control_de_lote (empresa_id, articulo_id, modo, con_calidad) values ($1, $2, 'LOTE', false)",
          [e.m.empresa, e.articulo],
        );
        const sa = randomUUID();
        await dueno.query(
          `insert into lote (id, empresa_id, articulo_id, codigo, es_sin_asignar, fecha_de_primer_ingreso, creado_por, creado_en)
           values ($1, $2, $3, 'SIN_ASIGNAR', true, '2026-11-09', $4, now())`,
          [sa, e.m.empresa, e.articulo, e.m.persona],
        );
        // Dentro de una sola transacción: sin apertura falla al confirmar.
        const r = await intentoDelDueno(dueno, "set constraints all immediate");
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.restriccion).toBe("control_de_lote_sin_apertura");
      });
      // Con la apertura hecha en la misma transacción, pasa y deja los lotes sumando el saldo.
      await dueno.query("begin");
      try {
        await dueno.query(
          "insert into control_de_lote (empresa_id, articulo_id, modo, con_calidad) values ($1, $2, 'LOTE', false)",
          [e.m.empresa, e.articulo],
        );
        const sa = randomUUID();
        await dueno.query(
          `insert into lote (id, empresa_id, articulo_id, codigo, es_sin_asignar, fecha_de_primer_ingreso, creado_por, creado_en)
           values ($1, $2, $3, 'SIN_ASIGNAR', true, '2026-11-09', $4, now())`,
          [sa, e.m.empresa, e.articulo, e.m.persona],
        );
        await aperturar(e, e.d1, "7", sa);
        await dueno.query("commit");
      } catch (error) {
        await dueno.query("rollback");
        throw error;
      }
      expect(await suma(e)).toBe("7.0000");
    });

    it("la apertura entra siempre al sin asignar y puede ser negativa (existencia negativa previa)", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      await sinConfirmar(dueno, async () => {
        const r = await intentoDelDueno(
          dueno,
          `insert into reasignacion_de_lote (empresa_id, deposito_id, articulo_id, lote_origen_id, lote_destino_id, cantidad, motivo, clave_idempotencia, por, en)
           values ($1, $2, $3, null, $4, 5, 'Apertura del control', $5, $6, now())`,
          [e.m.empresa, e.d1, e.articulo, a, `clave-${randomUUID()}`, e.m.persona],
        );
        check(r, "reasignacion_apertura_a_sin_asignar");
      });
    });

    it("reasignar mueve saldo entre lotes del mismo depósito sin tocar el artículo; un lote real no baja de cero y el sin asignar es la fuente de lo que no estaba identificado", async () => {
      const e = await escenario();
      const a = await crearLote(e.m, e.articulo, "L-A", "2027-01-01");
      await aceptar(e, entrada(e.m, e.d1, e.articulo, "6"), [[[e.sinAsignar, "6"]]]);
      await enApp(e.m, async (s, ex) => {
        const reasignar = (origen: string, destino: string, cantidad: string, clave: string) =>
          ex(
            `insert into reasignacion_de_lote (empresa_id, deposito_id, articulo_id, lote_origen_id, lote_destino_id, cantidad, motivo, clave_idempotencia, por, en)
             values ($1, $2, $3, $4, $5, $6, 'Llegó la información del lote', $7, $8, now())`,
            [e.m.empresa, e.d1, e.articulo, origen, destino, cantidad, clave, e.m.persona],
          );
        acepta(await reasignar(e.sinAsignar, a, "4", "clave-reasignacion-1"));
        check(
          await reasignar(a, e.sinAsignar, "5", "clave-reasignacion-2"),
          "saldo_de_lote_no_negativo_ck",
        );
        check(await reasignar(a, a, "1", "clave-reasignacion-3"), "reasignacion_forma_ck");
        check(
          await reasignar(a, e.sinAsignar, "0", "clave-reasignacion-4"),
          "reasignacion_cantidad_ck",
        );
        clave(
          await reasignar(e.sinAsignar, a, "1", "clave-reasignacion-1"),
          "reasignacion_de_lote_clave_uk",
        );
        acepta(await s.confirmar());
      });
      expect(await saldoDeLote(e, a)).toBe("4.0000");
      expect(await saldoDeLote(e, e.sinAsignar)).toBe("2.0000");
      expect(await suma(e)).toBe("6.0000");
    });

    it("no se reasigna entre lotes de otro artículo ni sin control", async () => {
      const e = await escenario();
      const otro = await articuloDeBase(dueno, e.m);
      await enApp(e.m, async (_s, ex) => {
        check(
          await ex(
            `insert into reasignacion_de_lote (empresa_id, deposito_id, articulo_id, lote_origen_id, lote_destino_id, cantidad, motivo, clave_idempotencia, por, en)
             values ($1, $2, $3, $4, $5, 1, 'Reasignación', $6, $7, now())`,
            [
              e.m.empresa,
              e.d1,
              otro.articulo,
              e.sinAsignar,
              e.sinAsignar,
              `clave-${randomUUID()}`,
              e.m.persona,
            ],
          ),
          "reasignacion_sin_control",
        );
      });
    });
  });

  // ---- recetas -------------------------------------------------------------------------------------------------------------

  describe("recetas dentro de recetas", () => {
    const elaborado = (m: Mundo) => productoDeBase(dueno, m.empresa, { clase: "ELABORADO" });
    /** Una versión de receta con elaborados como componentes, en UNA transacción confirmada. Devuelve el intento de la confirmación. */
    const guardar = (
      m: Mundo,
      producto: string,
      compuestos: readonly string[],
      numero = 1,
    ): Promise<Intento> =>
      enApp(m, async (s, ex) => {
        const id = randomUUID();
        const alta = await ex(
          `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, $4, 1, $5, now())`,
          [id, m.empresa, producto, numero, m.persona],
        );
        if (!alta.ok) return alta;
        let n = 0;
        for (const compuesto of compuestos) {
          n += 1;
          const r = await ex(
            `insert into componente_de_composicion (empresa_id, composicion_id, numero, compuesto_id, cantidad, unidad_id, dimension)
             values ($1, $2, $3, $4, 1, 'UNIDAD', 'CONTEO')`,
            [m.empresa, id, n, compuesto],
          );
          if (!r.ok) return r;
        }
        return await s.confirmar();
      });

    it("un componente puede ser un elaborado, y solo uno activo; una sola vez por versión", async () => {
      const m = await crearMundo(dueno);
      const masa = await elaborado(m);
      const plato = await productoDeBase(dueno, m.empresa, { clase: "VENDIBLE" });
      const reventa = await productoDeBase(dueno, m.empresa, { clase: "REVENTA" });
      acepta(await guardar(m, plato, [masa]));
      check(
        await guardar(m, await productoDeBase(dueno, m.empresa, { clase: "VENDIBLE" }), [reventa]),
        "componente_compuesto_no_elaborado",
      );
      check(
        await guardar(m, await productoDeBase(dueno, m.empresa, { clase: "VENDIBLE" }), [
          await productoDeBase(dueno, m.empresa, { clase: "VENDIBLE" }),
        ]),
        "componente_compuesto_no_elaborado",
      );
      const inactivo = await productoDeBase(dueno, m.empresa, {
        clase: "ELABORADO",
        activo: false,
      });
      check(
        await guardar(m, await productoDeBase(dueno, m.empresa, { clase: "VENDIBLE" }), [inactivo]),
        "componente_compuesto_inactivo",
      );
      clave(
        await guardar(m, await productoDeBase(dueno, m.empresa, { clase: "VENDIBLE" }), [
          masa,
          masa,
        ]),
        "componente_compuesto_uk",
      );
    });

    it("un producto no puede contenerse a sí mismo, ni por otro: ciclo directo e indirecto, por SQL directo", async () => {
      const m = await crearMundo(dueno);
      const a = await elaborado(m);
      const b2 = await elaborado(m);
      const c = await elaborado(m);
      check(await guardar(m, a, [a]), "composicion_con_ciclo");
      acepta(await guardar(m, a, [b2]));
      acepta(await guardar(m, b2, [c]));
      // A lleva B, B lleva C: C no puede llevar a A (ciclo indirecto), ni a B.
      check(await guardar(m, c, [a]), "composicion_con_ciclo");
      check(await guardar(m, c, [b2]), "composicion_con_ciclo");
    });

    it("sin ciclos aunque el ciclo lo cierre una versión nueva de un producto que ya tenía receta; cambiar la versión lo deshace", async () => {
      const m = await crearMundo(dueno);
      const a = await elaborado(m);
      const b2 = await elaborado(m);
      acepta(await guardar(m, a, [b2]));
      acepta(
        await guardar(m, b2, [await productoDeBase(dueno, m.empresa, { clase: "ELABORADO" })]),
      );
      check(await guardar(m, b2, [a], 2), "composicion_con_ciclo");
      // Una versión nueva de A que ya no lleva a B deja a B libre de llevar a A.
      acepta(await guardar(m, a, [await elaborado(m)], 2));
      acepta(await guardar(m, b2, [a], 2));
    });

    it("hasta cinco niveles contando la receta del propio producto; seis no", async () => {
      const m = await crearMundo(dueno);
      const p = await Promise.all([1, 2, 3, 4, 5, 6].map(() => elaborado(m)));
      // p5 es la hoja (sin receta); p4 lleva p5 ... p1 lleva p2: cadena de cinco recetas con la raíz.
      for (const [indice, producto] of [p[3], p[2], p[1]].entries()) {
        const hijo = [p[4], p[3], p[2]][indice] as string;
        acepta(await guardar(m, producto as string, [hijo]));
      }
      acepta(await guardar(m, p[0] as string, [p[1] as string])); // p0 → p1 → p2 → p3 → p4: cinco niveles
      check(await guardar(m, p[5] as string, [p[0] as string]), "composicion_demasiado_anidada");
    });

    it("dos guardados cruzados a la vez (A lleva B y B lleva A): a lo sumo uno se confirma y la base nunca queda con un ciclo", async () => {
      for (let ronda = 0; ronda < 3; ronda++) {
        const m = await crearMundo(dueno);
        const a = await elaborado(m);
        const b2 = await elaborado(m);
        const s1 = await conAbierta(m);
        const s2 = await conAbierta(m);
        try {
          for (const [s, producto, compuesto] of [
            [s1, a, b2],
            [s2, b2, a],
          ] as const) {
            const id = randomUUID();
            acepta(
              await s.intentar(
                `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 1, 1, $4, now())`,
                [id, m.empresa, producto, m.persona],
              ),
            );
            acepta(
              await s.intentar(
                `insert into componente_de_composicion (empresa_id, composicion_id, numero, compuesto_id, cantidad, unidad_id, dimension)
                 values ($1, $2, 1, $3, 1, 'UNIDAD', 'CONTEO')`,
                [m.empresa, id, compuesto],
              ),
            );
          }
          const [r1, r2] = await Promise.all([s1.confirmar(), s2.confirmar()]);
          expect([r1.ok, r2.ok].filter(Boolean)).toHaveLength(1);
          const fallo = r1.ok ? r2 : r1;
          expect(fallo.ok).toBe(false);
          if (!fallo.ok) expect(fallo.restriccion).toBe("composicion_con_ciclo");
        } finally {
          await s1.cerrar();
          await s2.cerrar();
        }
        const { rows } = await dueno.query("select 1 from composicion where empresa_id = $1", [
          m.empresa,
        ]);
        expect(rows).toHaveLength(1);
      }
    });

    const conAbierta = async (m: Mundo): Promise<SesionDePrueba> => {
      const { SesionDePrueba: Sesion } = await import("./sesiones");
      const { comoEmpresa } = await import("./entorno");
      const { empresaId, personaId } = await import("../../src/primitivas/identificadores/marca");
      return Sesion.abrir(
        b(),
        "pedernal_app",
        comoEmpresa(empresaId(m.empresa), personaId(m.persona)),
      );
    };

    it("los pasos de la receta son texto de catálogo de una línea, hasta 2000", async () => {
      const m = await crearMundo(dueno);
      const plato = await productoDeBase(dueno, m.empresa, { clase: "VENDIBLE" });
      await enApp(m, async (_s, ex) => {
        const con = (pasos: string | null, numero: number) =>
          ex(
            `insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en, pasos) values ($1, $2, $3, $4, 1, $5, now(), $6)`,
            [randomUUID(), m.empresa, plato, numero, m.persona, pasos],
          );
        check(await con("", 1), "composicion_pasos_ck");
        check(await con("a".repeat(2001), 1), "composicion_pasos_ck");
        check(await con("línea uno\nlínea dos", 1), "composicion_pasos_ck");
        acepta(await con("Mezclar, dejar reposar y hornear", 1));
        acepta(await con(null, 2));
      });
    });
  });

  // ---- los motivos de la producción ----------------------------------------------------------------------------------------

  describe("los motivos de la producción", () => {
    it("consumir y producir van con el origen TRANSFORMACION y ese origen solo con ellos; una anulación puede llevarlo", async () => {
      const e = await escenario(false);
      const orden = randomUUID();
      const consumo = salida(e.m, e.d1, e.articulo, "2", {
        motivo: "CONSUMO_DE_TRANSFORMACION",
        origen: { tipo: "TRANSFORMACION", id: orden },
        accion: "transformaciones.cerrar",
      });
      await enApp(e.m, async (_s, ex) => {
        check(
          (await escribirMovimiento(ex, e.m.empresa, { ...consumo, origen: null })).resultado,
          "movimiento_de_stock_transformacion_ck",
        );
        check(
          (await escribirMovimiento(ex, e.m.empresa, { ...consumo, motivo: "MERMA" })).resultado,
          "movimiento_de_stock_transformacion_ck",
        );
        check(
          (
            await escribirMovimiento(
              ex,
              e.m.empresa,
              entrada(e.m, e.d1, e.articulo, "1", {
                origen: { tipo: "TRANSFORMACION", id: randomUUID() },
              }),
            )
          ).resultado,
          "movimiento_de_stock_transformacion_ck",
        );
      });
      const id = await aceptar(e, { ...consumo, id: randomUUID() }, []);
      // Una sola salida por orden aunque cambie la clave.
      await enApp(e.m, async (_s, ex) => {
        clave(
          (
            await escribirMovimiento(ex, e.m.empresa, {
              ...consumo,
              clave: `clave-${randomUUID()}`,
            })
          ).resultado,
          "movimiento_de_stock_origen_uk",
        );
      });
      await aceptar(
        e,
        {
          ...espejoDe(e.m, { id, deposito: e.d1, renglones: consumo.renglones }),
          origen: { tipo: "TRANSFORMACION", id: orden },
        },
        [],
      );
    });
  });

  // ---- la migración y su reversión -----------------------------------------------------------------------------------------

  describe("la migración y su reversión", () => {
    it("sube, baja (deja el esquema como antes), sube de nuevo; con datos la reversión pide confirmar; con producción en 0030 frena siempre; y frena si `lote` ya existe", async () => {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      const conMia = await carpetaCon([...(await migracionesPrevias()), ARCHIVO]);
      try {
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const c = previa.cliente;
        const antes = await huellaDeCatalogo(c);
        const reversion = await textoDeLaReversion();
        const fila = async () =>
          (await c.query("select 1 from migracion where nombre = $1", [ARCHIVO])).rows.length;

        await c.query("create table lote (x int)");
        await expect(aplicarMigraciones(previa.aparte.base.dueno, conMia)).rejects.toThrow(
          /la tabla lote ya existe/,
        );
        await c.query("drop table lote");
        expect(await fila()).toBe(0);
        expect(await huellaDeCatalogo(c)).toEqual(antes);

        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(await fila()).toBe(1);
        const conLotes = await huellaDeCatalogo(c);
        expect(conLotes).not.toEqual(antes);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        expect(await fila()).toBe(0);
        const motivos = await c.query("select count(*)::int as n from motivo_de_movimiento");
        expect(motivos.rows[0]).toEqual({ n: 14 });
        const otraVez = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otraVez.aplicadas).toEqual([ARCHIVO]);
        // Una columna que se borra y se vuelve a crear queda al final con otro número de posición: es lo único que cambia.
        const sinPosicion = (h: Record<string, string[]>) => ({
          ...h,
          columnas: (h.columnas ?? []).map((x) =>
            x.replace(/^composicion\.pasos:\d+:/, "composicion.pasos:"),
          ),
        });
        expect(sinPosicion(await huellaDeCatalogo(c))).toEqual(sinPosicion(conLotes));

        // Con un control de lote cargado: sin confirmar no borra nada; confirmada, sí.
        const mundo = await crearMundo(c);
        await depositoDeBase(c, mundo);
        const a = await articuloDeBase(c, mundo);
        await c.query(
          "insert into control_de_lote (empresa_id, articulo_id, modo, con_calidad) values ($1, $2, 'LOTE', false)",
          [mundo.empresa, a.articulo],
        );
        await c.query("begin");
        await expect(c.query(reversion)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/avisar al dueño/) as string,
        });
        await c.query("rollback");
        expect((await c.query("select count(*)::int as n from control_de_lote")).rows[0]).toEqual({
          n: 1,
        });
        expect(await fila()).toBe(1);
        await c.query(
          `begin; set local pedernal.confirmar_reversion = 'SI'; ${reversion}; commit;`,
        );
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);

        // Con una receta de un elaborado ya guardada, la reversión frena SIEMPRE (nada se borra en 0030).
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        const otro = await crearMundo(c);
        const elab = await productoDeBase(c, otro.empresa, { clase: "ELABORADO" });
        await c.query(
          "insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 1, 1, $4, now())",
          [randomUUID(), otro.empresa, elab, otro.persona],
        );
        await c.query("begin");
        await expect(
          c.query(`set local pedernal.confirmar_reversion = 'SI'; ${reversion}`),
        ).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/no se puede revertir 0032/) as string,
        });
        await c.query("rollback");
      } finally {
        await rm(conMia, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("la reversión declara que es destructiva y que no se recupera, no usa CASCADE ni TRUNCATE y solo borra sus dos motivos y su fila del registro", async () => {
      const texto = await textoDeLaReversion();
      const plano = texto.replace(/\n--\s*/g, " ");
      expect(plano).toMatch(/DESTRUCTIVA/);
      expect(plano).toMatch(/NO SE RECUPERA/);
      expect(plano).toMatch(/NO lo aplica el ejecutor de migraciones/);
      const codigo = texto.replace(/--.*$/gm, "");
      const borrados = codigo.match(/\bDELETE\b[^;]*;/gi) ?? [];
      expect(borrados).toHaveLength(2);
      expect(borrados[0]).toMatch(/^DELETE FROM motivo_de_movimiento WHERE codigo IN/i);
      expect(borrados[1]).toMatch(/^DELETE FROM public\.migracion WHERE nombre LIKE /i);
      expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
    });
  });
});
