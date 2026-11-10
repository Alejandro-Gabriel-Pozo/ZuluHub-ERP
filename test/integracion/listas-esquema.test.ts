import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { traducirErrorDeBase } from "../../src/adaptadores/postgres/errores";
import {
  COLUMNAS_DE_VALOR_DE_LISTA,
  ERRORES_DE_LISTAS_POR_RESTRICCION,
  LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR,
  LISTAS_DEL_SISTEMA,
  RESTRICCIONES_DE_DISPARADORES_DE_LISTAS,
  errorDeListasDeRestriccion,
  nombreDeValorDesdeTexto,
} from "../../src/modulos/listas/publico";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import { crearBaseAparte } from "./entorno";

/**
 * Lo que el TypeScript de las listas del sistema repite de la base (`valor_de_lista`, 0027), comparado con la base REAL: las columnas, las
 * restricciones y los disparadores del mapa de traducción (no falta ni sobra ninguna), las listas declaradas, el largo y la lista de
 * permitidos del nombre, y cada traducción con el error verdadero de la base. Base propia. Los privilegios y las políticas de la tabla
 * son de `caja-migracion.test.ts` y `plataforma-sql.test.ts`; que una empresa no escribe, de `listas-aislamiento.test.ts`.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("listas del sistema: lo que el código repite de la base", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  async function provocar(texto: string, parametros: unknown[] = []): Promise<ErrorDePersistencia> {
    try {
      await dueno.query(texto, parametros);
    } catch (error) {
      const traducido = traducirErrorDeBase(error);
      if (traducido !== null) return traducido;
      throw error;
    }
    throw new Error(`la base tenía que rechazar: ${texto}`);
  }

  it("las columnas son las de la lista, en el orden de la base", async () => {
    const reales = await filas<{ column_name: string }>(
      `select column_name from information_schema.columns
        where table_schema = 'public' and table_name = 'valor_de_lista' order by ordinal_position`,
    );
    expect(reales.map((c) => c.column_name)).toEqual([...COLUMNAS_DE_VALOR_DE_LISTA]);
  });

  it("el mapa de restricciones tiene EXACTAMENTE las restricciones, los índices únicos y los disparadores de la tabla", async () => {
    const reales = await filas<{ nombre: string }>(
      `select conname as nombre from pg_constraint
        where conrelid = 'public.valor_de_lista'::regclass and contype in ('p', 'u', 'c', 'f', 'x')
       union
       select indexname as nombre from pg_indexes
        where schemaname = 'public' and tablename = 'valor_de_lista'
          and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
    );
    const cuerpos = await filas<{ prosrc: string }>(
      `select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = 'valor_de_lista_validar_cambio'`,
    );
    expect(cuerpos).toHaveLength(1);
    const lanzadas = [...(cuerpos[0]?.prosrc ?? "").matchAll(/CONSTRAINT = '([a-z_]+)'/g)].map(
      (m) => m[1],
    );
    expect([...lanzadas].sort()).toEqual([...RESTRICCIONES_DE_DISPARADORES_DE_LISTAS].sort());
    expect(Object.keys(ERRORES_DE_LISTAS_POR_RESTRICCION).sort()).toEqual(
      [...reales.map((r) => r.nombre), ...lanzadas].sort(),
    );
  });

  it("las listas declaradas son las del CHECK de la base: cada una entra y una cualquiera no", async () => {
    for (const lista of LISTAS_DEL_SISTEMA) {
      const { rows } = await dueno.query<{ id: string }>(
        "insert into valor_de_lista (lista, nombre) values ($1, $2) returning id",
        [lista, `Prueba de lista ${lista}`],
      );
      expect(rows).toHaveLength(1);
    }
    const error = await provocar(
      "insert into valor_de_lista (lista, nombre) values ('OTRA_LISTA', 'Algo')",
    );
    expect(error).toEqual({ tipo: "Check", restriccion: "valor_de_lista_lista_ck" });
    expect(errorDeListasDeRestriccion(error)).toBeNull();
  });

  it("el largo y los caracteres del nombre: lo que el TypeScript acepta la base lo acepta y lo que rechaza, también", async () => {
    expect(LARGO_MAXIMO_DEL_NOMBRE_DE_VALOR).toBe(40);
    const casos = [
      "a".repeat(40),
      "a".repeat(41),
      "Cobro dañado",
      "Ñandú ¿Qué? ¡Sí!",
      "Visa (débito) 50% #1 & $",
      "x/y + z * w _ - . , ; : ' \" °ºª",
      "con\ttab",
      "con\nsalto",
      "a​b",
      "<b>",
      "😀",
      "Ω",
    ];
    for (const nombre of casos) {
      const ts = nombreDeValorDesdeTexto(nombre);
      const enBase = await dueno
        .query("insert into valor_de_lista (lista, nombre) values ('MOTIVOS_DE_RECHAZO', $1)", [
          // Lo que el TypeScript deja es lo que viaja; si lo rechaza, se prueba el texto crudo (la base también tiene que rechazarlo).
          ts.ok ? ts.valor : nombre,
        ])
        .then(() => true)
        .catch((error: unknown) => {
          const traducido = traducirErrorDeBase(error);
          expect(traducido, JSON.stringify(nombre)).toEqual({
            tipo: "Check",
            restriccion: "valor_de_lista_nombre_ck",
          });
          return false;
        });
      expect(enBase, JSON.stringify(nombre)).toBe(ts.ok);
    }
    // Vacío, solo blancos y con blancos en los extremos: la base los rechaza (el TypeScript recorta o rechaza antes).
    for (const nombre of ["", " ", " a", "a "]) {
      const error = await provocar(
        "insert into valor_de_lista (lista, nombre) values ('MOTIVOS_DE_RECHAZO', $1)",
        [nombre],
      );
      expect(error, JSON.stringify(nombre)).toEqual({
        tipo: "Check",
        restriccion: "valor_de_lista_nombre_ck",
      });
    }
  });

  it("la única por nombre se traduce a VALOR_DUPLICADO con el error verdadero de la base, sin distinguir mayúsculas ni acentos", async () => {
    await dueno.query(
      "insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', 'Tarjeta Única')",
    );
    for (const nombre of ["Tarjeta Única", "TARJETA UNICA", "tarjeta única", "Tarjeta Unica"]) {
      const error = await provocar(
        "insert into valor_de_lista (lista, nombre) values ('MARCAS_DE_TARJETA', $1)",
        [nombre],
      );
      expect(error, nombre).toEqual({ tipo: "Unicidad", restriccion: "valor_de_lista_nombre_uk" });
      expect(errorDeListasDeRestriccion(error)).toBe("VALOR_DUPLICADO");
    }
    // En la otra lista no choca.
    await dueno.query(
      "insert into valor_de_lista (lista, nombre) values ('MOTIVOS_DE_RECHAZO', 'Tarjeta Única')",
    );
  });

  it("tocar un valor fijo se traduce a VALOR_FIJO; cambiar la lista, el id o la marca «fija» no se traduce", async () => {
    const [otra] = await filas<{ id: string }>(
      "select id from valor_de_lista where lista = 'MARCAS_DE_TARJETA' and fija",
    );
    for (const cambio of ["nombre = 'Otro nombre'", "activo = false"]) {
      const error = await provocar(`update valor_de_lista set ${cambio} where id = $1`, [otra?.id]);
      expect(error, cambio).toEqual({ tipo: "Check", restriccion: "valor_de_lista_fija" });
      expect(errorDeListasDeRestriccion(error)).toBe("VALOR_FIJO");
    }
    const [comun] = await filas<{ id: string }>(
      "select id from valor_de_lista where lista = 'MARCAS_DE_TARJETA' and not fija limit 1",
    );
    for (const cambio of [
      "lista = 'MOTIVOS_DE_RECHAZO'",
      "fija = true",
      "id = gen_random_uuid()",
    ]) {
      const error = await provocar(`update valor_de_lista set ${cambio} where id = $1`, [
        comun?.id,
      ]);
      expect(error, cambio).toMatchObject({ restriccion: "valor_de_lista_inmutable" });
      expect(errorDeListasDeRestriccion(error)).toBeNull();
    }
  });
});
