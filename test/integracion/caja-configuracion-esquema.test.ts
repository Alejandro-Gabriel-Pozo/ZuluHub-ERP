import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  COLUMNAS_DE_CAJA,
  ERRORES_DE_CAJA_POR_RESTRICCION,
  LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO,
  identificadorExternoValido,
  nombreDeCajaValido,
  nombreDeCuentaValido,
  nombreDeMedioValido,
} from "../../src/modulos/caja/publico";
import { crearBaseAparte, crearEntornoDePrueba, crearEmpresaActiva } from "./entorno";
import { sucursalDe } from "./fixtures-identidad";

/**
 * La configuración de caja: lo que el TypeScript declara y lo que dice la base de `0027_caja.sql` (E3, tramo 3). Previene que el esquema de
 * Kysely, el mapa restricción → error de negocio y las reglas de nombre del dominio se separen de la base sin que nada lo note: una
 * columna que se agrega y no se declara, una restricción sin su traducción (sale como un error genérico), o un nombre que el TypeScript deja
 * pasar y la base rechaza (sale como un error de persistencia en vez de `NOMBRE_DE_CAJA_INVALIDO`).
 */

const base = inject("baseDePruebas");

/** Los nombres con que los disparadores de las tres tablas lanzan sus errores (`CONSTRAINT = '...'`): no existen en el catálogo. */
const RESTRICCIONES_DE_DISPARADORES = [
  "caja_sucursal_inmutable",
  "caja_con_sesion_vigente",
  "medio_de_pago_tipo_inmutable",
  "cuenta_de_cobro_tipo_inmutable",
];

const TABLAS = ["caja", "medio_de_pago", "cuenta_de_cobro"] as const;

