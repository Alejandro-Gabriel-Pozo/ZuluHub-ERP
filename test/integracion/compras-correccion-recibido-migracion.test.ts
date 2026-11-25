import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import {
  CAUSAS_DE_CORRECCION,
  MAXIMO_DE_LA_NOTA_DE_CORRECCION,
} from "../../src/modulos/compras/publico";
import { MOTIVOS_DE_MOVIMIENTO } from "../../src/modulos/stock/dominio/motivos";
import { nuevoId, valorDe } from "./clientes-apoyo";
import {
  montarCompras,
  type EscenarioDeCompras,
  type MontajeDeCompras,
} from "./compras-casos-apoyo";
import { acepta, intentoDelDueno, sinConfirmar } from "./fiscal-apoyo";
import { CARPETA_DE_MIGRACIONES } from "./marcas-apoyo";

/**
 * Migración 0098 (corregir lo recibido): la lista de causas y el largo de la nota de la base son los del código, los dos motivos de stock sembrados son los del código, la aplicación solo inserta (ni actualiza ni
 * borra) y el saldo de lo recibido sigue cerrado a todo UPDATE directo, y la reversión frena con correcciones, sin ellas deja todo como antes y se puede repetir y volver a aplicar. Previene: una causa o un largo que
 * la base y el código entienden distinto, y una reversión que borre en silencio el historial de lo corregido.
 */
const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const leer = (archivo: string) => readFile(join(CARPETA_DE_MIGRACIONES, archivo), "utf8");

