import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import {
  COLUMNAS_DE_CAJA,
  ERRORES_DE_CAJA_POR_RESTRICCION,
  LARGO_MAXIMO_DEL_IDENTIFICADOR_EXTERNO,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CAJA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_CUENTA,
  LARGO_MAXIMO_DEL_NOMBRE_DE_MEDIO,
  exigirClave,
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
  // La operación (tramo 5): sesión, movimiento y arqueo.
  "sesion_caja_actor_invalido",
  "sesion_caja_caja_inactiva",
  "sesion_caja_sucursal_inactiva",
  "sesion_caja_sello_invalido",
  "sesion_caja_fecha_negocio_invalida",
  "sesion_caja_jornada_no_abierta",
  "sesion_caja_inmutable",
  "sesion_caja_cerrada_congelada",
  "sesion_caja_transicion_invalida",
  "sesion_caja_arqueo_incompleto",
  "sesion_caja_arqueo_no_cuadra",
  "sesion_caja_conteo_no_cuadra",
  "sesion_caja_conforme_invalido",
  "movimiento_caja_actor_invalido",
  "movimiento_caja_sesion_no_abierta",
  "movimiento_caja_jornada_no_abierta",
  "movimiento_caja_anulacion_con_origen",
  "movimiento_caja_anulacion_invalida",
  "movimiento_caja_solo_efectivo",
  "movimiento_caja_corrige_jornada_inexistente",
  "movimiento_caja_corrige_jornada_no_cerrada",
  "movimiento_caja_corrige_jornada_no_anterior",
  "movimiento_caja_sin_documento",
  "arqueo_caja_actor_invalido",
  "arqueo_caja_efectivo_conforme",
  "arqueo_caja_efectivo_sin_contar",
  "arqueo_caja_monedas_solo_efectivo",
  "arqueo_caja_sesion_invalida",
  // El cobro (tramo 6): `cobro_validar_alta`.
  "cobro_clase_invalida",
  "cobro_dato_no_habilitado",
  "cobro_marca_invalida",
];

/**
 * Los errores de `par_de_cobro_validar` (la regla medio ↔ cuenta de la base) llevan el nombre de la tabla de quien llama más un sufijo
 * (`p_tabla || '_cuenta_inactiva'`): no existen en el catálogo ni aparecen escritos enteros en el cuerpo de la función. Se verifica el
 * sufijo y que cada tabla que llama a la función con su nombre (`movimiento_caja`) tenga la traducción.
 */
const SUFIJOS_DEL_PAR_DE_COBRO = [
  "medio_inexistente",
  "medio_inactivo",
  "cuenta_no_admitida",
  "cuenta_inexistente",
  "cuenta_de_otra_sucursal",
  "cuenta_inactiva",
  "cuenta_incompatible",
];

