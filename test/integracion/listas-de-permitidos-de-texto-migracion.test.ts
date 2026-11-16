import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { domicilioDesdeDatos } from "../../src/primitivas/domicilio/domicilio";
import { textoDeUnaLineaDesdeTexto } from "../../src/primitivas/texto/texto-de-una-linea";
import { crearEscenario } from "./facturacion-apoyo";
import type { BaseDePruebas } from "./global";
import { CARPETA_DE_MIGRACIONES, baseConMigraciones } from "./marcas-apoyo";

/**
 * La migración 0062: la base pasa de «sin caracteres de control» a la lista de PERMITIDOS que ya usa el dominio. Se prueba: que cada
 * función de la base dice lo mismo que la regla del dominio sobre todos los puntos de código del plano básico (y una muestra de los
 * demás), que los 14 CHECK usan la función que les toca, que el PRE-CHEQUEO aborta con tabla, columna y cantidad sin dejar nada a
 * medias cuando hay datos viejos que no cumplen, que sobre datos que sí cumplen no cambia ni una fila, y la reversión.
 * Previene: que la base acepte lo que el dominio rechaza (o al revés), y una migración que bloquee la autorización de un comprobante
 * por una fila vieja.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });
const b = () => base as BaseDePruebas;

const ARCHIVO = "0062_listas_de_permitidos_de_texto.sql";
const REVERSION = "0062_revertir_listas_de_permitidos_de_texto.sql";
const textoDe = (carpeta: string, archivo: string) => readFile(join(carpeta, archivo), "utf8");

/** Los CHECK que cambian: tabla, nombre y la función que les toca. */
const CHECKS: readonly (readonly [string, string, string])[] = [
  ["sucursal", "sucursal_nombre_control_ck", "texto_de_una_linea_valido"],
  ["domicilio", "domicilio_calle_ck", "texto_de_una_linea_valido"],
  ["domicilio", "domicilio_localidad_ck", "texto_de_una_linea_valido"],
  ["domicilio", "domicilio_piso_ck", "piso_o_departamento_valido"],
  ["domicilio", "domicilio_departamento_ck", "piso_o_departamento_valido"],
  ["datos_fiscales", "datos_fiscales_razon_social_ck", "texto_de_una_linea_valido"],
  ["datos_fiscales", "datos_fiscales_iibb_numero_ck", "numero_de_iibb_valido"],
  ["comprobante", "comprobante_sucursal_nombre_ck", "texto_de_una_linea_valido"],
  ["comprobante", "comprobante_emisor_razon_social_ck", "texto_de_una_linea_valido"],
  ["comprobante", "comprobante_emisor_domicilio_ck", "texto_de_una_linea_valido"],
  ["comprobante", "comprobante_emisor_iibb_numero_ck", "numero_de_iibb_valido"],
  ["comprobante", "comprobante_pv_domicilio_ck", "texto_de_una_linea_valido"],
  ["comprobante", "comprobante_receptor_nombre_ck", "texto_de_una_linea_valido"],
  ["comprobante", "comprobante_receptor_domicilio_ck", "texto_de_una_linea_valido"],
];

const definicion = async (c: pg.Client, tabla: string, nombre: string): Promise<string> => {
  const { rows } = await c.query<{ def: string }>(
    `select pg_get_constraintdef(oid) as def from pg_constraint
      where conname = $1 and conrelid = ('public.' || $2)::regclass`,
    [nombre, tabla],
  );
  expect(rows, `falta el CHECK ${nombre}`).toHaveLength(1);
  return rows[0]?.def as string;
};

/** Los puntos de código que se comparan: todo el plano básico (menos NUL y sustitutos) y una muestra de los otros planos. */
const PUNTOS: readonly number[] = [
  ...Array.from({ length: 0x10000 }, (_, i) => i).filter(
    (i) => i !== 0 && !(i >= 0xd800 && i <= 0xdfff),
  ),
  0x1f600,
  0x1f4de,
  0x10000,
  0x20000,
  0xe0001,
  0xe0020,
];

