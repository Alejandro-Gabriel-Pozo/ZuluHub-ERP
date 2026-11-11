import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { grupoDeBase, opcionDeBase, productoDeBase } from "./catalogo-apoyo";
import { crearMundo, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import {
  CARPETA_DE_MIGRACIONES,
  baseConMigraciones,
  carpetaCon,
  huellaDeCatalogo,
} from "./marcas-apoyo";

/**
 * E5-T12: la migración 0036 (la línea del ticket sella la versión de la opción de la variante) sobre una base CON DATOS de ventas: sus guardas, lo
 * que promete su texto (clave foránea compuesta, «sin variante no hay versión», la versión es de la opción elegida, se escribe solo al insertar y no
 * cambia nunca, el privilegio es de INSERT por columna) y su reversión (que falla cerrado, sin borrar, si ya hay versiones selladas).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const ARCHIVO = "0036_ventas_sella_variante.sql";
const REVERSION = join(
  CARPETA_DE_MIGRACIONES,
  "reversiones",
  "0036_revertir_ventas_sella_variante.sql",
);
const AHORA = "2026-11-09T15:00:00Z";

/** Todo lo que hay en la carpeta ANTES de esta migración, en orden. */
async function anteriores(): Promise<string[]> {
  return (await readdir(CARPETA_DE_MIGRACIONES))
    .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < ARCHIVO)
    .sort();
}

type Linea = Readonly<{
  varianteOpcionId?: string | null;
  varianteVersionDeOpcionId?: string | null;
}>;

/** Un error de la base: su código y la restricción que lo causó. */
type Rechazo = Readonly<{ codigo: string | undefined; restriccion: string | undefined }>;