/** Las tablas cuyas columnas declara el esquema (`valor_de_lista` y `correccion_de_medio` solo se leen: sus restricciones las traducen la plataforma y el tramo de la corrección). */
const TABLAS = [
  "caja",
  "medio_de_pago",
  "cuenta_de_cobro",
  "sesion_caja",
  "movimiento_caja",
  "cobro",
  "arqueo_caja",
  "arqueo_billete",
  "valor_de_lista",
  "correccion_de_medio",
] as const;
/** Las tablas cuyas restricciones tienen su traducción a un error de negocio. */
const TABLAS_CON_TRADUCCION = [
  "caja",
  "medio_de_pago",
  "cuenta_de_cobro",
  "sesion_caja",
  "movimiento_caja",
  "cobro",
  "arqueo_caja",
  "arqueo_billete",
] as const;

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

    it("las columnas de las tablas de caja son las que declara el esquema, en el orden de la base", async () => {
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

    it("toda restricción de las tablas de caja tiene su traducción declarada, y no sobra ninguna", async () => {
      const { rows } = await dueno.query<{ nombre: string }>(
        `select conname as nombre from pg_constraint
        where conrelid = any($1::text[]::regclass[])
          and contype in ('p', 'u', 'c', 'f', 'x')
       union
       select indexname as nombre from pg_indexes
        where schemaname = 'public' and tablename = any($2::text[])
          and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
        [TABLAS_CON_TRADUCCION.map((t) => `public.${t}`), [...TABLAS_CON_TRADUCCION]],
      );
      const existentes = new Set(rows.map((r) => r.nombre));
      const declaradas = new Set(Object.keys(ERRORES_DE_CAJA_POR_RESTRICCION));
      expect(
        [...existentes].filter((n) => !declaradas.has(n)).sort(),
        "restricciones sin traducción declarada",
      ).toEqual([]);
      expect(
        [...declaradas]
          .filter(
            (n) =>
              !existentes.has(n) &&
              !RESTRICCIONES_DE_DISPARADORES.includes(n) &&
              !SUFIJOS_DEL_PAR_DE_COBRO.some((sufijo) => n === `movimiento_caja_${sufijo}`),
          )
          .sort(),
        "traducciones de restricciones que no existen",
      ).toEqual([]);
      // Los nombres de los disparadores son los que lanza la migración (si cambian ahí, esta prueba lo dice).
      const { rows: funciones } = await dueno.query<{ cuerpo: string }>(
        `select pg_get_functiondef(p.oid) as cuerpo from pg_proc p
        where p.proname in ('caja_validar_cambio', 'medio_de_pago_validar_cambio', 'cuenta_de_cobro_validar_cambio',
                            'sesion_caja_validar_alta', 'sesion_caja_validar_cambio', 'sesion_caja_verificar_cierre',
                            'movimiento_caja_validar_alta', 'movimiento_caja_verificar_documento', 'cobro_validar_alta',
                            'arqueo_caja_validar_alta', 'arqueo_billete_validar_alta', 'arqueo_verificar_sesion_cerrada')`,
      );
      const { rows: par } = await dueno.query<{ cuerpo: string }>(
        "select pg_get_functiondef(p.oid) as cuerpo from pg_proc p where p.proname = 'par_de_cobro_validar'",
      );
      for (const sufijo of SUFIJOS_DEL_PAR_DE_COBRO) {
        expect(par[0]?.cuerpo.includes(`p_tabla || '_${sufijo}'`), sufijo).toBe(true);
        expect(
          ERRORES_DE_CAJA_POR_RESTRICCION[`movimiento_caja_${sufijo}`],
          `movimiento_caja_${sufijo}`,
        ).toBeDefined();
      }
      for (const nombre of RESTRICCIONES_DE_DISPARADORES) {
        expect(
          funciones.some((f) => f.cuerpo.includes(`CONSTRAINT = '${nombre}'`)),
          nombre,
        ).toBe(true);
      }
    });

    it("la forma de la clave de idempotencia es la de los CHECK de sesion_caja y movimiento_caja: cada muestra la acepta o rechaza igual el TypeScript y la base", async () => {
      const muestras = [
        "a".repeat(15),
        "a".repeat(16),
        "A".repeat(128),
        "a".repeat(129),
        "abc-DEF_123-456_xyz",
        "con espacio 1234567",
        "con.punto.12345678",
        "ñandú-ñandú-ñandú-ñandú",
        "abcdefghijklmnop\n",
        "",
      ];
      for (const check of ["sesion_caja_clave_ck", "movimiento_caja_clave_ck"]) {
        const { rows } = await dueno.query<{ def: string }>(
          "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1",
          [check],
        );
        const patron = /'(\^[^']*\$)'::text/.exec(rows[0]?.def ?? "")?.[1];
        expect(patron, check).toBeDefined();
        for (const muestra of muestras) {
          const { rows: r } = await dueno.query<{ ok: boolean }>(
            "select $1::text ~ $2::text as ok",
            [muestra, patron],
          );
          expect(exigirClave(muestra).ok, `${check}: ${JSON.stringify(muestra)}`).toBe(r[0]?.ok);
        }
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