describe.skipIf(base === null)("0062: las listas de permitidos de la base repiten las del dominio", () => {
  let c: pg.Client;
  beforeAll(async () => {
    if (base === null) return;
    c = new pg.Client({ connectionString: b().dueno });
    await c.connect();
  });
  afterAll(async () => {
    await c.end();
  });

  const dice = async (consulta: string, valor: string | null, maximo?: number) =>
    (await c.query<{ ok: boolean | null }>(consulta, maximo === undefined ? [valor] : [valor, maximo]))
      .rows[0]?.ok;

  it("texto_de_una_linea_valido dice lo mismo que `textoDeUnaLineaDesdeTexto` en cada punto de código (y el texto ya canónico)", async () => {
    // El dominio normaliza (NFC, espacios repetidos en uno); la base exige que el texto YA venga así: se compara contra «el dominio lo deja igual».
    const igualEnElDominio = (texto: string): boolean => {
      const r = textoDeUnaLineaDesdeTexto(texto, { maximo: 100, exigirUnaLetra: false });
      return r.ok && r.valor === texto;
    };
    const lote: string[] = [];
    for (const punto of PUNTOS) lote.push(`a${String.fromCodePoint(punto)}b`);
    const { rows } = await c.query<{ t: string; ok: boolean }>(
      "select t, texto_de_una_linea_valido(t, 100) as ok from unnest($1::text[]) as t",
      [lote],
    );
    const distintos = rows.filter((r) => r.ok !== igualEnElDominio(r.t)).map((r) => r.t.codePointAt(1)?.toString(16));
    expect(distintos, "puntos de código en que la base y el dominio no coinciden").toEqual([]);
    expect(rows.filter((r) => r.ok).length, "la lista no puede quedar vacía").toBeGreaterThan(150);
  });

  it("los bordes de texto_de_una_linea_valido: largo, extremos, `+` y `-` iniciales, NFC y NULL", async () => {
    const q = "select texto_de_una_linea_valido($1, $2) as ok";
    expect(await dice(q, "a".repeat(100), 100)).toBe(true);
    expect(await dice(q, "a".repeat(101), 100)).toBe(false);
    expect(await dice(q, "", 100)).toBe(false);
    expect(await dice(q, " a", 100)).toBe(false);
    expect(await dice(q, "a ", 100)).toBe(false);
    expect(await dice(q, "+a", 100)).toBe(false);
    expect(await dice(q, "-a", 100)).toBe(false);
    expect(await dice(q, "a-+b", 100)).toBe(true);
    expect(await dice(q, "Café", 100)).toBe(false);
    expect(await dice(q, "Café", 100)).toBe(true);
    expect(await dice(q, null, 100)).toBe(false);
    // El tope cuenta caracteres, no bytes ni unidades de UTF-16.
    expect(await dice(q, "é".repeat(100), 100)).toBe(true);
  });

  it("piso_o_departamento_valido dice lo mismo que `domicilioDesdeDatos` en cada punto de código", async () => {
    const aceptaElDominio = (texto: string): boolean => {
      const r = domicilioDesdeDatos({
        calle: "a",
        numero: "1",
        piso: texto,
        localidad: "a",
        provincia: "AR-B",
      });
      return r.ok;
    };
    const lote = PUNTOS.map((p) => `a${String.fromCodePoint(p)}b`);
    const { rows } = await c.query<{ t: string; ok: boolean }>(
      "select t, piso_o_departamento_valido(t, 20) as ok from unnest($1::text[]) as t",
      [lote],
    );
    // El dominio recorta y usa el texto tal cual: con `a…b` (sin extremos) los dos ven lo mismo.
    const distintos = rows.filter((r) => r.ok !== aceptaElDominio(r.t)).map((r) => r.t.codePointAt(1)?.toString(16));
    expect(distintos).toEqual([]);
    const q = "select piso_o_departamento_valido($1, $2) as ok";
    for (const bueno of ["PB", "3", "-1", "1°", "B/2", "Sub 1", "Único", "Ñ"]) {
      expect(await dice(q, bueno, 20), bueno).toBe(true);
    }
    for (const malo of ["", " 1", "1 ", "<1>", "1&2", "😀", "a".repeat(21)]) {
      expect(await dice(q, malo, 20), JSON.stringify(malo)).toBe(false);
    }
    expect(await dice(q, null, 20)).toBe(false);
  });

  it("numero_de_iibb_valido: la forma de `datos-fiscales.ts` (letras latinas, dígitos, espacio y `. / -`, de 1 a 30, empieza con letra o dígito)", async () => {
    const q = "select numero_de_iibb_valido($1) as ok";
    for (const bueno of ["901-123456-7", "CM 901-123456-7", "280123456", "12.345/6", "a", "en trámite", "1".repeat(30)]) {
      expect(await dice(q, bueno), bueno).toBe(true);
    }
    for (const malo of ["", "-123", " 1", "1 ", "12​3", "<b>1</b>", "123 ✨", "1".repeat(31), "小林 1"]) {
      expect(await dice(q, malo), JSON.stringify(malo)).toBe(false);
    }
    expect(await dice(q, null)).toBe(false);
  });

  it("los 14 CHECK usan la función que les toca, con el nombre que ya tenían", async () => {
    for (const [tabla, nombre, funcion] of CHECKS) {
      const def = await definicion(c, tabla, nombre);
      expect(def, `${nombre}: ${def}`).toContain(funcion);
      expect(def, `${nombre} no puede conservar la lista de prohibidos`).not.toContain("x01");
    }
  });
});

