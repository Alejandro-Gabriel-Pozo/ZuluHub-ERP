import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { traducirErrorDeBase } from "../../src/adaptadores/postgres/errores";
import {
  ERRORES_DE_MARCAS_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_MARCAS,
  errorDeMarcaDeRestriccion,
  traducirErroresDeMarca,
} from "../../src/modulos/marcas/publico";
import {
  ERRORES_DE_PLANES_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_PLANES,
  errorDePlanesDeRestriccion,
  traducirErroresDePlanes,
} from "../../src/modulos/planes/publico";
import { err } from "../../src/primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import { crearBaseAparte } from "./entorno";
import {
  ACTOR_DE_PRUEBA,
  codigoAlAzar,
  crearBorradorDeMarca,
  crearBorradorDePlan,
  crearMarca,
  crearMundoDeMarca,
  crearPlan,
  crearPlanPublicado,
  crearVersionDeMarcaConfirmada,
  marcaPrincipal,
} from "./marcas-apoyo";

/**
 * Traducción de las restricciones de marcas y de planes contra la base REAL (M4): cada restricción y cada
 * disparador de 0007 tiene su entrada en el mapa (no falta ni sobra ninguna: una restricción nueva sin
 * traducir hace fallar esta prueba), y cada traducción que tiene motivo se fuerza con el error verdadero
 * de la base. Base propia. El resto de las pruebas de las tablas (privilegios, políticas, disparadores) es
 * de `marcas-sql.test.ts` y compañía.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("traducciones de marcas y de planes", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  /** Lo que el catálogo de la base dice de las tablas dadas: restricciones e índices únicos propios. */
  async function restriccionesDe(tablas: readonly string[]): Promise<Set<string>> {
    // `contype in (...)` deja afuera los NOT NULL que Postgres 18 lista (contype 'n') y 16 no.
    const reales = await filas<{ nombre: string }>(
      `select conname as nombre from pg_constraint
        where conrelid = any($1::regclass[]) and contype in ('p', 'u', 'c', 'f', 'x')
       union
       select indexname as nombre from pg_indexes
        where schemaname = 'public' and tablename = any($2)
          and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
      [tablas.map((t) => `public.${t}`), [...tablas]],
    );
    return new Set(reales.map((r) => r.nombre));
  }

  /** Los nombres que lanzan con `CONSTRAINT = '...'` las funciones dadas. */
  async function lanzadasPor(funciones: readonly string[]): Promise<Set<string>> {
    const cuerpos = await filas<{ prosrc: string }>(
      `select prosrc from pg_proc where pronamespace = 'public'::regnamespace and proname = any($1)`,
      [[...funciones]],
    );
    expect(cuerpos).toHaveLength(funciones.length);
    const lanzadas = new Set<string>();
    for (const { prosrc } of cuerpos) {
      for (const m of prosrc.matchAll(/CONSTRAINT = '([a-z_]+)'/g)) lanzadas.add(m[1] as string);
    }
    return lanzadas;
  }

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

  // ===============================================================================================
  type Conjunto = Readonly<{
    nombre: string;
    tablas: readonly string[];
    mapa: Readonly<Record<string, string>>;
    disparadores: readonly string[];
    funciones: readonly string[];
  }>;
  const conjuntos: readonly Conjunto[] = [
    {
      nombre: "marcas",
      tablas: ["marca", "version_de_marca"],
      mapa: ERRORES_DE_MARCAS_POR_RESTRICCION,
      disparadores: RESTRICCIONES_DE_DISPARADORES_DE_MARCAS,
      funciones: [
        "marca_validar_alta",
        "marca_validar_cambio",
        "version_de_marca_validar_alta",
        "version_de_marca_validar_cambio",
      ],
    },
    {
      nombre: "planes",
      tablas: [
        "plan",
        "version_de_plan",
        "plan_de_tenant",
        "ajuste_de_perilla",
        "modulo_de_empresa",
      ],
      mapa: ERRORES_DE_PLANES_POR_RESTRICCION,
      disparadores: RESTRICCIONES_DE_DISPARADORES_DE_PLANES,
      funciones: [
        "plan_validar_cambio",
        "version_de_plan_validar_alta",
        "version_de_plan_validar_cambio",
        "plan_de_tenant_validar_alta",
        "ajuste_de_perilla_validar_alta",
      ],
    },
  ];
  describe.each(conjuntos)(
    "el mapa de $nombre es el de la base",
    ({ tablas, mapa, disparadores, funciones }) => {
      it("toda restricción de sus tablas tiene su traducción declarada, y no sobra ninguna (falla si aparece una nueva)", async () => {
        const existentes = await restriccionesDe(tablas);
        const declaradas = new Set(Object.keys(mapa));
        const deDisparadores = new Set(disparadores);
        expect([...existentes].filter((n) => !declaradas.has(n)).sort(), "sin traducción").toEqual(
          [],
        );
        expect(
          [...declaradas].filter((n) => !existentes.has(n) && !deDisparadores.has(n)).sort(),
          "traducciones de restricciones que no existen",
        ).toEqual([]);
      });

      it("los nombres que lanzan los disparadores son exactamente la lista, y cada uno está declarado", async () => {
        const lanzadas = await lanzadasPor(funciones);
        expect([...lanzadas].sort()).toEqual([...disparadores].sort());
        for (const nombre of lanzadas) expect(Object.hasOwn(mapa, nombre), nombre).toBe(true);
      });

      it("los nombres de los disparadores no se confunden con una restricción del catálogo", async () => {
        const existentes = await restriccionesDe(tablas);
        for (const nombre of disparadores) {
          // Un disparador que reusa el nombre de una restricción real (como `dominio_duenio_ck`) se declara
          // aparte; acá ninguno lo hace.
          expect(existentes.has(nombre), nombre).toBe(false);
        }
      });
    },
  );

  // ===============================================================================================
  describe("cada traducción de marcas, forzada con el error real de la base", () => {
    type Caso = Readonly<{
      restriccion: keyof typeof ERRORES_DE_MARCAS_POR_RESTRICCION;
      tipo: ErrorDePersistencia["tipo"];
      motivo: string;
      provocar: () => Promise<ErrorDePersistencia>;
    }>;

    /** Una cadena principal → m1 → m2: m2 está en el nivel 2, el máximo de la base. */
    async function marcaDeNivelDos(): Promise<string> {
      const m1 = await crearMarca(dueno, { padre: principal });
      return crearMarca(dueno, { padre: m1 });
    }

    const casos: Caso[] = [
      {
        restriccion: "marca_codigo_ck",
        tipo: "Check",
        motivo: "CODIGO_DE_MARCA_INVALIDO",
        provocar: () => provocar("insert into marca (codigo) values ('Mayusculas!')"),
      },
      {
        restriccion: "marca_nivel_ck",
        tipo: "Check",
        motivo: "NIVEL_DE_MARCA_NO_HABILITADO",
        provocar: async () =>
          provocar("insert into marca (codigo, marca_padre_id) values ($1, $2)", [
            codigoAlAzar(),
            await marcaDeNivelDos(),
          ]),
      },
      {
        restriccion: "marca_codigo_uk",
        tipo: "Unicidad",
        motivo: "CODIGO_DE_MARCA_OCUPADO",
        provocar: async () => {
          const codigo = codigoAlAzar();
          await crearMarca(dueno, { codigo });
          return provocar("insert into marca (codigo) values ($1)", [codigo]);
        },
      },
      {
        restriccion: "marca_marca_padre_id_fkey",
        tipo: "Referencia",
        motivo: "MARCA_PADRE_NO_ENCONTRADA",
        provocar: () =>
          provocar("insert into marca (codigo, marca_padre_id) values ($1, $2)", [
            codigoAlAzar(),
            randomUUID(),
          ]),
      },
      {
        restriccion: "marca_padre_retirada",
        tipo: "Check",
        motivo: "MARCA_PADRE_RETIRADA",
        provocar: async () => {
          const padre = await crearMarca(dueno, { padre: principal });
          await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [padre]);
          return provocar("insert into marca (codigo, marca_padre_id) values ($1, $2)", [
            codigoAlAzar(),
            padre,
          ]);
        },
      },
      {
        restriccion: "version_de_marca_nombre_ck",
        tipo: "Check",
        motivo: "NOMBRE_DE_MARCA_INVALIDO",
        provocar: async () =>
          provocar("insert into version_de_marca (marca_id, nombre_visible) values ($1, '<b>')", [
            await crearMarca(dueno, { padre: principal }),
          ]),
      },
      {
        restriccion: "version_de_marca_logo_ck",
        tipo: "Check",
        motivo: "LOGO_INVALIDO",
        provocar: async () =>
          provocar(
            "insert into version_de_marca (marca_id, logo) values ($1, '/marcas/x/logo.svg')",
            [await crearMarca(dueno, { padre: principal })],
          ),
      },
      {
        restriccion: "version_de_marca_vigencia_ck",
        tipo: "Check",
        motivo: "VIGENCIA_RETROACTIVA",
        provocar: async () => {
          const marca = await crearMarca(dueno, { padre: principal });
          const borrador = await crearBorradorDeMarca(dueno, marca, { nombreVisible: "Retro" });
          return provocar(
            `update version_de_marca set estado = 'CONFIRMADA', numero = 1,
                    vigente_desde = now() - interval '1 hour', motivo = 'prueba',
                    confirmada_en = now(), confirmada_por = $2
              where id = $1`,
            [borrador, ACTOR_DE_PRUEBA],
          );
        },
      },
      {
        restriccion: "version_de_marca_borrador_uk",
        tipo: "Unicidad",
        motivo: "VERSION_DESACTUALIZADA",
        provocar: async () => {
          const marca = await crearMarca(dueno, { padre: principal });
          await crearBorradorDeMarca(dueno, marca);
          return provocar("insert into version_de_marca (marca_id) values ($1)", [marca]);
        },
      },
      {
        restriccion: "version_de_marca_marca_id_fkey",
        tipo: "Referencia",
        motivo: "MARCA_NO_ENCONTRADA",
        provocar: () =>
          provocar("insert into version_de_marca (marca_id) values ($1)", [randomUUID()]),
      },
      {
        restriccion: "version_de_marca_plan_por_defecto_id_fkey",
        tipo: "Referencia",
        motivo: "PLAN_NO_ENCONTRADO",
        provocar: async () =>
          provocar("insert into version_de_marca (marca_id, plan_por_defecto_id) values ($1, $2)", [
            await crearMarca(dueno, { padre: principal }),
            randomUUID(),
          ]),
      },
      {
        restriccion: "version_de_marca_marca_retirada",
        tipo: "Check",
        motivo: "MARCA_RETIRADA",
        provocar: async () => {
          const marca = await crearMarca(dueno, { padre: principal });
          await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [marca]);
          return provocar("insert into version_de_marca (marca_id) values ($1)", [marca]);
        },
      },
    ];

    it("los casos cubren exactamente las restricciones de marcas que se traducen a un motivo, una vez cada una", () => {
      const traducidas = Object.entries(ERRORES_DE_MARCAS_POR_RESTRICCION)
        .filter(([, motivo]) => motivo !== "NO_TRADUCIDA")
        .map(([restriccion]) => restriccion)
        .sort();
      expect(casos.map((c) => c.restriccion).sort()).toEqual(traducidas);
    });

    for (const caso of casos) {
      it(`${caso.restriccion} → ${caso.motivo}`, async () => {
        const e = await caso.provocar();
        expect(e).toEqual({ tipo: caso.tipo, restriccion: caso.restriccion });
        expect(errorDeMarcaDeRestriccion(e)).toBe(caso.motivo);
        expect(traducirErroresDeMarca(err(e), [caso.motivo as never])).toEqual(err(caso.motivo));
        expect(traducirErroresDeMarca(err(e), [])).toEqual(err(e));
      });
    }

    it("lo que la base rechaza y no tiene motivo propio (tema, aspecto, vocabulario, inmutables) sale como el error de persistencia tipado", async () => {
      const marca = await crearMarca(dueno, { padre: principal });
      const confirmada = await crearVersionDeMarcaConfirmada(dueno, marca, {
        nombreVisible: "Fija",
      });
      const sinMotivo: [string, () => Promise<ErrorDePersistencia>][] = [
        [
          "version_de_marca_tema_ck",
          async () =>
            provocar(
              `insert into version_de_marca (marca_id, tema) values ($1, '{"primary":"rojo"}'::jsonb)`,
              [await crearMarca(dueno, { padre: principal })],
            ),
        ],
        [
          "version_de_marca_aspecto_ck",
          async () =>
            provocar(
              `insert into version_de_marca (marca_id, aspecto) values ($1, '{"estilo":"moderno"}'::jsonb)`,
              [await crearMarca(dueno, { padre: principal })],
            ),
        ],
        [
          "version_de_marca_vocabulario_ck",
          async () =>
            provocar(
              `insert into version_de_marca (marca_id, vocabulario) values ($1, '{"x":"y"}'::jsonb)`,
              [await crearMarca(dueno, { padre: principal })],
            ),
        ],
        [
          "version_de_marca_confirmada_inmutable",
          () =>
            provocar("update version_de_marca set nombre_visible = 'Otra' where id = $1", [
              confirmada.id,
            ]),
        ],
        [
          "marca_inmutable",
          () => provocar("update marca set codigo = 'otro-codigo' where id = $1", [marca]),
        ],
      ];
      for (const [restriccion, esperado] of sinMotivo) {
        const e = await esperado();
        expect(e, restriccion).toMatchObject({ tipo: "Check", restriccion });
        expect(errorDeMarcaDeRestriccion(e), restriccion).toBeNull();
        const original = err(e);
        expect(traducirErroresDeMarca(original, ["VERSION_DESACTUALIZADA"])).toBe(original);
      }
    });
  });

  // ===============================================================================================
  describe("cada traducción de planes, forzada con el error real de la base", () => {
    type Caso = Readonly<{
      restriccion: keyof typeof ERRORES_DE_PLANES_POR_RESTRICCION;
      tipo: ErrorDePersistencia["tipo"];
      motivo: string;
      provocar: () => Promise<ErrorDePersistencia>;
    }>;

    const asignacion = (tenant: string, version: string, extra: Record<string, unknown> = {}) => ({
      texto: `insert into plan_de_tenant (tenant_id, numero, version_de_plan_id, vigente_desde, origen, motivo, asignado_por)
              values ($1, $2, $3, $4, 'CAMBIO', $5, $6)`,
      parametros: [
        tenant,
        extra["numero"] ?? 1,
        version,
        extra["vigenteDesde"] ?? new Date(),
        extra["motivo"] ?? "prueba",
        ACTOR_DE_PRUEBA,
      ],
    });
    const ajuste = (tenant: string, extra: Record<string, unknown> = {}) => ({
      texto: `insert into ajuste_de_perilla (tenant_id, empresa_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
              values ($1, $2, 'empresas_por_tenant', $3, '2', $4, $5, $6)`,
      parametros: [
        tenant,
        extra["empresa"] ?? null,
        extra["numero"] ?? 1,
        extra["vigenteDesde"] ?? new Date(),
        extra["motivo"] ?? "prueba",
        ACTOR_DE_PRUEBA,
      ],
    });

    /** Dos clientes del dueño que insertan lo mismo a la vez: el segundo espera al primero y choca en la única. */
    async function carrera(
      preparar: () => Promise<{ texto: string; parametros: unknown[] }>,
    ): Promise<ErrorDePersistencia> {
      const { texto, parametros } = await preparar();
      const a = new pg.Client({ connectionString: propia.base.dueno });
      const b = new pg.Client({ connectionString: propia.base.dueno });
      await a.connect();
      await b.connect();
      try {
        await a.query("begin");
        await b.query("begin");
        await a.query(texto, parametros);
        // `b` calcula el mismo «siguiente número» (no ve lo de `a` sin confirmar) y queda esperando.
        const espera = b.query(texto, parametros).then(
          () => null,
          (error: unknown) => error,
        );
        await new Promise((resolver) => setTimeout(resolver, 150));
        await a.query("commit");
        const error = await espera;
        if (error === null) throw new Error("la segunda inserción tenía que chocar");
        const traducido = traducirErrorDeBase(error);
        if (traducido === null) throw new Error("no es un error de la base", { cause: error });
        return traducido;
      } finally {
        await a.query("rollback").catch(() => undefined);
        await b.query("rollback").catch(() => undefined);
        await a.end();
        await b.end();
      }
    }

    const casos: Caso[] = [
      {
        restriccion: "plan_codigo_ck",
        tipo: "Check",
        motivo: "CODIGO_DE_PLAN_INVALIDO",
        provocar: () => provocar("insert into plan (codigo) values ('Mayusculas!')"),
      },
      {
        restriccion: "plan_codigo_uk",
        tipo: "Unicidad",
        motivo: "CODIGO_DE_PLAN_OCUPADO",
        provocar: async () => {
          const codigo = codigoAlAzar("p");
          await crearPlan(dueno, codigo);
          return provocar("insert into plan (codigo) values ($1)", [codigo]);
        },
      },
      {
        restriccion: "version_de_plan_plan_id_fkey",
        tipo: "Referencia",
        motivo: "PLAN_NO_ENCONTRADO",
        provocar: () =>
          provocar("insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'x')", [
            randomUUID(),
          ]),
      },
      {
        restriccion: "version_de_plan_nombre_ck",
        tipo: "Check",
        motivo: "NOMBRE_DE_PLAN_INVALIDO",
        provocar: async () =>
          provocar("insert into version_de_plan (plan_id, nombre_comercial) values ($1, '<b>')", [
            await crearPlan(dueno),
          ]),
      },
      {
        restriccion: "version_de_plan_borrador_uk",
        tipo: "Unicidad",
        motivo: "VERSION_DESACTUALIZADA",
        provocar: async () => {
          const plan = await crearPlan(dueno);
          await crearBorradorDePlan(dueno, plan);
          return provocar(
            "insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'x')",
            [plan],
          );
        },
      },
      {
        restriccion: "version_de_plan_plan_retirado",
        tipo: "Check",
        motivo: "PLAN_RETIRADO",
        provocar: async () => {
          const plan = await crearPlan(dueno);
          await dueno.query("update plan set estado = 'RETIRADO' where id = $1", [plan]);
          return provocar(
            "insert into version_de_plan (plan_id, nombre_comercial) values ($1, 'x')",
            [plan],
          );
        },
      },
      {
        restriccion: "plan_de_tenant_tenant_id_fkey",
        tipo: "Referencia",
        motivo: "TENANT_NO_ENCONTRADO",
        provocar: async () => {
          const { version } = await crearPlanPublicado(dueno);
          const a = asignacion(randomUUID(), version);
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "plan_de_tenant_motivo_ck",
        tipo: "Check",
        motivo: "MOTIVO_OBLIGATORIO",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          const { version } = await crearPlanPublicado(dueno);
          const a = asignacion(mundo.tenant, version, { motivo: "   " });
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "plan_de_tenant_vigencia_ck",
        tipo: "Check",
        motivo: "VIGENCIA_RETROACTIVA",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          const { version } = await crearPlanPublicado(dueno);
          const a = asignacion(mundo.tenant, version, {
            vigenteDesde: new Date(Date.now() - 3_600_000),
          });
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "plan_de_tenant_numero_invalido",
        tipo: "Check",
        motivo: "VERSION_DESACTUALIZADA",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          const { version } = await crearPlanPublicado(dueno);
          const a = asignacion(mundo.tenant, version, { numero: 5 });
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "plan_de_tenant_version_no_publicada",
        tipo: "Check",
        motivo: "VERSION_DE_PLAN_NO_PUBLICADA",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          const borrador = await crearBorradorDePlan(dueno, await crearPlan(dueno));
          const a = asignacion(mundo.tenant, borrador);
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "plan_de_tenant_numero_uk",
        tipo: "Unicidad",
        motivo: "VERSION_DESACTUALIZADA",
        provocar: () =>
          carrera(async () => {
            const mundo = await crearMundoDeMarca(dueno);
            const { version } = await crearPlanPublicado(dueno);
            return asignacion(mundo.tenant, version);
          }),
      },
      {
        restriccion: "ajuste_de_perilla_tenant_id_fkey",
        tipo: "Referencia",
        motivo: "TENANT_NO_ENCONTRADO",
        provocar: () => {
          const a = ajuste(randomUUID());
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "ajuste_de_perilla_empresa_id_fkey",
        tipo: "Referencia",
        motivo: "EMPRESA_NO_ENCONTRADA",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          const a = ajuste(mundo.tenant, { empresa: randomUUID() });
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "ajuste_de_perilla_motivo_ck",
        tipo: "Check",
        motivo: "MOTIVO_OBLIGATORIO",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          const a = ajuste(mundo.tenant, { motivo: " " });
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "ajuste_de_perilla_vigencia_ck",
        tipo: "Check",
        motivo: "VIGENCIA_RETROACTIVA",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          const a = ajuste(mundo.tenant, { vigenteDesde: new Date(Date.now() - 3_600_000) });
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "ajuste_de_perilla_empresa_de_otro_tenant",
        tipo: "Check",
        motivo: "EMPRESA_DE_OTRO_TENANT",
        provocar: async () => {
          const uno = await crearMundoDeMarca(dueno);
          const otro = await crearMundoDeMarca(dueno);
          const a = ajuste(uno.tenant, { empresa: otro.empresa });
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "ajuste_de_perilla_numero_invalido",
        tipo: "Check",
        motivo: "VERSION_DESACTUALIZADA",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          const a = ajuste(mundo.tenant, { numero: 3 });
          return provocar(a.texto, a.parametros);
        },
      },
      {
        restriccion: "ajuste_de_perilla_numero_uk",
        tipo: "Unicidad",
        motivo: "VERSION_DESACTUALIZADA",
        provocar: () =>
          carrera(async () => {
            const mundo = await crearMundoDeMarca(dueno);
            return ajuste(mundo.tenant);
          }),
      },
      {
        restriccion: "modulo_de_empresa_empresa_id_fkey",
        tipo: "Referencia",
        motivo: "EMPRESA_NO_ENCONTRADA",
        provocar: () =>
          provocar("insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'caja')", [
            randomUUID(),
          ]),
      },
    ];

    it("los casos cubren exactamente las restricciones de planes que se traducen a un motivo, una vez cada una", () => {
      const traducidas = Object.entries(ERRORES_DE_PLANES_POR_RESTRICCION)
        .filter(([, motivo]) => motivo !== "NO_TRADUCIDA")
        .map(([restriccion]) => restriccion)
        .sort();
      expect(casos.map((c) => c.restriccion).sort()).toEqual(traducidas);
    });

    for (const caso of casos) {
      it(`${caso.restriccion} → ${caso.motivo}`, async () => {
        const e = await caso.provocar();
        expect(e).toEqual({ tipo: caso.tipo, restriccion: caso.restriccion });
        expect(errorDePlanesDeRestriccion(e)).toBe(caso.motivo);
        expect(traducirErroresDePlanes(err(e), [caso.motivo as never])).toEqual(err(caso.motivo));
        expect(traducirErroresDePlanes(err(e), [])).toEqual(err(e));
      });
    }

    it("lo que la base rechaza y no tiene motivo propio (valor del ajuste, módulos, versión publicada) sale como el error de persistencia tipado", async () => {
      const mundo = await crearMundoDeMarca(dueno);
      const { version } = await crearPlanPublicado(dueno);
      const sinMotivo: [string, () => Promise<ErrorDePersistencia>][] = [
        [
          "ajuste_de_perilla_valor_ck",
          () =>
            provocar(
              `insert into ajuste_de_perilla (tenant_id, perilla, numero, valor, vigente_desde, motivo, asignado_por)
             values ($1, 'empresas_por_tenant', 1, 'muchas', now(), 'prueba', $2)`,
              [mundo.tenant, ACTOR_DE_PRUEBA],
            ),
        ],
        [
          "modulo_de_empresa_modulo_ck",
          () =>
            provocar(
              "insert into modulo_de_empresa (empresa_id, modulo) values ($1, 'No Valido')",
              [mundo.empresa],
            ),
        ],
        [
          "version_de_plan_modulos_ck",
          async () =>
            provocar(
              `insert into version_de_plan (plan_id, nombre_comercial, modulos) values ($1, 'x', '{MAYUS}')`,
              [await crearPlan(dueno)],
            ),
        ],
        [
          "version_de_plan_publicada_inmutable",
          () =>
            provocar("update version_de_plan set nombre_comercial = 'Otro' where id = $1", [
              version,
            ]),
        ],
      ];
      for (const [restriccion, esperado] of sinMotivo) {
        const e = await esperado();
        expect(e, restriccion).toMatchObject({ tipo: "Check", restriccion });
        expect(errorDePlanesDeRestriccion(e), restriccion).toBeNull();
        const original = err(e);
        expect(traducirErroresDePlanes(original, ["VERSION_DESACTUALIZADA"])).toBe(original);
      }
    });
  });

  // ===============================================================================================
  describe("el SQL de 0007 y el código dicen lo mismo", () => {
    it("el texto de un ajuste que acepta la base es exactamente lo que `valorDeAjuste` sabe leer (misma expresión que la restricción)", async () => {
      const [fila] = await filas<{ def: string }>(
        `select pg_get_constraintdef(oid) as def from pg_constraint
          where conname = 'ajuste_de_perilla_valor_ck' and conrelid = 'public.ajuste_de_perilla'::regclass`,
      );
      expect(fila?.def).toContain("^(0|[1-9][0-9]{0,8}|ILIMITADO|DEL_PLAN)$");
    });
  });
});
