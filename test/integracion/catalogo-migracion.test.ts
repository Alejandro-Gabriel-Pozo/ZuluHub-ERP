import { randomUUID } from "node:crypto";
import { readFile, readdir, rm } from "node:fs/promises";
import { join } from "node:path";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { aplicarMigraciones } from "../../src/adaptadores/postgres/migraciones";
import { textoDeUnaLineaDesdeTexto } from "../../src/primitivas/texto/texto-de-una-linea";
import { UNIDADES } from "../../src/primitivas/unidades/unidades";
import {
  grupoDeBase,
  nombreAlAzarDeProducto,
  opcionDeBase,
  precioDeBase,
  productoDeBase,
  type ClaseDeUsoDePrueba,
} from "./catalogo-apoyo";
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
import {
  baseConMigraciones,
  carpetaCon,
  CARPETA_DE_MIGRACIONES,
  huellaDeCatalogo,
} from "./marcas-apoyo";
import { sembrarMarcaPrincipalDePrueba } from "./marcas-de-prueba";

/**
 * La migración 0025 (E2 mínimo: el catálogo). Se prueba contra una base real, con el rol de la aplicación y el dueño: las tablas nacen con
 * su forma final, la lista de unidades es la del código, la lista de permitidos de la base es la de la primitiva, lo que cada clase pide y
 * prohíbe (D1), lo que no cambia (D3), el paso exacto, la forma de venta del precio (D9), las reglas de precio, opciones y consumo, el
 * aislamiento por empresa (FK compuestas, A2), la solo inserción (A6), el único lector de precios, la reversión (D6) y que ninguna tabla
 * nueva quede sin RLS forzada, sin política o con DELETE.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 180_000 });

const TABLAS = [
  "unidad_de_medida",
  "seccion_de_carta",
  "producto",
  "grupo_de_elecciones",
  "opcion",
  "version_de_opcion",
  "consumo_de_opcion",
  "precio_de_venta",
  "copia_de_opciones",
] as const;
const SOLO_INSERCION = [
  "unidad_de_medida",
  "version_de_opcion",
  "consumo_de_opcion",
  "precio_de_venta",
  "copia_de_opciones",
] as const;

const ARCHIVO = "0025_catalogo.sql";
const textoDeLaReversion = () =>
  readFile(join(CARPETA_DE_MIGRACIONES, "reversiones", "0025_revertir_catalogo.sql"), "utf8");
const migracionesPrevias = async () =>
  (await readdir(CARPETA_DE_MIGRACIONES))
    .filter((n) => /^\d{4}_.*\.sql$/.test(n) && n < ARCHIVO)
    .sort();
const b = (): BaseDePruebas => {
  if (base === null) throw new Error("sin base de pruebas");
  return base;
};

describe.skipIf(base === null)("0025 catálogo: la migración contra una base real", () => {
  let dueno: pg.Client;
  let m: Mundo;
  let otra: Mundo;

  beforeAll(async () => {
    dueno = new pg.Client({ connectionString: b().dueno });
    await dueno.connect();
    m = await crearMundo(dueno);
    otra = await crearMundo(dueno);
  });
  afterAll(async () => {
    await dueno.end();
  });

  const un = async <T extends Record<string, unknown>>(texto: string, p: unknown[] = []) =>
    (await dueno.query<T>(texto, p)).rows[0] ?? ({} as T);
  /**
   * Una sentencia dentro de un savepoint que SE LIBERA también al fallar: el helper común deja la transacción dentro del savepoint
   * revertido, y lo que se escriba después tendría el `xmin` de una subtransacción (el consumo exige el de la transacción).
   */
  const intento = async (texto: string, p: unknown[] = []) => {
    const r = await intentoDelDueno(dueno, texto, p);
    if (!r.ok) await dueno.query("release savepoint intento");
    return r;
  };
  /** Corre algo que tiene que fallar dentro de un savepoint (la transacción del escenario sigue sana) y devuelve el error. */
  const fallo = async (
    trabajo: () => Promise<unknown>,
  ): Promise<{ constraint?: string; code?: string } | null> => {
    await dueno.query("savepoint rechazo");
    try {
      await trabajo();
      await dueno.query("release savepoint rechazo");
      return null;
    } catch (error) {
      await dueno.query("rollback to savepoint rechazo");
      return error as { constraint?: string; code?: string };
    }
  };
  /** Un TRUNCATE se rechaza: por el disparador (42501) o, en una tabla referenciada por una clave foránea, antes de él (0A000). */
  const noSeVacia = (r: Awaited<ReturnType<typeof intento>>): void => {
    expect(r.ok).toBe(false);
    if (!r.ok) expect(["42501", "0A000"]).toContain(r.codigo);
  };

  describe("el esquema", () => {
    it("crea las nueve tablas, con RLS forzada, al menos una política, ninguna FOR ALL y sin DELETE ni TRUNCATE para nadie", async () => {
      const tablas = (
        await dueno.query<{
          relname: string;
          relrowsecurity: boolean;
          relforcerowsecurity: boolean;
        }>(
          `select relname, relrowsecurity, relforcerowsecurity from pg_class
            where relnamespace = 'public'::regnamespace and relkind = 'r' and relname = any($1)`,
          [[...TABLAS]],
        )
      ).rows;
      expect(tablas.map((t) => t.relname).sort()).toEqual([...TABLAS].sort());
      for (const t of tablas) {
        expect(t.relrowsecurity, t.relname).toBe(true);
        expect(t.relforcerowsecurity, t.relname).toBe(true);
      }
      const politicas = (
        await dueno.query<{ tablename: string; cmd: string }>(
          `select tablename, cmd from pg_policies where schemaname = 'public' and tablename = any($1)`,
          [[...TABLAS]],
        )
      ).rows;
      for (const tabla of TABLAS) {
        expect(
          politicas.some((p) => p.tablename === tabla),
          `${tabla} sin política`,
        ).toBe(true);
      }
      expect(politicas.filter((p) => p.cmd === "ALL")).toEqual([]);
      const privilegios = (
        await dueno.query<{ grantee: string; table_name: string; privilege_type: string }>(
          `select grantee, table_name, privilege_type from information_schema.role_table_grants
            where table_schema = 'public' and table_name = any($1)
              and grantee <> (select rolname from pg_roles where oid = (select relowner from pg_class where oid = 'public.producto'::regclass))`,
          [[...TABLAS]],
        )
      ).rows;
      expect(
        privilegios.filter((p) =>
          ["DELETE", "TRUNCATE", "REFERENCES", "TRIGGER"].includes(p.privilege_type),
        ),
      ).toEqual([]);
      // Solo la aplicación recibe algo; el rol de respaldo (0012) lee todo por sus privilegios por defecto, y solo leer.
      expect([...new Set(privilegios.map((p) => p.grantee))].sort()).toEqual([
        "pedernal_app",
        "pedernal_respaldo",
      ]);
      expect([
        ...new Set(
          privilegios.filter((p) => p.grantee === "pedernal_respaldo").map((p) => p.privilege_type),
        ),
      ]).toEqual(["SELECT"]);
    });

    it("toda función nueva fija su search_path, ninguna es SECURITY DEFINER y solo dos se otorgan a la aplicación", async () => {
      const funciones = (
        await dueno.query<{
          proname: string;
          prosecdef: boolean;
          proconfig: string[] | null;
          proacl: string | null;
        }>(
          `select proname, prosecdef, proconfig, proacl::text from pg_proc
            where pronamespace = 'public'::regnamespace
              and proname in ('texto_de_catalogo_valido', 'precio_vigente', 'producto_validar', 'grupo_de_elecciones_validar',
                              'opcion_validar', 'version_de_opcion_validar', 'consumo_de_opcion_validar', 'precio_de_venta_validar')`,
        )
      ).rows;
      expect(funciones).toHaveLength(8);
      for (const f of funciones) {
        expect(f.prosecdef, f.proname).toBe(false);
        expect(f.proconfig?.join(","), f.proname).toContain(
          "search_path=pg_catalog, public, pg_temp",
        );
      }
      const otorgadas = funciones
        .filter((f) => (f.proacl ?? "").includes("pedernal_app=X"))
        .map((f) => f.proname);
      expect(otorgadas.sort()).toEqual(["precio_vigente", "texto_de_catalogo_valido"]);
    });

    it("la tabla de unidades es la de `UNIDADES` del código (códigos, dimensión y factor) y hay una sola base por dimensión", async () => {
      const filas = (
        await dueno.query<{
          id: string;
          dimension: string;
          factor_a_base: string;
          es_base: boolean;
        }>("select id, dimension, factor_a_base, es_base from unidad_de_medida order by id")
      ).rows;
      const delCodigo = Object.entries(UNIDADES)
        .map(([id, u]) => ({ id, dimension: u.dimension, factor: u.factor.toString() }))
        .sort((x, y) => x.id.localeCompare(y.id));
      expect(
        filas.map((f) => ({ id: f.id, dimension: f.dimension, factor: f.factor_a_base })),
      ).toEqual(delCodigo);
      for (const f of filas) expect(f.es_base).toBe(f.factor_a_base === "1");
      const bases = new Map<string, number>();
      for (const f of filas.filter((x) => x.es_base))
        bases.set(f.dimension, (bases.get(f.dimension) ?? 0) + 1);
      expect([...bases.values()].every((n) => n === 1)).toBe(true);
    });
  });

  describe("la lista de permitidos de los textos", () => {
    const enBase = async (textos: string[]): Promise<boolean[]> =>
      (
        await dueno.query<{ ok: boolean }>(
          "select texto_de_catalogo_valido(t, 400) as ok from unnest($1::text[]) with ordinality as x(t, n) order by n",
          [textos],
        )
      ).rows.map((r) => r.ok);

    it("coincide con la primitiva de texto de una línea para cada carácter del plano básico (una sola lista, dos puntas)", async () => {
      const casos: string[] = [];
      for (let cp = 0x20; cp <= 0xffff; cp += 1) {
        if (cp >= 0xd800 && cp <= 0xdfff) continue; // mitades de sustitución: no son caracteres
        casos.push(`a${String.fromCodePoint(cp)}b`);
      }
      // La base recibe lo que la aplicación ya dejó en forma canónica (recortado, NFC y con un solo espacio): lo que la primitiva
      // transforma (espacios raros, marcas combinadas) no es un caso de la base.
      const canonicos = casos.filter(
        (t) => t.normalize("NFC") === t && t.replace(/\p{Zs}+/gu, " ") === t,
      );
      const base = await enBase(canonicos);
      const distintos = canonicos.filter(
        (texto, i) =>
          base[i] !==
          textoDeUnaLineaDesdeTexto(texto, {
            maximo: 400,
            exigirUnaLetra: false,
            conSignosDeCatalogo: true,
          }).ok,
      );
      expect(canonicos.length).toBeGreaterThan(60_000);
      expect(distintos).toEqual([]);
    });

    it("coincide en los bordes: espacios en los extremos, signos que no abren, largo, emojis, saltos de línea y texto vacío", async () => {
      const casos = [
        "+Kota",
        "-x",
        "x+",
        "x-",
        " x",
        "x ",
        "",
        "é",
        "é",
        "😀 x",
        "a\nb",
        "a\tb",
        "a  b",
        "=suma",
        "@x",
        "<b>x</b>",
        "a".repeat(400),
        "a".repeat(401),
      ];
      const base = await enBase(casos);
      casos.forEach((texto, i) => {
        // La primitiva recorta, pasa a NFC y colapsa los espacios: la base solo acepta lo ya canónico.
        const canonico = texto
          .trim()
          .normalize("NFC")
          .replace(/\p{Zs}+/gu, " ");
        const primitiva =
          canonico === texto &&
          textoDeUnaLineaDesdeTexto(texto, {
            maximo: 400,
            exigirUnaLetra: false,
            conSignosDeCatalogo: true,
          }).ok;
        if (texto === "a  b") return; // dos espacios: la primitiva los colapsa, la base no los rechaza (los conserva la app)
        expect(base[i], JSON.stringify(texto)).toBe(primitiva);
      });
    });
  });

  describe("D1: lo que pide y lo que prohíbe cada una de las cinco clases (directo contra los CHECK)", () => {
    const CLASES: Array<{ clase: ClaseDeUsoDePrueba; vende: boolean }> = [
      { clase: "MATERIA_PRIMA", vende: false },
      { clase: "INSUMO", vende: false },
      { clase: "REVENTA", vende: true },
      { clase: "ELABORADO", vende: false },
      { clase: "VENDIBLE", vende: true },
    ];
    const insertar = (
      clase: string,
      extra: Record<string, unknown> = {},
      seccion: string | null = null,
    ) =>
      intento(
        `insert into producto (empresa_id, nombre, nombre_clave, nombre_de_cocina, descripcion_en_carta, tipo, clase_de_uso,
                               unidad_base_id, dimension, unidad_de_venta_id, alicuota_iva, seccion_de_carta_id, falta_completar)
         values ($1, $2, $3, $4, $5, 'BIEN', $6, 'UNIDAD', 'CONTEO', 'UNIDAD', $7, $8, false)`,
        [
          m.empresa,
          `Prueba ${randomUUID().slice(0, 8)}`.replace(/[0-9]/g, "x"),
          randomUUID(),
          extra["cocina"] ?? null,
          extra["descripcion"] ?? null,
          clase,
          extra["alicuota"] ?? null,
          seccion,
        ],
      );

    it.each(CLASES)(
      "$clase: %# alícuota, sección, nombre de cocina y descripción según venda o no",
      async ({ clase, vende }) => {
        await sinConfirmar(dueno, async () => {
          const seccion = (
            await un<{ id: string }>(
              "insert into seccion_de_carta (empresa_id, nombre, nombre_clave, orden) values ($1, 'Entradas', 'entradas', 1) returning id",
              [m.empresa],
            )
          ).id;
          // Sin nada de lo que solo vende: siempre pasa.
          acepta(await insertar(clase));
          // Cada campo «de venta» suelto: pasa solo si la clase vende; si no, el CHECK de la clase.
          for (const extra of [
            { alicuota: "21" },
            { cocina: "Napolitana" },
            { descripcion: "Con salsa" },
          ]) {
            const r = await insertar(clase, extra);
            if (vende) acepta(r);
            else check(r, "producto_clase_sin_venta_ck");
          }
          const conSeccion = await insertar(clase, {}, seccion);
          if (vende) acepta(conSeccion);
          else check(conSeccion, "producto_clase_sin_venta_ck");
        });
      },
    );

    it("una alícuota fuera de los ocho códigos, un código de barras mal formado y un tipo que no es BIEN se rechazan", async () => {
      await sinConfirmar(dueno, async () => {
        check(await insertar("VENDIBLE", { alicuota: "20" }), "producto_alicuota_ck");
        for (const codigo of ["0", "2.5", "5", "10.5", "21", "27", "EXENTO", "NO_GRAVADO"]) {
          acepta(await insertar("VENDIBLE", { alicuota: codigo }));
        }
        check(
          await intento(
            `insert into producto (empresa_id, nombre, nombre_clave, codigo_de_barras, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id)
             values ($1, 'Barras', $2, '1234567', 'BIEN', 'INSUMO', 'UNIDAD', 'CONTEO', 'UNIDAD')`,
            [m.empresa, randomUUID()],
          ),
          "producto_codigo_de_barras_ck",
        );
        check(
          await intento(
            `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id)
             values ($1, 'Servicio', $2, 'SERVICIO', 'INSUMO', 'UNIDAD', 'CONTEO', 'UNIDAD')`,
            [m.empresa, randomUUID()],
          ),
          "producto_tipo_ck",
        );
      });
    });

    it("`se_vende` se deduce: vende quien es de clase que vende, tiene alícuota y no está «Falta completar»; y no se puede escribir", async () => {
      await sinConfirmar(dueno, async () => {
        const quien = async (
          clase: ClaseDeUsoDePrueba,
          alicuota: string | null,
          falta: boolean,
        ) => {
          const id = await productoDeBase(dueno, m.empresa, {
            clase,
            alicuota,
            faltaCompletar: falta,
          });
          return (
            await un<{ se_vende: boolean }>("select se_vende from producto where id = $1", [id])
          ).se_vende;
        };
        expect(await quien("VENDIBLE", "21", false)).toBe(true);
        expect(await quien("REVENTA", "10.5", false)).toBe(true);
        expect(await quien("VENDIBLE", null, false)).toBe(false); // sin alícuota
        expect(await quien("VENDIBLE", "21", true)).toBe(false); // «Falta completar»
        expect(await quien("ELABORADO", null, false)).toBe(false);
        expect(await quien("MATERIA_PRIMA", null, false)).toBe(false);
        expect(await quien("INSUMO", null, false)).toBe(false);
        const escribir = await intento(
          `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id, se_vende)
           values ($1, 'X', $2, 'BIEN', 'INSUMO', 'UNIDAD', 'CONTEO', 'UNIDAD', true)`,
          [m.empresa, randomUUID()],
        );
        expect(escribir.ok).toBe(false);
      });
    });
  });

  describe("D3: la clase, la unidad base, el tipo, la empresa y el id no cambian (ni el dueño de la base)", () => {
    it.each([
      ["clase_de_uso = 'INSUMO'", "producto_clase_de_uso_inmutable"],
      [
        "unidad_base_id = 'GRAMO', dimension = 'MASA', unidad_de_venta_id = 'GRAMO'",
        "producto_unidad_inmutable",
      ],
      [
        "empresa_id = '" + "00000000-0000-4000-8000-000000000000" + "'",
        "producto_identidad_inmutable",
      ],
    ])("UPDATE %s", async (cambio, restriccion) => {
      await sinConfirmar(dueno, async () => {
        const id = await productoDeBase(dueno, m.empresa, { clase: "REVENTA" });
        check(await intento(`update producto set ${cambio} where id = $1`, [id]), restriccion);
      });
    });

    it("la aplicación ni siquiera tiene permiso para escribir esas columnas", async () => {
      const id = await productoDeBase(dueno, m.empresa, { clase: "REVENTA" });
      await conAppDe(b(), m, async (s) => {
        for (const columna of [
          "clase_de_uso = 'INSUMO'",
          "unidad_base_id = 'GRAMO'",
          "tipo = 'BIEN'",
          "dimension = 'MASA'",
        ]) {
          denegado(await s.intentar(`update producto set ${columna} where id = $1`, [id]));
        }
      });
    });
  });

  describe("el paso mínimo y la forma de venta (162, 166)", () => {
    it("el paso tiene que caber exacto en 4 decimales en la unidad base; un paso decimal exacto o una unidad más grande pasan", async () => {
      await sinConfirmar(dueno, async () => {
        const insertarFormas = (base: string, venta: string, dimension: string, paso: string) =>
          intento(
            `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id, paso_minimo, alicuota_iva)
             values ($1, 'Forma', $2, 'BIEN', 'VENDIBLE', $3, $4, $5, $6, '21')`,
            [m.empresa, randomUUID(), base, dimension, venta, paso],
          );
        // Base en gramos, venta por kilo: 0,5 kg = 500 g, exacto; 0,0001 kg = 0,1 g, exacto en 4 decimales.
        acepta(await insertarFormas("GRAMO", "KILOGRAMO", "MASA", "0.5"));
        acepta(await insertarFormas("GRAMO", "KILOGRAMO", "MASA", "0.0001"));
        // Base en kilos, venta por gramo: 1 g = 0,001 kg exacto; 0,25 g = 0,00025 kg NO cabe en 4 decimales.
        acepta(await insertarFormas("KILOGRAMO", "GRAMO", "MASA", "1"));
        check(
          await insertarFormas("KILOGRAMO", "GRAMO", "MASA", "0.25"),
          "producto_paso_no_exacto",
        );
        // Un paso de 0,00001 se redondea a 0 al guardarlo en `numeric(18,4)`: lo frena el CHECK del paso.
        check(await insertarFormas("UNIDAD", "UNIDAD", "CONTEO", "0.00001"), "producto_paso_ck");
        check(await insertarFormas("UNIDAD", "UNIDAD", "CONTEO", "0"), "producto_paso_ck");
        check(await insertarFormas("UNIDAD", "UNIDAD", "CONTEO", "-1"), "producto_paso_ck");
        expect((await insertarFormas("UNIDAD", "UNIDAD", "CONTEO", "NaN")).ok).toBe(false); // NaN: lo frena el disparador o la cota
      });
    });

    it("la unidad de venta es de la dimensión del producto (FK compuesta)", async () => {
      await sinConfirmar(dueno, async () => {
        referencia(
          await intento(
            `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id, alicuota_iva)
             values ($1, 'Metros', $2, 'BIEN', 'VENDIBLE', 'UNIDAD', 'CONTEO', 'METRO', '21')`,
            [m.empresa, randomUUID()],
          ),
          "producto_unidad_de_venta_fkey",
        );
      });
    });

    it("un producto que no vende conserva unidad base y paso 1, y el producto que vende puede pasar a fracciones con un UPDATE (sin migrar)", async () => {
      await sinConfirmar(dueno, async () => {
        const noVende = await productoDeBase(dueno, m.empresa, {
          clase: "INSUMO",
          unidadBase: "KILOGRAMO",
          dimension: "MASA",
        });
        check(
          await intento("update producto set paso_minimo = 0.5 where id = $1", [noVende]),
          "producto_forma_de_venta_sin_venta_ck",
        );
        check(
          await intento("update producto set unidad_de_venta_id = 'GRAMO' where id = $1", [
            noVende,
          ]),
          "producto_forma_de_venta_sin_venta_ck",
        );
        const vende = await productoDeBase(dueno, m.empresa, {
          clase: "VENDIBLE",
          unidadBase: "GRAMO",
          dimension: "MASA",
        });
        acepta(await intento("update producto set paso_minimo = 0.25 where id = $1", [vende]));
        acepta(
          await intento(
            "update producto set unidad_de_venta_id = 'KILOGRAMO', paso_minimo = 0.5 where id = $1",
            [vende],
          ),
        );
        expect(
          (await un<{ version: number }>("select version from producto where id = $1", [vende]))
            .version,
        ).toBe(3);
      });
    });
  });

  describe("nombre y códigos: únicos por empresa, también contra los desactivados; la forma de cada texto", () => {
    it("el nombre (por su clave) y el código y el código de barras son únicos por empresa y no entre empresas", async () => {
      const nombre = nombreAlAzarDeProducto("Medialuna");
      expect(await productoDeBase(dueno, m.empresa, { nombre, activo: false })).toBeTruthy();
      await sinConfirmar(dueno, async () => {
        clave(
          await intento(
            `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id, alicuota_iva)
             values ($1, $2, $3, 'BIEN', 'VENDIBLE', 'UNIDAD', 'CONTEO', 'UNIDAD', '21')`,
            [m.empresa, nombre.toUpperCase(), nombre.toLowerCase()],
          ),
          "producto_nombre_uk",
        );
        // Otra empresa puede llamarlo igual.
        await productoDeBase(dueno, otra.empresa, { nombre });
        const insertarCon = (campo: string, valor: string) =>
          intento(
            `insert into producto (empresa_id, nombre, nombre_clave, ${campo}, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id)
             values ($1, $2, $3, $4, 'BIEN', 'INSUMO', 'UNIDAD', 'CONTEO', 'UNIDAD')`,
            [
              m.empresa,
              `Otro ${randomUUID().slice(0, 6)}`.replace(/[0-9]/g, "z"),
              randomUUID(),
              valor,
            ],
          );
        acepta(await insertarCon("codigo", "ABC-1"));
        clave(await insertarCon("codigo", "ABC-1"), "producto_codigo_uk");
        check(await insertarCon("codigo", "con espacio"), "producto_codigo_ck");
        acepta(await insertarCon("codigo_de_barras", "7790001234567"));
        clave(
          await insertarCon("codigo_de_barras", "7790001234567"),
          "producto_codigo_de_barras_uk",
        );
        check(
          await insertarCon("codigo_de_barras", "12345678901234567"),
          "producto_codigo_de_barras_ck",
        );
      });
    });

    it("un nombre con caracteres que no están en la lista de permitidos se rechaza", async () => {
      await sinConfirmar(dueno, async () => {
        for (const nombre of ["<b>x</b>", "con\nsalto", " con borde", "😀 pizza", "+x"]) {
          check(
            await intento(
              `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id)
               values ($1, $2, $3, 'BIEN', 'INSUMO', 'UNIDAD', 'CONTEO', 'UNIDAD')`,
              [m.empresa, nombre, randomUUID()],
            ),
            "producto_nombre_ck",
          );
        }
      });
    });
  });

  describe("grupos y opciones: propios de un producto que vende, una sola variante activa", () => {
    it("solo un producto que vende tiene grupos; la clase y el producto del grupo no cambian", async () => {
      await sinConfirmar(dueno, async () => {
        const insumo = await productoDeBase(dueno, m.empresa, { clase: "INSUMO" });
        const intentoGrupo = (producto: string) =>
          intento(
            `insert into grupo_de_elecciones (empresa_id, producto_id, clase, nombre, nombre_clave, es_obligatorio, admite_varias, orden)
             values ($1, $2, 'ADICIONAL', 'Extras', $3, false, false, 0)`,
            [m.empresa, producto, randomUUID()],
          );
        check(await intentoGrupo(insumo), "grupo_de_producto_no_vendible");
        const vendible = await productoDeBase(dueno, m.empresa);
        acepta(await intentoGrupo(vendible));
        const grupo = await grupoDeBase(dueno, m.empresa, vendible, { clase: "INCLUIDA" });
        check(
          await intento("update grupo_de_elecciones set clase = 'ADICIONAL' where id = $1", [
            grupo,
          ]),
          "grupo_de_elecciones_inmutable",
        );
        check(
          await intento("update grupo_de_elecciones set producto_id = $2 where id = $1", [
            grupo,
            insumo,
          ]),
          "grupo_de_elecciones_inmutable",
        );
      });
    });

    it("la variante es obligatoria, de una sola elección y se muestra; a lo sumo una activa por producto; el tamaño solo en una variante", async () => {
      await sinConfirmar(dueno, async () => {
        const producto = await productoDeBase(dueno, m.empresa);
        const variante = (extra: string) =>
          intento(
            `insert into grupo_de_elecciones (empresa_id, producto_id, clase, nombre, nombre_clave, es_obligatorio, admite_varias, se_muestra_en_carta, es_tamano, orden)
             values ($1, $2, 'VARIANTE', $3, $4, ${extra}, 0)`,
            [
              m.empresa,
              producto,
              `V${randomUUID().slice(0, 5)}`.replace(/[0-9]/g, "q"),
              randomUUID(),
            ],
          );
        check(await variante("false, false, true, false"), "grupo_de_elecciones_variante_ck");
        check(await variante("true, true, true, false"), "grupo_de_elecciones_variante_ck");
        check(await variante("true, false, false, false"), "grupo_de_elecciones_variante_ck");
        acepta(await variante("true, false, true, true"));
        clave(await variante("true, false, true, false"), "grupo_de_elecciones_variante_uk");
        check(
          await intento(
            `insert into grupo_de_elecciones (empresa_id, producto_id, clase, nombre, nombre_clave, es_obligatorio, admite_varias, es_tamano, orden)
             values ($1, $2, 'ADICIONAL', 'Salsas', 'salsas', false, false, true, 0)`,
            [m.empresa, producto],
          ),
          "grupo_de_elecciones_tamano_ck",
        );
      });
    });

    it("la variante desactivada libera el lugar para otra, y un grupo repetido por su clave se rechaza también entre desactivados", async () => {
      await sinConfirmar(dueno, async () => {
        const producto = await productoDeBase(dueno, m.empresa);
        const vieja = await grupoDeBase(dueno, m.empresa, producto, {
          clase: "VARIANTE",
          nombre: "Tamaño",
          esTamano: true,
        });
        acepta(
          await intento("update grupo_de_elecciones set activo = false where id = $1", [vieja]),
        );
        await grupoDeBase(dueno, m.empresa, producto, { clase: "VARIANTE", nombre: "Porción" });
        clave(
          await intento(
            `insert into grupo_de_elecciones (empresa_id, producto_id, clase, nombre, nombre_clave, es_obligatorio, admite_varias, orden)
             values ($1, $2, 'ADICIONAL', 'TAMAÑO', 'tamaño', false, false, 0)`,
            [m.empresa, producto],
          ),
          "grupo_de_elecciones_nombre_uk",
        );
      });
    });

    it("la opción es del mismo producto que su grupo (FK compuesta) y su grupo no se reasigna", async () => {
      await sinConfirmar(dueno, async () => {
        const uno = await productoDeBase(dueno, m.empresa);
        const dos = await productoDeBase(dueno, m.empresa);
        const grupo = await grupoDeBase(dueno, m.empresa, uno);
        referencia(
          await intento(
            "insert into opcion (empresa_id, producto_id, grupo_id, nombre_clave, orden) values ($1, $2, $3, 'x', 0)",
            [m.empresa, dos, grupo],
          ),
          "opcion_grupo_fkey",
        );
        const { opcion } = await opcionDeBase(dueno, m.empresa, uno, grupo);
        check(
          await intento("update opcion set producto_id = $2 where id = $1", [opcion, dos]),
          "opcion_inmutable",
        );
        check(
          await intento("update opcion set grupo_id = gen_random_uuid() where id = $1", [opcion]),
          "opcion_inmutable",
        );
      });
    });
  });

  describe("versión de opción: recargo, factor de tamaño y número", () => {
    it("sin recargo en incluida, variante ni elección oculta; con recargo en un adicional visible; el factor solo en el tamaño", async () => {
      await sinConfirmar(dueno, async () => {
        const p = await productoDeBase(dueno, m.empresa);
        const incluida = await grupoDeBase(dueno, m.empresa, p, { clase: "INCLUIDA" });
        const adicional = await grupoDeBase(dueno, m.empresa, p, {
          clase: "ADICIONAL",
          seMuestraEnCarta: true,
        });
        const oculto = await grupoDeBase(dueno, m.empresa, p, {
          clase: "ADICIONAL",
          seMuestraEnCarta: false,
        });
        const tamano = await grupoDeBase(dueno, m.empresa, p, {
          clase: "VARIANTE",
          esTamano: true,
        });
        const variante = await grupoDeBase(
          dueno,
          m.empresa,
          await productoDeBase(dueno, m.empresa),
          { clase: "VARIANTE" },
        );
        const sobre = (grupo: string, producto: string, recargo: string, factor = "1") =>
          opcionDeBase(dueno, m.empresa, producto, grupo, { recargo, factor }).then(
            () => ({ ok: true as const }),
            (e: { code?: string; constraint?: string }) => ({
              ok: false as const,
              codigo: e.code,
              restriccion: e.constraint,
            }),
          );
        // Cada intento falla dentro de un savepoint: se usa uno por intento para que la transacción siga.
        const probar = async (grupo: string, producto: string, recargo: string, factor = "1") => {
          await dueno.query("savepoint p");
          const r = await sobre(grupo, producto, recargo, factor);
          await dueno.query(r.ok ? "release savepoint p" : "rollback to savepoint p");
          return r;
        };
        expect(await probar(incluida, p, "0")).toEqual({ ok: true });
        expect(await probar(incluida, p, "10")).toMatchObject({
          ok: false,
          restriccion: "version_de_opcion_incluida_con_recargo",
        });
        expect(await probar(adicional, p, "600")).toEqual({ ok: true });
        expect(await probar(oculto, p, "600")).toMatchObject({
          ok: false,
          restriccion: "version_de_opcion_eleccion_oculta_con_precio",
        });
        expect(await probar(oculto, p, "0")).toEqual({ ok: true });
        expect(await probar(tamano, p, "100")).toMatchObject({
          ok: false,
          restriccion: "version_de_opcion_incluida_con_recargo",
        });
        expect(await probar(tamano, p, "0", "1.5")).toEqual({ ok: true });
        expect(await probar(adicional, p, "0", "1.5")).toMatchObject({
          ok: false,
          restriccion: "version_de_opcion_factor_sin_tamano",
        });
        const productoDeLaVariante = (
          await un<{ producto_id: string }>(
            "select producto_id from grupo_de_elecciones where id = $1",
            [variante],
          )
        ).producto_id;
        expect(await probar(variante, productoDeLaVariante, "0", "1.5")).toMatchObject({
          ok: false,
          restriccion: "version_de_opcion_factor_sin_tamano",
        });
        expect(await probar(tamano, p, "0", "0")).toMatchObject({
          ok: false,
          restriccion: "version_de_opcion_factor_ck",
        });
        expect(await probar(tamano, p, "0", "100.0001")).toMatchObject({ ok: false });
        expect(await probar(adicional, p, "NaN")).toMatchObject({
          ok: false,
          restriccion: "version_de_opcion_recargo_ck",
        });
        expect(await probar(adicional, p, "-1")).toMatchObject({
          ok: false,
          restriccion: "version_de_opcion_recargo_ck",
        });
      });
    });

    it("el número de versión es siempre el siguiente al último, y una versión no se modifica ni se borra", async () => {
      await sinConfirmar(dueno, async () => {
        const p = await productoDeBase(dueno, m.empresa);
        const g = await grupoDeBase(dueno, m.empresa, p, {
          clase: "ADICIONAL",
          seMuestraEnCarta: true,
        });
        const { opcion, version } = await opcionDeBase(dueno, m.empresa, p, g);
        const nueva = (numero: number) =>
          intento(
            "insert into version_de_opcion (empresa_id, opcion_id, numero, nombre, creado_en) values ($1, $2, $3, 'Otra', now())",
            [m.empresa, opcion, numero],
          );
        check(await nueva(3), "version_de_opcion_numero_salteado");
        check(await nueva(1), "version_de_opcion_numero_salteado");
        acepta(await nueva(2));
        denegado(
          await intento("update version_de_opcion set nombre = 'x' where id = $1", [version]),
        );
        denegado(await intento("delete from version_de_opcion where id = $1", [version]));
        noSeVacia(await intento("truncate version_de_opcion"));
      });
    });
  });

  describe("consumo de una opción (139): solo dato, de insumos admitidos, solo junto con su versión", () => {
    it("rechaza insumo de clase no admitida, el mismo producto, cantidad cero o negativa, insumo repetido y consumo en la variante", async () => {
      await sinConfirmar(dueno, async () => {
        const p = await productoDeBase(dueno, m.empresa);
        const g = await grupoDeBase(dueno, m.empresa, p, { clase: "ADICIONAL" });
        const { version } = await opcionDeBase(dueno, m.empresa, p, g);
        const insumo = await productoDeBase(dueno, m.empresa, { clase: "INSUMO" });
        const reventa = await productoDeBase(dueno, m.empresa, { clase: "REVENTA" });
        const elaborado = await productoDeBase(dueno, m.empresa, { clase: "ELABORADO" });
        const cargar = (
          numero: number,
          producto: string,
          cantidad: string,
          escala = false,
          v = version,
        ) =>
          intento(
            "insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad, escala_con_tamano) values ($1, $2, $3, $4, $5, $6)",
            [m.empresa, v, numero, producto, cantidad, escala],
          );
        acepta(await cargar(1, insumo, "0.2500"));
        acepta(await cargar(2, reventa, "1", true));
        check(await cargar(3, elaborado, "1"), "consumo_de_opcion_insumo_no_admitido");
        check(await cargar(3, p, "1"), "consumo_de_opcion_insumo_es_el_mismo_producto");
        check(await cargar(3, insumo, "0"), "consumo_de_opcion_cantidad_ck");
        check(await cargar(3, insumo, "-1"), "consumo_de_opcion_cantidad_ck");
        clave(await cargar(3, insumo, "1"), "consumo_de_opcion_insumo_uk");
        const tamano = await grupoDeBase(dueno, m.empresa, p, {
          clase: "VARIANTE",
          esTamano: true,
        });
        const deLaVariante = await opcionDeBase(dueno, m.empresa, p, tamano);
        check(
          await cargar(1, insumo, "1", false, deLaVariante.version),
          "consumo_de_opcion_de_variante",
        );
      });
    });

    it("una versión ya confirmada no recibe consumo nuevo: solo en la misma transacción que la creó", async () => {
      const p = await productoDeBase(dueno, m.empresa);
      const g = await grupoDeBase(dueno, m.empresa, p, { clase: "ADICIONAL" });
      const { version } = await opcionDeBase(dueno, m.empresa, p, g);
      const insumo = await productoDeBase(dueno, m.empresa, { clase: "INSUMO" });
      // `opcionDeBase` ya confirmó (autocommit): el consumo tardío se rechaza.
      await expect(
        dueno.query(
          "insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad) values ($1, $2, 1, $3, 1)",
          [m.empresa, version, insumo],
        ),
      ).rejects.toMatchObject({
        code: "23514",
        constraint: "consumo_de_opcion_version_confirmada",
      });
      // En la misma transacción que crea la versión, sí.
      await sinConfirmar(dueno, async () => {
        const nueva = (await opcionDeBase(dueno, m.empresa, p, g)).version;
        acepta(
          await intento(
            "insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad) values ($1, $2, 1, $3, 1)",
            [m.empresa, nueva, insumo],
          ),
        );
      });
    });
  });

  describe("precio de venta: forma de venta (D9), variante, recargos, orden y único lector", () => {
    it("D9: la unidad y el paso de la fila son los del producto, también en una fila de sucursal", async () => {
      await sinConfirmar(dueno, async () => {
        const p = await productoDeBase(dueno, m.empresa, {
          unidadBase: "GRAMO",
          dimension: "MASA",
          unidadDeVenta: "KILOGRAMO",
          paso: "0.5",
        });
        const insertar = (unidad: string, paso: string, sucursal: string | null, desde: string) =>
          intento(
            `insert into precio_de_venta (empresa_id, producto_id, sucursal_id, precio, unidad_id, paso_minimo, vigente_desde)
             values ($1, $2, $3, 100, $4, $5, $6)`,
            [m.empresa, p, sucursal, unidad, paso, desde],
          );
        check(
          await insertar("GRAMO", "0.5", null, "2026-01-01T00:00:00Z"),
          "precio_forma_de_venta_distinta",
        );
        check(
          await insertar("KILOGRAMO", "1", null, "2026-01-01T00:00:00Z"),
          "precio_forma_de_venta_distinta",
        );
        check(
          await insertar("GRAMO", "0.5", m.sucursal, "2026-01-01T00:00:00Z"),
          "precio_forma_de_venta_distinta",
        );
        acepta(await insertar("KILOGRAMO", "0.5", null, "2026-01-01T00:00:00Z"));
        acepta(await insertar("KILOGRAMO", "0.5", m.sucursal, "2026-01-02T00:00:00Z"));
      });
    });

    it("solo un producto que vende tiene precio; el precio no puede ser negativo ni NaN; la moneda es ARS", async () => {
      await sinConfirmar(dueno, async () => {
        const insumo = await productoDeBase(dueno, m.empresa, { clase: "INSUMO" });
        expect(
          await fallo(() =>
            precioDeBase(dueno, {
              empresa: m.empresa,
              producto: insumo,
              precio: "1",
              desde: "2026-01-01T00:00:00Z",
            }),
          ),
        ).toMatchObject({ constraint: "precio_de_venta_producto_no_vendible" });
      });
      await sinConfirmar(dueno, async () => {
        const p = await productoDeBase(dueno, m.empresa);
        let segundo = 0;
        const insertar = (precio: string, moneda = "ARS") => {
          segundo += 1;
          return intento(
            `insert into precio_de_venta (empresa_id, producto_id, precio, unidad_id, paso_minimo, vigente_desde, moneda)
             values ($1, $2, $3, 'UNIDAD', 1, now() + ($4 * interval '1 second'), $5)`,
            [m.empresa, p, precio, segundo, moneda],
          );
        };
        check(await insertar("-1"), "precio_de_venta_precio_ck");
        check(await insertar("NaN"), "precio_de_venta_precio_ck");
        const desborde = await insertar("1000000000000"); // no entra ni en `numeric(18,6)`
        expect(desborde.ok).toBe(false);
        acepta(await insertar("999999999999.999999"));
        check(await insertar("1", "USD"), "precio_de_venta_moneda_ck");
        acepta(await insertar("0")); // cero = cortesía
      });
    });

    it("con variante activa no se acepta un precio del producto (R-18); una opción incluida no lleva precio; el adicional solo con sucursal", async () => {
      await sinConfirmar(dueno, async () => {
        const p = await productoDeBase(dueno, m.empresa);
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          precio: "100",
          desde: "2026-01-01T00:00:00Z",
        });
        const tamano = await grupoDeBase(dueno, m.empresa, p, {
          clase: "VARIANTE",
          esTamano: true,
        });
        const chico = (await opcionDeBase(dueno, m.empresa, p, tamano)).opcion;
        expect(
          await fallo(() =>
            precioDeBase(dueno, {
              empresa: m.empresa,
              producto: p,
              precio: "120",
              desde: "2026-02-01T00:00:00Z",
            }),
          ),
        ).toMatchObject({ constraint: "precio_propio_con_variante" });
        expect(
          await fallo(() =>
            precioDeBase(dueno, {
              empresa: m.empresa,
              producto: p,
              sucursal: m.sucursal,
              precio: "120",
              desde: "2026-02-01T00:00:00Z",
            }),
          ),
        ).toMatchObject({ constraint: "precio_propio_con_variante" });
        // El precio de la empresa y el de una sucursal del tamaño sí.
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          opcion: chico,
          precio: "3000",
          desde: "2026-02-01T00:00:00Z",
        });
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          opcion: chico,
          sucursal: m.sucursal,
          precio: "3200",
          desde: "2026-02-02T00:00:00Z",
        });
        const incluida = await grupoDeBase(dueno, m.empresa, p, { clase: "INCLUIDA" });
        const sinPrecio = (await opcionDeBase(dueno, m.empresa, p, incluida)).opcion;
        expect(
          await fallo(() =>
            precioDeBase(dueno, {
              empresa: m.empresa,
              producto: p,
              opcion: sinPrecio,
              sucursal: m.sucursal,
              precio: "5",
              desde: "2026-02-03T00:00:00Z",
            }),
          ),
        ).toMatchObject({ constraint: "precio_incluida_con_recargo" });
        const adicional = await grupoDeBase(dueno, m.empresa, p, {
          clase: "ADICIONAL",
          seMuestraEnCarta: true,
        });
        const extra = (await opcionDeBase(dueno, m.empresa, p, adicional, { recargo: "600" }))
          .opcion;
        expect(
          await fallo(() =>
            precioDeBase(dueno, {
              empresa: m.empresa,
              producto: p,
              opcion: extra,
              precio: "700",
              desde: "2026-02-03T00:00:00Z",
            }),
          ),
        ).toMatchObject({ constraint: "precio_recargo_de_empresa_en_precio" });
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          opcion: extra,
          sucursal: m.sucursal,
          precio: "800",
          desde: "2026-02-03T00:00:00Z",
        });
        // Volver al de la empresa: `NULL` con sucursal.
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          opcion: extra,
          sucursal: m.sucursal,
          precio: null,
          desde: "2026-02-04T00:00:00Z",
        });
        // Un adicional oculto no admite recargo de sucursal, pero sí el `NULL` (volver al de la empresa).
        await dueno.query(
          "update grupo_de_elecciones set se_muestra_en_carta = false where id = $1",
          [adicional],
        );
        expect(
          await fallo(() =>
            precioDeBase(dueno, {
              empresa: m.empresa,
              producto: p,
              opcion: extra,
              sucursal: m.sucursal,
              precio: "900",
              desde: "2026-02-05T00:00:00Z",
            }),
          ),
        ).toMatchObject({ constraint: "precio_eleccion_oculta_con_precio" });
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          opcion: extra,
          sucursal: m.sucursal,
          precio: null,
          desde: "2026-02-05T00:00:00Z",
        });
      });
    });

    it("el precio rige estrictamente después del último del mismo dueño y alcance (C7), y el mismo instante en otro alcance no choca", async () => {
      await sinConfirmar(dueno, async () => {
        const p = await productoDeBase(dueno, m.empresa);
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          precio: "100",
          desde: "2026-03-01T12:00:00Z",
        });
        expect(
          await fallo(() =>
            precioDeBase(dueno, {
              empresa: m.empresa,
              producto: p,
              precio: "110",
              desde: "2026-03-01T11:59:59Z",
            }),
          ),
        ).toMatchObject({ constraint: "precio_fuera_de_orden" });
        expect(
          await fallo(() =>
            precioDeBase(dueno, {
              empresa: m.empresa,
              producto: p,
              precio: "110",
              desde: "2026-03-01T12:00:00Z",
            }),
          ),
        ).toMatchObject({ constraint: "precio_fuera_de_orden" });
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          precio: "110",
          desde: "2026-03-01T12:00:00.000001Z",
        });
        // La sucursal tiene su propia secuencia.
        await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          sucursal: m.sucursal,
          precio: "90",
          desde: "2026-03-01T12:00:00Z",
        });
      });
    });

    it("`precio_vigente`: la sucursal pisa a la empresa, `NULL` de sucursal vuelve a la empresa, un `NULL` de empresa es precio abierto, sin filas devuelve nulo y mira solo hasta el instante pedido", async () => {
      await sinConfirmar(dueno, async () => {
        const p = await productoDeBase(dueno, m.empresa);
        const vigente = async (sucursal: string | null, en: string) =>
          await un<{ precio: string | null; id: string | null; hay: boolean }>(
            "select (v).precio::text as precio, (v).id as id, (v).id is not null as hay from (select precio_vigente($1, $2, null, $3, $4::timestamptz) as v) q",
            [m.empresa, p, sucursal, en],
          );
        expect((await vigente(m.sucursal, "2026-06-01T00:00:00Z")).hay).toBe(false);
        const e1 = await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          precio: "3000",
          desde: "2026-04-01T00:00:00Z",
        });
        const s1 = await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          sucursal: m.sucursal,
          precio: "3600",
          desde: "2026-04-02T00:00:00Z",
        });
        expect(await vigente(m.sucursal, "2026-06-01T00:00:00Z")).toMatchObject({
          precio: "3600.000000",
          id: s1,
        });
        expect(await vigente(otra.sucursal, "2026-06-01T00:00:00Z")).toMatchObject({
          precio: "3000.000000",
          id: e1,
        });
        expect(await vigente(null, "2026-06-01T00:00:00Z")).toMatchObject({ id: e1 });
        expect(await vigente(m.sucursal, "2026-04-01T12:00:00Z")).toMatchObject({ id: e1 }); // antes del precio propio
        expect((await vigente(m.sucursal, "2026-03-31T00:00:00Z")).hay).toBe(false); // antes de todo
        const s2 = await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          sucursal: m.sucursal,
          precio: null,
          desde: "2026-04-03T00:00:00Z",
        });
        expect(s2).toBeTruthy();
        expect(await vigente(m.sucursal, "2026-06-01T00:00:00Z")).toMatchObject({
          precio: "3000.000000",
          id: e1,
        }); // volvió a la empresa
        const e2 = await precioDeBase(dueno, {
          empresa: m.empresa,
          producto: p,
          precio: null,
          desde: "2026-04-04T00:00:00Z",
        });
        expect(await vigente(m.sucursal, "2026-06-01T00:00:00Z")).toMatchObject({
          precio: null,
          id: e2,
          hay: true,
        }); // abierto explícito
      });
    });
  });

  describe("A2: aislamiento entre empresas por clave foránea compuesta", () => {
    it("una fila no puede apuntar a un producto, una opción, una sección o una sucursal de otra empresa", async () => {
      const ajeno = await productoDeBase(dueno, otra.empresa);
      const grupoAjeno = await grupoDeBase(dueno, otra.empresa, ajeno);
      const { opcion: opcionAjena } = await opcionDeBase(dueno, otra.empresa, ajeno, grupoAjeno);
      const seccionAjena = (
        await un<{ id: string }>(
          "insert into seccion_de_carta (empresa_id, nombre, nombre_clave, orden) values ($1, 'Ajena', $2, 1) returning id",
          [otra.empresa, randomUUID()],
        )
      ).id;
      await sinConfirmar(dueno, async () => {
        const propio = await productoDeBase(dueno, m.empresa);
        referencia(
          await intento(
            `insert into grupo_de_elecciones (empresa_id, producto_id, clase, nombre, nombre_clave, es_obligatorio, admite_varias, orden)
             values ($1, $2, 'ADICIONAL', 'G', 'g', false, false, 0)`,
            [m.empresa, ajeno],
          ),
          "grupo_de_elecciones_producto_fkey",
        );
        referencia(
          await intento(
            `insert into precio_de_venta (empresa_id, producto_id, precio, unidad_id, paso_minimo, vigente_desde) values ($1, $2, 1, 'UNIDAD', 1, now())`,
            [m.empresa, ajeno],
          ),
          "precio_de_venta_producto_fkey",
        );
        referencia(
          await intento(
            `insert into precio_de_venta (empresa_id, producto_id, opcion_id, sucursal_id, precio, unidad_id, paso_minimo, vigente_desde) values ($1, $2, $3, $4, 1, 'UNIDAD', 1, now())`,
            [m.empresa, propio, opcionAjena, m.sucursal],
          ),
          "precio_de_venta_opcion_fkey",
        );
        referencia(
          await intento(
            `insert into precio_de_venta (empresa_id, producto_id, sucursal_id, precio, unidad_id, paso_minimo, vigente_desde) values ($1, $2, $3, 1, 'UNIDAD', 1, now())`,
            [m.empresa, propio, otra.sucursal],
          ),
          "precio_de_venta_sucursal_fkey",
        );
        referencia(
          await intento("update producto set seccion_de_carta_id = $2 where id = $1", [
            propio,
            seccionAjena,
          ]),
          "producto_seccion_fkey",
        );
        referencia(
          await intento(
            `insert into copia_de_opciones (id, empresa_id, producto_origen_id, producto_destino_id) values (gen_random_uuid(), $1, $2, $3)`,
            [m.empresa, propio, ajeno],
          ),
          "copia_de_opciones_destino_fkey",
        );
        const { version } = await opcionDeBase(
          dueno,
          m.empresa,
          propio,
          await grupoDeBase(dueno, m.empresa, propio),
        );
        referencia(
          await intento(
            `insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad) values ($1, $2, 1, $3, 1)`,
            [m.empresa, version, await productoDeBase(dueno, otra.empresa, { clase: "INSUMO" })],
          ),
          "consumo_de_opcion_insumo_fkey",
        );
      });
    });

    it("la aplicación de una empresa no ve ni escribe filas de otra (RLS), y sin contexto no ve nada", async () => {
      const mio = await productoDeBase(dueno, m.empresa, { persona: m.persona });
      const ajeno = await productoDeBase(dueno, otra.empresa);
      await conAppDe(b(), m, async (s) => {
        const vistos = await s.intentar("select id from producto where id = any($1)", [
          [mio, ajeno],
        ]);
        expect(vistos.ok && vistos.rows.map((r) => r["id"])).toEqual([mio]);
        const toqueAjeno = await s.intentar("update producto set activo = false where id = $1", [
          ajeno,
        ]);
        expect(toqueAjeno.ok && toqueAjeno.filas).toBe(0);
        // No puede insertar a nombre de otra empresa.
        const alta = await s.intentar(
          `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id, creado_por)
           values ($1, 'Ajeno', $2, 'BIEN', 'INSUMO', 'UNIDAD', 'CONTEO', 'UNIDAD', $3)`,
          [otra.empresa, randomUUID(), m.persona],
        );
        expect(alta.ok).toBe(false);
        // Ni a nombre de otra persona.
        const autor = await s.intentar(
          `insert into producto (empresa_id, nombre, nombre_clave, tipo, clase_de_uso, unidad_base_id, dimension, unidad_de_venta_id, creado_por)
           values ($1, 'Autor', $2, 'BIEN', 'INSUMO', 'UNIDAD', 'CONTEO', 'UNIDAD', $3)`,
          [m.empresa, randomUUID(), otra.persona],
        );
        expect(autor.ok).toBe(false);
      });
    });
  });

  describe("A6: solo inserción y sin borrado, aun para el dueño de la base", () => {
    /** Una columna que existe en cada tabla, para un UPDATE que no cambia nada. */
    const COLUMNA: Record<string, string> = {
      unidad_de_medida: "id",
      seccion_de_carta: "id",
      producto: "id",
      grupo_de_elecciones: "id",
      opcion: "id",
      version_de_opcion: "id",
      consumo_de_opcion: "empresa_id",
      precio_de_venta: "id",
      copia_de_opciones: "id",
    };
    /** Con al menos una fila en cada tabla: un DELETE por fila sobre una tabla vacía no dispara nada. */
    beforeAll(async () => {
      const a = await productoDeBase(dueno, m.empresa);
      const g = await grupoDeBase(dueno, m.empresa, a, { clase: "ADICIONAL" });
      const { version } = await opcionDeBase(dueno, m.empresa, a, g);
      const insumo = await productoDeBase(dueno, m.empresa, { clase: "INSUMO" });
      await precioDeBase(dueno, {
        empresa: m.empresa,
        producto: a,
        precio: "10",
        desde: "2026-01-01T00:00:00Z",
      });
      await dueno.query(
        "insert into seccion_de_carta (empresa_id, nombre, nombre_clave, orden) values ($1, 'Postres', $2, 1)",
        [m.empresa, randomUUID()],
      );
      await dueno.query(
        "insert into copia_de_opciones (id, empresa_id, producto_origen_id, producto_destino_id) values (gen_random_uuid(), $1, $2, $3)",
        [m.empresa, a, insumo],
      );
      await dueno.query("begin");
      const nueva = await opcionDeBase(dueno, m.empresa, a, g);
      await dueno.query(
        "insert into consumo_de_opcion (empresa_id, version_de_opcion_id, numero, insumo_id, cantidad) values ($1, $2, 1, $3, 1)",
        [m.empresa, nueva.version, insumo],
      );
      await dueno.query("commit");
      expect(version).toBeTruthy();
    });

    it.each(SOLO_INSERCION)("%s: UPDATE, DELETE y TRUNCATE se rechazan", async (tabla) => {
      await sinConfirmar(dueno, async () => {
        denegado(await intento(`update ${tabla} set ${COLUMNA[tabla]} = ${COLUMNA[tabla]}`));
        denegado(await intento(`delete from ${tabla}`));
        noSeVacia(await intento(`truncate ${tabla}`));
      });
    });

    it.each(["producto", "seccion_de_carta", "grupo_de_elecciones", "opcion"])(
      "%s: no se borra ni se vacía (ni el dueño)",
      async (tabla) => {
        await sinConfirmar(dueno, async () => {
          denegado(await intento(`delete from ${tabla}`));
          noSeVacia(await intento(`truncate ${tabla}`));
        });
      },
    );

    it("la aplicación no tiene DELETE, TRUNCATE ni UPDATE sobre las tablas de solo inserción", async () => {
      await conAppDe(b(), m, async (s) => {
        for (const tabla of TABLAS) {
          denegado(await s.intentar(`delete from ${tabla}`));
          denegado(await s.intentar(`truncate ${tabla}`));
        }
        for (const tabla of SOLO_INSERCION) {
          denegado(await s.intentar(`update ${tabla} set ${COLUMNA[tabla]} = ${COLUMNA[tabla]}`));
        }
      });
    });

    it("los demás roles (plataforma, grupo, trabajos, público, captación, autenticación) no leen nada del catálogo", async () => {
      for (const rol of [
        "plataforma",
        "grupo",
        "trabajos",
        "publico",
        "captacion",
        "autenticacion",
      ] as const) {
        const c = new pg.Client({ connectionString: b()[rol] });
        await c.connect();
        try {
          for (const tabla of TABLAS) {
            const r = await c.query(`select 1 from ${tabla} limit 1`).then(
              () => "leyó",
              (e: { code?: string }) => e.code,
            );
            expect(r, `${rol} sobre ${tabla}`).toBe("42501");
          }
        } finally {
          await c.end();
        }
      }
    });
  });

  describe("D6: la migración y su reversión", () => {
    it("sobre una base sin catálogo sube, baja (deja el catálogo como antes), sube de nuevo; con filas la reversión pide confirmar; y frena si `producto` ya existe", async () => {
      const previa = await baseConMigraciones(b(), await migracionesPrevias());
      const conMia = await carpetaCon([...(await migracionesPrevias()), ARCHIVO]);
      try {
        await sembrarMarcaPrincipalDePrueba(previa.aparte.base.dueno);
        const c = previa.cliente;
        const antes = await huellaDeCatalogo(c);
        const reversion = await textoDeLaReversion();
        const fila = async () =>
          (await c.query("select 1 from migracion where nombre = $1", [ARCHIVO])).rows.length;

        // Defensa: si alguien creó `producto` a mano, frena sin cambiar nada.
        await c.query("create table producto (x int)");
        await expect(aplicarMigraciones(previa.aparte.base.dueno, conMia)).rejects.toThrow(
          /la tabla producto ya existe/,
        );
        await c.query("drop table producto");
        expect(await fila()).toBe(0);
        expect(await huellaDeCatalogo(c)).toEqual(antes);

        // Sube, baja sin datos (no pide nada) y vuelve a subir.
        await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(await fila()).toBe(1);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        expect(await fila()).toBe(0);
        const otraVez = await aplicarMigraciones(previa.aparte.base.dueno, conMia);
        expect(otraVez.aplicadas).toEqual([ARCHIVO]);

        // Con un producto cargado: sin confirmar no borra nada.
        const mundo = await crearMundo(c);
        await productoDeBase(c, mundo.empresa);
        await c.query("begin");
        await expect(c.query(reversion)).rejects.toMatchObject({
          code: "55000",
          message: expect.stringMatching(/avisar al dueño/) as string,
        });
        await c.query("rollback");
        expect((await c.query("select count(*)::int as n from producto")).rows[0]).toEqual({
          n: 1,
        });
        expect(await fila()).toBe(1);
        // Confirmada: borra y deja el catálogo como estaba; se puede repetir.
        await c.query(
          `begin; set local pedernal.confirmar_reversion = 'SI'; ${reversion}; commit;`,
        );
        expect(await huellaDeCatalogo(c)).toEqual(antes);
        await c.query(`begin; ${reversion}; commit;`);
        expect(await huellaDeCatalogo(c)).toEqual(antes);
      } finally {
        await rm(conMia, { recursive: true, force: true });
        await previa.cerrar();
      }
    });

    it("la reversión declara que es destructiva y que no se recupera, no usa CASCADE ni TRUNCATE y su único DELETE es el de su fila del registro", async () => {
      const texto = await textoDeLaReversion();
      const plano = texto.replace(/\n--\s*/g, " ");
      expect(plano).toMatch(/DESTRUCTIVA/);
      expect(plano).toMatch(/NO SE RECUPERA/);
      expect(plano).toMatch(/NO lo aplica el ejecutor de migraciones/);
      const codigo = texto.replace(/--.*$/gm, "");
      const borrados = codigo.match(/\bDELETE\b[^;]*;/gi) ?? [];
      expect(borrados).toHaveLength(1);
      expect(borrados[0]).toMatch(/^DELETE FROM public\.migracion WHERE nombre LIKE /i);
      expect(codigo).not.toMatch(/\b(TRUNCATE|CASCADE)\b/i);
    });

    it("la cabecera de la migración declara que es la primera del catálogo, sin SECURITY DEFINER, y el código no usa DELETE ni listas de prohibidos", async () => {
      const texto = await readFile(join(CARPETA_DE_MIGRACIONES, ARCHIVO), "utf8");
      const codigo = texto.replace(/--.*$/gm, "");
      expect(codigo).not.toMatch(/SECURITY DEFINER/i);
      expect(codigo).not.toMatch(/\b(DELETE\s+FROM|TRUNCATE\s+TABLE)\b/i);
      expect(codigo).not.toMatch(/GRANT\s+(DELETE|TRUNCATE|ALL)\b/i);
      expect(codigo).not.toMatch(/!~/);
    });
  });
});
