import { randomUUID } from "node:crypto";
import { sql, type Kysely } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it } from "vitest";
import { traducirErrorDeBase } from "../../src/adaptadores/postgres/errores";
import type {
  SinTablas,
  TransaccionesDePostgres,
} from "../../src/adaptadores/postgres/transacciones";
import {
  COLUMNAS_DE_DOMINIO,
  ERRORES_DE_DOMINIO_POR_RESTRICCION,
  ESTADOS_DE_DOMINIO,
  RESTRICCIONES_DE_DISPARADORES_DE_DOMINIO,
  SUPERFICIES_DE_DOMINIO,
  TITULARES_DE_DOMINIO,
  decidirCambioDeDominio,
  errorDeDominioDeRestriccion,
  traducirErroresDeDominio,
  type PedidoDeCambioDeDominio,
} from "../../src/modulos/marcas/publico";
import { dominioId, empresaId, marcaComercialId } from "../../src/primitivas/identificadores/marca";
import { err, ok } from "../../src/primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import {
  comoAdminDePlataforma as comoAdmin,
  comoSoporteDePlataforma as comoSoporte,
  crearCasosDeDominios,
  crearEntornoDeDominios,
  filaDeDominio,
  type TxDeDominiosDePrueba,
} from "./dominios-apoyo";
import { AHORA_DE_PRUEBA, comoEmpresa, crearBaseAparte } from "./entorno";
import {
  crearDominio,
  crearDominioDeEmpresa,
  crearMarca,
  crearMundoDeMarca,
  hostAlAzar,
  marcaPrincipal,
} from "./marcas-apoyo";
import { claveAlAzar } from "./plataforma-apoyo";
import { personaId } from "../../src/primitivas/identificadores/marca";

/**
 * Persistencia de dominios contra Postgres real (M4a): el esquema que declara el código, el repositorio, y
 * sobre todo la TRADUCCIÓN de cada restricción de `dominio` a su motivo tipado: cada una se fuerza con el
 * error real de la base y se verifica el motivo, y una prueba exhaustiva falla si aparece una restricción
 * nueva sin traducir. Base propia.
 */

const base = inject("baseDePruebas");