describe.skipIf(base === null)("migración 0036: ventas sella la versión de la variante", () => {
  const b = () => base as BaseDePruebas;
  /** Dentro de `rechazada` la transacción es de la prueba: lo escrito no se confirma. */
  let enRechazada = false;

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

  async function revertir(c: pg.Client, confirmar = false): Promise<void> {
    const sql = await readFile(REVERSION, "utf8");
    await c.query("begin");
    try {
      if (confirmar) await c.query("set local pedernal.confirmar_reversion = 'SI'");
      await c.query(sql);
      await c.query("commit");
    } catch (error) {
      await c.query("rollback");
      throw error;
    }
  }

  /**
   * La cuenta abierta con una línea de $1000 escrita por el dueño de la base. La base exige que el total cuadre AL CONFIRMAR: fuera de una
   * transacción propia de la prueba (`dentro`), se arma y confirma acá.
   */
  async function lineaPorSql(
    c: pg.Client,
    w: Pick<Mundo, "empresa" | "sucursal" | "persona">,
    extra: Linea & Readonly<{ columnaNueva?: boolean; dentro?: boolean }> = {},
  ): Promise<string> {
    if (extra.dentro !== true && !enRechazada) {
      await c.query("begin");
      try {
        const id = await lineaPorSql(c, w, { ...extra, dentro: true });
        await c.query("commit");
        return id;
      } catch (error) {
        await c.query("rollback");
        throw error;
      }
    }
    const cuenta = randomUUID();
    const id = randomUUID();
    await c.query(
      `insert into cuenta_consumo (id, empresa_id, sucursal_id, abierta_por, abierta_en) values ($1, $2, $3, $4, $5)`,
      [cuenta, w.empresa, w.sucursal, w.persona, AHORA],
    );
    await c.query("update cuenta_consumo set ultima_posicion = 1 where id = $1", [cuenta]);
    const conVersion = extra.columnaNueva === true;
    const parametros: unknown[] = [
      id,
      w.empresa,
      cuenta,
      randomUUID(),
      extra.varianteOpcionId ?? null,
      extra.varianteOpcionId === undefined || extra.varianteOpcionId === null ? null : "Chico",
      ...(conVersion ? [extra.varianteVersionDeOpcionId ?? null] : []),
      randomUUID(),
      w.persona,
      AHORA,
    ];
    const n = (i: number) => `$${conVersion ? i + 1 : i}`;
    await c.query(
      `insert into linea_cuenta (id, empresa_id, cuenta_id, posicion, producto_id, descripcion, variante_opcion_id, variante_nombre,
                                 ${conVersion ? "variante_version_de_opcion_id," : ""} precio_id, origen_del_precio, precio_base,
                                 precio_unitario, cantidad, unidad_de_venta, paso_de_cantidad, alicuota, controla_stock, creada_por, creada_en)
       values ($1, $2, $3, 1, $4, 'Producto', $5, $6, ${conVersion ? "$7," : ""} ${n(7)}, 'EMPRESA', 1000, 1000, 1, 'UNIDAD', 1, '21', false, ${n(8)}, ${n(9)})`,
      parametros,
    );
    await c.query("update cuenta_consumo set total_provisorio = 1000 where id = $1", [cuenta]);
    return id;
  }

  /** Una variante (grupo de tamaño con una opción y su versión 1) de un producto de la empresa. */
  async function variante(c: pg.Client, empresa: string, factor = "1") {
    const producto = await productoDeBase(c, empresa);
    const grupo = await grupoDeBase(c, empresa, producto, {
      clase: "VARIANTE",
      esTamano: true,
      nombre: "Tamano",
    });
    return opcionDeBase(c, empresa, producto, grupo, { nombre: "Chico", factor });
  }

  /** Corre `trabajo` en una transacción y devuelve por qué lo rechazó la base (siempre revierte). */
  async function rechazada(c: pg.Client, trabajo: () => Promise<unknown>): Promise<Rechazo> {
    await c.query("begin");
    enRechazada = true;
    try {
      await trabajo();
      await c.query("commit");
      throw new Error("la base tendría que haberlo rechazado");
    } catch (error) {
      enRechazada = false;
      await c.query("rollback").catch(() => undefined);
      const e = error as { code?: string; constraint?: string };
      if (e.code === undefined) throw error;
      return { codigo: e.code, restriccion: e.constraint };
    }
  }

  const sellado = async (c: pg.Client, id: string) =>
    (
      await c.query<{ v: string | null }>(
        "select variante_version_de_opcion_id::text as v from linea_cuenta where id = $1",
        [id],
      )
    ).rows[0]?.v;

  // ===========================================================================================================
  it("sobre una base con ventas reales no cambia NI UNA fila: la versión queda en NULL y repetir no hace nada", async () => {
    await conPrevias(async (previa, completa) => {
      const mundo = await crearMundo(previa.cliente);
      const opcion = await variante(previa.cliente, mundo.empresa);
      await lineaPorSql(previa.cliente, mundo);
      await lineaPorSql(previa.cliente, mundo, { varianteOpcionId: opcion.opcion });
      const huella = async () =>
        (
          await previa.cliente.query<{ h: string }>(
            `select md5(string_agg((to_jsonb(t) - 'variante_version_de_opcion_id')::text, '|' order by id)) as h from linea_cuenta t`,
          )
        ).rows[0]?.h;
      const antes = await huella();

      const r = await aplicarMigraciones(previa.aparte.base.dueno, completa);
      expect(r.aplicadas).toEqual([ARCHIVO]);

      expect(await huella()).toBe(antes);
      expect(
        (
          await previa.cliente.query(
            "select count(*)::int as n, count(variante_version_de_opcion_id)::int as con from linea_cuenta",
          )
        ).rows,
      ).toEqual([{ n: 2, con: 0 }]);
      expect((await aplicarMigraciones(previa.aparte.base.dueno, completa)).aplicadas).toEqual([]);
    });
  });

  it("exige 0028: sin la línea del ticket se frena con un mensaje claro y no deja nada", async () => {
    const sin = (await anteriores()).filter((n) => n < "0028");
    const ninguna = await baseConMigraciones(b(), sin);
    const carpeta = await carpetaCon([...sin, ARCHIVO]);
    try {
      await expect(aplicarMigraciones(ninguna.aparte.base.dueno, carpeta)).rejects.toThrow(
        /requiere 0028_ventas/,
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

  it("exige 0025: sin las versiones de opción se frena con un mensaje claro (la columna nueva apunta a ellas)", async () => {
    // Sin 0025 tampoco hay ventas (0028 la necesita): se prueba la guarda sola con una base que tiene `linea_cuenta` pero no `version_de_opcion`.
    await conPrevias(async (previa, completa) => {
      await previa.cliente.query(
        "alter table version_de_opcion rename to version_de_opcion_renombrada",
      );
      await expect(aplicarMigraciones(previa.aparte.base.dueno, completa)).rejects.toThrow(
        /requiere 0025_catalogo/,
      );
    });
  });

  it("una columna creada a mano frena la migración (no pisa lo que alguien armó)", async () => {
    await conPrevias(async (previa, completa) => {
      await previa.cliente.query(
        "alter table linea_cuenta add column variante_version_de_opcion_id uuid",
      );
      await expect(aplicarMigraciones(previa.aparte.base.dueno, completa)).rejects.toThrow(
        /ya existe \(alguien la creó a mano\)/,
      );
    });
  });

  // ===========================================================================================================
  describe("lo que promete", () => {
    it("la versión sellada se guarda al insertar la línea y la base la devuelve tal cual", async () => {
      await conPrevias(async (previa, completa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const mundo = await crearMundo(previa.cliente);
        const opcion = await variante(previa.cliente, mundo.empresa, "1.5");
        const id = await lineaPorSql(previa.cliente, mundo, {
          columnaNueva: true,
          varianteOpcionId: opcion.opcion,
          varianteVersionDeOpcionId: opcion.version,
        });
        expect(await sellado(previa.cliente, id)).toBe(opcion.version);
      });
    });

    it("la versión es de la opción elegida: la de OTRA opción se rechaza (linea_variante_version_no_corresponde)", async () => {
      await conPrevias(async (previa, completa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const mundo = await crearMundo(previa.cliente);
        const chico = await variante(previa.cliente, mundo.empresa);
        const grande = await variante(previa.cliente, mundo.empresa, "1.5");
        expect(
          await rechazada(previa.cliente, () =>
            lineaPorSql(previa.cliente, mundo, {
              columnaNueva: true,
              varianteOpcionId: chico.opcion,
              varianteVersionDeOpcionId: grande.version,
            }),
          ),
        ).toEqual({ codigo: "23514", restriccion: "linea_variante_version_no_corresponde" });
      });
    });

    it("la clave foránea es compuesta: una versión inexistente o de otra empresa se rechaza (linea_variante_version_fkey)", async () => {
      await conPrevias(async (previa, completa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const mundo = await crearMundo(previa.cliente);
        const otra = await crearMundo(previa.cliente);
        const ajena = await variante(previa.cliente, otra.empresa);
        const propia = await variante(previa.cliente, mundo.empresa);
        const inexistente = await rechazada(previa.cliente, () =>
          lineaPorSql(previa.cliente, mundo, {
            columnaNueva: true,
            varianteOpcionId: propia.opcion,
            varianteVersionDeOpcionId: randomUUID(),
          }),
        );
        // El disparador de alta mira primero y la clave foránea (no diferida) se evalúa al insertar: cualquiera de las dos frena la fila.
        expect(["linea_variante_version_fkey", "linea_variante_version_no_corresponde"]).toContain(
          inexistente.restriccion,
        );
        const deOtraEmpresa = await rechazada(previa.cliente, () =>
          lineaPorSql(previa.cliente, mundo, {
            columnaNueva: true,
            varianteOpcionId: ajena.opcion,
            varianteVersionDeOpcionId: ajena.version,
          }),
        );
        expect(["linea_variante_version_fkey", "linea_variante_version_no_corresponde"]).toContain(
          deOtraEmpresa.restriccion,
        );
      });
    });

    it("la clave foránea compuesta existe y es la de la versión de ESA empresa", async () => {
      await conPrevias(async (previa, completa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const { rows } = await previa.cliente.query<{ def: string }>(
          `select pg_get_constraintdef(oid) as def from pg_constraint
            where conrelid = 'linea_cuenta'::regclass and conname = 'linea_variante_version_fkey'`,
        );
        expect(rows[0]?.def).toBe(
          "FOREIGN KEY (variante_version_de_opcion_id, empresa_id) REFERENCES version_de_opcion(id, empresa_id)",
        );
      });
    });

    it("sin variante no hay versión (linea_variante_version_no_corresponde)", async () => {
      await conPrevias(async (previa, completa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const mundo = await crearMundo(previa.cliente);
        const opcion = await variante(previa.cliente, mundo.empresa);
        expect(
          await rechazada(previa.cliente, () =>
            lineaPorSql(previa.cliente, mundo, {
              columnaNueva: true,
              varianteOpcionId: null,
              varianteVersionDeOpcionId: opcion.version,
            }),
          ),
        ).toEqual({ codigo: "23514", restriccion: "linea_variante_version_no_corresponde" });
      });
    });

    it("la versión sellada no cambia nunca: ni el dueño de la base la edita (linea_inmutable), y la aplicación solo tiene INSERT sobre la columna", async () => {
      await conPrevias(async (previa, completa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const mundo = await crearMundo(previa.cliente);
        const chico = await variante(previa.cliente, mundo.empresa);
        const grande = await variante(previa.cliente, mundo.empresa, "1.5");
        const id = await lineaPorSql(previa.cliente, mundo, {
          columnaNueva: true,
          varianteOpcionId: chico.opcion,
          varianteVersionDeOpcionId: chico.version,
        });
        for (const nuevo of [null, grande.version]) {
          expect(
            await rechazada(previa.cliente, () =>
              previa.cliente.query(
                "update linea_cuenta set variante_version_de_opcion_id = $2 where id = $1",
                [id, nuevo],
              ),
            ),
          ).toEqual({ codigo: "23514", restriccion: "linea_inmutable" });
        }
        expect(await sellado(previa.cliente, id)).toBe(chico.version);
        const privilegio = async (que: "INSERT" | "UPDATE") =>
          (
            await previa.cliente.query<{ p: boolean }>(
              "select has_column_privilege('pedernal_app', 'linea_cuenta', 'variante_version_de_opcion_id', $1) as p",
              [que],
            )
          ).rows[0]?.p;
        expect({
          insertar: await privilegio("INSERT"),
          cambiar: await privilegio("UPDATE"),
        }).toEqual({
          insertar: true,
          cambiar: false,
        });
      });
    });
  });

  // ===========================================================================================================
  describe("reversión", () => {
    it("sin versiones selladas deja ventas como antes, y la migración se puede aplicar de nuevo con el mismo resultado", async () => {
      await conPrevias(async (previa, completa) => {
        const mundo = await crearMundo(previa.cliente);
        await lineaPorSql(previa.cliente, mundo);
        const antes = await huellaDeCatalogo(previa.cliente);
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        expect(await huellaDeCatalogo(previa.cliente)).not.toEqual(antes);

        await revertir(previa.cliente);
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        expect(
          (await previa.cliente.query("select count(*)::int as n from linea_cuenta")).rows,
        ).toEqual([{ n: 1 }]);
        // Se puede repetir sin que cambie nada; el registro deja de figurar la 0036 y las anteriores siguen.
        await revertir(previa.cliente);
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        expect(
          (
            await previa.cliente.query(
              "select count(*)::int as n from migracion where nombre = $1",
              [ARCHIVO],
            )
          ).rows,
        ).toEqual([{ n: 0 }]);

        expect((await aplicarMigraciones(previa.aparte.base.dueno, completa)).aplicadas).toEqual([
          ARCHIVO,
        ]);
      });
    });

    it("con una versión sellada se NIEGA sin borrar nada, salvo confirmación expresa", async () => {
      await conPrevias(async (previa, completa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, completa);
        const mundo = await crearMundo(previa.cliente);
        const opcion = await variante(previa.cliente, mundo.empresa);
        const id = await lineaPorSql(previa.cliente, mundo, {
          columnaNueva: true,
          varianteOpcionId: opcion.opcion,
          varianteVersionDeOpcionId: opcion.version,
        });
        const antes = await huellaDeCatalogo(previa.cliente);
        await expect(revertir(previa.cliente)).rejects.toThrow(/confirmar_reversion/);
        expect(await huellaDeCatalogo(previa.cliente)).toEqual(antes);
        expect(await sellado(previa.cliente, id)).toBe(opcion.version);

        await revertir(previa.cliente, true);
        expect(
          (
            await previa.cliente.query(
              "select count(*)::int as n from information_schema.columns where table_name = 'linea_cuenta' and column_name = 'variante_version_de_opcion_id'",
            )
          ).rows,
        ).toEqual([{ n: 0 }]);
        expect(
          (await previa.cliente.query("select count(*)::int as n from linea_cuenta")).rows,
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
});
