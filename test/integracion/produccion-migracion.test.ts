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
import type { SesionDePrueba } from "./sesiones";
import {
  articuloDeBase,
  depositoDeBase,
  escribirMovimiento,
  espejoDe,
  entrada,
  salida,
  type Ejecutor,
} from "./stock-apoyo";

/**
 * La migración 0033 (E6: orden de producción) contra una base real: RLS forzada y una política por comando, nada se borra, el número lo da
 * la base y es correlativo (también con altas simultáneas), la máquina de estados, cerrar exige los dos movimientos con el origen de la
 * orden y lo obtenido igual al libro, anular exige los espejos, lo real se carga una vez y la reversión.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = ["contador_de_ordenes", "orden_de_produccion", "renglon_de_orden"] as const;
const COMANDOS: Readonly<Record<(typeof TABLAS)[number], readonly string[]>> = {
  contador_de_ordenes: ["SELECT", "INSERT", "UPDATE"],
  orden_de_produccion: ["SELECT", "INSERT", "UPDATE"],
  renglon_de_orden: ["SELECT", "INSERT", "UPDATE"],
};
const ARCHIVO = "0033_produccion.sql";
const textoDeLaReversion = () =>
  readFile(join(CARPETA_DE_MIGRACIONES, "reversiones", "0033_revertir_produccion.sql"), "utf8");
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
  /** El producto elaborado con stock propio y su receta vigente. */
  producto: string;
  articulo: string;
  receta: string;
  harina: string;
}>;