describe.skipIf(base === null)("dominios: persistencia y traducción de restricciones", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: TransaccionesDePostgres<TxDeDominiosDePrueba>;
  let principal: string;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
    entorno = crearEntornoDeDominios(propia.base, 4);
    principal = await marcaPrincipal(dueno);
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await propia.destruir();
  });

  const filas = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;

  // ===============================================================================================
  describe("el esquema que declara el código es el de la base", () => {
    it("las columnas de `dominio` coinciden con COLUMNAS_DE_DOMINIO, en orden", async () => {
      const reales = await filas<{ column_name: string }>(
        `select column_name from information_schema.columns
         where table_schema = 'public' and table_name = 'dominio' order by ordinal_position`,
      );
      expect(reales.map((c) => c.column_name)).toEqual([...COLUMNAS_DE_DOMINIO]);
    });

    it("los estados, las superficies y los titulares del dominio puro son exactamente los de los CHECK", async () => {
      const lista = async (restriccion: string) => {
        const [fila] = await filas<{ def: string }>(
          "select pg_get_constraintdef(oid) as def from pg_constraint where conname = $1 and conrelid = 'public.dominio'::regclass",
          [restriccion],
        );
        return [...(fila?.def ?? "").matchAll(/'([A-Z_]+)'::text/g)].map((m) => m[1]);
      };
      expect(await lista("dominio_estado_ck")).toEqual([...ESTADOS_DE_DOMINIO]);
      expect(await lista("dominio_superficie_ck")).toEqual([...SUPERFICIES_DE_DOMINIO]);
      expect(await lista("dominio_titular_ck")).toEqual([...TITULARES_DE_DOMINIO]);
    });

    it("toda restricción de `dominio` tiene su traducción declarada, y no sobra ninguna (falla si aparece una nueva)", async () => {
      // `contype in (...)` deja afuera los NOT NULL que Postgres 18 lista (contype 'n') y 16 no.
      const reales = await filas<{ nombre: string }>(
        `select conname as nombre from pg_constraint
         where conrelid = 'public.dominio'::regclass and contype in ('p', 'u', 'c', 'f', 'x')
         union
         select indexname as nombre from pg_indexes
         where schemaname = 'public' and tablename = 'dominio'
           and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
      );
      const existentes = new Set(reales.map((r) => r.nombre));
      const declaradas = new Set(Object.keys(ERRORES_DE_DOMINIO_POR_RESTRICCION));
      const disparadores = new Set<string>(RESTRICCIONES_DE_DISPARADORES_DE_DOMINIO);
      expect([...existentes].filter((n) => !declaradas.has(n)).sort(), "sin traducción").toEqual(
        [],
      );
      expect(
        [...declaradas].filter((n) => !existentes.has(n) && !disparadores.has(n)).sort(),
        "traducciones de restricciones que no existen",
      ).toEqual([]);
    });

    it("los nombres que lanzan los disparadores de `dominio` son exactamente la lista, y cada uno está declarado", async () => {
      const funciones = await filas<{ prosrc: string }>(
        `select prosrc from pg_proc
         where pronamespace = 'public'::regnamespace and proname in ('dominio_validar_alta', 'dominio_validar_cambio')`,
      );
      expect(funciones).toHaveLength(2);
      const lanzados = new Set<string>();
      for (const f of funciones) {
        for (const m of f.prosrc.matchAll(/CONSTRAINT = '([a-z_]+)'/g))
          lanzados.add(m[1] as string);
      }
      expect([...lanzados].sort()).toEqual([...RESTRICCIONES_DE_DISPARADORES_DE_DOMINIO].sort());
      for (const nombre of lanzados) {
        expect(Object.hasOwn(ERRORES_DE_DOMINIO_POR_RESTRICCION, nombre), nombre).toBe(true);
      }
    });
  });

  // ===============================================================================================
  describe("cada restricción traducida, forzada con el error real de la base", () => {
    /** Corre `trabajo` como plataforma (ADMIN) y devuelve el error de la base tal como lo ve un caso de uso. */
    async function conPlataforma(
      trabajo: (db: Kysely<SinTablas>) => Promise<unknown>,
    ): Promise<ErrorDePersistencia> {
      const r = await entorno.ejecutar({ contexto: comoAdmin() }, async (tx) => {
        await trabajo(tx.db);
        return ok(null);
      });
      if (r.ok) throw new Error("la base tenía que rechazarlo");
      return r.error;
    }
    /** Lo que sólo el dueño de la base puede provocar (columnas sin permiso para la plataforma). */
    async function conDueno(texto: string, parametros: unknown[]): Promise<ErrorDePersistencia> {
      try {
        await dueno.query(texto, parametros);
      } catch (error) {
        const traducido = traducirErrorDeBase(error);
        if (traducido !== null) return traducido;
        throw error;
      }
      throw new Error("la base tenía que rechazarlo");
    }

    const actor = sql`(select app_actor_plataforma())`;
    const insertarDeMarca = (
      db: Kysely<SinTablas>,
      host: string,
      marca: string,
      extra: { superficie?: string; titular?: string; canonico?: boolean } = {},
    ) =>
      sql`insert into dominio (host, superficie, duenio_marca_id, titular, es_canonico, registrado_por)
          values (${host}, ${extra.superficie ?? "APP"}, ${marca}, ${extra.titular ?? "OPERADOR"},
                  ${extra.canonico ?? false}, ${actor})`.execute(db);
    const insertarDeEmpresa = (
      db: Kysely<SinTablas>,
      empresa: string,
      extra: { superficie?: string; canonico?: boolean } = {},
    ) =>
      sql`insert into dominio (host, superficie, duenio_empresa_id, titular, es_canonico, registrado_por)
          values (${hostAlAzar()}, ${extra.superficie ?? "CARTA"}, ${empresa}, 'CLIENTE',
                  ${extra.canonico ?? false}, ${actor})`.execute(db);
    const cambiar = (db: Kysely<SinTablas>, id: string, fragmento: ReturnType<typeof sql>) =>
      sql`update dominio set ${fragmento} where id = ${id}`.execute(db);

    type Caso = Readonly<{
      restriccion: keyof typeof ERRORES_DE_DOMINIO_POR_RESTRICCION;
      tipo: ErrorDePersistencia["tipo"];
      motivo: string;
      provocar: () => Promise<ErrorDePersistencia>;
    }>;

    const casos: Caso[] = [
      {
        restriccion: "dominio_host_uk",
        tipo: "Unicidad",
        motivo: "HOST_DUPLICADO",
        provocar: async () => {
          const d = await crearDominio(dueno, principal, { estado: "PENDIENTE_VERIFICACION" });
          return conPlataforma((db) => insertarDeMarca(db, d.host, principal));
        },
      },
      {
        restriccion: "dominio_canonico_uk",
        tipo: "Unicidad",
        motivo: "YA_TIENE_CANONICO",
        provocar: async () => {
          const m = await crearMarca(dueno);
          await crearDominio(dueno, m, { canonico: true });
          return conPlataforma((db) => insertarDeMarca(db, hostAlAzar(), m, { canonico: true }));
        },
      },
      {
        restriccion: "dominio_transicion_invalida",
        tipo: "Check",
        motivo: "TRANSICION_DE_DOMINIO_INVALIDA",
        provocar: async () => {
          const d = await crearDominio(dueno, await crearMarca(dueno), {
            estado: "PENDIENTE_VERIFICACION",
          });
          return conPlataforma((db) => cambiar(db, d.id, sql`estado = 'ACTIVO'`));
        },
      },
      {
        restriccion: "dominio_verificacion_inmutable",
        tipo: "Check",
        motivo: "FECHA_DE_VERIFICACION_INMUTABLE",
        provocar: async () => {
          const d = await crearDominio(dueno, await crearMarca(dueno), { estado: "VERIFICADO" });
          return conPlataforma((db) =>
            cambiar(db, d.id, sql`estado = 'ACTIVO', verificado_en = now() + interval '1 day'`),
          );
        },
      },
      {
        restriccion: "dominio_retirado_inmutable",
        tipo: "Check",
        motivo: "DOMINIO_RETIRADO",
        provocar: async () => {
          const d = await crearDominio(dueno, await crearMarca(dueno), { estado: "RETIRADO" });
          return conPlataforma((db) => cambiar(db, d.id, sql`estado = 'ACTIVO'`));
        },
      },
      {
        restriccion: "dominio_canonico_no_se_retira",
        tipo: "Check",
        motivo: "DOMINIO_CANONICO",
        provocar: async () => {
          const d = await crearDominio(dueno, await crearMarca(dueno), {
            canonico: true,
            estado: "ACTIVO",
          });
          return conPlataforma((db) =>
            cambiar(db, d.id, sql`estado = 'RETIRADO', motivo = 'quiero retirarlo'`),
          );
        },
      },
      {
        restriccion: "dominio_marca_retirada",
        tipo: "Check",
        motivo: "MARCA_RETIRADA",
        provocar: async () => {
          const m = await crearMarca(dueno);
          await dueno.query("update marca set estado = 'RETIRADA' where id = $1", [m]);
          return conPlataforma((db) => insertarDeMarca(db, hostAlAzar(), m));
        },
      },
      {
        restriccion: "dominio_duenio_marca_id_fkey",
        tipo: "Referencia",
        motivo: "MARCA_NO_ENCONTRADA",
        provocar: () => conPlataforma((db) => insertarDeMarca(db, hostAlAzar(), randomUUID())),
      },
      {
        restriccion: "dominio_duenio_empresa_id_fkey",
        tipo: "Referencia",
        motivo: "EMPRESA_NO_ENCONTRADA",
        provocar: () => conPlataforma((db) => insertarDeEmpresa(db, randomUUID())),
      },
      {
        restriccion: "dominio_host_ck",
        tipo: "Check",
        motivo: "HOST_INVALIDO",
        provocar: () => conPlataforma((db) => insertarDeMarca(db, "No Es Un Host", principal)),
      },
      {
        restriccion: "dominio_superficie_ck",
        tipo: "Check",
        motivo: "SUPERFICIE_INVALIDA",
        provocar: () =>
          conPlataforma((db) =>
            insertarDeMarca(db, hostAlAzar(), principal, { superficie: "TIENDA" }),
          ),
      },
      {
        restriccion: "dominio_titular_ck",
        tipo: "Check",
        motivo: "TITULAR_INVALIDO",
        provocar: () =>
          conPlataforma((db) => insertarDeMarca(db, hostAlAzar(), principal, { titular: "YO" })),
      },
      {
        restriccion: "dominio_superficie_duenio_ck",
        tipo: "Check",
        motivo: "SUPERFICIE_NO_ADMITIDA_PARA_EMPRESA",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          return conPlataforma((db) =>
            insertarDeEmpresa(db, mundo.empresa, { superficie: "LANDING" }),
          );
        },
      },
      {
        restriccion: "dominio_canonico_ck",
        tipo: "Check",
        motivo: "CANONICO_SOLO_DE_MARCA",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          return conPlataforma((db) => insertarDeEmpresa(db, mundo.empresa, { canonico: true }));
        },
      },
    ];

    it("los casos cubren exactamente las restricciones que se traducen a un motivo, una vez cada una", () => {
      const traducidas = Object.entries(ERRORES_DE_DOMINIO_POR_RESTRICCION)
        .filter(([, motivo]) => motivo !== "NO_TRADUCIDA")
        .map(([restriccion]) => restriccion)
        .sort();
      expect(casos.map((c) => c.restriccion).sort()).toEqual(traducidas);
      expect(casos).toHaveLength(14);
      // las siete que pidió el dueño están entre ellas
      for (const nombre of [
        "dominio_host_uk",
        "dominio_canonico_uk",
        "dominio_transicion_invalida",
        "dominio_verificacion_inmutable",
        "dominio_retirado_inmutable",
        "dominio_canonico_no_se_retira",
        "dominio_marca_retirada",
      ]) {
        expect(casos.map((c) => c.restriccion)).toContain(nombre);
      }
    });

    for (const caso of casos) {
      it(`${caso.restriccion} → ${caso.motivo}`, async () => {
        const e = await caso.provocar();
        // La base lanzó exactamente esa restricción...
        expect(e).toEqual({ tipo: caso.tipo, restriccion: caso.restriccion });
        // ...el mapa la traduce a su motivo...
        expect(errorDeDominioDeRestriccion(e)).toBe(caso.motivo);
        // ...el caso de uso que la admite recibe un Resultado con nombre, nunca una excepción cruda...
        expect(traducirErroresDeDominio(err(e), [caso.motivo as never])).toEqual(err(caso.motivo));
        // ...y uno que no la admite recibe el error de persistencia tipado, intacto.
        expect(traducirErroresDeDominio(err(e), [])).toEqual(err(e));
      });
    }

    it("el 40001 de SERIALIZABLE no es una restricción: el adaptador lo reintenta y, agotados los reintentos, devuelve ConcurrenciaAgotada tipado", async () => {
      const r = await entorno.ejecutar({ contexto: comoAdmin(), reintentos: 0 }, async (tx) => {
        await sql`select pg_sleep(0)`.execute(tx.db);
        // Fuerza el aborto por serialización: un SQLSTATE 40001 lanzado desde la propia transacción.
        await sql`do $$ begin raise exception 'conflicto de prueba' using errcode = '40001'; end $$`.execute(
          tx.db,
        );
        return ok(null);
      });
      expect(r).toEqual(err({ tipo: "ConcurrenciaAgotada" }));
      expect(errorDeDominioDeRestriccion({ tipo: "ConcurrenciaAgotada" })).toBeNull();
    });

    // Las que siguen NO tienen motivo propio (`NO_TRADUCIDA`): el dominio puro decide antes o las fija la
    // base. Si saltan, salen como el error de persistencia tipado, no disfrazadas.
    const sinMotivo: Array<{
      restriccion: keyof typeof ERRORES_DE_DOMINIO_POR_RESTRICCION;
      provocar: () => Promise<ErrorDePersistencia>;
    }> = [
      {
        restriccion: "dominio_pkey",
        provocar: async () => {
          const d = await crearDominio(dueno, principal);
          return conDueno(
            `insert into dominio (id, host, superficie, duenio_marca_id, titular, registrado_por)
             values ($1, $2, 'APP', $3, 'OPERADOR', 'x')`,
            [d.id, hostAlAzar(), principal],
          );
        },
      },
      {
        restriccion: "dominio_registrado_por_ck",
        provocar: () =>
          conDueno(
            `insert into dominio (host, superficie, duenio_marca_id, titular, registrado_por)
             values ($1, 'APP', $2, 'OPERADOR', '')`,
            [hostAlAzar(), principal],
          ),
      },
      {
        restriccion: "dominio_duenio_ck",
        provocar: async () => {
          const mundo = await crearMundoDeMarca(dueno);
          return conDueno(
            `insert into dominio (host, superficie, duenio_marca_id, duenio_empresa_id, titular, registrado_por)
             values ($1, 'APP', $2, $3, 'OPERADOR', 'x')`,
            [hostAlAzar(), principal, mundo.empresa],
          );
        },
      },
      {
        restriccion: "dominio_nace_pendiente",
        provocar: () =>
          conDueno(
            `insert into dominio (host, superficie, duenio_marca_id, titular, registrado_por, estado, verificado_en)
             values ($1, 'APP', $2, 'OPERADOR', 'x', 'VERIFICADO', now())`,
            [hostAlAzar(), principal],
          ),
      },
      {
        restriccion: "dominio_inmutable",
        provocar: async () => {
          const d = await crearDominio(dueno, principal);
          return conDueno("update dominio set host = $2 where id = $1", [d.id, hostAlAzar()]);
        },
      },
      {
        restriccion: "dominio_verificacion_ck",
        provocar: async () => {
          const d = await crearDominio(dueno, principal, { estado: "PENDIENTE_VERIFICACION" });
          return conPlataforma((db) => cambiar(db, d.id, sql`estado = 'VERIFICADO'`));
        },
      },
    ];

    for (const caso of sinMotivo) {
      it(`${caso.restriccion} es NO_TRADUCIDA: sale como el error de persistencia tipado, sin motivo`, async () => {
        expect(ERRORES_DE_DOMINIO_POR_RESTRICCION[caso.restriccion]).toBe("NO_TRADUCIDA");
        const e = await caso.provocar();
        expect(e).toMatchObject({ restriccion: caso.restriccion });
        expect(errorDeDominioDeRestriccion(e)).toBeNull();
        const original = err(e);
        expect(traducirErroresDeDominio(original, ["HOST_DUPLICADO", "DOMINIO_CANONICO"])).toBe(
          original,
        );
      });
    }

    it("dominio_estado_ck y dominio_marca_duena_ck no se pueden forzar: el disparador salta antes (la base los repite como defensa)", async () => {
      // estado inválido al nacer: lo para `dominio_nace_pendiente`; al cambiar: `dominio_transicion_invalida`.
      expect(
        await conDueno(
          `insert into dominio (host, superficie, duenio_marca_id, titular, registrado_por, estado)
           values ($1, 'APP', $2, 'OPERADOR', 'x', 'OTRO')`,
          [hostAlAzar(), principal],
        ),
      ).toEqual({ tipo: "Check", restriccion: "dominio_nace_pendiente" });
      const d = await crearDominio(dueno, principal);
      expect(await conDueno("update dominio set estado = 'OTRO' where id = $1", [d.id])).toEqual({
        tipo: "Check",
        restriccion: "dominio_transicion_invalida",
      });
      // la marca de entrada la fija el disparador desde el dueño: nunca puede discrepar
      expect((await filaDeDominio(dueno, d.id)).marca_id).toBe(principal);
      expect(ERRORES_DE_DOMINIO_POR_RESTRICCION.dominio_estado_ck).toBe("NO_TRADUCIDA");
      expect(ERRORES_DE_DOMINIO_POR_RESTRICCION.dominio_marca_duena_ck).toBe("NO_TRADUCIDA");
    });
  });

  // ===============================================================================================
  describe("la traducción llega hasta el caso de uso, aunque el dominio puro no la haya visto venir", () => {
    /** Un entorno cuyo `obtener` devuelve una vista VIEJA del dominio: la carrera que el dominio puro no ve. */
    function conVistaVieja(
      vista: (
        real: NonNullable<Awaited<ReturnType<TxDeDominiosDePrueba["dominios"]["obtener"]>>>,
      ) => object,
    ) {
      const propio = crearEntornoDeDominios(propia.base, 2, (tx) => ({
        ...tx,
        dominios: {
          ...tx.dominios,
          obtener: async (id) => {
            const real = await tx.dominios.obtener(id);
            return real === null ? null : { ...real, ...vista(real) };
          },
        },
      }));
      return { propio, casos: crearCasosDeDominios(propio) };
    }
    const pedido = <T extends object>(id: string, extra: T) => ({
      claveDeIdempotencia: claveAlAzar(),
      dominioId: id,
      ...extra,
    });

    it("activar un dominio que otra transacción ya devolvió a pendiente: TRANSICION_DE_DOMINIO_INVALIDA", async () => {
      const { propio, casos } = conVistaVieja(() => ({ estado: "VERIFICADO" }));
      try {
        const d = await crearDominio(dueno, await crearMarca(dueno), {
          estado: "PENDIENTE_VERIFICACION",
        });
        expect(await casos.activarDominio(comoAdmin(), pedido(d.id, {}))).toEqual({
          ok: false,
          error: "TRANSICION_DE_DOMINIO_INVALIDA",
        });
        expect((await filaDeDominio(dueno, d.id)).estado).toBe("PENDIENTE_VERIFICACION");
      } finally {
        await propio.cerrar();
      }
    });

    it("tocar un dominio que otra transacción ya retiró: DOMINIO_RETIRADO", async () => {
      const { propio, casos } = conVistaVieja(() => ({ estado: "ACTIVO" }));
      try {
        const d = await crearDominio(dueno, await crearMarca(dueno), { estado: "RETIRADO" });
        expect(await casos.desactivarDominio(comoAdmin(), pedido(d.id, {}))).toEqual({
          ok: false,
          error: "DOMINIO_RETIRADO",
        });
      } finally {
        await propio.cerrar();
      }
    });

    it("retirar el canónico que la vista vieja no sabía canónico: DOMINIO_CANONICO", async () => {
      const { propio, casos } = conVistaVieja(() => ({ esCanonico: false }));
      try {
        const d = await crearDominio(dueno, await crearMarca(dueno), {
          canonico: true,
          estado: "ACTIVO",
        });
        expect(await casos.retirarDominio(comoAdmin(), pedido(d.id, { motivo: "x" }))).toEqual({
          ok: false,
          error: "DOMINIO_CANONICO",
        });
        expect((await filaDeDominio(dueno, d.id)).estado).toBe("ACTIVO");
      } finally {
        await propio.cerrar();
      }
    });

    it("verificar de nuevo, con otra fecha, lo que la vista vieja creía pendiente: FECHA_DE_VERIFICACION_INMUTABLE", async () => {
      const { propio, casos } = conVistaVieja(() => ({
        estado: "PENDIENTE_VERIFICACION",
        verificadoEn: null,
      }));
      try {
        const d = await crearDominio(dueno, await crearMarca(dueno), { estado: "VERIFICADO" });
        expect(
          await casos.verificarDominio(
            comoAdmin(),
            pedido(d.id, { verificadoEn: new Date("2026-10-11T11:59:00Z") }),
          ),
        ).toEqual({ ok: false, error: "FECHA_DE_VERIFICACION_INMUTABLE" });
        expect((await filaDeDominio(dueno, d.id)).estado).toBe("VERIFICADO");
      } finally {
        await propio.cerrar();
      }
    });

    it("el rechazo de la base no deja constancia ni clave: se puede reintentar con la misma clave", async () => {
      const { propio, casos } = conVistaVieja(() => ({ estado: "VERIFICADO" }));
      try {
        const d = await crearDominio(dueno, await crearMarca(dueno), {
          estado: "PENDIENTE_VERIFICACION",
        });
        const entrada = pedido(d.id, {});
        const antes = (await filas("select count(*)::int as n from idempotencia_plataforma"))[0];
        expect((await casos.activarDominio(comoAdmin(), entrada)).ok).toBe(false);
        expect((await filas("select count(*)::int as n from idempotencia_plataforma"))[0]).toEqual(
          antes,
        );
        expect(
          await filas("select 1 from auditoria_plataforma where entidad_id = $1", [d.id]),
        ).toEqual([]);
      } finally {
        await propio.cerrar();
      }
    });
  });

  // ===============================================================================================
  describe("el dominio puro y la base dicen lo mismo", () => {
    const FECHA = new Date("2026-10-11T11:00:00.000Z");
    const PEDIDOS: ReadonlyArray<
      readonly [PedidoDeCambioDeDominio, (id: string) => Promise<unknown>]
    > = [
      [
        { tipo: "VERIFICAR", verificadoEn: FECHA },
        (id) =>
          dueno.query(
            "update dominio set estado = 'VERIFICADO', verificado_en = $2 where id = $1",
            [id, FECHA],
          ),
      ],
      [
        { tipo: "ACTIVAR" },
        (id) => dueno.query("update dominio set estado = 'ACTIVO' where id = $1", [id]),
      ],
      [
        { tipo: "DESACTIVAR" },
        (id) =>
          dueno.query(
            "update dominio set estado = 'PENDIENTE_VERIFICACION', verificado_en = null where id = $1",
            [id],
          ),
      ],
      [
        { tipo: "RETIRAR", motivo: "baja" },
        (id) =>
          dueno.query("update dominio set estado = 'RETIRADO', motivo = 'baja' where id = $1", [
            id,
          ]),
      ],
    ];

    it("lo que el dominio puro decide cambiar la base lo acepta; lo que decide rechazar la base también lo rechaza", async () => {
      const vistos = new Set<string>();
      for (const estado of ESTADOS_DE_DOMINIO) {
        for (const esCanonico of [false, true]) {
          if (esCanonico && estado === "RETIRADO") continue; // la base no deja retirar un canónico
          for (const [pedido, aplicar] of PEDIDOS) {
            const marca = await crearMarca(dueno);
            const d = await crearDominio(dueno, marca, { estado, canonico: esCanonico });
            const decision = decidirCambioDeDominio(
              { estado, esCanonico },
              pedido,
              AHORA_DE_PRUEBA,
            );
            const etiqueta = `${estado}${esCanonico ? " canónico" : ""} + ${pedido.tipo}`;
            if (!decision.ok) {
              vistos.add(decision.error);
              await expect(aplicar(d.id), etiqueta).rejects.toThrow();
            } else if (decision.valor.tipo === "CAMBIA") {
              vistos.add("CAMBIA");
              await aplicar(d.id);
              expect((await filaDeDominio(dueno, d.id)).estado, etiqueta).toBe(
                decision.valor.cambio.estado,
              );
            } else {
              vistos.add("YA_ESTABA");
            }
          }
        }
      }
      // La tabla recorrió todas las clases de decisión.
      expect([...vistos].sort()).toEqual([
        "CAMBIA",
        "DOMINIO_CANONICO",
        "DOMINIO_RETIRADO",
        "DOMINIO_SIN_VERIFICAR",
        "YA_ESTABA",
      ]);
    });
  });

  // ===============================================================================================
  describe("el repositorio", () => {
    const sinEmpresa = () => comoEmpresa(randomUUID() as never, personaId(randomUUID()));

    it("obtener devuelve el dominio tal como está guardado (marca o empresa dueña) o null", async () => {
      const otra = await crearMarca(dueno);
      const mundo = await crearMundoDeMarca(dueno, { marca: otra });
      const deMarca = await crearDominio(dueno, otra, {
        canonico: true,
        superficie: "CARTA",
        titular: "CLIENTE",
      });
      const deEmpresa = await crearDominioDeEmpresa(dueno, mundo.empresa, { estado: "VERIFICADO" });
      const r = await entorno.ejecutar({ contexto: comoAdmin() }, async (tx) =>
        ok({
          marca: await tx.dominios.obtener(dominioId(deMarca.id)),
          empresa: await tx.dominios.obtener(dominioId(deEmpresa.id)),
          nada: await tx.dominios.obtener(dominioId(randomUUID())),
        }),
      );
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.nada).toBeNull();
      expect(r.valor.marca).toMatchObject({
        id: deMarca.id,
        host: deMarca.host,
        superficie: "CARTA",
        titular: "CLIENTE",
        duenio: { tipo: "MARCA", marcaId: otra },
        marcaId: otra,
        esCanonico: true,
        estado: "ACTIVO",
        motivo: null,
        version: 3,
      });
      expect(r.valor.marca?.verificadoEn).toBeInstanceOf(Date);
      expect(r.valor.empresa).toMatchObject({
        duenio: { tipo: "EMPRESA", empresaId: empresaId(mundo.empresa) },
        marcaId: marcaComercialId(otra),
        esCanonico: false,
        estado: "VERIFICADO",
      });
    });

    it("crear fija quién lo registró desde el contexto firmado (nadie lo elige), y la marca desde el dueño", async () => {
      const marca = await crearMarca(dueno);
      const host = hostAlAzar();
      const r = await entorno.ejecutar({ contexto: comoAdmin() }, async (tx) => {
        const alta = await tx.dominios.crear({
          host: host as never,
          superficie: "LANDING",
          titular: "OPERADOR",
          esCanonico: false,
          duenio: { tipo: "MARCA", marcaId: marcaComercialId(marca) },
        });
        return ok(alta);
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor).toMatchObject({
        host,
        estado: "PENDIENTE_VERIFICACION",
        verificadoEn: null,
        registradoPor: (await filaDeDominio(dueno, r.valor.id)).registrado_por,
        marcaId: marca,
        version: 1,
      });
      expect(r.valor.registradoPor).toMatch(/^aaaaaaaa-0000-4000-8000-000000000001$/);
    });

    it("cambiarEstado exige la versión que se leyó: con otra devuelve null y no toca nada", async () => {
      const d = await crearDominio(dueno, await crearMarca(dueno), { estado: "VERIFICADO" });
      const r = await entorno.ejecutar({ contexto: comoAdmin() }, async (tx) => {
        const obsoleta = await tx.dominios.cambiarEstado(dominioId(d.id), 99, { estado: "ACTIVO" });
        const inexistente = await tx.dominios.cambiarEstado(dominioId(randomUUID()), 1, {
          estado: "ACTIVO",
        });
        const buena = await tx.dominios.cambiarEstado(dominioId(d.id), 2, { estado: "ACTIVO" });
        return ok({ obsoleta, inexistente, buena });
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.obsoleta).toBeNull();
      expect(r.valor.inexistente).toBeNull();
      expect(r.valor.buena).toMatchObject({ estado: "ACTIVO", version: 3 });
    });

    it("cada cambio escribe solo lo suyo: verificar fija la fecha, desactivar la borra, retirar guarda el motivo, activar no toca nada más", async () => {
      const d = await crearDominio(dueno, await crearMarca(dueno), {
        estado: "PENDIENTE_VERIFICACION",
      });
      const fecha = new Date("2026-10-11T10:00:00.000Z");
      const r = await entorno.ejecutar({ contexto: comoAdmin() }, async (tx) => {
        const id = dominioId(d.id);
        const a = await tx.dominios.cambiarEstado(id, 1, {
          estado: "VERIFICADO",
          verificadoEn: fecha,
        });
        const b = await tx.dominios.cambiarEstado(id, 2, { estado: "ACTIVO" });
        const c = await tx.dominios.cambiarEstado(id, 3, { estado: "PENDIENTE_VERIFICACION" });
        const e = await tx.dominios.cambiarEstado(id, 4, { estado: "RETIRADO", motivo: "baja" });
        return ok([a, b, c, e]);
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.valor.map((x) => [x?.estado, x?.verificadoEn, x?.motivo])).toEqual([
        ["VERIFICADO", fecha, null],
        ["ACTIVO", fecha, null],
        ["PENDIENTE_VERIFICACION", null, null],
        ["RETIRADO", null, "baja"],
      ]);
    });

    it("SOPORTE ve los dominios pero no los escribe; la aplicación no los lee ni los escribe (AccesoDenegado)", async () => {
      const d = await crearDominio(dueno, await crearMarca(dueno), { estado: "VERIFICADO" });
      const soporte = await entorno.ejecutar({ contexto: comoSoporte() }, async (tx) =>
        ok(await tx.dominios.obtener(dominioId(d.id))),
      );
      expect(soporte.ok && soporte.valor?.id === d.id).toBe(true);
      const escribeSoporte = await entorno.ejecutar({ contexto: comoSoporte() }, async (tx) =>
        ok(await tx.dominios.cambiarEstado(dominioId(d.id), 2, { estado: "ACTIVO" })),
      );
      // Un UPDATE que ninguna fila deja tocar (RLS restrictiva) no falla: no encuentra la fila.
      expect(escribeSoporte.ok ? escribeSoporte.valor : "error").toBeNull();
      expect((await filaDeDominio(dueno, d.id)).estado).toBe("VERIFICADO");
      const altaSoporte = await entorno.ejecutar({ contexto: comoSoporte() }, async (tx) =>
        ok(
          await tx.dominios.crear({
            host: hostAlAzar() as never,
            superficie: "APP",
            titular: "OPERADOR",
            esCanonico: false,
            duenio: { tipo: "MARCA", marcaId: marcaComercialId(principal) },
          }),
        ),
      );
      expect(altaSoporte).toEqual(err({ tipo: "AccesoDenegado" }));
      const deLaApp = await entorno.ejecutar({ contexto: sinEmpresa() }, async (tx) =>
        ok(await tx.dominios.obtener(dominioId(d.id))),
      );
      expect(deLaApp).toEqual(err({ tipo: "AccesoDenegado" }));
    });
  });
});