describe.skipIf(base === null)(
  "configuración de caja: la base y el TypeScript dicen lo mismo",
  () => {
    let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
    let entornoBase: ReturnType<typeof crearEntornoDePrueba>;
    let dueno: pg.Client;
    let empresa: string;
    let sucursal: string;

    beforeAll(async () => {
      if (base === null) return;
      propia = await crearBaseAparte(base);
      entornoBase = crearEntornoDePrueba(propia.base, 2);
      dueno = new pg.Client({ connectionString: propia.base.dueno });
      await dueno.connect();
      empresa = (await crearEmpresaActiva(entornoBase)).empresa;
      sucursal = await sucursalDe(dueno, empresa);
    });
    afterAll(async () => {
      await dueno.end();
      await entornoBase.cerrar();
      await propia.destruir();
    });

    it("las columnas de las tres tablas son las que declara el esquema, en el orden de la base", async () => {
      for (const tabla of TABLAS) {
        const { rows } = await dueno.query<{ column_name: string }>(
          `select column_name from information_schema.columns
          where table_schema = 'public' and table_name = $1 order by ordinal_position`,
          [tabla],
        );
        expect(
          rows.map((r) => r.column_name),
          tabla,
        ).toEqual([...COLUMNAS_DE_CAJA[tabla]]);
      }
    });

    it("toda restricción de las tres tablas tiene su traducción declarada, y no sobra ninguna", async () => {
      const { rows } = await dueno.query<{ nombre: string }>(
        `select conname as nombre from pg_constraint
        where conrelid = any(array['public.caja','public.medio_de_pago','public.cuenta_de_cobro']::regclass[])
          and contype in ('p', 'u', 'c', 'f', 'x')
       union
       select indexname as nombre from pg_indexes
        where schemaname = 'public' and tablename in ('caja', 'medio_de_pago', 'cuenta_de_cobro')
          and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
      );
      const existentes = new Set(rows.map((r) => r.nombre));
      const declaradas = new Set(Object.keys(ERRORES_DE_CAJA_POR_RESTRICCION));
      expect(
        [...existentes].filter((n) => !declaradas.has(n)).sort(),
        "restricciones sin traducción declarada",
      ).toEqual([]);
      expect(
        [...declaradas]
          .filter((n) => !existentes.has(n) && !RESTRICCIONES_DE_DISPARADORES.includes(n))
          .sort(),
        "traducciones de restricciones que no existen",
      ).toEqual([]);
      // Los nombres de los disparadores son los que lanza la migración (si cambian ahí, esta prueba lo dice).
      const { rows: funciones } = await dueno.query<{ cuerpo: string }>(
        `select pg_get_functiondef(p.oid) as cuerpo from pg_proc p
        where p.proname in ('caja_validar_cambio', 'medio_de_pago_validar_cambio', 'cuenta_de_cobro_validar_cambio')`,
      );
      for (const nombre of RESTRICCIONES_DE_DISPARADORES) {
        expect(
          funciones.some((f) => f.cuerpo.includes(`CONSTRAINT = '${nombre}'`)),
          nombre,
        ).toBe(true);
      }
    });

    /** ¿Acepta la base esta inserción? Se prueba dentro de un savepoint y se deshace. */
    const acepta = async (texto: string, parametros: unknown[]): Promise<boolean> => {
      await dueno.query("begin");
      try {
        await dueno.query(texto, parametros);
        return true;
      } catch (e) {
        if (e instanceof pg.DatabaseError && ["23514", "23505"].includes(e.code ?? ""))
          return false;
        throw e;
      } finally {
        await dueno.query("rollback");
      }
    };

    const candidatos = [
      "a",
      "A",
      "é",
      "é",
      "Ñandú 2",
      "a b",
      "a  b",
      " a",
      "a ",
      "  ",
      "",
      "a\nb",
      "a\tb",
      "a<b",
      "a>b",
      "😀",
      "a​b",
      "a‮b",
      "a b",
      "ａ",
      "Ω",
      "+a",
      "-a",
      "=a",
      "@a",
      "a=b",
      "a'b",
      'a"b',
      "a`b",
      "a|b",
      "a\\b",
      "a{b}",
      "a[b]",
      "a~b",
      "a^b",
      "a;b",
      "a:b",
      "a#b",
      "a&b",
      "¿Qué? ¡Sí!",
      "50% off $",
      "ºª°",
      "×",
      "÷",
      "a_b-c/d.e,f(g)*h",
    ];

    /**
     * La regla común: si el TypeScript acepta un texto, la base acepta lo que el TypeScript guarda (su forma canónica); y si el TypeScript lo
     * rechaza, la base también lo rechaza tal cual (salvo lo que es blanco puro, donde el TypeScript es más estricto a propósito).
     */
    const mismaReglaQueLaBase = async (
      nombre: string,
      validar: (texto: string) => { ok: true; valor: string | null } | { ok: false },
      insertar: (valor: string | null) => Promise<boolean>,
    ) => {
      for (const texto of candidatos) {
        const ts = validar(texto);
        if (ts.ok) {
          expect(await insertar(ts.valor), `${nombre}: TS acepta ${JSON.stringify(texto)}`).toBe(
            true,
          );
        } else if (texto.trim() !== "") {
          expect(await insertar(texto), `${nombre}: TS rechaza ${JSON.stringify(texto)}`).toBe(
            false,
          );
        }
      }
    };

    it("el nombre de una caja es el mismo en TypeScript y en la base (lista de permitidos y largo)", async () => {
      const insertar = (nombre: string | null) =>
        acepta("insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, $3)", [
          empresa,
          sucursal,
          nombre,
        ]);
      await mismaReglaQueLaBase("caja", nombreDeCajaValido, insertar);
      expect(await insertar("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA))).toBe(true);
      expect(await insertar("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA + 1))).toBe(false);
    });

    it("el nombre de un medio de pago es el mismo en TypeScript y en la base", async () => {
      const insertar = (nombre: string | null) =>
        acepta("insert into medio_de_pago (empresa_id, tipo, nombre) values ($1, 'QR', $2)", [
          empresa,
          nombre,
        ]);
      await mismaReglaQueLaBase("medio", (t) => nombreDeMedioValido(t), insertar);
      expect(await insertar("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO))).toBe(true);
      expect(await insertar("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO + 1))).toBe(false);
      // Sin nombre es válido en los dos lados.
      expect(nombreDeMedioValido(null)).toEqual({ ok: true, valor: null });
      expect(await insertar(null)).toBe(true);
    });

    it("el nombre de una cuenta de cobro es el mismo en TypeScript y en la base", async () => {
      const insertar = (nombre: string | null) =>
        acepta(
          "insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id) values ($1, 'TERMINAL', $2, $3)",
          [empresa, nombre, sucursal],
        );
      await mismaReglaQueLaBase("cuenta", nombreDeCuentaValido, insertar);
      expect(await insertar("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA))).toBe(true);
      expect(await insertar("a".repeat(LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA + 1))).toBe(false);
    });

    it("el identificador externo de una cuenta es el mismo en TypeScript y en la base", async () => {
      const insertar = (identificador: string | null) =>
        acepta(
          `insert into cuenta_de_cobro (empresa_id, tipo, nombre, sucursal_id, identificador_externo)
         values ($1, 'TERMINAL', 'Cuenta', $2, $3)`,
          [empresa, sucursal, identificador],
        );
      await mismaReglaQueLaBase("identificador", identificadorExternoValido, insertar);
      expect(await insertar("a".repeat(LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO))).toBe(true);
      expect(await insertar("a".repeat(LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO + 1))).toBe(false);
      expect(await insertar(null)).toBe(true);
    });

    it("el nombre es único sin distinguir mayúsculas: por sucursal en las cajas, y por empresa en medios y cuentas", async () => {
      await dueno.query("begin");
      try {
        await dueno.query(
          "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'Caja 1')",
          [empresa, sucursal],
        );
        await dueno.query("savepoint s");
        await expect(
          dueno.query(
            "insert into caja (empresa_id, sucursal_id, nombre) values ($1, $2, 'CAJA 1')",
            [empresa, sucursal],
          ),
        ).rejects.toMatchObject({ code: "23505", constraint: "caja_nombre_uk" });
        await dueno.query("rollback to savepoint s");
        await dueno.query(
          "insert into medio_de_pago (empresa_id, tipo, nombre) values ($1, 'QR', 'Medio')",
          [empresa],
        );
        await expect(
          dueno.query(
            "insert into medio_de_pago (empresa_id, tipo, nombre) values ($1, 'OTRO', 'MEDIO')",
            [empresa],
          ),
        ).rejects.toMatchObject({ code: "23505", constraint: "medio_de_pago_nombre_uk" });
      } finally {
        await dueno.query("rollback");
      }
    });
  },
);