describe.skipIf(base === null)("0062 sobre una base con datos", () => {
  let previas: string[];
  beforeAll(async () => {
    previas = (await readdir(CARPETA_DE_MIGRACIONES))
      .filter((n) => /^\d{4}_[a-z0-9_]+\.sql$/.test(n) && n < ARCHIVO)
      .sort();
  });

  it("con datos que no cumplen ABORTA con tabla, columna y cantidad y no deja nada a medias; con datos que cumplen no cambia ni una fila; y la reversión vuelve atrás", async () => {
    const previa = await baseConMigraciones(b(), previas);
    const c = previa.cliente;
    try {
      const e = await crearEscenario(c);
      // Datos que hoy valen (la regla vieja solo rechaza controles) pero que la lista de permitidos no nombra.
      await c.query("update sucursal set nombre = $1 where id = $2", [`Casa​ central`, e.sucursal]);
      await c.query(
        `insert into domicilio (empresa_id, calle, numero, localidad, provincia, piso)
         values ($1, 'Calle <b>', '1', 'Rosario', 'AR-S', '1 😀')`,
        [e.empresa],
      );
      const migracion = await textoDe(CARPETA_DE_MIGRACIONES, ARCHIVO);
      const huella = async () =>
        (await c.query<{ h: string }>(
          `select md5(coalesce((select string_agg(to_jsonb(x)::text, '|' order by id) from sucursal x), '')
               || coalesce((select string_agg(to_jsonb(x)::text, '|' order by id) from domicilio x), '')
               || coalesce((select string_agg(to_jsonb(x)::text, '|' order by id) from datos_fiscales x), '')
               || coalesce((select string_agg(to_jsonb(x)::text, '|' order by id) from comprobante x), '')) as h`,
        )).rows[0]?.h;
      const antes = await huella();

      // 1. Aborta, y dice qué y cuánto.
      let mensaje = "";
      try {
        await c.query(migracion);
      } catch (error) {
        mensaje = (error as Error).message;
      }
      expect(mensaje).toContain("0062: hay datos que no cumplen");
      expect(mensaje).toContain("sucursal.nombre: 1 fila(s)");
      expect(mensaje).toContain("domicilio.calle: 1 fila(s)");
      expect(mensaje).toContain("domicilio.piso: 1 fila(s)");
      // 2. No quedó nada a medias: ni las funciones ni un CHECK cambiado, ni un dato tocado.
      const { rows: funciones } = await c.query(
        "select 1 from pg_proc where proname in ('texto_de_una_linea_valido', 'piso_o_departamento_valido', 'numero_de_iibb_valido')",
      );
      expect(funciones).toHaveLength(0);
      expect(await definicion(c, "sucursal", "sucursal_nombre_control_ck")).toContain("x01");
      expect(await huella()).toBe(antes);

      // 3. Corregidos los datos, se aplica sin cambiar ninguna fila.
      await c.query("update sucursal set nombre = 'Casa central' where id = $1", [e.sucursal]);
      await c.query("delete from domicilio where calle = 'Calle <b>'");
      const limpias = await huella();
      await c.query(migracion);
      expect(await huella()).toBe(limpias);
      for (const [tabla, nombre, funcion] of CHECKS) {
        expect(await definicion(c, tabla, nombre), nombre).toContain(funcion);
      }

      // 4. Con la lista nueva, la base rechaza por sí sola lo hostil y acepta lo válido.
      for (const calle of ["Calle​x", "Calle‮x", "<b>x</b>", "Calle 😀", "=1+1", "小林商事"]) {
        await c.query("savepoint s");
        await expect(
          c.query(
            `insert into domicilio (empresa_id, calle, numero, localidad, provincia) values ($1, $2, '1', 'Rosario', 'AR-S')`,
            [e.empresa, calle],
          ),
          JSON.stringify(calle),
        ).rejects.toMatchObject({ code: "23514", constraint: "domicilio_calle_ck" });
        await c.query("rollback to savepoint s");
      }
      for (const calle of ["D'Orbigny", "Pellegrini & Cía.", "25 de Mayo", "Ñandú"]) {
        await c.query("savepoint s");
        await c.query(
          `insert into domicilio (empresa_id, calle, numero, localidad, provincia, piso, departamento)
           values ($1, $2, '1', 'Rosario', 'AR-S', '-1', 'Único')`,
          [e.empresa, calle],
        );
        await c.query("rollback to savepoint s");
      }
      await c.query("savepoint s");
      await expect(
        c.query("update sucursal set nombre = $1 where id = $2", ["Casa​central", e.sucursal]),
      ).rejects.toMatchObject({ code: "23514", constraint: "sucursal_nombre_control_ck" });
      await c.query("rollback to savepoint s");

      // 5. La reversión vuelve a «sin controles», no pierde datos y se puede repetir.
      const reversion = await textoDe(join(CARPETA_DE_MIGRACIONES, "reversiones"), REVERSION);
      await c.query(reversion);
      await c.query(reversion);
      expect(await huella()).toBe(limpias);
      for (const [tabla, nombre, funcion] of CHECKS) {
        expect(await definicion(c, tabla, nombre), nombre).not.toContain(funcion);
      }
      const { rows: quedan } = await c.query(
        "select 1 from pg_proc where proname in ('texto_de_una_linea_valido', 'piso_o_departamento_valido', 'numero_de_iibb_valido')",
      );
      expect(quedan).toHaveLength(0);
      const { rows: registro } = await c.query(
        "select 1 from migracion where nombre = '0062_listas_de_permitidos_de_texto.sql'",
      );
      expect(registro).toHaveLength(0);
    } finally {
      await previa.cerrar();
      await previa.aparte.destruir();
      await rm(previa.carpeta, { recursive: true, force: true });
    }
  });
});
