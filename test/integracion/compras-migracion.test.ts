import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import {
  claveDeCompra,
  comprobanteDeBase,
  huellaAlAzar,
  materiaPrima,
  proveedorDeBase,
  recepcionDeBase,
} from "./compras-apoyo";
import { acepta, check, clave, conAppDe, crearMundo, denegado, type Mundo } from "./fiscal-apoyo";
import type { BaseDePruebas } from "./global";
import { baseConMigraciones, CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";
import type { SesionDePrueba } from "./sesiones";

/**
 * La migración 0037 (E9 compras N1 y N2) contra una base real: RLS forzada y una política por comando, nada se borra, peso variable sin pesar (R1), «sin
 * precio» nunca cero, remito y factura únicos (C1, C2), un pago vigente por factura (C8), los saldos que solo escribe el disparador y que nunca superan lo
 * recibido ni lo facturado (C3), solo inserción (R7), numeración y fecha de negocio (C11, R10), aislamiento (R6) y la reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = [
  "configuracion_de_compras",
  "ficha_de_compra_del_proveedor",
  "comprobante_de_la_ficha",
  "punto_de_venta_de_la_ficha",
  "pedido_de_ficha",
  "presentacion_de_producto",
  "oferta_de_proveedor",
  "recepcion",
  "linea_de_recepcion",
  "saldo_de_linea_de_recepcion",
  "comprobante_de_proveedor",
  "linea_de_comprobante",
  "importe_por_alicuota",
  "tributo_de_comprobante",
  "saldo_de_linea_de_comprobante",
  "conciliacion",
  "asignacion_de_conciliacion",
  "pago_de_comprobante",
  "correccion_de_compra",
] as const;
const ACTUALIZABLES = new Set([
  "configuracion_de_compras",
  "ficha_de_compra_del_proveedor",
  "comprobante_de_la_ficha",
  "punto_de_venta_de_la_ficha",
  "pedido_de_ficha",
  "presentacion_de_producto",
  "oferta_de_proveedor",
  "recepcion",
  "saldo_de_linea_de_recepcion",
  "comprobante_de_proveedor",
  "saldo_de_linea_de_comprobante",
  "pago_de_comprobante",
]);
const ARCHIVO = "0037_compras.sql";
const REVERSION = join(CARPETA_DE_MIGRACIONES, "reversiones", "0037_revertir_compras.sql");
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)("0037 compras: la migración contra una base real", () => {
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
    trabajo: (s: SesionDePrueba) => Promise<T>,
  ) => conAppDe(b(), m, trabajo);
  const escenario = async () => {
    const m = await crearMundo(dueno);
    const proveedor = await proveedorDeBase(dueno, m);
    const producto = await materiaPrima(dueno, m.empresa);
    return { m, proveedor, producto };
  };
  const insertarRecepcion = (m: Mundo, proveedor: string, extra: Record<string, unknown> = {}) => {
    const t: Record<string, unknown> = {
      empresa_id: m.empresa,
      sucursal_id: m.sucursal,
      proveedor_id: proveedor,
      nivel: "COMPRA_SIMPLE",
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
  const insertarLinea = (
    m: Mundo,
    recepcion: string,
    producto: string,
    extra: Record<string, unknown> = {},
  ) => {
    const t: Record<string, unknown> = {
      empresa_id: m.empresa,
      recepcion_id: recepcion,
      numero: 1,
      producto_id: producto,
      unidad_de_compra_id: "UNIDAD",
      cantidad_de_compra: "10",
      cantidad_en_stock: "10",
      ...extra,
    };
    const cols = Object.keys(t);
    return {
      texto: `insert into linea_de_recepcion (${cols.join(", ")}) values (${cols.map((_, i) => `$${i + 1}`).join(", ")})`,
      parametros: Object.values(t),
    };
  };
  const recepcionConLinea = async (
    s: SesionDePrueba,
    m: Mundo,
    proveedor: string,
    producto: string,
    linea: Record<string, unknown> = {},
    cab: Record<string, unknown> = {},
  ) => {
    const a = insertarRecepcion(m, proveedor, cab);
    const r = await s.intentar(a.texto, a.parametros);
    acepta(r);
    const id = String(r.ok ? r.rows[0]?.id : "");
    const l = insertarLinea(m, id, producto, linea);
    return { id, linea: await s.intentar(l.texto, l.parametros) };
  };

  it("crea las diecinueve tablas con RLS forzada, una política por comando y sin DELETE ni TRUNCATE para nadie", async () => {
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
    for (const t of TABLAS) {
      const esperados = ["SELECT", "INSERT", ...(ACTUALIZABLES.has(t) ? ["UPDATE"] : [])].sort();
      expect(
        politicas
          .filter((p) => p.tablename === t)
          .map((p) => p.cmd)
          .sort(),
        t,
      ).toEqual(esperados);
    }
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

  it("R1: peso variable sin peso real no se confirma; con peso real entra; «sin precio» son tres nulos juntos, nunca cero", async () => {
    const { m, proveedor, producto } = await escenario();
    await enApp(m, async (s) => {
      const sinPeso = await recepcionConLinea(s, m, proveedor, producto, {
        de_peso_variable: true,
      });
      check(sinPeso.linea, "linea_de_recepcion_peso_real_ck");
      acepta(
        (
          await recepcionConLinea(s, m, proveedor, producto, {
            de_peso_variable: true,
            peso_real: "46.6",
            cantidad_en_stock: "46.6",
          })
        ).linea,
      );
      check(
        (
          await recepcionConLinea(s, m, proveedor, producto, {
            precio: "11000",
            precio_por_tipo: "UNIDAD",
          })
        ).linea,
        "linea_de_recepcion_sin_precio_ck",
      );
      check(
        (
          await recepcionConLinea(s, m, proveedor, producto, {
            precio: "0",
            importe: "0",
            costo_por_unidad_de_stock: "0",
            precio_por_tipo: "UNIDAD",
          })
        ).linea,
        "linea_de_recepcion_costo_ck",
      );
      acepta(
        (
          await recepcionConLinea(s, m, proveedor, producto, {
            precio: "1800",
            importe: "64800",
            costo_por_unidad_de_stock: "1800",
            precio_por_tipo: "PRESENTACION",
          })
        ).linea,
      );
      check(
        (await recepcionConLinea(s, m, proveedor, producto, { cantidad_en_stock: "0" })).linea,
        "linea_de_recepcion_stock_ck",
      );
    });
  });

  it("C1 e I3: el mismo remito del mismo proveedor no se carga dos veces; otro proveedor sí; la anulada libera el número", async () => {
    const { m, proveedor, producto } = await escenario();
    const otro = await proveedorDeBase(dueno, m, "Otro");
    const remito = { remito_punto_de_venta: 2, remito_numero: 345, remito_fecha: "2026-11-10" };
    await enApp(m, async (s) => {
      const primera = await recepcionConLinea(s, m, proveedor, producto, {}, remito);
      acepta(primera.linea);
      const a = insertarRecepcion(m, proveedor, remito);
      clave(await s.intentar(a.texto, a.parametros), "recepcion_remito_uk");
      const c2 = insertarRecepcion(m, otro, remito);
      acepta(await s.intentar(c2.texto, c2.parametros));
      acepta(
        await s.intentar(
          "update recepcion set estado = 'ANULADA', anulada_por = $2, anulada_en = now(), motivo_de_anulacion = 'Se cargó dos veces' where id = $1",
          [primera.id, m.persona],
        ),
      );
      const c3 = insertarRecepcion(m, proveedor, remito);
      acepta(await s.intentar(c3.texto, c3.parametros));
    });
  });

  it("C11 y R10: la numeración sube de a uno por empresa y la fecha de negocio la fija la base con la jornada de la sucursal", async () => {
    const { m, proveedor } = await escenario();
    await dueno.query("update sucursal set hora_de_corte = '04:00' where id = $1", [m.sucursal]);
    await enApp(m, async (s) => {
      const nums: number[] = [];
      for (const hecho of ["2026-11-10T05:00:00Z", "2026-11-10T20:00:00Z"]) {
        const a = insertarRecepcion(m, proveedor, { hecho_en: hecho });
        const r = await s.intentar(a.texto, a.parametros);
        acepta(r);
        const f = await s.intentar(
          "select numero, fecha_negocio::text as f from recepcion where id = $1",
          [r.ok ? r.rows[0]?.id : null],
        );
        nums.push(Number(f.ok ? f.rows[0]?.numero : 0));
        // 05:00 UTC es 02:00 en Buenos Aires con corte 04:00: queda en la jornada anterior.
        expect(f.ok && f.rows[0]?.f).toBe(
          hecho.startsWith("2026-11-10T05") ? "2026-11-09" : "2026-11-10",
        );
      }
      expect(nums).toEqual([1, 2]);
      const intento = insertarRecepcion(m, proveedor, { fecha_negocio: "2020-01-01" });
      expect((await s.intentar(intento.texto, intento.parametros)).ok).toBe(false);
    });
  });

  it("C2: la misma factura (proveedor, tipo, punto de venta, número) no se carga dos veces entre las no anuladas; la anulada libera el número", async () => {
    const { m, proveedor } = await escenario();
    const id = await comprobanteDeBase(dueno, m, proveedor, { numero: 777, puntoDeVenta: 3 });
    await expect(
      comprobanteDeBase(dueno, m, proveedor, { numero: 777, puntoDeVenta: 3 }),
    ).rejects.toThrow(/cp_duplicado_uk/);
    await comprobanteDeBase(dueno, m, proveedor, {
      numero: 777,
      puntoDeVenta: 3,
      tipo: "FACTURA_B",
    }).catch(() => undefined);
    await dueno.query(
      "update comprobante_de_proveedor set estado = 'ANULADO', anulado_por = $2, anulado_en = now(), motivo_de_anulacion = 'Error de carga' where id = $1",
      [id, m.persona],
    );
    await comprobanteDeBase(dueno, m, proveedor, { numero: 777, puntoDeVenta: 3 });
  });

  it("el total calculado es la suma de sus partes, la moneda es ARS y una nota no mezcla clase y tipo", async () => {
    const { m, proveedor } = await escenario();
    await enApp(m, async (s) => {
      const cols = `id, empresa_id, proveedor_id, clase, tipo, punto_de_venta, numero, fecha_del_comprobante, neto_gravado, no_gravado, exento, iva, tributos_total, credito_fiscal_computable,
        total_calculado, total_segun_factura, proveedor_razon_social, nivel, clave_idempotencia, huella, registrado_por`;
      const fila = (total: string, tipo = "FACTURA_A", clase = "FACTURA") => [
        randomUUID(),
        m.empresa,
        proveedor,
        clase,
        tipo,
        1,
        Math.floor(Math.random() * 9e7) + 1,
        "2026-11-10",
        "100",
        "0",
        "0",
        "21",
        "0",
        "21",
        total,
        total,
        "Sur",
        "CON_COMPROBANTE",
        claveDeCompra(),
        huellaAlAzar(),
        m.persona,
      ];
      const sentencia = `insert into comprobante_de_proveedor (${cols}) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)`;
      acepta(await s.intentar(sentencia, fila("121")));
      check(await s.intentar(sentencia, fila("120")), "cp_total_ck");
      check(
        await s.intentar(sentencia, fila("121", "NOTA_CREDITO_A", "FACTURA")),
        "cp_clase_tipo_ck",
      );
    });
  });

  it("C8 e I5: un pago vigente por factura (sin parciales); el anulado libera; el pago no mueve ninguna caja", async () => {
    const { m, proveedor } = await escenario();
    const factura = await comprobanteDeBase(dueno, m, proveedor);
    const pagar = (extra: Record<string, unknown> = {}) =>
      [
        "insert into pago_de_comprobante (empresa_id, comprobante_id, fecha_de_pago, medio, importe, clave_idempotencia, huella, registrado_por) values ($1,$2,$3,$4,$5,$6,$7,$8) returning id",
        [
          m.empresa,
          factura,
          "2026-11-10",
          extra["medio"] ?? "EFECTIVO",
          "1210",
          claveDeCompra(),
          huellaAlAzar(),
          m.persona,
        ],
      ] as [string, unknown[]];
    await enApp(m, async (s) => {
      const primero = await s.intentar(...pagar());
      acepta(primero);
      clave(await s.intentar(...pagar({ medio: "TRANSFERENCIA" })), "pago_vigente_uk");
      check(await s.intentar(...pagar({ medio: "CHEQUE" })), "pago_medio_ck");
      acepta(
        await s.intentar(
          "update pago_de_comprobante set estado = 'ANULADO', anulado_por = $2, anulado_en = now(), motivo_de_anulacion = 'Pago equivocado' where id = $1",
          [primero.ok ? primero.rows[0]?.id : null, m.persona],
        ),
      );
      acepta(await s.intentar(...pagar()));
    });
  });

  it("C3: los saldos solo los escribe el disparador y una asignación nunca supera lo recibido ni lo facturado", async () => {
    const { m, proveedor, producto } = await escenario();
    const recepcion = await recepcionDeBase(dueno, m, proveedor, producto, { cantidad: "10" });
    const factura = await comprobanteDeBase(dueno, m, proveedor);
    const conciliar = async (
      s: SesionDePrueba,
      cantidad: string,
      acto = "CONCILIACION",
      numero = 1,
    ) => {
      const conc = randomUUID();
      acepta(
        await s.intentar(
          "insert into conciliacion (id, empresa_id, acto, anula_a, comprobante_id, nivel, clave_idempotencia, registrado_por) values ($1,$2,$3,null,$4,'CON_COMPROBANTE',$5,$6)",
          [conc, m.empresa, "CONCILIACION", factura, claveDeCompra(), m.persona],
        ),
      );
      return s.intentar(
        "insert into asignacion_de_conciliacion (empresa_id, conciliacion_id, acto, numero, comprobante_id, linea_de_comprobante, recepcion_id, linea_de_recepcion, cantidad) values ($1,$2,$3,$4,$5,1,$6,1,$7)",
        [m.empresa, conc, acto, numero, factura, recepcion, cantidad],
      );
    };
    await enApp(m, async (s) => {
      denegado(
        await s.intentar(
          "update saldo_de_linea_de_recepcion set cantidad_asignada = 1 where recepcion_id = $1",
          [recepcion],
        ),
      );
      acepta(await conciliar(s, "10"));
      check(await conciliar(s, "0.0001"), "asignacion_excede_lo_recibido");
      acepta(await s.confirmar());
    });
    const saldo = (
      await dueno.query<{ r: string; a: string }>(
        "select cantidad_recibida::text as r, cantidad_asignada::text as a from saldo_de_linea_de_recepcion where recepcion_id = $1",
        [recepcion],
      )
    ).rows[0];
    expect(saldo).toEqual({ r: "10.0000", a: "10.0000" });
    // El saldo siempre es la suma de las asignaciones.
    const suma = (
      await dueno.query<{ s: string }>(
        "select coalesce(sum(cantidad), 0)::text as s from asignacion_de_conciliacion where recepcion_id = $1",
        [recepcion],
      )
    ).rows[0];
    expect(suma?.s).toBe("10.0000");
  });

  it("C3: dos asignaciones a la vez sobre la misma línea: solo entra la que cabe y el saldo nunca supera lo recibido", async () => {
    const { m, proveedor, producto } = await escenario();
    const recepcion = await recepcionDeBase(dueno, m, proveedor, producto, { cantidad: "10" });
    const factura = await comprobanteDeBase(dueno, m, proveedor);
    const resultados = await Promise.all(
      [6, 6].map((n) =>
        enApp(m, async (s) => {
          const conc = randomUUID();
          const c1 = await s.intentar(
            "insert into conciliacion (id, empresa_id, acto, comprobante_id, nivel, clave_idempotencia, registrado_por) values ($1,$2,'CONCILIACION',$3,'CON_COMPROBANTE',$4,$5)",
            [conc, m.empresa, factura, claveDeCompra(), m.persona],
          );
          if (!c1.ok) return c1;
          const a = await s.intentar(
            "insert into asignacion_de_conciliacion (empresa_id, conciliacion_id, acto, numero, comprobante_id, linea_de_comprobante, recepcion_id, linea_de_recepcion, cantidad) values ($1,$2,'CONCILIACION',1,$3,1,$4,1,$5)",
            [m.empresa, conc, factura, recepcion, String(n)],
          );
          return a.ok ? s.confirmar() : a;
        }),
      ),
    );
    expect(resultados.filter((r) => r.ok)).toHaveLength(1);
    const saldo = (
      await dueno.query<{ a: string }>(
        "select cantidad_asignada::text as a from saldo_de_linea_de_recepcion where recepcion_id = $1",
        [recepcion],
      )
    ).rows[0];
    expect(saldo?.a).toBe("6.0000");
  });

  it("R7: líneas, importes, asignaciones y correcciones no se modifican ni se borran (ni el dueño); el estado cambia solo en un sentido", async () => {
    const { m, proveedor, producto } = await escenario();
    const recepcion = await recepcionDeBase(dueno, m, proveedor, producto);
    await expect(
      dueno.query("update linea_de_recepcion set cantidad_en_stock = 99 where recepcion_id = $1", [
        recepcion,
      ]),
    ).rejects.toThrow();
    await expect(
      dueno.query("delete from linea_de_recepcion where recepcion_id = $1", [recepcion]),
    ).rejects.toThrow();
    await expect(dueno.query("delete from recepcion where id = $1", [recepcion])).rejects.toThrow();
    await expect(dueno.query("truncate recepcion")).rejects.toThrow();
    await expect(
      dueno.query("update recepcion set nivel = 'TRES_VIAS' where id = $1", [recepcion]),
    ).rejects.toThrow(/inmutable|solo cambian/);
    await dueno.query(
      "update recepcion set estado = 'ANULADA', anulada_por = $2, anulada_en = now(), motivo_de_anulacion = 'Prueba' where id = $1",
      [recepcion, m.persona],
    );
    await expect(
      dueno.query(
        "update recepcion set estado = 'CONFIRMADA', anulada_por = null, anulada_en = null, motivo_de_anulacion = null where id = $1",
        [recepcion],
      ),
    ).rejects.toThrow(/transición/);
  });

  it("R7: una línea no entra a una recepción de otra transacción (solo con su cabecera)", async () => {
    const { m, proveedor, producto } = await escenario();
    const recepcion = await recepcionDeBase(dueno, m, proveedor, producto);
    await expect(
      dueno.query(
        insertarLinea(m, recepcion, producto, { numero: 2 }).texto,
        insertarLinea(m, recepcion, producto, { numero: 2 }).parametros,
      ),
    ).rejects.toThrow(/transacción de su cabecera/);
  });

  it("R6: una empresa no ve ni toca las compras de la otra, ni referencia sus partes", async () => {
    const a = await escenario();
    const otra = await crearMundo(dueno);
    const recepcion = await recepcionDeBase(dueno, a.m, a.proveedor, a.producto);
    await enApp(otra, async (s) => {
      const leida = await s.intentar("select id from recepcion where id = $1", [recepcion]);
      expect(leida.ok && leida.filas).toBe(0);
      const ajena = insertarRecepcion({ ...otra, sucursal: otra.sucursal }, a.proveedor);
      expect((await s.intentar(ajena.texto, ajena.parametros)).ok).toBe(false);
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
    it("sin datos deja la base como antes y se puede repetir; con datos se NIEGA sin borrar nada", async () => {
      await conPrevias(async (previa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        await revertir(previa.cliente);
        await revertir(previa.cliente);
        expect(
          (
            await previa.cliente.query<{ t: string | null }>(
              "select to_regclass('public.recepcion') as t",
            )
          ).rows[0]?.t,
        ).toBeNull();
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const m = await crearMundo(previa.cliente);
        const proveedor = await proveedorDeBase(previa.cliente, m);
        const producto = await materiaPrima(previa.cliente, m.empresa);
        await recepcionDeBase(previa.cliente, m, proveedor, producto);
        await expect(revertir(previa.cliente)).rejects.toThrow(/confirmar_reversion/);
        expect(
          (await previa.cliente.query<{ n: number }>("select count(*)::int as n from recepcion"))
            .rows[0]?.n,
        ).toBe(1);
      });
    });
    it("necesita un rol que evada RLS", async () => {
      await conPrevias(async (previa) => {
        await aplicarMigraciones(previa.aparte.base.dueno, CARPETA_DE_MIGRACIONES);
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
