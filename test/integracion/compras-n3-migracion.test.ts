import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { claveDeCompra, huellaAlAzar, materiaPrima, proveedorDeBase } from "./compras-apoyo";
import {
  acepta,
  check,
  clave,
  conAppDe,
  crearMundo,
  denegado,
  intentoDelDueno,
  type Mundo,
} from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { baseConMigraciones, CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import { esperarBloqueo } from "./sesiones";
import {
  articuloDeBase,
  depositoDeBase,
  entrada as entradaDeStock,
  escribirMovimiento,
} from "./stock-apoyo";

/**
 * La migración 0063 (compras N3, recepción separada) contra una base real: la recepción PENDIENTE solo en N3 y N4, las transiciones y quién fija la confirmación,
 * el remito único entre pendientes y confirmadas, el control de la mercadería (solo N3 y N4, misma transacción, observación obligatoria), las entradas de stock por
 * línea y depósito (solo en la transacción que confirma, nunca más que lo recibido, una por línea y depósito), la confirmación simultánea y la reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = ["inspeccion_de_linea_de_recepcion", "entrada_de_linea_de_recepcion"] as const;
const ARCHIVO = "0063_compras_recepcion_separada.sql";
const REVERSION = join(
  CARPETA_DE_MIGRACIONES,
  "reversiones",
  "0063_revertir_compras_recepcion_separada.sql",
);
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)("0063 compras N3: la migración contra una base real", () => {
  let dueno: pg.Client;
  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: b().dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
  });

  const escenario = async () => {
    const m = await crearMundo(dueno);
    const proveedor = await proveedorDeBase(dueno, m);
    const producto = await materiaPrima(dueno, m.empresa);
    return { m, proveedor, producto };
  };
  const cabecera = (m: Mundo, proveedor: string, extra: Record<string, unknown> = {}) => {
    const t: Record<string, unknown> = {
      empresa_id: m.empresa,
      sucursal_id: m.sucursal,
      proveedor_id: proveedor,
      nivel: "RECEPCION_SEPARADA",
      hecho_en: "2026-11-10T15:00:00Z",
      clave_idempotencia: claveDeCompra(),
      huella: huellaAlAzar(),
      registrado_por: m.persona,
      ...extra,
    };
    const cols = Object.keys(t);
    return {
      texto: `insert into recepcion (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")}) returning id`,
      parametros: Object.values(t),
    };
  };
  const linea = (m: Mundo, recepcion: string, producto: string, cantidad = "10") => ({
    texto: `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock)
            values ($1, $2, 1, $3, 'UNIDAD', $4, $4)`,
    parametros: [m.empresa, recepcion, producto, cantidad],
  });
  /** Una recepción N3 con una línea de 10, ya confirmada la transacción (queda PENDIENTE). */
  const pendiente = async (
    m: Mundo,
    proveedor: string,
    producto: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> =>
    conAppDe(b(), m, async (s) => {
      const c = cabecera(m, proveedor, extra);
      const r = await s.intentar(c.texto, c.parametros);
      acepta(r);
      const id = String(r.ok ? r.rows[0]?.id : "");
      const l = linea(m, id, producto);
      acepta(await s.intentar(l.texto, l.parametros));
      expect((await s.confirmar()).ok).toBe(true);
      return id;
    });
  const pendienteN3 = (m: Mundo, proveedor: string, producto: string) =>
    pendiente(m, proveedor, producto, { estado: "PENDIENTE" });
  const confirmarSql = `update recepcion set estado = 'CONFIRMADA', confirmada_por = $3 where id = $1 and empresa_id = $2 and estado = 'PENDIENTE'`;
  const movimiento = async (m: Mundo, deposito: string): Promise<string> => {
    const { articulo } = await articuloDeBase(dueno, m);
    await dueno.query("begin");
    try {
      const e = await escribirMovimiento(
        (texto, parametros) => intentoDelDueno(dueno, texto, parametros),
        m.empresa,
        entradaDeStock(m, deposito, articulo, "10"),
      );
      acepta(e.resultado);
      await dueno.query("commit");
      return e.id;
    } catch (error) {
      await dueno.query("rollback");
      throw error;
    }
  };
  const entrada = (
    m: Mundo,
    recepcion: string,
    deposito: string,
    movimientoId: string,
    cantidad: string,
  ) => ({
    texto: `insert into entrada_de_linea_de_recepcion (empresa_id, recepcion_id, linea, deposito_id, movimiento_id, cantidad) values ($1, $2, 1, $3, $4, $5)`,
    parametros: [m.empresa, recepcion, deposito, movimientoId, cantidad],
  });

  it("crea las dos tablas con RLS forzada, SELECT e INSERT solamente y sin DELETE, UPDATE ni TRUNCATE para nadie", async () => {
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
    for (const t of TABLAS)
      expect(
        politicas
          .filter((p) => p.tablename === t)
          .map((p) => p.cmd)
          .sort(),
        t,
      ).toEqual(["INSERT", "SELECT"]);
    const privilegios = (
      await dueno.query<{ privilege_type: string }>(
        "select privilege_type from information_schema.role_table_grants where table_schema = 'public' and table_name = any($1) and grantee = 'pedernal_app'",
        [[...TABLAS]],
      )
    ).rows;
    expect(
      privilegios.filter((p) => ["DELETE", "TRUNCATE", "UPDATE"].includes(p.privilege_type)),
    ).toEqual([]);
  });

  it("PENDIENTE solo existe en N3 y N4, nunca como atajo ni ya confirmada; una N3 no atajo no nace CONFIRMADA sin confirmar", async () => {
    const { m, proveedor } = await escenario();
    await conAppDe(b(), m, async (s) => {
      const casos: [Record<string, unknown>, string][] = [
        [{ nivel: "COMPRA_SIMPLE", estado: "PENDIENTE" }, "recepcion_pendiente_ck"],
        [{ nivel: "CON_COMPROBANTE", estado: "PENDIENTE" }, "recepcion_pendiente_ck"],
        [{ estado: "PENDIENTE", es_atajo: true }, "recepcion_pendiente_ck"],
        [{ estado: "CONFIRMADA" }, "recepcion_confirmada_ck"],
      ];
      for (const [extra, restriccion] of casos) {
        const c = cabecera(m, proveedor, extra);
        check(await s.intentar(c.texto, c.parametros), restriccion);
      }
      for (const extra of [
        { nivel: "RECEPCION_SEPARADA", estado: "PENDIENTE" },
        { nivel: "TRES_VIAS", estado: "PENDIENTE" },
        { nivel: "RECEPCION_SEPARADA", estado: "CONFIRMADA", es_atajo: true },
      ]) {
        const c = cabecera(m, proveedor, extra);
        acepta(await s.intentar(c.texto, c.parametros));
      }
    });
  });

  it("PENDIENTE → CONFIRMADA fija quién y cuándo; no hay vuelta atrás ni confirmación fuera de esa transición; PENDIENTE → ANULADA con motivo", async () => {
    const { m, proveedor, producto } = await escenario();
    const id = await pendienteN3(m, proveedor, producto);
    await conAppDe(b(), m, async (s) => {
      check(
        await s.intentar(
          "update recepcion set confirmada_por = $3 where id = $1 and empresa_id = $2",
          [id, m.empresa, m.persona],
        ),
        "recepcion_confirmacion_invalida",
      );
      const r = await s.intentar(confirmarSql, [id, m.empresa, m.persona]);
      acepta(r);
      expect(r.ok && r.filas).toBe(1);
      const fila = await s.intentar(
        "select estado, confirmada_por, confirmada_en is not null as con_hora from recepcion where id = $1",
        [id],
      );
      expect(fila.ok && fila.rows[0]).toEqual({
        estado: "CONFIRMADA",
        confirmada_por: m.persona,
        con_hora: true,
      });
      expect((await s.confirmar()).ok).toBe(true);
    });
    await conAppDe(b(), m, async (s) => {
      check(
        await s.intentar(
          "update recepcion set estado = 'PENDIENTE' where id = $1 and empresa_id = $2",
          [id, m.empresa],
        ),
        "recepcion_transicion_invalida",
      );
      check(
        await s.intentar(
          "update recepcion set confirmada_por = null, confirmada_en = null where id = $1 and empresa_id = $2",
          [id, m.empresa],
        ),
        "recepcion_confirmacion_invalida",
      );
      denegado(
        await s.intentar(
          "update recepcion set sucursal_id = gen_random_uuid() where id = $1 and empresa_id = $2",
          [id, m.empresa],
        ),
      );
      acepta(
        await s.intentar(
          "update recepcion set estado = 'ANULADA', anulada_por = $3, anulada_en = now(), motivo_de_anulacion = 'Error de carga' where id = $1 and empresa_id = $2",
          [id, m.empresa, m.persona],
        ),
      );
    });
    const otra = await pendienteN3(m, proveedor, producto);
    await conAppDe(b(), m, async (s) => {
      acepta(
        await s.intentar(
          "update recepcion set estado = 'ANULADA', anulada_por = $3, anulada_en = now(), motivo_de_anulacion = 'No era' where id = $1 and empresa_id = $2",
          [otra, m.empresa, m.persona],
        ),
      );
    });
  });

  it("el remito no se repite entre pendientes y confirmadas; la anulada libera el número", async () => {
    const { m, proveedor, producto } = await escenario();
    const remito = { remito_punto_de_venta: 4, remito_numero: 777, remito_fecha: "2026-11-10" };
    const primera = await pendiente(m, proveedor, producto, { estado: "PENDIENTE", ...remito });
    await conAppDe(b(), m, async (s) => {
      const c = cabecera(m, proveedor, { estado: "PENDIENTE", ...remito });
      clave(await s.intentar(c.texto, c.parametros), "recepcion_remito_uk");
      const d = cabecera(m, proveedor, { nivel: "COMPRA_SIMPLE", ...remito });
      clave(await s.intentar(d.texto, d.parametros), "recepcion_remito_uk");
      acepta(
        await s.intentar(
          "update recepcion set estado = 'ANULADA', anulada_por = $3, anulada_en = now(), motivo_de_anulacion = 'Repetido' where id = $1 and empresa_id = $2",
          [primera, m.empresa, m.persona],
        ),
      );
      const e = cabecera(m, proveedor, { estado: "PENDIENTE", ...remito });
      acepta(await s.intentar(e.texto, e.parametros));
    });
  });

  it("el control de la mercadería: solo en N3 y N4, en la transacción de su recepción, con observación si no es conforme y sin cambios después", async () => {
    const { m, proveedor, producto } = await escenario();
    const insertar = (id: string, extra: Record<string, unknown> = {}) => {
      const t: Record<string, unknown> = {
        empresa_id: m.empresa,
        recepcion_id: id,
        linea: 1,
        condicion: "CONFORME",
        ...extra,
      };
      const cols = Object.keys(t);
      return {
        texto: `insert into inspeccion_de_linea_de_recepcion (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
        parametros: Object.values(t),
      };
    };
    const tarde = await pendienteN3(m, proveedor, producto);
    await conAppDe(b(), m, async (s) => {
      // N3 en su transacción.
      const c = cabecera(m, proveedor, { estado: "PENDIENTE" });
      const r = await s.intentar(c.texto, c.parametros);
      acepta(r);
      const id = String(r.ok ? r.rows[0]?.id : "");
      const l = linea(m, id, producto);
      acepta(await s.intentar(l.texto, l.parametros));
      check(
        await s.intentar(
          ...(Object.values(insertar(id, { condicion: "CON_OBSERVACIONES" })) as [
            string,
            unknown[],
          ]),
        ),
        "inspeccion_observacion_requerida_ck",
      );
      check(
        await s.intentar(
          ...(Object.values(insertar(id, { condicion: "RECHAZADA", observacion: "   " })) as [
            string,
            unknown[],
          ]),
        ),
        "inspeccion_observacion_ck",
      );
      check(
        await s.intentar(
          ...(Object.values(insertar(id, { temperatura_en_c: -300 })) as [string, unknown[]]),
        ),
        "inspeccion_temperatura_ck",
      );
      check(
        await s.intentar(
          ...(Object.values(insertar(id, { cantidad_segun_remito: 0 })) as [string, unknown[]]),
        ),
        "inspeccion_cantidad_remito_ck",
      );
      const ok = insertar(id, {
        condicion: "RECHAZADA",
        observacion: "Llegó descongelada",
        temperatura_en_c: 9.5,
        cantidad_segun_remito: "10",
      });
      acepta(await s.intentar(ok.texto, ok.parametros));
      const repetida = insertar(id);
      clave(
        await s.intentar(repetida.texto, repetida.parametros),
        "inspeccion_de_linea_de_recepcion_pkey",
      );
      denegado(
        await s.intentar("update inspeccion_de_linea_de_recepcion set condicion = 'CONFORME'"),
      );
      // N1: no hay control.
      const c1 = cabecera(m, proveedor, { nivel: "COMPRA_SIMPLE" });
      const r1 = await s.intentar(c1.texto, c1.parametros);
      acepta(r1);
      const id1 = String(r1.ok ? r1.rows[0]?.id : "");
      const l1 = linea(m, id1, producto);
      acepta(await s.intentar(l1.texto, l1.parametros));
      const sinNivel = insertar(id1);
      check(await s.intentar(sinNivel.texto, sinNivel.parametros), "inspeccion_nivel_ck");
    });
    // Después, en otra transacción: ya no.
    await conAppDe(b(), m, async (s) => {
      const t = insertar(tarde);
      check(await s.intentar(t.texto, t.parametros), "inspeccion_cabecera_confirmada");
    });
  });

  it("las entradas de stock: solo al confirmar, una por línea y depósito, nunca más que lo recibido, y no entran en una pendiente ni después", async () => {
    const { m, proveedor, producto } = await escenario();
    const normal = await depositoDeBase(dueno, m);
    // Entrar a un depósito de cuarentena o rechazo lo rechaza hoy el libro de stock (`renglon_deposito_de_uso_restringido`): es el tramo N3-3 (decisión del 14/11).
    const cuarentena = await depositoDeBase(dueno, m);
    const id = await pendienteN3(m, proveedor, producto);
    const mov = [
      await movimiento(m, normal),
      await movimiento(m, cuarentena),
      await movimiento(m, normal),
    ];
    await conAppDe(b(), m, async (s) => {
      const antes = entrada(m, id, normal, mov[0] as string, "4");
      check(await s.intentar(antes.texto, antes.parametros), "entrada_de_linea_confirmacion");
      acepta(await s.intentar(confirmarSql, [id, m.empresa, m.persona]));
      const a = entrada(m, id, normal, mov[0] as string, "4");
      acepta(await s.intentar(a.texto, a.parametros));
      const repetida = entrada(m, id, normal, mov[2] as string, "1");
      clave(
        await s.intentar(repetida.texto, repetida.parametros),
        "entrada_de_linea_de_recepcion_pkey",
      );
      const demas = entrada(m, id, cuarentena, mov[1] as string, "6.0001");
      check(await s.intentar(demas.texto, demas.parametros), "entrada_de_linea_excede_lo_recibido");
      const justa = entrada(m, id, cuarentena, mov[1] as string, "6");
      acepta(await s.intentar(justa.texto, justa.parametros));
      expect((await s.confirmar()).ok).toBe(true);
    });
    // Otra transacción: la recepción ya estaba confirmada, el stock ya no entra.
    const tarde = await depositoDeBase(dueno, m);
    const movTarde = await movimiento(m, tarde);
    await conAppDe(b(), m, async (s) => {
      const t = entrada(m, id, tarde, movTarde, "1");
      check(await s.intentar(t.texto, t.parametros), "entrada_de_linea_confirmacion");
    });
    // Una recepción de N1 no tiene entradas por línea.
    await conAppDe(b(), m, async (s) => {
      const c = cabecera(m, proveedor, { nivel: "COMPRA_SIMPLE" });
      const r = await s.intentar(c.texto, c.parametros);
      acepta(r);
      const n1 = String(r.ok ? r.rows[0]?.id : "");
      const l = linea(m, n1, producto);
      acepta(await s.intentar(l.texto, l.parametros));
      const e = entrada(m, n1, normal, await movimiento(m, normal), "1");
      check(await s.intentar(e.texto, e.parametros), "entrada_de_linea_nivel_ck");
    });
  });

  it("un mismo movimiento de stock cubre varias líneas del mismo depósito (así entra una recepción de varios renglones)", async () => {
    const { m, proveedor, producto } = await escenario();
    const deposito = await depositoDeBase(dueno, m);
    const id = await conAppDe(b(), m, async (s) => {
      const c = cabecera(m, proveedor, { estado: "PENDIENTE" });
      const r = await s.intentar(c.texto, c.parametros);
      acepta(r);
      const nueva = String(r.ok ? r.rows[0]?.id : "");
      for (const numero of [1, 2]) {
        acepta(
          await s.intentar(
            `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock)
             values ($1, $2, $3, $4, 'UNIDAD', 5, 5)`,
            [m.empresa, nueva, numero, producto],
          ),
        );
      }
      expect((await s.confirmar()).ok).toBe(true);
      return nueva;
    });
    const movimientoId = await movimiento(m, deposito);
    await conAppDe(b(), m, async (s) => {
      acepta(await s.intentar(confirmarSql, [id, m.empresa, m.persona]));
      for (const linea of [1, 2]) {
        acepta(
          await s.intentar(
            `insert into entrada_de_linea_de_recepcion (empresa_id, recepcion_id, linea, deposito_id, movimiento_id, cantidad) values ($1, $2, $3, $4, $5, 5)`,
            [m.empresa, id, linea, deposito, movimientoId],
          ),
        );
      }
      expect((await s.confirmar()).ok).toBe(true);
    });
  });

  it("dos personas confirman la misma recepción a la vez: una sola gana y la otra no encuentra nada que confirmar", async () => {
    const { m, proveedor, producto } = await escenario();
    const id = await pendienteN3(m, proveedor, producto);
    await conAppDe(b(), m, async (s1) => {
      await conAppDe(b(), m, async (s2) => {
        const primera = await s1.directo(confirmarSql, [id, m.empresa, m.persona]);
        expect(primera.ok && primera.filas).toBe(1);
        const segunda = s2.directo(confirmarSql, [id, m.empresa, m.persona]);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        const r = await segunda;
        expect(r.ok && r.filas).toBe(0);
      });
    });
    const fila = await dueno.query<{ estado: string }>(
      "select estado from recepcion where id = $1",
      [id],
    );
    expect(fila.rows[0]?.estado).toBe("CONFIRMADA");
  });

  it("aislamiento: otra empresa no ve ni escribe controles y entradas ajenos", async () => {
    const a = await escenario();
    const otra = await escenario();
    const id = await pendienteN3(a.m, a.proveedor, a.producto);
    await conAppDe(b(), a.m, async (s) => {
      const c = await s.intentar(
        "insert into inspeccion_de_linea_de_recepcion (empresa_id, recepcion_id, linea, condicion) values ($1, $2, 1, 'CONFORME')",
        [a.m.empresa, id],
      );
      check(c, "inspeccion_cabecera_confirmada");
    });
    await conAppDe(b(), otra.m, async (s) => {
      const r = await s.intentar("select count(*)::int as n from entrada_de_linea_de_recepcion");
      expect(r.ok && r.rows[0]).toEqual({ n: 0 });
      denegado(await s.intentar("delete from inspeccion_de_linea_de_recepcion"));
    });
  });

  describe("reversión", () => {
    async function conPrevias<T>(
      trabajo: (previa: Awaited<ReturnType<typeof baseConMigraciones>>) => Promise<T>,
    ): Promise<T> {
      const previas = (await readdir(CARPETA_DE_MIGRACIONES))
        .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < ARCHIVO)
        .sort();
      const previa = await baseConMigraciones(b(), previas);
      try {
        return await trabajo(previa);
      } finally {
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
    it("sin datos deja la base como antes y se puede repetir; con una PENDIENTE frena siempre; con controles pide confirmación", async () => {
      await conPrevias(async (previa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        await revertir(previa.cliente);
        await revertir(previa.cliente);
        const cols = await previa.cliente.query(
          "select 1 from information_schema.columns where table_name = 'recepcion' and column_name = 'confirmada_por'",
        );
        expect(cols.rowCount).toBe(0);
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const m = await crearMundo(previa.cliente);
        const proveedor = await proveedorDeBase(previa.cliente, m);
        const producto = await materiaPrima(previa.cliente, m.empresa);
        const id = randomUUID();
        await previa.cliente.query(
          `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, estado, hecho_en, clave_idempotencia, huella, registrado_por)
           values ($1, $2, $3, $4, 'RECEPCION_SEPARADA', 'PENDIENTE', now(), $5, $6, $7)`,
          [id, m.empresa, m.sucursal, proveedor, claveDeCompra(), huellaAlAzar(), m.persona],
        );
        void producto;
        await expect(revertir(previa.cliente, true)).rejects.toThrow(/PENDIENTE/);
        await previa.cliente.query(
          "update recepcion set estado = 'ANULADA', anulada_por = $2, anulada_en = now(), motivo_de_anulacion = 'Prueba' where id = $1",
          [id, m.persona],
        );
        await revertir(previa.cliente);
      });
    });
  });
});
