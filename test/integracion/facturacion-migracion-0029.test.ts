import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { FORMA_DEL_SIMBOLO_DE_UNIDAD } from "../../src/modulos/fiscal/publico";
import {
  RENGLON_DE_121,
  crearComprobante,
  crearEscenario,
  datosDeComprobante,
  type Escenario,
} from "./facturacion-apoyo";
import type { BaseDePruebas } from "./global";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";

/**
 * E1-T2: la migración 0029 (parte fiscal de E1: el origen `REEMISION_DE_TICKET` y la unidad opcional del renglón) sobre una base CON DATOS, sus
 * guardas, lo que promete su texto, la lista de permitidos de la unidad contra la de 0025, los debilitamientos propios y su reversión (que falla
 * cerrado, sin borrar, si ya hay datos que la usan).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const ARCHIVO = "0029_facturacion.sql";
const REVERSION = join(CARPETA_DE_MIGRACIONES, "reversiones", "0029_revertir_facturacion.sql");

/** Todo lo que hay en la carpeta ANTES de esta migración, en orden. */
async function anteriores(): Promise<string[]> {
  return (await readdir(CARPETA_DE_MIGRACIONES))
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < ARCHIVO)
    .sort();
}

describe.skipIf(base === null)(
  "migración 0029: facturar un documento de origen (parte fiscal)",
  () => {
    const b = () => base as BaseDePruebas;

    async function conPrevias<T>(
      trabajo: (
        previa: Awaited<ReturnType<typeof baseConMigraciones>>,
        completa: string,
      ) => Promise<T>,
    ): Promise<T> {
      const previas = await anteriores();
      const previa = await baseConMigraciones(b(), previas);
      await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
      const completa = await carpetaCon([...previas, ARCHIVO]);
      try {
        return await trabajo(previa, completa);
      } finally {
        await rm(completa, { recursive: true, force: true });
        await previa.cerrar();
      }
    }

    const huellaDeFacturacion = async (c: pg.Client): Promise<Record<string, string>> => {
      const r: Record<string, string> = {};
      for (const tabla of ["comprobante", "comprobante_linea", "comprobante_alicuota"]) {
        // La columna nueva todavía no existe en una base anterior: se compara sin ella.
        const { rows } = await c.query<{ h: string }>(
          `select coalesce(md5(string_agg((to_jsonb(t) - 'unidad')::text, '|' order by (to_jsonb(t) - 'unidad')::text)), '-') as h from ${tabla} t`,
        );
        r[tabla] = rows[0]?.h as string;
      }
      return r;
    };

    async function revertir(c: pg.Client): Promise<void> {
      const sql = await readFile(REVERSION, "utf8");
      await c.query("begin");
      try {
        await c.query(sql);
        await c.query("commit");
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    }

    /** Un comprobante con un renglón (con la unidad dada) creado por el dueño de la base. */
    const crearConUnidad = (c: pg.Client, e: Escenario, unidad: string | null, cambios = {}) =>
      crearComprobante(c, e, cambios, [{ ...RENGLON_DE_121, unidad }]);

    // ===========================================================================================================
    it("sobre una base con comprobantes reales no cambia NI UNA fila: la unidad queda en NULL y repetir no hace nada", async () => {
      await conPrevias(async (previa, completa) => {
        const e = await crearEscenario(previa.cliente);
        await crearComprobante(previa.cliente, e);
        await crearComprobante(previa.cliente, e, {
          origen_tipo: "EJEMPLAR_DE_TICKET",
          origen_id: "ticket-previo",
        });
        const antes = await huellaDeFacturacion(previa.cliente);

        const r = await aplicarMigraciones(previa.aparte.base.dueno, completa);
        expect(r.aplicadas).toEqual([ARCHIVO]);

        expect(await huellaDeFacturacion(previa.cliente)).toEqual(antes);
        expect(
          (
            await previa.cliente.query(
              "select count(*)::int as n, count(unidad)::int as con from comprobante_linea",
            )
          ).rows,
        ).toEqual([{ n: 2, con: 0 }]);
        const otra = await aplicarMigraciones(previa.aparte.base.dueno, completa);
        expect(otra.aplicadas).toEqual([]);
      });
    });

    it("exige 0009: sin los comprobantes se frena con un mensaje claro y no deja nada", async () => {
      const ninguna = await baseConMigraciones(
        b(),
        (await anteriores()).filter((n) => n < "0009"),
      );
      const carpeta = await carpetaCon([
        ...(await anteriores()).filter((n) => n < "0009"),
        ARCHIVO,
      ]);
      try {
        await expect(aplicarMigraciones(ninguna.aparte.base.dueno, carpeta)).rejects.toThrow(
          /requiere 0009/,
        );
        expect(
          (await ninguna.cliente.query("select nombre from migracion where nombre = $1", [ARCHIVO]))
            .rowCount,
        ).toBe(0);
      } finally {
        await rm(carpeta, { recursive: true, force: true });
        await ninguna.cerrar();
      }
    });

    it("si la columna ya existe (alguien la creó a mano) se frena y no cambia nada", async () => {
      await conPrevias(async (previa, completa) => {
        await previa.cliente.query("alter table comprobante_linea add column unidad text");
        const antes = await huellaDeCatalogo(previa.cliente);
        await expect(aplicarMigraciones(previa.aparte.base.dueno, completa)).rejects.toThrow(
          /ya existe/,
        );
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
      });
    });

    // ===========================================================================================================
    describe("el texto de la migración", () => {
      it("es aditiva: nada de DELETE, UPDATE, TRUNCATE ni DROP de tablas o columnas; el único DROP es la restricción de orígenes, que se recrea como superconjunto", async () => {
        const texto = (await readFile(join(CARPETA_DE_MIGRACIONES, ARCHIVO), "utf8")).replace(
          /--.*$/gm,
          "",
        );
        expect(texto).not.toMatch(/\b(DELETE|UPDATE|TRUNCATE)\b/i);
        expect(texto).not.toMatch(/DROP\s+(TABLE|COLUMN|FUNCTION|INDEX|TRIGGER)/i);
        expect(texto.match(/DROP\s+CONSTRAINT\s+(\w+)/gi)).toEqual([
          "DROP CONSTRAINT comprobante_origen_tipo_ck",
        ]);
        expect(texto).not.toMatch(/SECURITY\s+DEFINER|CREATE\s+ROLE|PASSWORD|CASCADE/i);
        expect(texto.match(/GRANT [^;]+;/gi)).toEqual([
          "GRANT INSERT (unidad) ON comprobante_linea TO pedernal_app;",
        ]);
      });

      it("la reversión vive fuera de la carpeta que aplica el ejecutor, no usa CASCADE y no se corre sola", async () => {
        expect(await readdir(CARPETA_DE_MIGRACIONES)).not.toContain(
          "0029_revertir_facturacion.sql",
        );
        const texto = (await readFile(REVERSION, "utf8")).replace(/--.*$/gm, "");
        expect(texto).not.toMatch(/CASCADE|PASSWORD/i);
        // Nombre exacto: `0009_facturacion.sql` también termina en `_facturacion.sql`.
        expect(texto).toContain("nombre = '0029_facturacion.sql'");
      });
    });

    // ===========================================================================================================
    describe("lo que la base admite después de migrar", () => {
      const sondear = async <T>(
        trabajo: (c: pg.Client, e: Escenario) => Promise<T>,
      ): Promise<T> => {
        const aparte = await baseConMigraciones(b(), [...(await anteriores()), ARCHIVO]);
        try {
          await sembrarMarcaPrincipalDePrueba(aparte.aparte.base.dueno);
          const e = await crearEscenario(aparte.cliente);
          return await trabajo(aparte.cliente, e);
        } finally {
          await aparte.cerrar();
        }
      };

      it("admite el origen nuevo y sigue rechazando uno que no existe", async () => {
        await sondear(async (c, e) => {
          await crearComprobante(c, e, {
            origen_tipo: "REEMISION_DE_TICKET",
            origen_id: "reemision-1",
          });
          await expect(
            crearComprobante(c, e, { origen_tipo: "VENTA", origen_id: "x" }),
          ).rejects.toThrow(/comprobante_origen_tipo_ck/);
        });
      });

      it("la unidad admite NULL y de 1 a 8 letras o dígitos, y rechaza vacío, 9 caracteres, espacios y signos", async () => {
        await sondear(async (c, e) => {
          for (const valida of [null, "kg", "u", "m2", "cm2", "ABCDEFGH", "ml"]) {
            await crearConUnidad(c, e, valida);
          }
          for (const invalida of ["", "ABCDEFGHI", "k g", "kg ", "k-g", "kg\n", "ñ", "%", "k.g"]) {
            await expect(crearConUnidad(c, e, invalida), JSON.stringify(invalida)).rejects.toThrow(
              /comprobante_linea_unidad_ck/,
            );
          }
        });
      });

      it("es la MISMA lista de permitidos que la unidad del catálogo (0025) y que la del dominio", async () => {
        await sondear(async (c) => {
          const forma = async (restriccion: string) => {
            const { rows } = await c.query<{ def: string }>(
              "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
              [restriccion],
            );
            return /~ '([^']+)'/.exec(rows[0]?.def ?? "")?.[1];
          };
          expect(await forma("comprobante_linea_unidad_ck")).toBe(
            FORMA_DEL_SIMBOLO_DE_UNIDAD.source,
          );
          expect(await forma("unidad_simbolo_ck")).toBe(FORMA_DEL_SIMBOLO_DE_UNIDAD.source);
        });
      });

      it("todos los símbolos del catálogo de unidades pasan la restricción del renglón", async () => {
        await sondear(async (c) => {
          const { rows } = await c.query<{ simbolo: string }>(
            "select simbolo from unidad_de_medida",
          );
          expect(rows.length).toBeGreaterThanOrEqual(14);
          for (const { simbolo } of rows) {
            expect(FORMA_DEL_SIMBOLO_DE_UNIDAD.test(simbolo), simbolo).toBe(true);
          }
        });
      });

      it("la aplicación puede escribir la unidad al insertar el renglón y nunca modificarla ni borrarla", async () => {
        await sondear(async (c) => {
          const privilegio = async (privilegio: string) =>
            (
              await c.query<{ p: boolean }>(
                "select has_column_privilege('pedernal_app', 'comprobante_linea', 'unidad', $1) as p",
                [privilegio],
              )
            ).rows[0]?.p;
          expect(await privilegio("INSERT")).toBe(true);
          expect(await privilegio("UPDATE")).toBe(false);
          expect(
            (
              await c.query<{ p: boolean }>(
                "select has_table_privilege('pedernal_app', 'comprobante_linea', 'DELETE') as p",
              )
            ).rows[0]?.p,
          ).toBe(false);
        });
      });

      it("el renglón con unidad es de solo inserción: ni el dueño de la base la cambia", async () => {
        await sondear(async (c, e) => {
          const id = await crearConUnidad(c, e, "kg");
          await expect(
            c.query("update comprobante_linea set unidad = 'g' where comprobante_id = $1", [id]),
          ).rejects.toThrow();
        });
      });
    });

    // ===========================================================================================================
    describe("debilitamientos propios: cada uno rompe una sonda", () => {
      /** Rompe la migración a propósito DENTRO de una transacción que se deshace, y dice si la sonda deja de cumplirse. */
      async function conDebilitamiento(
        debilitar: string,
        sonda: (c: pg.Client, e: Escenario) => Promise<boolean>,
      ): Promise<{ sana: boolean; rota: boolean }> {
        const aparte = await baseConMigraciones(b(), [...(await anteriores()), ARCHIVO]);
        try {
          await sembrarMarcaPrincipalDePrueba(aparte.aparte.base.dueno);
          const e = await crearEscenario(aparte.cliente);
          await aparte.cliente.query("begin");
          const sana = await sonda(aparte.cliente, e);
          await aparte.cliente.query(debilitar);
          const rota = await sonda(aparte.cliente, e);
          await aparte.cliente.query("rollback");
          return { sana, rota };
        } finally {
          await aparte.cerrar();
        }
      }
      const rechaza = async (c: pg.Client, trabajo: () => Promise<unknown>): Promise<boolean> => {
        await c.query("savepoint s");
        try {
          await trabajo();
          return false;
        } catch {
          return true;
        } finally {
          await c.query("rollback to savepoint s");
        }
      };
      const datos = (e: Escenario, cambios = {}) => datosDeComprobante(e, cambios);
      const insertarConUnidad = async (
        c: pg.Client,
        e: Escenario,
        unidad: string,
      ): Promise<void> => {
        const d = datos(e);
        const columnas = Object.keys(d);
        await c.query(
          `insert into comprobante (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
          columnas.map((k) => d[k]),
        );
        await c.query(
          `insert into comprobante_linea (empresa_id, comprobante_id, posicion, descripcion, cantidad, precio_unitario, alicuota, importe, unidad)
         values ($1, $2, 1, 'x', 1, 121, '21', 121, $3)`,
          [e.empresa, d["id"], unidad],
        );
      };

      it("sacar la restricción de la unidad deja pasar «kilo gramo»", async () => {
        const r = await conDebilitamiento(
          "alter table comprobante_linea drop constraint comprobante_linea_unidad_ck",
          (c, e) => rechaza(c, () => insertarConUnidad(c, e, "kilo gramo")),
        );
        expect(r).toEqual({ sana: true, rota: false });
      });

      it("volver a la lista de orígenes de 0009 deja de admitir la reemisión", async () => {
        const r = await conDebilitamiento(
          `alter table comprobante drop constraint comprobante_origen_tipo_ck;
         alter table comprobante add constraint comprobante_origen_tipo_ck check (origen_tipo in
           ('MANUAL', 'EJEMPLAR_DE_TICKET', 'PROPINA_DE_TICKET', 'CORRECCION_DE_TICKET', 'SUSCRIPCION'))`,
          async (c, e) =>
            !(await rechaza(c, async () => {
              const d = datos(e, { origen_tipo: "REEMISION_DE_TICKET", origen_id: "r-1" });
              const columnas = Object.keys(d);
              await c.query(
                `insert into comprobante (${columnas.join(", ")}) values (${columnas.map((_, i) => `$${i + 1}`).join(", ")})`,
                columnas.map((k) => d[k]),
              );
            })),
        );
        expect(r).toEqual({ sana: true, rota: false });
      });

      it("quitarle a la aplicación el privilegio de la columna le impide guardar la unidad", async () => {
        const r = await conDebilitamiento(
          "revoke insert (unidad) on comprobante_linea from pedernal_app",
          async (c) =>
            (
              await c.query<{ p: boolean }>(
                "select has_column_privilege('pedernal_app', 'comprobante_linea', 'unidad', 'INSERT') as p",
              )
            ).rows[0]?.p === true,
        );
        expect(r).toEqual({ sana: true, rota: false });
      });
    });

    // ===========================================================================================================
    describe("reversión", () => {
      it("sin datos que la usen deja la facturación como antes, y la migración se puede aplicar de nuevo con el mismo resultado", async () => {
        await conPrevias(async (previa, completa) => {
          const e = await crearEscenario(previa.cliente);
          await crearComprobante(previa.cliente, e, {
            origen_tipo: "EJEMPLAR_DE_TICKET",
            origen_id: "t-1",
          });
          const antes = await huellaDeCatalogo(previa.cliente);
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(antes);

          await revertir(previa.cliente);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
          expect(
            (await previa.cliente.query("select count(*)::int as n from comprobante")).rows,
          ).toEqual([{ n: 1 }]);
          // Se puede repetir sin que cambie nada, y sin borrar la fila de la 0009 del registro de migraciones.
          await revertir(previa.cliente);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
          expect(
            (
              await previa.cliente.query(
                "select nombre from migracion where nombre like '%facturacion%' order by nombre",
              )
            ).rows,
          ).toEqual([{ nombre: "0009_facturacion.sql" }]);

          const otra = await aplicarMigraciones(previa.aparte.base.dueno, completa);
          expect(otra.aplicadas).toEqual([ARCHIVO]);
        });
      });

      it("con un renglón con unidad se NIEGA sin borrar nada (son registros fiscales)", async () => {
        await conPrevias(async (previa, completa) => {
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          const e = await crearEscenario(previa.cliente);
          await crearConUnidad(previa.cliente, e, "kg");
          const antes = await huellaDeCatalogo(previa.cliente);
          await expect(revertir(previa.cliente)).rejects.toThrow(/1 renglones con unidad/);
          expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
          expect(
            (await previa.cliente.query("select count(unidad)::int as n from comprobante_linea"))
              .rows,
          ).toEqual([{ n: 1 }]);
        });
      });

      it("con un comprobante de origen REEMISION_DE_TICKET se NIEGA sin borrar nada", async () => {
        await conPrevias(async (previa, completa) => {
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          const e = await crearEscenario(previa.cliente);
          await crearComprobante(previa.cliente, e, {
            origen_tipo: "REEMISION_DE_TICKET",
            origen_id: "r-1",
          });
          await expect(revertir(previa.cliente)).rejects.toThrow(
            /1 comprobantes con origen REEMISION_DE_TICKET/,
          );
          expect(
            (
              await previa.cliente.query(
                "select count(*)::int as n from comprobante where origen_tipo = 'REEMISION_DE_TICKET'",
              )
            ).rows,
          ).toEqual([{ n: 1 }]);
        });
      });

      it("necesita un rol que evada RLS: si no, rechaza (así no cuenta cero filas en silencio)", async () => {
        await conPrevias(async (previa, completa) => {
          await aplicarMigraciones(previa.aparte.base.dueno, completa);
          const c = new pg.Client({ connectionString: previa.aparte.base.plataforma });
          await c.connect();
          try {
            await expect(c.query(await readFile(REVERSION, "utf8"))).rejects.toThrow(/evada RLS/);
          } finally {
            await c.end();
          }
        });
      });
    });
  },
);