describe.skipIf(base === null)("0098: correccion_de_lo_recibido", () => {
  let c: MontajeDeCompras;
  let e: EscenarioDeCompras;
  let recepcionId: string;
  beforeAll(async () => {
    if (base === null) return;
    c = await montarCompras(base);
    c.encenderPerilla("recepcion_separada");
    e = await c.escenario();
    valorDe(
      await c.casos.configurarCompras(e.gerente, {
        nivel: "RECEPCION_SEPARADA",
        versionEsperada: 1,
      }),
    );
    const deposito = await c.deposito(e);
    const { producto } = await c.articulo(e, { unidadBase: "GRAMO", dimension: "MASA" });
    const proveedor = await c.proveedor(e.operador);
    recepcionId = valorDe(
      await c.casos.registrarRecepcion(e.operador, {
        clave: nuevoId(),
        sucursalId: e.sucursal,
        proveedorId: proveedor,
        renglones: [
          {
            productoId: producto,
            unidadDeCompraId: "KILOGRAMO",
            cantidad: "2",
            precioPor: "UNIDAD",
            unidadDePrecioId: "KILOGRAMO",
            precio: "1000",
          },
        ],
      }),
    ).recepcionId;
    valorDe(await c.casos.confirmarRecepcion(e.gerente, { recepcionId, depositoId: deposito }));
  });
  afterAll(async () => {
    if (base !== null) await c.cerrar();
  });

  const definicion = async (restriccion: string) =>
    (
      await c.filas<{ def: string }>(
        "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
        [restriccion],
      )
    )[0]?.def ?? "";

  it("las causas de la base son las del código y el largo de la nota es el mismo", async () => {
    const causas = [
      ...(await definicion("correccion_de_lo_recibido_causa_ck")).matchAll(/'([A-Z_]+)'::text/g),
    ].map((m) => m[1]);
    expect(causas.sort()).toEqual([...CAUSAS_DE_CORRECCION].sort());
    expect(await definicion("correccion_de_lo_recibido_nota_ck")).toContain(
      `texto_de_catalogo_valido(nota, ${String(MAXIMO_DE_LA_NOTA_DE_CORRECCION)})`,
    );
  });

  it("los motivos de stock de la corrección están sembrados como en el código (la entrada con costo, la salida sin él)", async () => {
    const filas = await c.filas<{
      clase: string;
      entra_con_costo: boolean;
      entrega_mercaderia: boolean;
    }>(
      "select clase, entra_con_costo, entrega_mercaderia from motivo_de_movimiento where codigo = 'CORRECCION_DE_RECEPCION' order by clase",
    );
    const enCodigo = MOTIVOS_DE_MOVIMIENTO.filter((m) => m.codigo === "CORRECCION_DE_RECEPCION")
      .map((m) => ({
        clase: m.clase,
        entra_con_costo: m.entraConCosto,
        entrega_mercaderia: m.entregaMercaderia,
      }))
      .sort((a, b) => a.clase.localeCompare(b.clase));
    expect(filas).toEqual(enCodigo);
    expect(filas).toHaveLength(2);
  });

  it("la aplicación solo inserta en la tabla nueva (ni UPDATE ni DELETE) y puede actualizar de `saldo_de_linea_de_recepcion` solo lo asignado y lo recibido, este último guardado por el disparador", async () => {
    const tabla = await c.filas<{ privilegio: string }>(
      "select privilege_type as privilegio from information_schema.table_privileges where table_name = 'correccion_de_lo_recibido' and grantee = 'pedernal_app'",
    );
    expect(tabla.map((p) => p.privilegio)).toEqual(["SELECT"]);
    const columnas = await c.filas<{ columna: string }>(
      "select column_name as columna from information_schema.column_privileges where table_name = 'correccion_de_lo_recibido' and grantee = 'pedernal_app' and privilege_type = 'INSERT'",
    );
    expect(columnas.map((x) => x.columna).sort()).toEqual(
      [
        "causa",
        "cantidad_anterior",
        "cantidad_nueva",
        "clave_idempotencia",
        "empresa_id",
        "huella",
        "id",
        "linea",
        "movimiento_id",
        "nota",
        "numero",
        "recepcion_id",
        "registrado_por",
      ].sort(),
    );
    const saldo = await c.filas<{ columna: string }>(
      "select column_name as columna from information_schema.column_privileges where table_name = 'saldo_de_linea_de_recepcion' and grantee = 'pedernal_app' and privilege_type = 'UPDATE'",
    );
    expect(saldo.map((x) => x.columna).sort()).toEqual(["cantidad_asignada", "cantidad_recibida"]);
    // Y aun con el permiso, nadie lo cambia a mano: solo el disparador de la corrección (y el de las asignaciones, para lo asignado).
    const directo = await sinConfirmar(c.dueno, () =>
      intentoDelDueno(
        c.dueno,
        "update saldo_de_linea_de_recepcion set cantidad_recibida = 1 where recepcion_id = $1",
        [recepcionId],
      ),
    );
    expect(directo).toMatchObject({
      ok: false,
      restriccion: "saldo_de_linea_de_recepcion_solo_por_disparadores",
    });
  });

  it("la reversión frena con correcciones; sin ellas se puede correr dos veces, deja todo como antes y la migración se puede volver a aplicar", async () => {
    const reversion = await leer("reversiones/0098_revertir_correccion_de_lo_recibido.sql");
    const migracion = await leer("0098_correccion_de_lo_recibido.sql");
    // Con una corrección hecha por el caso de uso frena (y no borra nada).
    const hecha = valorDe(
      await c.casos.corregirLoRecibido(e.gerente, {
        clave: nuevoId(),
        recepcionId,
        linea: 1,
        correccionesVistas: 0,
        cantidad: "1500",
        causa: "ERROR_DE_CARGA",
      }),
    );
    expect(hecha.numero).toBe(1);
    await sinConfirmar(c.dueno, async () => {
      const frena = await intentoDelDueno(c.dueno, reversion);
      expect(frena.ok).toBe(false);
      expect(frena.ok ? "" : frena.codigo).toBe("55000");
    });
    expect(await c.contar("select count(*) as n from correccion_de_lo_recibido")).toBe(1);
    // Sin correcciones (en una transacción que se descarta): revierte, repite, y al volver a aplicar queda como al principio.
    await sinConfirmar(c.dueno, async () => {
      await c.dueno.query("alter table correccion_de_lo_recibido disable trigger user");
      await c.dueno.query("delete from correccion_de_lo_recibido");
      await c.dueno.query("alter table correccion_de_lo_recibido enable trigger user");
      acepta(await intentoDelDueno(c.dueno, reversion));
      acepta(await intentoDelDueno(c.dueno, reversion));
      expect(
        (
          await c.dueno.query<{ t: string | null }>(
            "select to_regclass('public.correccion_de_lo_recibido')::text as t",
          )
        ).rows[0]?.t,
      ).toBeNull();
      const privilegio = await c.dueno.query<{ n: string }>(
        "select count(*)::text as n from information_schema.column_privileges where table_name = 'saldo_de_linea_de_recepcion' and grantee = 'pedernal_app' and privilege_type = 'UPDATE' and column_name = 'cantidad_recibida'",
      );
      expect(privilegio.rows[0]?.n).toBe("0");
      acepta(await intentoDelDueno(c.dueno, migracion));
      expect(
        (
          await c.dueno.query<{ t: string | null }>(
            "select to_regclass('public.correccion_de_lo_recibido')::text as t",
          )
        ).rows[0]?.t,
      ).toBe("correccion_de_lo_recibido");
    });
    // Nada de lo anterior quedó: la corrección real sigue y el saldo también.
    expect(await c.contar("select count(*) as n from correccion_de_lo_recibido")).toBe(1);
  });
});