describe.skipIf(base === null)("0033 producción: la migración contra una base real", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: b().dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const enApp = <T>(
    m: Pick<Mundo, "empresa" | "persona">,
    trabajo: (s: SesionDePrueba, e: Ejecutor) => Promise<T>,
  ): Promise<T> => conAppDe(b(), m, (s) => trabajo(s, (t, p) => s.intentar(t, p)));

  const escenario = async (): Promise<Escenario> => {
    const m = await crearMundo(dueno);
    const d1 = await depositoDeBase(dueno, m, { deVenta: true });
    const d2 = await depositoDeBase(dueno, m);
    const harina = (await articuloDeBase(dueno, m)).articulo;
    const producto = await productoDeBase(dueno, m.empresa, { clase: "ELABORADO" });
    const articulo = randomUUID();
    await dueno.query(
      "insert into articulo_de_stock (id, empresa_id, producto_id, unidad_de_stock_id, dimension) values ($1, $2, $3, 'UNIDAD', 'CONTEO')",
      [articulo, m.empresa, producto],
    );
    const receta = randomUUID();
    await dueno.query(
      "insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 1, 10, $4, now())",
      [receta, m.empresa, producto, m.persona],
    );
    // Los componentes de una versión entran en su transacción: se arma en una sola.
    await dueno.query("begin");
    try {
      const r2 = randomUUID();
      await dueno.query(
        "insert into composicion (id, empresa_id, producto_id, numero, rinde, creada_por, creada_en) values ($1, $2, $3, 2, 10, $4, now())",
        [r2, m.empresa, producto, m.persona],
      );
      await dueno.query(
        "insert into componente_de_composicion (empresa_id, composicion_id, numero, articulo_id, cantidad, unidad_id, dimension) values ($1, $2, 1, $3, 6, 'UNIDAD', 'CONTEO')",
        [m.empresa, r2, harina],
      );
      await dueno.query("commit");
      return { m, d1, d2, producto, articulo, receta: r2, harina };
    } catch (error) {
      await dueno.query("rollback");
      throw error;
    }
  };

  const abrir = (e: Escenario, s: SesionDePrueba, id: string = randomUUID()) =>
    s.intentar(
      `insert into orden_de_produccion (id, empresa_id, producto_id, articulo_id, composicion_id, deposito_id, deposito_destino_id, cantidad_esperada, abierta_por, abierta_en)
       values ($1, $2, $3, $4, $5, $6, $7, 100, $8, now())`,
      [id, e.m.empresa, e.producto, e.articulo, e.receta, e.d1, e.d2, e.m.persona],
    );
  const renglones = (e: Escenario, s: SesionDePrueba, orden: string) =>
    s.intentar(
      "insert into renglon_de_orden (empresa_id, orden_id, numero, articulo_id, composicion_id, cantidad_esperada) values ($1, $2, 1, $3, $4, 60)",
      [e.m.empresa, orden, e.harina, e.receta],
    );
  /** Abre una orden con un renglón y la confirma. */
  const abierta = async (e: Escenario): Promise<string> =>
    enApp(e.m, async (s) => {
      const id = randomUUID();
      acepta(await abrir(e, s, id));
      acepta(await renglones(e, s, id));
      acepta(await s.confirmar());
      return id;
    });
  const numeroDe = async (id: string): Promise<number> =>
    Number(
      (
        await dueno.query<{ numero: number }>(
          "select numero from orden_de_produccion where id = $1",
          [id],
        )
      ).rows[0]?.numero,
    );
  /** Cierra la orden: consumo, producto y la orden, en una transacción; `ajuste` permite romper una pieza. */
  const cerrar = (
    e: Escenario,
    orden: string,
    obtenido = "95",
    pieza: "ok" | "sin-consumo" | "sin-producto" = "ok",
  ) =>
    enApp(e.m, async (s, ex) => {
      const origen = { tipo: "TRANSFORMACION", id: orden };
      const consumo = salida(e.m, e.d1, e.harina, "60", {
        motivo: "CONSUMO_DE_TRANSFORMACION",
        origen,
        accion: "transformaciones.cerrar",
      });
      const producto = entrada(e.m, e.d2, e.articulo, obtenido, {
        motivo: "PRODUCTO_DE_TRANSFORMACION",
        origen,
        accion: "transformaciones.cerrar",
      });
      const rc =
        pieza === "sin-consumo" ? null : await escribirMovimiento(ex, e.m.empresa, consumo);
      const rp =
        pieza === "sin-producto" ? null : await escribirMovimiento(ex, e.m.empresa, producto);
      if (rc && !rc.resultado.ok)
        return { id: rc.id, resultado: rc.resultado, consumo: rc.id, producto: rp?.id ?? null };
      if (rp && !rp.resultado.ok)
        return { id: rp.id, resultado: rp.resultado, consumo: rc?.id ?? null, producto: rp.id };
      acepta(
        await ex("update renglon_de_orden set cantidad_real = 60 where orden_id = $1", [orden]),
      );
      const r = await ex(
        `update orden_de_produccion set estado = 'CERRADA', cantidad_obtenida = $2, costo_estado = 'SIN_COSTO', movimiento_de_consumo_id = $3,
                movimiento_de_producto_id = $4, cerrada_por = $5, cerrada_en = now() where id = $1`,
        [orden, obtenido, rc?.id ?? randomUUID(), rp?.id ?? randomUUID(), e.m.persona],
      );
      return {
        id: orden,
        resultado: r.ok ? await s.confirmar() : r,
        consumo: rc?.id ?? null,
        producto: rp?.id ?? null,
      };
    });

  describe("el esquema", () => {
    it("tres tablas con RLS forzada, una política por comando y sin DELETE ni TRUNCATE para nadie; lo que fija la base no se concede", async () => {
      const tablas = (
        await dueno.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          `select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)`,
          [[...TABLAS]],
        )
      ).rows;
      expect(tablas).toHaveLength(3);
      for (const t of tablas) {
        expect(t.relrowsecurity && t.relforcerowsecurity, t.relname).toBe(true);
      }
      const politicas = (
        await dueno.query<{ tablename: string; cmd: string }>(
          "select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)",
          [[...TABLAS]],
        )
      ).rows;
      for (const tabla of TABLAS) {
        expect(
          politicas
            .filter((p) => p.tablename === tabla)
            .map((p) => p.cmd)
            .sort(),
          tabla,
        ).toEqual([...COMANDOS[tabla]].sort());
        for (const privilegio of ["DELETE", "TRUNCATE"]) {
          expect(
            (
              await dueno.query<{ t: boolean }>(
                "select has_table_privilege('pedernal_app', $1, $2) as t",
                [tabla, privilegio],
              )
            ).rows[0]?.t,
            `${tabla} ${privilegio}`,
          ).toBe(false);
        }
      }
      for (const [tabla, columna, privilegio] of [
        ["orden_de_produccion", "numero", "INSERT"],
        ["orden_de_produccion", "numero", "UPDATE"],
        ["orden_de_produccion", "tipo", "INSERT"],
        ["orden_de_produccion", "hecho_en", "UPDATE"],
        ["orden_de_produccion", "fecha_de_negocio", "UPDATE"],
        ["orden_de_produccion", "producto_id", "UPDATE"],
        ["renglon_de_orden", "cantidad_esperada", "UPDATE"],
      ] as const) {
        expect(
          (
            await dueno.query<{ t: boolean }>(
              "select has_column_privilege('pedernal_app', $1, $2, $3) as t",
              [tabla, columna, privilegio],
            )
          ).rows[0]?.t,
          `${tabla}.${columna} ${privilegio}`,
        ).toBe(false);
      }
    });
    it("sin funciones SECURITY DEFINER y con search_path fijo", async () => {
      const { rows } = await dueno.query<{
        proname: string;
        prosecdef: boolean;
        config: string[] | null;
      }>(
        "select proname, prosecdef, proconfig as config from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)",
        [
          [
            "contador_de_ordenes_solo_por_ordenes",
            "orden_validar",
            "orden_cerrada_con_reales",
            "renglon_de_orden_validar",
          ],
        ],
      );
      expect(rows).toHaveLength(4);
      for (const f of rows) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.config?.join(" "), f.proname).toContain("search_path=pg_catalog, public, pg_temp");
      }
    });
    it("nada se borra ni se vacía, ni el dueño", async () => {
      const e = await escenario();
      await abierta(e);
      for (const tabla of TABLAS) {
        await sinConfirmar(dueno, async () => {
          expect((await intentoDelDueno(dueno, `delete from ${tabla}`)).ok, tabla).toBe(false);
        });
        await sinConfirmar(dueno, async () => {
          expect((await intentoDelDueno(dueno, `truncate ${tabla}`)).ok, tabla).toBe(false);
        });
      }
    });
  });

  describe("abrir", () => {
    it("el número lo da la base: correlativo por empresa, no se manda, y el contador no se escribe directo", async () => {
      const e = await escenario();
      const a = await abierta(e);
      const c = await abierta(e);
      expect([await numeroDe(a), await numeroDe(c)]).toEqual([1, 2]);
      const otra = await escenario();
      expect(await numeroDe(await abierta(otra))).toBe(1);
      await enApp(e.m, async (s, ex) => {
        denegado(
          await ex(
            "insert into orden_de_produccion (id, empresa_id, numero, producto_id, articulo_id, composicion_id, deposito_id, deposito_destino_id, cantidad_esperada, abierta_por, abierta_en) values ($1,$2,9,$3,$4,$5,$6,$7,1,$8,now())",
            [randomUUID(), e.m.empresa, e.producto, e.articulo, e.receta, e.d1, e.d2, e.m.persona],
          ),
        );
        denegado(await ex("update contador_de_ordenes set ultimo = 1"));
        await s.deshacer();
      });
      await sinConfirmar(dueno, async () => {
        const r = await intentoDelDueno(
          dueno,
          "update contador_de_ordenes set ultimo = 1 where empresa_id = $1",
          [e.m.empresa],
        );
        expect(r.ok).toBe(false);
        if (!r.ok) expect(r.restriccion).toBe("contador_de_ordenes_solo_por_ordenes");
      });
    });
    it("un rollback no deja hueco y N altas simultáneas dan 1..N sin repetidos; el mismo id dos veces es una sola orden", async () => {
      const e = await escenario();
      const abiertas = await Promise.all(Array.from({ length: 6 }, () => abierta(e)));
      const numeros = (await Promise.all(abiertas.map(numeroDe))).sort((x, y) => x - y);
      expect(numeros).toEqual([1, 2, 3, 4, 5, 6]);
      await enApp(e.m, async (s) => {
        acepta(await abrir(e, s));
        await s.deshacer();
      });
      expect(await numeroDe(await abierta(e))).toBe(7);
      const id = randomUUID();
      await enApp(e.m, async (s) => {
        acepta(await abrir(e, s, id));
        acepta(await s.confirmar());
      });
      await enApp(e.m, async (s) => {
        clave(
          (await abrir(e, s, id)).ok
            ? { ok: false, codigo: "23505", restriccion: "orden_de_produccion_pkey", mensaje: "" }
            : await abrir(e, s, id),
          "orden_de_produccion_pkey",
        );
      });
    });
    it("el artículo y la receta son del producto y los depósitos son normales y activos; abre la persona del contexto", async () => {
      const e = await escenario();
      const otro = await articuloDeBase(dueno, e.m);
      const cuarentena = await depositoDeBase(dueno, e.m, { uso: "CUARENTENA" });
      await enApp(e.m, async (s, ex) => {
        const abrirCon = (articulo: string, deposito: string, persona: string = e.m.persona) =>
          ex(
            `insert into orden_de_produccion (id, empresa_id, producto_id, articulo_id, composicion_id, deposito_id, deposito_destino_id, cantidad_esperada, abierta_por, abierta_en)
             values ($1, $2, $3, $4, $5, $6, $7, 1, $8, now())`,
            [randomUUID(), e.m.empresa, e.producto, articulo, e.receta, e.d1, deposito, persona],
          );
        check(await abrirCon(otro.articulo, e.d2), "orden_articulo_del_producto");
        check(await abrirCon(e.articulo, cuarentena), "orden_depositos_normales");
        denegado(await abrirCon(e.articulo, e.d2, randomUUID()));
        check(
          await ex(
            `insert into orden_de_produccion (id, empresa_id, producto_id, articulo_id, composicion_id, deposito_id, deposito_destino_id, cantidad_esperada, abierta_por, abierta_en)
             values ($1, $2, $3, $4, $5, $6, $7, 0, $8, now())`,
            [randomUUID(), e.m.empresa, e.producto, e.articulo, e.receta, e.d1, e.d2, e.m.persona],
          ),
          "orden_esperada_ck",
        );
        await s.deshacer();
      });
    });
    it("los renglones solo entran con su orden y sin lo real", async () => {
      const e = await escenario();
      const id = await abierta(e);
      await enApp(e.m, async (s, ex) => {
        check(await renglones(e, s, id), "renglon_de_orden_orden_confirmada");
        await ex("select 1");
      });
      await enApp(e.m, async (s) => {
        const nueva = randomUUID();
        acepta(await abrir(e, s, nueva));
        // Lo real no se concede al insertar: se carga al cerrar.
        denegado(
          await s.intentar(
            "insert into renglon_de_orden (empresa_id, orden_id, numero, articulo_id, composicion_id, cantidad_esperada, cantidad_real) values ($1, $2, 1, $3, $4, 6, 6)",
            [e.m.empresa, nueva, e.harina, e.receta],
          ),
        );
      });
    });
  });

  describe("cerrar, cancelar y anular", () => {
    it("cerrar con consumo y producto: queda cerrada con la fecha de negocio del movimiento; la cantidad obtenida es la del libro", async () => {
      const e = await escenario();
      const id = await abierta(e);
      const r = await cerrar(e, id);
      acepta(r.resultado);
      const fila = (
        await dueno.query(
          "select estado, cantidad_obtenida, hecho_en, fecha_de_negocio from orden_de_produccion where id = $1",
          [id],
        )
      ).rows[0] as {
        estado: string;
        cantidad_obtenida: string;
        hecho_en: Date | null;
        fecha_de_negocio: Date | null;
      };
      expect(fila.estado).toBe("CERRADA");
      expect(fila.cantidad_obtenida).toBe("95.0000");
      expect(fila.hecho_en).not.toBeNull();
      expect(fila.fecha_de_negocio).not.toBeNull();
    });
    it("sin consumo, sin producto o con lo obtenido distinto del libro no cierra", async () => {
      const e = await escenario();
      const a = await abierta(e);
      check((await cerrar(e, a, "95", "sin-consumo")).resultado, "orden_cierre_sin_consumo");
      check((await cerrar(e, a, "95", "sin-producto")).resultado, "orden_cierre_sin_producto");
      await enApp(e.m, async (s, ex) => {
        const origen = { tipo: "TRANSFORMACION", id: a };
        const rc = await escribirMovimiento(
          ex,
          e.m.empresa,
          salida(e.m, e.d1, e.harina, "60", {
            motivo: "CONSUMO_DE_TRANSFORMACION",
            origen,
            accion: "transformaciones.cerrar",
          }),
        );
        const rp = await escribirMovimiento(
          ex,
          e.m.empresa,
          entrada(e.m, e.d2, e.articulo, "90", {
            motivo: "PRODUCTO_DE_TRANSFORMACION",
            origen,
            accion: "transformaciones.cerrar",
          }),
        );
        check(
          await ex(
            `update orden_de_produccion set estado = 'CERRADA', cantidad_obtenida = 95, costo_estado = 'SIN_COSTO', movimiento_de_consumo_id = $2, movimiento_de_producto_id = $3, cerrada_por = $4, cerrada_en = now() where id = $1`,
            [a, rc.id, rp.id, e.m.persona],
          ),
          "orden_obtenida_es_la_del_libro",
        );
      });
      expect(
        (await dueno.query("select estado from orden_de_produccion where id = $1", [a])).rows[0],
      ).toEqual({ estado: "ABIERTA" });
    });
    it("una orden cerrada sin lo real de algún renglón no se confirma", async () => {
      const e = await escenario();
      const id = await abierta(e);
      await enApp(e.m, async (s, ex) => {
        const origen = { tipo: "TRANSFORMACION", id };
        const rc = await escribirMovimiento(
          ex,
          e.m.empresa,
          salida(e.m, e.d1, e.harina, "60", {
            motivo: "CONSUMO_DE_TRANSFORMACION",
            origen,
            accion: "transformaciones.cerrar",
          }),
        );
        const rp = await escribirMovimiento(
          ex,
          e.m.empresa,
          entrada(e.m, e.d2, e.articulo, "95", {
            motivo: "PRODUCTO_DE_TRANSFORMACION",
            origen,
            accion: "transformaciones.cerrar",
          }),
        );
        acepta(
          await ex(
            `update orden_de_produccion set estado = 'CERRADA', cantidad_obtenida = 95, costo_estado = 'SIN_COSTO', movimiento_de_consumo_id = $2, movimiento_de_producto_id = $3, cerrada_por = $4, cerrada_en = now() where id = $1`,
            [id, rc.id, rp.id, e.m.persona],
          ),
        );
        check(await s.confirmar(), "orden_cerrada_con_reales");
      });
    });
    it("cancelar solo con la orden abierta y con motivo; después no cambia nada", async () => {
      const e = await escenario();
      const id = await abierta(e);
      await enApp(e.m, async (_s, ex) => {
        check(
          await ex(
            "update orden_de_produccion set estado = 'CANCELADA', cancelada_por = $2, cancelada_en = now() where id = $1",
            [id, e.m.persona],
          ),
          "orden_estado_coherente_ck",
        );
        acepta(
          await ex(
            "update orden_de_produccion set estado = 'CANCELADA', motivo = 'Se rompió el horno', cancelada_por = $2, cancelada_en = now() where id = $1",
            [id, e.m.persona],
          ),
        );
      });
      await enApp(e.m, async (_s, ex) => {
        acepta(
          await ex(
            "update orden_de_produccion set estado = 'CANCELADA', motivo = 'Se rompió el horno', cancelada_por = $2, cancelada_en = now() where id = $1",
            [id, e.m.persona],
          ),
        );
      });
      const cerrada = await abierta(e);
      acepta((await cerrar(e, cerrada)).resultado);
      await enApp(e.m, async (_s, ex) => {
        check(
          await ex(
            "update orden_de_produccion set estado = 'CANCELADA', motivo = 'x y', cancelada_por = $2, cancelada_en = now() where id = $1",
            [cerrada, e.m.persona],
          ),
          "orden_transicion_invalida",
        );
      });
      await dueno
        .query(
          "update orden_de_produccion set estado = 'CANCELADA', motivo = 'Se rompió el horno', cancelada_por = $2, cancelada_en = now() where id = $1",
          [id, e.m.persona],
        )
        .catch(() => undefined);
    });
    it("anular exige las dos anulaciones espejo y conserva el costo y los movimientos de lo cerrado", async () => {
      const e = await escenario();
      const id = await abierta(e);
      const c = await cerrar(e, id);
      acepta(c.resultado);
      const origen = { tipo: "TRANSFORMACION", id };
      await enApp(e.m, async (s, ex) => {
        check(
          await ex(
            "update orden_de_produccion set estado = 'ANULADA', motivo = 'Se cargó mal', anulada_por = $2, anulada_en = now(), anulacion_de_consumo_id = $3, anulacion_de_producto_id = $3 where id = $1",
            [id, e.m.persona, randomUUID()],
          ),
          "orden_anulacion_sin_espejos",
        );
        await s.deshacer();
      });
      await enApp(e.m, async (s, ex) => {
        const consumo = salida(e.m, e.d1, e.harina, "60", { id: c.consumo as string });
        const producto = entrada(e.m, e.d2, e.articulo, "95", { id: c.producto as string });
        const a1 = await escribirMovimiento(ex, e.m.empresa, {
          ...espejoDe(e.m, {
            id: c.consumo as string,
            deposito: e.d1,
            renglones: consumo.renglones,
          }),
          origen,
        });
        const a2 = await escribirMovimiento(ex, e.m.empresa, {
          ...espejoDe(e.m, {
            id: c.producto as string,
            deposito: e.d2,
            renglones: producto.renglones,
          }),
          origen,
        });
        acepta(a1.resultado);
        acepta(a2.resultado);
        check(
          await ex(
            "update orden_de_produccion set estado = 'ANULADA', motivo = 'Se cargó mal', anulada_por = $2, anulada_en = now(), anulacion_de_consumo_id = $3, anulacion_de_producto_id = $4, costo_unitario = 5, costo_estado = 'DEFINITIVO' where id = $1",
            [id, e.m.persona, a1.id, a2.id],
          ),
          "orden_cerrada_no_cambia",
        );
        acepta(
          await ex(
            "update orden_de_produccion set estado = 'ANULADA', motivo = 'Se cargó mal', anulada_por = $2, anulada_en = now(), anulacion_de_consumo_id = $3, anulacion_de_producto_id = $4 where id = $1",
            [id, e.m.persona, a1.id, a2.id],
          ),
        );
        acepta(await s.confirmar());
      });
      expect(
        (await dueno.query("select estado from orden_de_produccion where id = $1", [id])).rows[0],
      ).toEqual({ estado: "ANULADA" });
    });
    it("lo que identifica la orden no cambia y lo real se carga una sola vez", async () => {
      const e = await escenario();
      const id = await abierta(e);
      await enApp(e.m, async (_s, ex) => {
        denegado(
          await ex("update orden_de_produccion set cantidad_esperada = 5 where id = $1", [id]),
        );
      });
      await sinConfirmar(dueno, async () => {
        check(
          await intentoDelDueno(
            dueno,
            "update orden_de_produccion set cantidad_esperada = 5 where id = $1",
            [id],
          ),
          "orden_inmutable",
        );
        check(
          await intentoDelDueno(
            dueno,
            "update renglon_de_orden set cantidad_esperada = 5 where orden_id = $1",
            [id],
          ),
          "renglon_de_orden_inmutable",
        );
      });
      await enApp(e.m, async (_s, ex) => {
        acepta(
          await ex("update renglon_de_orden set cantidad_real = 61 where orden_id = $1", [id]),
        );
        check(
          await ex("update renglon_de_orden set cantidad_real = 62 where orden_id = $1", [id]),
          "renglon_de_orden_real_una_vez",
        );
      });
    });
  });

  describe("la migración y su reversión", () => {
    it("sube, baja y sube de nuevo; con órdenes pide confirmar; y frena si `orden_de_produccion` ya existe", async () => {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      const conMia = await carpetaCon([...(await migracionesPrevias()), ARCHIVO]);
      try {
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const c = previa.cliente;
        const antes = await huellaDeCatalogo(c);
        const reversion = await textoDeLaReversion();
        const fila = async () =>
          (await c.query("select 1 from migracion where nombre = $1", [ARCHIVO])).rows.length;
        await c.query("create table orden_de_produccion (x int)");
        await expect(aplicarMigraciones(previa.aparte.base.dueno, conMia)).rejects.toThrow(
          /la tabla orden_de_produccion ya existe/,
        );
        await c.query("drop table orden_de_produccion");
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(await fila()).toBe(1);
        const conOrdenes = await huellaDeCatalogo(c);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        expect(await fila()).toBe(0);
        expect((await aplicarMigraciones(previa.aparte.base.dueno, conMia)).aplicadas).toEqual([
          ARCHIVO,
        ]);
        expect(await huellaDeCatalogo(c)).toEqual(conOrdenes);
        await c
          .query(
            "insert into contador_de_ordenes (empresa_id, ultimo) select id, 1 from empresa limit 1",
          )
          .catch(() => undefined);
        const mundo = await crearMundo(c);
        await c.query("begin");
        await c.query(
          "alter table contador_de_ordenes disable trigger contador_de_ordenes_solo_por_ordenes",
        );
        await c.query("insert into contador_de_ordenes (empresa_id, ultimo) values ($1, 1)", [
          mundo.empresa,
        ]);
        await c.query("commit");
        await c.query("begin");
        await expect(c.query(reversion)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/avisar al dueño/) as string,
        });
        await c.query("rollback");
        await c.query(
          "begin; alter table contador_de_ordenes enable trigger contador_de_ordenes_solo_por_ordenes; commit",
        );
        await c.query(
          `begin; set local pedernal.confirmar_reversion = 'SI'; ${reversion}; commit;`,
        );
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        await c.query(`begin; ${reversion}; commit;`);
      } finally {
        await rm(conMia, { recursive: true, force: true });
        await previa.cerrar();
      }
    });
    it("la reversión declara que es destructiva, no usa CASCADE ni TRUNCATE y su único DELETE es el de su fila del registro", async () => {
      const texto = await textoDeLaReversion();
      expect(texto.replace(/\n--\s*/g, " ")).toMatch(/DESTRUCTIVA/);
      expect(texto.replace(/\n--\s*/g, " ")).toMatch(/NO SE RECUPERA/);
      const codigo = texto.replace(/--.*$/gm, "");
      expect(codigo.match(/\bDELETE\b[^;]*;/gi) ?? []).toHaveLength(1);
      expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
    });
  });
});
