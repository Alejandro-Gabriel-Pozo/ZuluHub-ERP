import { randomUUID } from "node:crypto";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { claveDeCompra, huellaAlAzar, proveedorDeBase } from "./compras-apoyo";
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
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { esperarBloqueo } from "./sesiones";
import { nombreUnico } from "./unicos";
import {
  articuloDeBase,
  depositoDeBase,
  entrada as entradaDeStock,
  escribirMovimiento,
} from "./stock-apoyo";
import { conectarDueno, motivoDeRechazo } from "./compras-devoluciones-apoyo";

/**
 * La migración 0084 (compras N4, devolución al proveedor) contra una base real: el motivo de stock sembrado, las dos tablas con RLS forzada, el motivo de la devolución (de la lista del sistema de
 * motivos de rechazo y activo), el número consecutivo (también con dos altas a la vez), las transiciones, que la línea solo entra con su devolución, el tope «no más de lo recibido» (con una devolución
 * anulada que deja de contar, otro proveedor, otro producto y dos devoluciones simultáneas de la misma línea) y el aislamiento entre empresas. La reversión y el reaplicar los prueba `compras-reversiones.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = ["devolucion_a_proveedor", "linea_de_devolucion"] as const;
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)("0084 compras N4: devoluciones contra una base real", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = await conectarDueno(b());
  });
  afterAll(async () => {
    await dueno.end();
  });

  /** Una empresa con proveedor, depósito, un artículo de stock y UNA línea recibida (10) confirmada de ese artículo, y el motivo de la lista. */
  const escenario = async () => {
    const m = await crearMundo(dueno);
    const proveedor = await proveedorDeBase(dueno, m);
    const deposito = await depositoDeBase(dueno, m);
    const { producto, articulo } = await articuloDeBase(dueno, m);
    const recepcion = randomUUID();
    await dueno.query("begin");
    try {
      await dueno.query(
        `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, hecho_en, clave_idempotencia, huella, registrado_por)
         values ($1, $2, $3, $4, 'COMPRA_SIMPLE', now(), $5, $6, $7)`,
        [recepcion, m.empresa, m.sucursal, proveedor, claveDeCompra(), huellaAlAzar(), m.persona],
      );
      await dueno.query(
        `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock)
         values ($1, $2, 1, $3, 'UNIDAD', 10, 10)`,
        [m.empresa, recepcion, producto],
      );
      await dueno.query("commit");
    } catch (error) {
      await dueno.query("rollback");
      throw error;
    }
    return {
      m,
      proveedor,
      deposito,
      producto,
      articulo,
      recepcion,
      motivo: await motivoDeRechazo(dueno),
    };
  };
  type E = Awaited<ReturnType<typeof escenario>>;

  /** Un movimiento de stock con un renglón de (depósito, artículo): lo que la línea de la devolución referencia (la base no mira la clase). */
  const renglon = async (e: E): Promise<string> => {
    await dueno.query("begin");
    try {
      const r = await escribirMovimiento(
        (texto, parametros) => intentoDelDueno(dueno, texto, parametros),
        e.m.empresa,
        entradaDeStock(e.m, e.deposito, e.articulo, "10"),
      );
      acepta(r.resultado);
      await dueno.query("commit");
      return r.id;
    } catch (error) {
      await dueno.query("rollback");
      throw error;
    }
  };
  const cabecera = (e: E, extra: Record<string, unknown> = {}) => {
    const t: Record<string, unknown> = {
      id: randomUUID(),
      empresa_id: e.m.empresa,
      sucursal_id: e.m.sucursal,
      proveedor_id: e.proveedor,
      motivo_id: e.motivo,
      clave_idempotencia: claveDeCompra(),
      huella: huellaAlAzar(),
      hecho_en: "2026-11-10T15:00:00Z",
      registrado_por: e.m.persona,
      ...extra,
    };
    const cols = Object.keys(t);
    return {
      id: t["id"] as string,
      texto: `insert into devolucion_a_proveedor (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
      parametros: Object.values(t),
    };
  };
  const linea = (
    e: E,
    devolucion: string,
    movimiento: string,
    cantidad: string,
    deRecepcion = true,
    numero = 1,
  ) => ({
    texto: `insert into linea_de_devolucion (empresa_id, devolucion_id, numero, deposito_id, articulo_id, cantidad, recepcion_id, linea_de_recepcion, movimiento_id, renglon_numero)
            values ($1, $2, $3, $4, $5, $6, $7, $8, $9, 1)`,
    parametros: [
      e.m.empresa,
      devolucion,
      numero,
      e.deposito,
      e.articulo,
      cantidad,
      deRecepcion ? e.recepcion : null,
      deRecepcion ? 1 : null,
      movimiento,
    ],
  });
  /** Una devolución con su línea, en UNA transacción confirmada; devuelve su id. */
  const devolver = async (
    e: E,
    cantidad: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> => {
    const movimiento = await renglon(e);
    return conAppDe(b(), e.m, async (s) => {
      const c = cabecera(e, extra);
      acepta(await s.intentar(c.texto, c.parametros));
      const l = linea(e, c.id, movimiento, cantidad);
      acepta(await s.intentar(l.texto, l.parametros));
      expect((await s.confirmar()).ok).toBe(true);
      return c.id;
    });
  };

  it("el motivo de stock queda sembrado y las dos tablas tienen RLS forzada, las políticas esperadas y nadie recibe DELETE ni TRUNCATE", async () => {
    const motivo = await dueno.query<{ entra_con_costo: boolean; entrega_mercaderia: boolean }>(
      "select entra_con_costo, entrega_mercaderia from motivo_de_movimiento where clase = 'SALIDA' and codigo = 'DEVOLUCION_A_PROVEEDOR'",
    );
    expect(motivo.rows).toEqual([{ entra_con_costo: false, entrega_mercaderia: false }]);
    const tablas = (
      await dueno.query<{ relname: string; relrowsecurity: boolean; relforcerowsecurity: boolean }>(
        "select relname, relrowsecurity, relforcerowsecurity from pg_class where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)",
        [[...TABLAS]],
      )
    ).rows;
    expect(tablas).toHaveLength(TABLAS.length);
    for (const t of tablas)
      expect([t.relrowsecurity, t.relforcerowsecurity], t.relname).toEqual([true, true]);
    const politicas = (
      await dueno.query<{ tablename: string; cmd: string }>(
        "select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)",
        [[...TABLAS]],
      )
    ).rows;
    const de = (t: string) =>
      politicas
        .filter((p) => p.tablename === t)
        .map((p) => p.cmd)
        .sort();
    expect(de("devolucion_a_proveedor")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(de("linea_de_devolucion")).toEqual(["INSERT", "SELECT"]);
    const privilegios = (
      await dueno.query<{ privilege_type: string }>(
        "select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee = 'pedernal_app'",
        [[...TABLAS]],
      )
    ).rows;
    expect(privilegios.filter((p) => ["DELETE", "TRUNCATE"].includes(p.privilege_type))).toEqual(
      [],
    );
  });

  it("el alta pone el número consecutivo y la jornada, la clave es única por empresa, y no se cambia a mano nada más que la anulación", async () => {
    const e = await escenario();
    const a = await devolver(e, "1");
    const c = await devolver(e, "1");
    const filas = await dueno.query<{ id: string; numero: number; fecha_negocio: string }>(
      "select id, numero, fecha_negocio::text from devolucion_a_proveedor where id = any($1) order by numero",
      [[a, c]],
    );
    expect(filas.rows.map((f) => f.id)).toEqual([a, c]);
    expect(filas.rows[1]?.numero).toBe((filas.rows[0]?.numero ?? 0) + 1);
    expect(filas.rows[0]?.fecha_negocio).toBe("2026-11-10");
    await conAppDe(b(), e.m, async (s) => {
      const repetida = cabecera(e, { clave_idempotencia: "clave-repetida-de-prueba-1" });
      acepta(await s.intentar(repetida.texto, repetida.parametros));
      const otra = cabecera(e, { clave_idempotencia: "clave-repetida-de-prueba-1" });
      clave(await s.intentar(otra.texto, otra.parametros), "devolucion_clave_uk");
      denegado(
        await s.intentar("update devolucion_a_proveedor set motivo_id = motivo_id where id = $1", [
          a,
        ]),
      );
      denegado(
        await s.intentar("update devolucion_a_proveedor set numero = 99 where id = $1", [a]),
      );
      denegado(await s.intentar("delete from devolucion_a_proveedor where id = $1", [a]));
    });
  });

  it("dos altas a la vez de la misma empresa toman números distintos", async () => {
    const e = await escenario();
    const movimientos = [await renglon(e), await renglon(e)];
    const ids: string[] = [];
    await conAppDe(b(), e.m, async (s1) => {
      await conAppDe(b(), e.m, async (s2) => {
        const c1 = cabecera(e);
        const c2 = cabecera(e);
        ids.push(c1.id, c2.id);
        acepta(await s1.intentar(c1.texto, c1.parametros));
        const segunda = s2.directo(c2.texto, c2.parametros);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        acepta(
          await s1.intentar(
            linea(e, c1.id, movimientos[0] as string, "1", false).texto,
            linea(e, c1.id, movimientos[0] as string, "1", false).parametros,
          ),
        );
        expect((await s1.confirmar()).ok).toBe(true);
        expect((await segunda).ok).toBe(true);
        acepta(
          await s2.intentar(
            linea(e, c2.id, movimientos[1] as string, "1", false).texto,
            linea(e, c2.id, movimientos[1] as string, "1", false).parametros,
          ),
        );
        expect((await s2.confirmar()).ok).toBe(true);
      });
    });
    const numeros = await dueno.query<{ numero: number }>(
      "select numero from devolucion_a_proveedor where id = any($1)",
      [ids],
    );
    expect(new Set(numeros.rows.map((n) => n.numero)).size).toBe(2);
  });

  it("el motivo es de la lista de motivos de rechazo y está activo: de otra lista, desactivado o inexistente se rechaza; desactivado después, lo ya devuelto lo conserva", async () => {
    const e = await escenario();
    const otraLista = (
      await dueno.query<{ id: string }>(
        "select id from valor_de_lista where lista = 'MARCAS_DE_TARJETA' limit 1",
      )
    ).rows[0]?.id as string;
    const nombre = nombreUnico("Motivo");
    const nuevo = (
      await dueno.query<{ id: string }>(
        "insert into valor_de_lista (lista, nombre) values ('MOTIVOS_DE_RECHAZO', $1) returning id",
        [nombre],
      )
    ).rows[0]?.id as string;
    const antes = await devolver(e, "1", { motivo_id: nuevo });
    await dueno.query("update valor_de_lista set activo = false where id = $1", [nuevo]);
    await conAppDe(b(), e.m, async (s) => {
      for (const motivo of [otraLista, nuevo]) {
        const c = cabecera(e, { motivo_id: motivo });
        check(await s.intentar(c.texto, c.parametros), "devolucion_motivo_invalido");
      }
      // Inexistente: el disparador la rechaza antes de que la clave foránea (que queda de red de seguridad) la mire.
      const c = cabecera(e, { motivo_id: randomUUID() });
      check(await s.intentar(c.texto, c.parametros), "devolucion_motivo_invalido");
    });
    const guardada = await dueno.query<{ motivo_id: string }>(
      "select motivo_id from devolucion_a_proveedor where id = $1",
      [antes],
    );
    expect(guardada.rows[0]?.motivo_id).toBe(nuevo);
  });

  it("transiciones: solo CONFIRMADA → ANULADA con quién, motivo y momento (lo fija la base); nada vuelve ni se cambia", async () => {
    const e = await escenario();
    const id = await devolver(e, "2");
    await conAppDe(b(), e.m, async (s) => {
      check(
        await s.intentar(
          "update devolucion_a_proveedor set estado = 'ANULADA', anulada_por = $2 where id = $1",
          [id, e.m.persona],
        ),
        "devolucion_anulacion_ck",
      );
      acepta(
        await s.intentar(
          "update devolucion_a_proveedor set estado = 'ANULADA', anulada_por = $2, motivo_de_anulacion = 'Se cargó mal' where id = $1",
          [id, e.m.persona],
        ),
      );
      check(
        await s.intentar("update devolucion_a_proveedor set estado = 'CONFIRMADA' where id = $1", [
          id,
        ]),
        "devolucion_transicion_invalida",
      );
      const r = await s.intentar(
        "select estado, anulada_por, anulada_en is not null as con_momento, version from devolucion_a_proveedor where id = $1",
        [id],
      );
      expect(r.ok && r.rows[0]).toEqual({
        estado: "ANULADA",
        anulada_por: e.m.persona,
        con_momento: true,
        version: 2,
      });
    });
    await sinConfirmar(dueno, async () => {
      for (const sql of [
        "update devolucion_a_proveedor set huella = $2 where id = $1",
        "update devolucion_a_proveedor set hecho_en = now() where id = $1",
      ]) {
        const r = await intentoDelDueno(
          dueno,
          sql,
          [id, huellaAlAzar()].slice(0, sql.includes("$2") ? 2 : 1),
        );
        expect(r.ok ? "" : r.restriccion).toBe("devolucion_inmutable");
      }
    });
  });

  it("la línea solo entra con su devolución, de solo inserción, y con una cantidad positiva y un artículo de la empresa", async () => {
    const e = await escenario();
    const otra = await escenario();
    const id = await devolver(e, "1");
    const movimiento = await renglon(e);
    await conAppDe(b(), e.m, async (s) => {
      const fuera = linea(e, id, movimiento, "1", true, 2);
      check(
        await s.intentar(fuera.texto, fuera.parametros),
        "linea_de_devolucion_cabecera_confirmada",
      );
      denegado(
        await s.intentar("update linea_de_devolucion set cantidad = 1 where devolucion_id = $1", [
          id,
        ]),
      );
      denegado(await s.intentar("delete from linea_de_devolucion where devolucion_id = $1", [id]));
    });
    await conAppDe(b(), e.m, async (s) => {
      const c = cabecera(e);
      acepta(await s.intentar(c.texto, c.parametros));
      check(
        await s.intentar(
          linea(e, c.id, movimiento, "0", false).texto,
          linea(e, c.id, movimiento, "0", false).parametros,
        ),
        "linea_de_devolucion_cantidad_ck",
      );
      const ajeno = { ...linea(e, c.id, movimiento, "1", false) };
      ajeno.parametros[4] = otra.articulo;
      referencia(
        await s.intentar(ajeno.texto, ajeno.parametros),
        "linea_de_devolucion_articulo_fkey",
      );
    });
  });

  it("con línea recibida de origen: no se devuelve más de lo recibido, la anulada deja de contar, y la recepción tiene que ser del proveedor, confirmada y del mismo producto", async () => {
    const e = await escenario();
    await devolver(e, "6");
    const exceso = await renglon(e);
    await conAppDe(b(), e.m, async (s) => {
      const c = cabecera(e);
      acepta(await s.intentar(c.texto, c.parametros));
      const l = linea(e, c.id, exceso, "5");
      check(await s.intentar(l.texto, l.parametros), "devolucion_excede_lo_recibido");
    });
    // la anulada deja de contar: se anula la de 6 y entran 10
    const previa = (
      await dueno.query<{ id: string }>(
        "select id from devolucion_a_proveedor where empresa_id = $1",
        [e.m.empresa],
      )
    ).rows[0]?.id as string;
    await dueno.query(
      "update devolucion_a_proveedor set estado = 'ANULADA', anulada_por = $2, motivo_de_anulacion = 'x' where id = $1",
      [previa, e.m.persona],
    );
    await devolver(e, "10");
    // otro proveedor, otro producto, recepción anulada
    const otroProveedor = await proveedorDeBase(dueno, e.m);
    const m3 = await renglon(e);
    await conAppDe(b(), e.m, async (s) => {
      const c1 = cabecera(e, { proveedor_id: otroProveedor });
      acepta(await s.intentar(c1.texto, c1.parametros));
      const l1 = linea(e, c1.id, m3, "1");
      check(await s.intentar(l1.texto, l1.parametros), "devolucion_de_otro_proveedor");
    });
    const otro = await articuloDeBase(dueno, e.m);
    const m4 = await renglon({ ...e, articulo: otro.articulo });
    await conAppDe(b(), e.m, async (s) => {
      const c2 = cabecera(e);
      acepta(await s.intentar(c2.texto, c2.parametros));
      const l2 = linea({ ...e, articulo: otro.articulo }, c2.id, m4, "1");
      check(await s.intentar(l2.texto, l2.parametros), "devolucion_de_otro_producto");
    });
    await dueno.query(
      "update recepcion set estado = 'ANULADA', anulada_por = $2, anulada_en = now(), motivo_de_anulacion = 'x' where id = $1",
      [e.recepcion, e.m.persona],
    );
    const m5 = await renglon(e);
    await conAppDe(b(), e.m, async (s) => {
      const c3 = cabecera(e);
      acepta(await s.intentar(c3.texto, c3.parametros));
      const l3 = linea(e, c3.id, m5, "1");
      check(await s.intentar(l3.texto, l3.parametros), "devolucion_recepcion_no_confirmada");
    });
  });

  it("dos devoluciones simultáneas de la misma línea recibida que no caben juntas: se serializan, entra una y la otra se pasa de lo recibido", async () => {
    const e = await escenario();
    const movimientos = [await renglon(e), await renglon(e)];
    await conAppDe(b(), e.m, async (s1) => {
      await conAppDe(b(), e.m, async (s2) => {
        const c1 = cabecera(e);
        const c2 = cabecera(e);
        acepta(await s1.intentar(c1.texto, c1.parametros));
        const l1 = linea(e, c1.id, movimientos[0] as string, "7");
        acepta(await s1.intentar(l1.texto, l1.parametros));
        // la segunda espera el número (candado por empresa) hasta que la primera termine
        const segunda = s2.directo(c2.texto, c2.parametros);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        expect((await segunda).ok).toBe(true);
        const l2 = linea(e, c2.id, movimientos[1] as string, "7");
        const r = await s2.intentar(l2.texto, l2.parametros);
        check(r, "devolucion_excede_lo_recibido");
      });
    });
    const vigentes = await dueno.query<{ n: string }>(
      "select coalesce(sum(l.cantidad), 0)::text as n from linea_de_devolucion l where l.empresa_id = $1",
      [e.m.empresa],
    );
    expect(vigentes.rows[0]?.n).toBe("7.0000");
  });

  it("aislamiento: otra empresa no ve ni toca las devoluciones ajenas", async () => {
    const e = await escenario();
    const otra = await escenario();
    const id = await devolver(e, "1");
    await conAppDe(b(), otra.m, async (s) => {
      for (const t of TABLAS) {
        const r = await s.intentar(`select count(*)::int as n from ${t}`);
        expect(r.ok && r.rows[0], t).toEqual({ n: 0 });
      }
      const u = await s.directo(
        "update devolucion_a_proveedor set estado = 'ANULADA', anulada_por = $2, motivo_de_anulacion = 'x' where id = $1",
        [id, otra.m.persona],
      );
      expect(u.ok && u.filas).toBe(0);
    });
  });
});
