import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { claveDeCompra, huellaAlAzar, materiaPrima, proveedorDeBase } from "./compras-apoyo";
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
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";
import { esperarBloqueo } from "./sesiones";

/**
 * La migración 0066 (compras N4, órdenes de compra) contra una base real: el alta siempre en borrador, las transiciones impuestas, el número al pedir (también con dos pedidos a la
 * vez), lo inmutable desde que se pide, el saldo por línea, recibir contra la orden con el control de exceso (BLOQUEAR, AVISAR con y sin confirmación, PERMITIR) y dos recepciones
 * simultáneas, la devolución al anular la recepción, el aislamiento por empresa y la reversión.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = [
  "orden_de_compra",
  "linea_de_orden",
  "saldo_de_linea_de_orden",
  "linea_de_recepcion_de_orden",
] as const;
const REVERSION = join(CARPETA_DE_MIGRACIONES, "reversiones", "0066_revertir_compras_ordenes.sql");
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)("0066 compras N4: órdenes contra una base real", () => {
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
  type E = Awaited<ReturnType<typeof escenario>>;

  const altaDeOrden = (m: Mundo, proveedor: string, id = randomUUID()) => ({
    id,
    texto: `insert into orden_de_compra (id, empresa_id, proveedor_id, clave_idempotencia, huella, creado_por) values ($1, $2, $3, $4, $5, $6)`,
    parametros: [id, m.empresa, proveedor, claveDeCompra(), huellaAlAzar(), m.persona],
  });
  const altaDeLinea = (
    m: Mundo,
    orden: string,
    producto: string,
    numero: number,
    cantidad: string,
  ) => ({
    texto: `insert into linea_de_orden (empresa_id, orden_id, numero, producto_id, cantidad_pedida, precio_unitario) values ($1, $2, $3, $4, $5, 10)`,
    parametros: [m.empresa, orden, numero, producto, cantidad],
  });
  const pedirSql = `update orden_de_compra set estado = 'PEDIDA', pedida_por = $3 where id = $1 and empresa_id = $2 and estado = 'BORRADOR'`;
  const cerrarSql = `update orden_de_compra set estado = 'CERRADA', cerrada_por = $3 where id = $1 and empresa_id = $2 and estado = 'PEDIDA'`;
  const anularSql = `update orden_de_compra set estado = 'ANULADA', anulada_por = $3, motivo_de_anulacion = 'Prueba' where id = $1 and empresa_id = $2`;

  /** Una orden con las cantidades dadas (una línea por cantidad), ya confirmada la transacción. Pedida si `pedida`. */
  const orden = async (e: E, cantidades: string[], pedida = true): Promise<string> =>
    conAppDe(b(), e.m, async (s) => {
      const alta = altaDeOrden(e.m, e.proveedor);
      acepta(await s.intentar(alta.texto, alta.parametros));
      for (const [i, c] of cantidades.entries()) {
        const l = altaDeLinea(e.m, alta.id, e.producto, i + 1, c);
        acepta(await s.intentar(l.texto, l.parametros));
      }
      if (pedida) acepta(await s.intentar(pedirSql, [alta.id, e.m.empresa, e.m.persona]));
      expect((await s.confirmar()).ok).toBe(true);
      return alta.id;
    });

  /** Una recepción N3 pendiente de `cantidad` del producto dado (una línea), ya confirmada la transacción; con vínculo a la orden si se pide. */
  const recepcion = async (
    e: E,
    cantidad: string,
    contra: { orden: string; linea: number; confirmoExceso?: boolean } | null,
    proveedor = e.proveedor,
    producto = e.producto,
  ) =>
    conAppDe(b(), e.m, async (s) => {
      const id = randomUUID();
      acepta(
        await s.intentar(
          `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, estado, hecho_en, clave_idempotencia, huella, registrado_por)
           values ($1, $2, $3, $4, 'RECEPCION_SEPARADA', 'PENDIENTE', now(), $5, $6, $7)`,
          [id, e.m.empresa, e.m.sucursal, proveedor, claveDeCompra(), huellaAlAzar(), e.m.persona],
        ),
      );
      acepta(
        await s.intentar(
          `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock)
           values ($1, $2, 1, $3, 'UNIDAD', $4, $4)`,
          [e.m.empresa, id, producto, cantidad],
        ),
      );
      if (contra !== null) {
        acepta(
          await s.intentar(
            `insert into linea_de_recepcion_de_orden (empresa_id, recepcion_id, linea, orden_id, linea_de_orden, confirmo_exceso) values ($1, $2, 1, $3, $4, $5)`,
            [e.m.empresa, id, contra.orden, contra.linea, contra.confirmoExceso ?? false],
          ),
        );
      }
      expect((await s.confirmar()).ok).toBe(true);
      return id;
    });
  /** El intento de recibir contra la orden, en una sesión que no confirma: devuelve el resultado del vínculo. */
  const intentarVinculo = (
    e: E,
    ordenId: string,
    cantidad: string,
    extra: { confirmoExceso?: boolean; proveedor?: string; producto?: string; linea?: number } = {},
  ) =>
    conAppDe(b(), e.m, async (s) => {
      const id = randomUUID();
      acepta(
        await s.intentar(
          `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, estado, hecho_en, clave_idempotencia, huella, registrado_por)
           values ($1, $2, $3, $4, 'RECEPCION_SEPARADA', 'PENDIENTE', now(), $5, $6, $7)`,
          [
            id,
            e.m.empresa,
            e.m.sucursal,
            extra.proveedor ?? e.proveedor,
            claveDeCompra(),
            huellaAlAzar(),
            e.m.persona,
          ],
        ),
      );
      acepta(
        await s.intentar(
          `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock)
           values ($1, $2, 1, $3, 'UNIDAD', $4, $4)`,
          [e.m.empresa, id, extra.producto ?? e.producto, cantidad],
        ),
      );
      return s.intentar(
        `insert into linea_de_recepcion_de_orden (empresa_id, recepcion_id, linea, orden_id, linea_de_orden, confirmo_exceso) values ($1, $2, 1, $3, $4, $5)`,
        [e.m.empresa, id, ordenId, extra.linea ?? 1, extra.confirmoExceso ?? false],
      );
    });
  const nivelDeControl = (m: Mundo, nivel: string) =>
    dueno.query(
      `insert into nivel_de_control (empresa_id, control, nivel) values ($1, 'compras.recepcion_excede_la_orden', $2)`,
      [m.empresa, nivel],
    );
  const recibido = async (ordenId: string, linea = 1) =>
    Number(
      (
        await dueno.query<{ r: string }>(
          "select cantidad_recibida::text as r from saldo_de_linea_de_orden where orden_id = $1 and linea = $2",
          [ordenId, linea],
        )
      ).rows[0]?.r,
    );

  it("las cuatro tablas con RLS forzada, SELECT e INSERT (y UPDATE donde cambia) y sin DELETE ni TRUNCATE para nadie", async () => {
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
    expect(de("orden_de_compra")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(de("linea_de_orden")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(de("saldo_de_linea_de_orden")).toEqual(["INSERT", "SELECT", "UPDATE"]);
    expect(de("linea_de_recepcion_de_orden")).toEqual(["INSERT", "SELECT"]);
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

  it("la orden nace BORRADOR sin número: el estado no entra por el alta y la aplicación no puede borrar", async () => {
    const e = await escenario();
    await conAppDe(b(), e.m, async (s) => {
      const a = altaDeOrden(e.m, e.proveedor);
      denegado(
        await s.intentar(
          `insert into orden_de_compra (id, empresa_id, proveedor_id, estado, clave_idempotencia, huella, creado_por) values ($1, $2, $3, 'PEDIDA', $4, $5, $6)`,
          [a.id, e.m.empresa, e.proveedor, claveDeCompra(), huellaAlAzar(), e.m.persona],
        ),
      );
      denegado(
        await s.intentar(
          `insert into orden_de_compra (id, empresa_id, proveedor_id, numero, clave_idempotencia, huella, creado_por) values ($1, $2, $3, 7, $4, $5, $6)`,
          [a.id, e.m.empresa, e.proveedor, claveDeCompra(), huellaAlAzar(), e.m.persona],
        ),
      );
      acepta(await s.intentar(a.texto, a.parametros));
      const r = await s.intentar(
        "select estado, numero, pedida_en from orden_de_compra where id = $1",
        [a.id],
      );
      expect(r.ok && r.rows[0]).toEqual({ estado: "BORRADOR", numero: null, pedida_en: null });
      denegado(await s.intentar("delete from orden_de_compra where id = $1", [a.id]));
    });
  });

  it("la clave de idempotencia es única por empresa y el proveedor y la sucursal deben ser de la empresa", async () => {
    const a = await escenario();
    const otra = await escenario();
    await conAppDe(b(), a.m, async (s) => {
      const primera = altaDeOrden(a.m, a.proveedor);
      acepta(await s.intentar(primera.texto, primera.parametros));
      const repetida = await s.intentar(primera.texto, [
        randomUUID(),
        a.m.empresa,
        a.proveedor,
        primera.parametros[3],
        huellaAlAzar(),
        a.m.persona,
      ]);
      clave(repetida, "orden_clave_uk");
      const ajeno = altaDeOrden(a.m, otra.proveedor);
      referencia(await s.intentar(ajeno.texto, ajeno.parametros), "orden_proveedor_fkey");
    });
  });

  it("pedir asigna número consecutivo por empresa, momento y jornada; un borrador sin líneas (o con todas retiradas) no se pide", async () => {
    const e = await escenario();
    const primera = await orden(e, ["5"]);
    const segunda = await orden(e, ["5"]);
    const filas = await dueno.query<{ id: string; numero: number; fecha_negocio: string | null }>(
      "select id, numero, fecha_negocio::text from orden_de_compra where id = any($1) order by numero",
      [[primera, segunda]],
    );
    expect(filas.rows.map((f) => f.id)).toEqual([primera, segunda]);
    expect(filas.rows[1]?.numero).toBe((filas.rows[0]?.numero ?? 0) + 1);
    expect(filas.rows[0]?.fecha_negocio).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    await conAppDe(b(), e.m, async (s) => {
      const a = altaDeOrden(e.m, e.proveedor);
      acepta(await s.intentar(a.texto, a.parametros));
      check(await s.intentar(pedirSql, [a.id, e.m.empresa, e.m.persona]), "orden_sin_lineas");
      const l = altaDeLinea(e.m, a.id, e.producto, 1, "5");
      acepta(await s.intentar(l.texto, l.parametros));
      acepta(
        await s.intentar("update linea_de_orden set retirada = true where orden_id = $1", [a.id]),
      );
      check(await s.intentar(pedirSql, [a.id, e.m.empresa, e.m.persona]), "orden_sin_lineas");
    });
  });

  it("una entrega prevista anterior al día del pedido no se pide", async () => {
    const e = await escenario();
    await conAppDe(b(), e.m, async (s) => {
      const a = altaDeOrden(e.m, e.proveedor);
      acepta(await s.intentar(a.texto, a.parametros));
      const l = altaDeLinea(e.m, a.id, e.producto, 1, "5");
      acepta(await s.intentar(l.texto, l.parametros));
      acepta(
        await s.intentar(
          "update orden_de_compra set fecha_de_entrega_prevista = '2000-01-01' where id = $1",
          [a.id],
        ),
      );
      check(
        await s.intentar(pedirSql, [a.id, e.m.empresa, e.m.persona]),
        "orden_entrega_anterior_al_pedido",
      );
    });
  });

  it("dos pedidos a la vez de la misma empresa toman números distintos", async () => {
    const e = await escenario();
    const a = await orden(e, ["5"], false);
    const c = await orden(e, ["5"], false);
    await conAppDe(b(), e.m, async (s1) => {
      await conAppDe(b(), e.m, async (s2) => {
        const primero = await s1.directo(pedirSql, [a, e.m.empresa, e.m.persona]);
        expect(primero.ok && primero.filas).toBe(1);
        const segundo = s2.directo(pedirSql, [c, e.m.empresa, e.m.persona]);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        const r = await segundo;
        expect(r.ok && r.filas).toBe(1);
        expect((await s2.confirmar()).ok).toBe(true);
      });
    });
    const numeros = await dueno.query<{ numero: number }>(
      "select numero from orden_de_compra where id = any($1)",
      [[a, c]],
    );
    expect(new Set(numeros.rows.map((n) => n.numero)).size).toBe(2);
  });

  it("transiciones: BORRADOR → PEDIDA | ANULADA y PEDIDA → CERRADA | ANULADA; nada sale de CERRADA ni de ANULADA ni vuelve a BORRADOR", async () => {
    const e = await escenario();
    const borrador = await orden(e, ["5"], false);
    const pedida = await orden(e, ["5"]);
    await conAppDe(b(), e.m, async (s) => {
      check(
        await s.intentar(cerrarSql.replace("estado = 'PEDIDA'", "estado = 'BORRADOR'"), [
          borrador,
          e.m.empresa,
          e.m.persona,
        ]),
        "orden_transicion_invalida",
      );
      check(
        await s.intentar("update orden_de_compra set estado = 'BORRADOR' where id = $1", [pedida]),
        "orden_transicion_invalida",
      );
      acepta(await s.intentar(cerrarSql, [pedida, e.m.empresa, e.m.persona]));
      check(
        await s.intentar(anularSql, [pedida, e.m.empresa, e.m.persona]),
        "orden_transicion_invalida",
      );
      acepta(await s.intentar(anularSql, [borrador, e.m.empresa, e.m.persona]));
      check(
        await s.intentar(pedirSql.replace("and estado = 'BORRADOR'", ""), [
          borrador,
          e.m.empresa,
          e.m.persona,
        ]),
        "orden_transicion_invalida",
      );
    });
  });

  it("anular exige motivo y deja constancia; cerrar deja quién y cuándo", async () => {
    const e = await escenario();
    const aAnular = await orden(e, ["5"]);
    const aCerrar = await orden(e, ["5"]);
    await conAppDe(b(), e.m, async (s) => {
      check(
        await s.intentar(
          "update orden_de_compra set estado = 'ANULADA', anulada_por = $2 where id = $1",
          [aAnular, e.m.persona],
        ),
        "orden_anulacion_ck",
      );
      acepta(await s.intentar(anularSql, [aAnular, e.m.empresa, e.m.persona]));
      acepta(await s.intentar(cerrarSql, [aCerrar, e.m.empresa, e.m.persona]));
      const r = await s.intentar(
        "select id, anulada_por, anulada_en is not null as anulada, cerrada_por, cerrada_en is not null as cerrada from orden_de_compra where id = any($1)",
        [[aAnular, aCerrar]],
      );
      const fila = (id: string) => (r.ok ? r.rows.find((x) => x.id === id) : undefined);
      expect(fila(aAnular)).toMatchObject({ anulada_por: e.m.persona, anulada: true });
      expect(fila(aCerrar)).toMatchObject({ cerrada_por: e.m.persona, cerrada: true });
    });
  });

  it("la aplicación no puede fijar el número, el momento ni el motivo de cierre: los fija la base", async () => {
    const e = await escenario();
    const id = await orden(e, ["5"], false);
    await conAppDe(b(), e.m, async (s) => {
      denegado(await s.intentar("update orden_de_compra set numero = 99 where id = $1", [id]));
      denegado(
        await s.intentar("update orden_de_compra set pedida_en = now() where id = $1", [id]),
      );
      denegado(
        await s.intentar("update orden_de_compra set cierre_motivo = 'COMPLETA' where id = $1", [
          id,
        ]),
      );
      denegado(
        await s.intentar(
          "update orden_de_compra set clave_idempotencia = 'otra-clave-distinta' where id = $1",
          [id],
        ),
      );
      denegado(
        await s.intentar("update orden_de_compra set huella = $2 where id = $1", [
          id,
          huellaAlAzar(),
        ]),
      );
    });
  });

  it("en BORRADOR se edita la cabecera y las líneas; desde PEDIDA todo es inmutable", async () => {
    const e = await escenario();
    const id = await orden(e, ["5"], false);
    await conAppDe(b(), e.m, async (s) => {
      acepta(
        await s.intentar(
          "update orden_de_compra set fecha_de_entrega_prevista = '2999-01-01', sucursal_destino_id = $2 where id = $1",
          [id, e.m.sucursal],
        ),
      );
      acepta(
        await s.intentar(
          "update linea_de_orden set cantidad_pedida = 8, precio_unitario = 12 where orden_id = $1 and numero = 1",
          [id],
        ),
      );
      const l = altaDeLinea(e.m, id, e.producto, 2, "3");
      acepta(await s.intentar(l.texto, l.parametros));
      acepta(await s.intentar(pedirSql, [id, e.m.empresa, e.m.persona]));
      check(
        await s.intentar(
          "update orden_de_compra set fecha_de_entrega_prevista = '2999-02-02' where id = $1",
          [id],
        ),
        "orden_inmutable",
      );
      check(
        await s.intentar(
          "update linea_de_orden set cantidad_pedida = 9 where orden_id = $1 and numero = 1",
          [id],
        ),
        "linea_de_orden_orden_pedida",
      );
      check(
        await s.intentar(
          altaDeLinea(e.m, id, e.producto, 3, "1").texto,
          altaDeLinea(e.m, id, e.producto, 3, "1").parametros,
        ),
        "linea_de_orden_orden_pedida",
      );
      denegado(
        await s.intentar(
          "update linea_de_orden set producto_id = producto_id where orden_id = $1",
          [id],
        ),
      );
      expect((await s.confirmar()).ok).toBe(true);
    });
    const saldos = await dueno.query<{ linea: number; cantidad_pedida: string }>(
      "select linea, cantidad_pedida::text from saldo_de_linea_de_orden where orden_id = $1 order by linea",
      [id],
    );
    expect(saldos.rows).toEqual([
      { linea: 1, cantidad_pedida: "8.0000" },
      { linea: 2, cantidad_pedida: "3.0000" },
    ]);
  });

  it("el saldo nace al pedir solo para las líneas no retiradas y la aplicación no lo escribe a mano", async () => {
    const e = await escenario();
    const id = await conAppDe(b(), e.m, async (s) => {
      const a = altaDeOrden(e.m, e.proveedor);
      acepta(await s.intentar(a.texto, a.parametros));
      for (const n of [1, 2]) {
        const l = altaDeLinea(e.m, a.id, e.producto, n, "5");
        acepta(await s.intentar(l.texto, l.parametros));
      }
      acepta(
        await s.intentar(
          "update linea_de_orden set retirada = true where orden_id = $1 and numero = 2",
          [a.id],
        ),
      );
      acepta(await s.intentar(pedirSql, [a.id, e.m.empresa, e.m.persona]));
      denegado(
        await s.intentar(
          "insert into saldo_de_linea_de_orden (empresa_id, orden_id, linea, cantidad_pedida) values ($1, $2, 2, 5)",
          [e.m.empresa, a.id],
        ),
      );
      denegado(
        await s.intentar(
          "update saldo_de_linea_de_orden set cantidad_recibida = 1 where orden_id = $1",
          [a.id],
        ),
      );
      expect((await s.confirmar()).ok).toBe(true);
      return a.id;
    });
    const r = await dueno.query<{ linea: number }>(
      "select linea from saldo_de_linea_de_orden where orden_id = $1",
      [id],
    );
    expect(r.rows).toEqual([{ linea: 1 }]);
  });

  it("recibir contra la orden suma al saldo; la orden se cierra COMPLETA si todo llegó y CON_SALDO si no", async () => {
    const e = await escenario();
    const completa = await orden(e, ["10"]);
    const conSaldo = await orden(e, ["10"]);
    await recepcion(e, "10", { orden: completa, linea: 1 });
    await recepcion(e, "4", { orden: conSaldo, linea: 1 });
    expect(await recibido(completa)).toBe(10);
    expect(await recibido(conSaldo)).toBe(4);
    await conAppDe(b(), e.m, async (s) => {
      acepta(await s.intentar(cerrarSql, [completa, e.m.empresa, e.m.persona]));
      acepta(await s.intentar(cerrarSql, [conSaldo, e.m.empresa, e.m.persona]));
      expect((await s.confirmar()).ok).toBe(true);
    });
    const r = await dueno.query<{ id: string; cierre_motivo: string }>(
      "select id, cierre_motivo from orden_de_compra where id = any($1)",
      [[completa, conSaldo]],
    );
    expect(r.rows.find((x) => x.id === completa)?.cierre_motivo).toBe("COMPLETA");
    expect(r.rows.find((x) => x.id === conSaldo)?.cierre_motivo).toBe("CON_SALDO");
  });

  it("solo se recibe contra una orden PEDIDA, del mismo proveedor, del mismo producto y con la línea sin retirar", async () => {
    const e = await escenario();
    const borrador = await orden(e, ["10"], false);
    const cerrada = await orden(e, ["10"]);
    const pedida = await orden(e, ["10"]);
    await conAppDe(b(), e.m, async (s) => {
      acepta(await s.intentar(cerrarSql, [cerrada, e.m.empresa, e.m.persona]));
      expect((await s.confirmar()).ok).toBe(true);
    });
    check(await intentarVinculo(e, borrador, "1"), "orden_no_pedida");
    check(await intentarVinculo(e, cerrada, "1"), "orden_no_pedida");
    const otroProveedor = await proveedorDeBase(dueno, e.m);
    check(
      await intentarVinculo(e, pedida, "1", { proveedor: otroProveedor }),
      "recepcion_de_orden_proveedor_distinto",
    );
    const otroProducto = await materiaPrima(dueno, e.m.empresa);
    check(
      await intentarVinculo(e, pedida, "1", { producto: otroProducto }),
      "recepcion_de_orden_producto_distinto",
    );
    const conRetirada = await conAppDe(b(), e.m, async (s) => {
      const a = altaDeOrden(e.m, e.proveedor);
      acepta(await s.intentar(a.texto, a.parametros));
      for (const n of [1, 2]) {
        const l = altaDeLinea(e.m, a.id, e.producto, n, "5");
        acepta(await s.intentar(l.texto, l.parametros));
      }
      acepta(
        await s.intentar(
          "update linea_de_orden set retirada = true where orden_id = $1 and numero = 2",
          [a.id],
        ),
      );
      acepta(await s.intentar(pedirSql, [a.id, e.m.empresa, e.m.persona]));
      expect((await s.confirmar()).ok).toBe(true);
      return a.id;
    });
    check(await intentarVinculo(e, conRetirada, "1", { linea: 2 }), "linea_de_orden_retirada");
  });

  it("control en BLOQUEAR: lo recibido nunca supera lo pedido, ni con confirmación", async () => {
    const e = await escenario();
    await nivelDeControl(e.m, "BLOQUEAR");
    const id = await orden(e, ["10"]);
    await recepcion(e, "6", { orden: id, linea: 1 });
    check(await intentarVinculo(e, id, "5"), "recepcion_excede_la_orden_bloqueada");
    check(
      await intentarVinculo(e, id, "5", { confirmoExceso: true }),
      "recepcion_excede_la_orden_bloqueada",
    );
    await recepcion(e, "4", { orden: id, linea: 1 });
    expect(await recibido(id)).toBe(10);
  });

  it("control en AVISAR: pasa solo con la confirmación explícita; sin ella se rechaza", async () => {
    const e = await escenario();
    await nivelDeControl(e.m, "AVISAR");
    const id = await orden(e, ["10"]);
    check(await intentarVinculo(e, id, "12"), "recepcion_excede_la_orden_sin_confirmar");
    await recepcion(e, "12", { orden: id, linea: 1, confirmoExceso: true });
    expect(await recibido(id)).toBe(12);
  });

  it("sin control (o en PERMITIR) el exceso pasa y queda en el saldo", async () => {
    const e = await escenario();
    const id = await orden(e, ["10"]);
    await recepcion(e, "15", { orden: id, linea: 1 });
    expect(await recibido(id)).toBe(15);
    const otra = await escenario();
    await nivelDeControl(otra.m, "PERMITIR");
    const o2 = await orden(otra, ["10"]);
    await recepcion(otra, "15", { orden: o2, linea: 1 });
    expect(await recibido(o2)).toBe(15);
  });

  it("dos recepciones a la vez contra lo que queda de la línea con BLOQUEAR: entra una sola (la numeración serializa y la segunda no llega al saldo)", async () => {
    const e = await escenario();
    await nivelDeControl(e.m, "BLOQUEAR");
    const id = await orden(e, ["10"]);
    const cabecera = `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, estado, hecho_en, clave_idempotencia, huella, registrado_por)
      values ($1, $2, $3, $4, 'RECEPCION_SEPARADA', 'PENDIENTE', now(), $5, $6, $7)`;
    const lineaSql = `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock)
      values ($1, $2, 1, $3, 'UNIDAD', 8, 8)`;
    const vinculoSql = `insert into linea_de_recepcion_de_orden (empresa_id, recepcion_id, linea, orden_id, linea_de_orden) values ($1, $2, 1, $3, 1)`;
    const r1 = randomUUID();
    const r2 = randomUUID();
    await conAppDe(b(), e.m, async (s1) => {
      await conAppDe(b(), e.m, async (s2) => {
        acepta(
          await s1.intentar(cabecera, [
            r1,
            e.m.empresa,
            e.m.sucursal,
            e.proveedor,
            claveDeCompra(),
            huellaAlAzar(),
            e.m.persona,
          ]),
        );
        acepta(await s1.intentar(lineaSql, [e.m.empresa, r1, e.producto]));
        acepta(await s1.intentar(vinculoSql, [e.m.empresa, r1, id]));
        // La numeración de las recepciones de la empresa serializa a las dos: la segunda espera y, al terminar la primera, choca con el número ya tomado (la aplicación reintenta,
        // y en el reintento el saldo ya está lleno: eso lo prueba la prueba de arriba).
        const segunda = s2.directo(cabecera, [
          r2,
          e.m.empresa,
          e.m.sucursal,
          e.proveedor,
          claveDeCompra(),
          huellaAlAzar(),
          e.m.persona,
        ]);
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        const choque = await segunda;
        expect(!choque.ok && choque.restriccion).toBe("recepcion_numero_uk");
      });
    });
    expect(await recibido(id)).toBe(8);
  });

  it("anular la recepción devuelve lo recibido a la orden, una sola vez", async () => {
    const e = await escenario();
    const id = await orden(e, ["10"]);
    const r1 = await recepcion(e, "6", { orden: id, linea: 1 });
    await recepcion(e, "3", { orden: id, linea: 1 });
    expect(await recibido(id)).toBe(9);
    await conAppDe(b(), e.m, async (s) => {
      acepta(
        await s.intentar(
          "update recepcion set estado = 'ANULADA', anulada_por = $2, anulada_en = now(), motivo_de_anulacion = 'Prueba' where id = $1",
          [r1, e.m.persona],
        ),
      );
      check(
        await s.intentar("update recepcion set estado = 'PENDIENTE' where id = $1", [r1]),
        "recepcion_transicion_invalida",
      );
      expect((await s.confirmar()).ok).toBe(true);
    });
    expect(await recibido(id)).toBe(3);
  });

  it("una orden con recepciones vigentes no se anula; con la recepción anulada sí", async () => {
    const e = await escenario();
    const id = await orden(e, ["10"]);
    const r = await recepcion(e, "6", { orden: id, linea: 1 });
    await conAppDe(b(), e.m, async (s) => {
      check(await s.intentar(anularSql, [id, e.m.empresa, e.m.persona]), "orden_con_recepciones");
      acepta(
        await s.intentar(
          "update recepcion set estado = 'ANULADA', anulada_por = $2, anulada_en = now(), motivo_de_anulacion = 'Prueba' where id = $1",
          [r, e.m.persona],
        ),
      );
      acepta(await s.intentar(anularSql, [id, e.m.empresa, e.m.persona]));
    });
  });

  it("recibir y anular la orden a la vez: la que llega segunda ve el resultado de la primera", async () => {
    const e = await escenario();
    const id = await orden(e, ["10"]);
    await conAppDe(b(), e.m, async (s1) => {
      await conAppDe(b(), e.m, async (s2) => {
        const anulada = await s1.directo(anularSql, [id, e.m.empresa, e.m.persona]);
        expect(anulada.ok && anulada.filas).toBe(1);
        const rid = randomUUID();
        acepta(
          await s2.intentar(
            `insert into recepcion (id, empresa_id, sucursal_id, proveedor_id, nivel, estado, hecho_en, clave_idempotencia, huella, registrado_por)
             values ($1, $2, $3, $4, 'RECEPCION_SEPARADA', 'PENDIENTE', now(), $5, $6, $7)`,
            [
              rid,
              e.m.empresa,
              e.m.sucursal,
              e.proveedor,
              claveDeCompra(),
              huellaAlAzar(),
              e.m.persona,
            ],
          ),
        );
        acepta(
          await s2.intentar(
            `insert into linea_de_recepcion (empresa_id, recepcion_id, numero, producto_id, unidad_de_compra_id, cantidad_de_compra, cantidad_en_stock)
             values ($1, $2, 1, $3, 'UNIDAD', 2, 2)`,
            [e.m.empresa, rid, e.producto],
          ),
        );
        const vinculo = s2.directo(
          `insert into linea_de_recepcion_de_orden (empresa_id, recepcion_id, linea, orden_id, linea_de_orden) values ($1, $2, 1, $3, 1)`,
          [e.m.empresa, rid, id],
        );
        expect(await esperarBloqueo(dueno, s2.pid)).toBe(true);
        expect((await s1.confirmar()).ok).toBe(true);
        const r = await vinculo;
        expect(r.ok).toBe(false);
        expect(!r.ok && r.restriccion).toBe("orden_no_pedida");
      });
    });
  });

  it("el vínculo solo entra en la transacción de su recepción y no se cambia ni se borra", async () => {
    const e = await escenario();
    const id = await orden(e, ["10"]);
    const r = await recepcion(e, "2", { orden: id, linea: 1 });
    await conAppDe(b(), e.m, async (s) => {
      check(
        await s.intentar(
          `insert into linea_de_recepcion_de_orden (empresa_id, recepcion_id, linea, orden_id, linea_de_orden) values ($1, $2, 1, $3, 1)`,
          [e.m.empresa, r, id],
        ),
        "linea_de_recepcion_de_orden_cabecera_confirmada",
      );
      denegado(
        await s.intentar(
          "update linea_de_recepcion_de_orden set confirmo_exceso = true where orden_id = $1",
          [id],
        ),
      );
      denegado(
        await s.intentar("delete from linea_de_recepcion_de_orden where orden_id = $1", [id]),
      );
    });
  });

  it("aislamiento: otra empresa no ve ni toca las órdenes ajenas y no puede vincular recepciones con ellas", async () => {
    const a = await escenario();
    const otra = await escenario();
    const id = await orden(a, ["10"]);
    await conAppDe(b(), otra.m, async (s) => {
      for (const t of TABLAS) {
        const r = await s.intentar(`select count(*)::int as n from ${t}`);
        expect(r.ok && r.rows[0], t).toEqual({ n: 0 });
      }
      const u = await s.directo(
        "update orden_de_compra set fecha_de_entrega_prevista = '2999-01-01' where id = $1",
        [id],
      );
      expect(u.ok && u.filas).toBe(0);
    });
    const ajena = await intentarVinculo(otra, id, "1");
    expect(ajena.ok).toBe(false);
  });

  describe("reversión", () => {
    const reversion = () => readFile(REVERSION, "utf8");
    it("frena si hay órdenes, con confirmación las borra sin tocar las recepciones y se puede repetir", async () => {
      const e = await escenario();
      const id = await orden(e, ["10"]);
      const r = await recepcion(e, "2", { orden: id, linea: 1 });
      const sql = await reversion();
      await sinConfirmar(dueno, async () => {
        const frena = await intentoDelDueno(dueno, sql);
        expect(frena.ok ? "" : frena.codigo).toBe("55000");
        await dueno.query("set local pedernal.confirmar_reversion = 'SI'");
        acepta(await intentoDelDueno(dueno, sql));
        acepta(await intentoDelDueno(dueno, sql));
        for (const t of TABLAS) {
          const existe = await dueno.query<{ t: string | null }>(
            "select to_regclass($1)::text as t",
            [`public.${t}`],
          );
          expect(existe.rows[0]?.t, t).toBeNull();
        }
        const queda = await dueno.query("select 1 from recepcion where id = $1", [r]);
        expect(queda.rowCount).toBe(1);
        const disparador = await dueno.query(
          "select 1 from pg_trigger where tgname = 'recepcion_devuelve_a_la_orden'",
        );
        expect(disparador.rowCount).toBe(0);
      });
    });
  });
});
