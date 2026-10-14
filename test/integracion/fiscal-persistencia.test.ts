import { Kysely, PostgresDialect } from "kysely";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { traducirErrorDeBase } from "../../src/adaptadores/postgres/errores";
import {
  COLUMNAS_DE_FISCAL,
  ERRORES_DE_FISCAL_POR_RESTRICCION,
  RESTRICCIONES_DE_DISPARADORES_DE_FISCAL,
  activarPuntoDeVenta,
  cerrarSerie,
  crearRepositorioDeDatosFiscales,
  crearRepositorioDeDomicilios,
  crearRepositorioDeEmisores,
  crearRepositorioDePuntosDeVenta,
  crearRepositorioDeReglasDeEmisor,
  crearRepositorioDeSeries,
  confirmarDatosFiscales,
  confirmarReglaDeEmisor,
  desactivarEmisor,
  domicilioId,
  editarBorrador,
  editarPuntoDeVenta,
  emisorId,
  errorFiscalDeRestriccion,
  OPCIONES_DE_NUMERACION,
  iniciarSerie,
  puntoDeVentaId,
  reconciliarSerie,
  reglaDeEmisorVigente,
  reservarNumero,
  solicitudId,
  traducirErroresDeFiscal,
  versionId,
  versionVigente,
  type Emisor,
  type ErrorDeFiscalPorRestriccion,
  type FiscalDb,
  type Serie,
} from "../../src/modulos/fiscal/publico";
import type { Contexto } from "../../src/contexto/contexto";
import type { ErrorDePersistencia } from "../../src/puertos/transacciones";
import type { Cuit } from "../../src/primitivas/identificacion-fiscal/cuit";
import {
  empresaId,
  personaId,
  sucursalId,
  tenantId,
} from "../../src/primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { cuitAlAzar } from "./entorno";
import {
  crearDomicilio,
  crearMundo,
  crearPuntoDeVenta,
  crearSerie,
  usarSerie,
  type Mundo,
} from "./fiscal-apoyo";
import {
  contextoDeApp,
  contextoDePlataforma,
  crearEntornoFiscal,
  elPrincipal,
  nuevoId,
  unBorrador,
  unDomicilio,
  unPuntoDeVenta,
  unPuntoDeVentaCrudo,
  type TxFiscalDePrueba,
} from "./fiscal-persistencia-apoyo";

/**
 * H7 (fiscal base), tramo T4: la persistencia fiscal contra una base real, con los roles reales y su
 * contexto firmado y pasando por el adaptador de transacciones (el mismo camino que usarán los casos
 * de uso). Qué prueba:
 *  1. Catálogo: las columnas y TODA restricción de la base tienen su traducción declarada, y los 21
 *     errores de los disparadores son exactamente los de la lista.
 *  2. Cada repositorio: lo que lee y escribe, la idempotencia (repetir con la misma clave devuelve el
 *     mismo éxito), el control de versión y el aislamiento entre empresas (también del mismo tenant)
 *     y entre roles.
 *  3. Los 21 errores de los disparadores, provocados de verdad y traducidos a su error de negocio:
 *     12 por el camino real de un repositorio y 9 que solo el dueño de la base puede provocar (la
 *     aplicación no tiene permiso o la RLS los esconde: son la última defensa).
 * La concurrencia está en `fiscal-persistencia-concurrencia.test.ts`.
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 60_000 });

const AHORA = new Date("2026-10-12T12:00:00Z");
const MAS_TARDE = new Date("2026-10-13T12:00:00Z");

/** Desarma un `Resultado` que tiene que ser un éxito. */
function exito<T, E>(r: Resultado<T, E>): T {
  if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
  return r.valor;
}

const cuitValido = (): Cuit => cuitAlAzar();

describe.skipIf(base === null)("fiscal T4: la persistencia contra una base real", () => {
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoFiscal>;

  beforeAll(async () => {
    if (base === null) return;
    dueno = new pg.Client({ connectionString: base.dueno });
    await dueno.connect();
    entorno = crearEntornoFiscal(base);
  });
  afterAll(async () => {
    await entorno.cerrar();
    await dueno.end();
  });

  const consultar = async <T extends Record<string, unknown>>(
    texto: string,
    parametros: unknown[] = [],
  ) => (await dueno.query<T>(texto, parametros)).rows;
  const mundo = (opciones: Parameters<typeof crearMundo>[1] = {}) => crearMundo(dueno, opciones);

  /** Corre el trabajo con ese contexto; un error de la base es un fallo del test. */
  async function correr<T>(
    contexto: Contexto,
    trabajo: (tx: TxFiscalDePrueba) => Promise<T>,
  ): Promise<T> {
    const r = await entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));
    if (!r.ok) throw new Error(`falló la transacción: ${JSON.stringify(r.error)}`);
    return r.valor;
  }
  /** Igual, pero devuelve el `Resultado` para ver el error de la base tal como llega a un caso de uso. */
  const intentar = <T>(contexto: Contexto, trabajo: (tx: TxFiscalDePrueba) => Promise<T>) =>
    entorno.ejecutar({ contexto }, async (tx) => ok(await trabajo(tx)));

  const app = (m: Mundo) => contextoDeApp(m);
  const plataforma = () => contextoDePlataforma();
  const empresaDe = (m: Mundo) => empresaId(m.empresa);

  /** Un emisor secundario de la empresa, creado como lo haría la plataforma. */
  const secundarioDe = (m: Mundo, cuit: Cuit = cuitValido()) =>
    correr(
      plataforma(),
      async (tx) => exito(await tx.emisores.crearSecundario(empresaDe(m), cuit)).valor,
    );

  // ===============================================================================================
  // 1. Catálogo
  // ===============================================================================================
  describe("catálogo", () => {
    it("las columnas de cada tabla coinciden con COLUMNAS_DE_FISCAL", async () => {
      for (const [tabla, esperadas] of Object.entries(COLUMNAS_DE_FISCAL)) {
        const reales = (
          await consultar<{ column_name: string }>(
            `select column_name from information_schema.columns
             where table_schema = 'public' and table_name = $1 order by ordinal_position`,
            [tabla],
          )
        ).map((c) => c.column_name);
        expect(reales, tabla).toEqual([...esperadas]);
      }
    });

    it("toda restricción de las tablas fiscales tiene su traducción declarada, y no sobra ninguna", async () => {
      const reales = await consultar<{ nombre: string }>(
        `select conname as nombre from pg_constraint
         where conrelid = any($1::text[]::regclass[]) and contype in ('p', 'u', 'c', 'f', 'x')
         union
         select indexname as nombre from pg_indexes
         where schemaname = 'public' and tablename = any($1)
           and indexdef like 'CREATE UNIQUE INDEX%' and indexname not like '%pkey' and indexname not like '%_key'`,
        [Object.keys(COLUMNAS_DE_FISCAL)],
      );
      const existentes = new Set(reales.map((r) => r.nombre));
      const declaradas = new Set(Object.keys(ERRORES_DE_FISCAL_POR_RESTRICCION));
      const disparadores = new Set<string>(RESTRICCIONES_DE_DISPARADORES_DE_FISCAL);
      expect([...existentes].filter((n) => !declaradas.has(n)).sort(), "sin traducción").toEqual(
        [],
      );
      expect(
        [...declaradas].filter((n) => !existentes.has(n) && !disparadores.has(n)).sort(),
        "traducciones de restricciones que no existen",
      ).toEqual([]);
    });

    it("los 35 errores con nombre de los disparadores son exactamente la lista, y ninguno queda sin traducir", async () => {
      const { rows } = await dueno.query<{ prosrc: string }>(
        `select prosrc from pg_proc
         where pronamespace = 'public'::regnamespace and prorettype = 'trigger'::regtype
           and proname ~ '^(empresa_(crear_emisor_principal|validar_cuit_fiscal)|emisor_|punto_de_venta_|datos_fiscales_|regla_emisor_|serie_comprobante_|comprobante_|certificado_arca_)'`,
      );
      const lanzados = new Set<string>();
      for (const f of rows) {
        for (const m of f.prosrc.matchAll(/CONSTRAINT = '([a-z_]+)'/g))
          lanzados.add(m[1] as string);
      }
      expect([...lanzados].sort()).toEqual([...RESTRICCIONES_DE_DISPARADORES_DE_FISCAL].sort());
      expect(lanzados.size).toBe(35);
      for (const nombre of lanzados) {
        const traduccion = (ERRORES_DE_FISCAL_POR_RESTRICCION as Record<string, string>)[nombre];
        expect(traduccion, nombre).toBeDefined();
        expect(traduccion, nombre).not.toBe("NO_TRADUCIDA");
      }
    });
  });

  // ===============================================================================================
  // 2. Emisores
  // ===============================================================================================
  describe("emisores", () => {
    it("el principal sale con el CUIT de la empresa (una sola fuente), activo, y es el único de una empresa nueva", async () => {
      const m = await mundo();
      const { principal, todos, porId } = await correr(app(m), async (tx) => {
        const principal = await elPrincipal(tx, m);
        return {
          principal,
          todos: await tx.emisores.listar(empresaDe(m)),
          porId: await tx.emisores.obtener(empresaDe(m), principal.id),
        };
      });
      expect(principal).toEqual({
        id: emisorId(m.emisor),
        empresaId: empresaDe(m),
        esPrincipal: true,
        cuit: m.cuit,
        activo: true,
        version: 1,
      });
      expect(todos).toEqual([principal]);
      expect(porId).toEqual(principal);
    });

    it("el CUIT del principal sigue a empresa.cuit: no hay copia que sincronizar", async () => {
      const m = await mundo();
      const nuevo = cuitValido();
      await dueno.query("update empresa set cuit = $2 where id = $1", [m.empresa, nuevo]);
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      expect(principal.cuit).toBe(nuevo);
      expect((await consultar("select cuit from emisor where id = $1", [m.emisor]))[0]).toEqual({
        cuit: null,
      });
    });

    it("la plataforma crea un secundario; repetir el alta con el mismo CUIT devuelve el mismo emisor (creado: false)", async () => {
      const m = await mundo();
      const cuit = cuitValido();
      const primero = await correr(plataforma(), async (tx) =>
        exito(await tx.emisores.crearSecundario(empresaDe(m), cuit)),
      );
      expect(primero.creado).toBe(true);
      expect(primero.valor).toMatchObject({
        empresaId: empresaDe(m),
        esPrincipal: false,
        cuit,
        activo: true,
        version: 1,
      });
      const segundo = await correr(plataforma(), async (tx) =>
        exito(await tx.emisores.crearSecundario(empresaDe(m), cuit)),
      );
      expect(segundo).toEqual({ creado: false, valor: primero.valor });
      expect(
        await consultar("select count(*)::int as n from emisor where empresa_id = $1", [m.empresa]),
      ).toEqual([{ n: 2 }]);
    });

    it("el CUIT de un secundario de OTRA empresa es CUIT_EN_USO (un resultado, no una excepción) y no revela de quién es", async () => {
      const a = await mundo();
      const b = await mundo();
      const cuit = cuitValido();
      await secundarioDe(a, cuit);
      const r = await correr(plataforma(), (tx) => tx.emisores.crearSecundario(empresaDe(b), cuit));
      expect(r).toEqual(err("CUIT_EN_USO"));
      expect(
        await consultar("select count(*)::int as n from emisor where empresa_id = $1", [b.empresa]),
      ).toEqual([{ n: 1 }]);
    });

    it("un CUIT que ya es el de una empresa viene del disparador de la base y se traduce a CUIT_EN_USO", async () => {
      const a = await mundo();
      const b = await mundo();
      const r = await intentar(plataforma(), (tx) =>
        tx.emisores.crearSecundario(empresaDe(a), b.cuit as Cuit),
      );
      expect(r.ok).toBe(false);
      expect(r).toEqual(err({ tipo: "Check", restriccion: "emisor_cuit_es_empresa" }));
      expect(traducirErroresDeFiscal(r, ["CUIT_EN_USO"])).toEqual(err("CUIT_EN_USO"));
    });

    it("el CUIT de una empresa CANCELADA se puede reutilizar como secundario", async () => {
      const a = await mundo();
      const cancelada = await mundo({ estado: "CANCELLED" });
      const r = await correr(plataforma(), (tx) =>
        tx.emisores.crearSecundario(empresaDe(a), cancelada.cuit as Cuit),
      );
      expect(exito(r).creado).toBe(true);
    });

    it("la lista pone primero al principal y la aplicación ve los dos emisores de su empresa", async () => {
      const m = await mundo();
      const secundario = await secundarioDe(m);
      const lista = await correr(app(m), (tx) => tx.emisores.listar(empresaDe(m)));
      expect(lista.map((e) => e.esPrincipal)).toEqual([true, false]);
      expect(lista[1]).toEqual(secundario);
    });

    it("guardar cambia el CUIT y el estado del secundario si la versión coincide; con la versión vieja devuelve null", async () => {
      const m = await mundo();
      const sec = await secundarioDe(m);
      const otro = cuitValido();
      const cambiado = await correr(plataforma(), async (tx) => {
        const d = exito(desactivarEmisor(sec, 0));
        return tx.emisores.guardar({ ...d.emisor, cuit: otro });
      });
      expect(cambiado).toMatchObject({ cuit: otro, activo: false, version: 2 });
      const viejo = await correr(plataforma(), (tx) =>
        tx.emisores.guardar({ ...sec, activo: true }),
      );
      expect(viejo).toBeNull();
      expect(
        (
          await consultar<{ activo: boolean }>("select activo from emisor where id = $1", [sec.id])
        )[0],
      ).toEqual({ activo: false });
    });

    it("el principal no se guarda por acá (su CUIT es el de la empresa)", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      await expect(correr(plataforma(), (tx) => tx.emisores.guardar(principal))).rejects.toThrow(
        /principal/,
      );
    });

    it("cuitsTomados (plataforma) devuelve los de emisores secundarios y empresas no canceladas, y no los de empresas canceladas", async () => {
      const a = await mundo();
      const cancelada = await mundo({ estado: "CANCELLED" });
      const sec = await secundarioDe(a);
      const libre = cuitValido();
      const tomados = await correr(plataforma(), (tx) =>
        tx.emisores.cuitsTomados([sec.cuit, a.cuit as Cuit, cancelada.cuit as Cuit, libre]),
      );
      expect([...tomados].sort()).toEqual([sec.cuit, a.cuit].sort());
      expect(await correr(plataforma(), (tx) => tx.emisores.cuitsTomados([]))).toEqual(new Set());
    });

    it("aislamiento: otra empresa (del mismo tenant) no ve los emisores ni con el id en la mano, y no puede escribir en los ajenos", async () => {
      const a = await mundo();
      const b = await mundo({ tenant: a.tenant });
      const sec = await secundarioDe(a);
      const desdeB = await correr(app(b), async (tx) => ({
        listaDeA: await tx.emisores.listar(empresaDe(a)),
        principalDeA: await tx.emisores.delPrincipal(empresaDe(a)),
        secundarioDeA: await tx.emisores.obtener(empresaDe(a), sec.id),
        secundarioPidiendoB: await tx.emisores.obtener(empresaDe(b), sec.id),
      }));
      expect(desdeB).toEqual({
        listaDeA: [],
        principalDeA: null,
        secundarioDeA: null,
        secundarioPidiendoB: null,
      });
      // Pidiendo con la empresa propia pero con el id de un emisor ajeno: tampoco.
      const desdeA = await correr(app(a), (tx) => tx.emisores.obtener(empresaDe(b), sec.id));
      expect(desdeA).toBeNull();
    });

    it("la aplicación no puede crear ni cambiar emisores: la base le niega el permiso", async () => {
      const m = await mundo();
      const r = await intentar(app(m), (tx) =>
        tx.emisores.crearSecundario(empresaDe(m), cuitValido()),
      );
      expect(r).toEqual(err({ tipo: "AccesoDenegado" }));
    });
  });

  // ===============================================================================================
  // 2. Domicilios
  // ===============================================================================================
  describe("domicilios", () => {
    it("se guardan y se leen; repetir el mismo id con el mismo contenido devuelve el mismo (creado: false)", async () => {
      const m = await mundo();
      const id = domicilioId(nuevoId());
      const d = unDomicilio({ piso: "5", departamento: "B", codigoPostal: null });
      const primero = await correr(app(m), async (tx) =>
        exito(await tx.domicilios.crear(empresaDe(m), id, d)),
      );
      expect(primero).toEqual({
        creado: true,
        valor: { id, empresaId: empresaDe(m), domicilio: d },
      });
      const segundo = await correr(app(m), async (tx) =>
        exito(await tx.domicilios.crear(empresaDe(m), id, d)),
      );
      expect(segundo).toEqual({ creado: false, valor: primero.valor });
      expect(await correr(app(m), (tx) => tx.domicilios.obtener(empresaDe(m), id))).toEqual(
        primero.valor,
      );
      expect(
        await consultar("select count(*)::int as n from domicilio where id = $1", [id]),
      ).toEqual([{ n: 1 }]);
    });

    it("el mismo id con OTRO contenido es ID_EN_USO: un domicilio no se edita", async () => {
      const m = await mundo();
      const id = domicilioId(nuevoId());
      await correr(app(m), (tx) => tx.domicilios.crear(empresaDe(m), id, unDomicilio()));
      const r = await correr(app(m), (tx) =>
        tx.domicilios.crear(empresaDe(m), id, unDomicilio({ calle: "Otra calle" })),
      );
      expect(r).toEqual(err("ID_EN_USO"));
      expect(
        (await consultar<{ calle: string }>("select calle from domicilio where id = $1", [id]))[0],
      ).toEqual({ calle: "Av. Corrientes" });
    });

    it("aislamiento: el id de un domicilio de otra empresa es ID_EN_USO, no se lee y no se puede escribir a nombre de otra empresa", async () => {
      const a = await mundo();
      const b = await mundo({ tenant: a.tenant });
      const id = domicilioId(nuevoId());
      await correr(app(a), (tx) => tx.domicilios.crear(empresaDe(a), id, unDomicilio()));
      expect(await correr(app(b), (tx) => tx.domicilios.obtener(empresaDe(a), id))).toBeNull();
      expect(await correr(app(b), (tx) => tx.domicilios.obtener(empresaDe(b), id))).toBeNull();
      expect(
        await correr(app(b), (tx) => tx.domicilios.crear(empresaDe(b), id, unDomicilio())),
      ).toEqual(err("ID_EN_USO"));
      // Escribir a nombre de la otra empresa: la política de la base lo niega.
      const ajeno = await intentar(app(b), (tx) =>
        tx.domicilios.crear(empresaDe(a), domicilioId(nuevoId()), unDomicilio()),
      );
      expect(ajeno).toEqual(err({ tipo: "AccesoDenegado" }));
    });

    it("lo que el dominio no dejaría pasar lo frena la base, con su error de negocio", async () => {
      const m = await mundo();
      const casos: [string, Parameters<typeof unDomicilio>[0], ErrorDeFiscalPorRestriccion][] = [
        ["calle con espacio al principio", { calle: " Av. Corrientes" }, "CALLE_INVALIDA"],
        ["número inválido", { numero: "12a" }, "NUMERO_INVALIDO"],
        ["piso de 21 caracteres", { piso: "p".repeat(21) }, "PISO_INVALIDO"],
        ["departamento con salto de línea", { departamento: "A\nB" }, "DEPARTAMENTO_INVALIDO"],
        ["localidad vacía", { localidad: "" }, "LOCALIDAD_INVALIDA"],
        [
          "provincia fuera del catálogo",
          { provincia: "ZZ-9" as ReturnType<typeof unDomicilio>["provincia"] },
          "PROVINCIA_INVALIDA",
        ],
        ["código postal en minúsculas", { codigoPostal: "s2000" }, "CODIGO_POSTAL_INVALIDO"],
      ];
      for (const [nombre, cambios, esperado] of casos) {
        const r = await intentar(app(m), (tx) =>
          tx.domicilios.crear(empresaDe(m), domicilioId(nuevoId()), unDomicilio(cambios)),
        );
        expect(r.ok, nombre).toBe(false);
        expect(traducirErroresDeFiscal(r, [esperado]), nombre).toEqual(err(esperado));
      }
    });
  });

  // ===============================================================================================
  // 2. Datos fiscales
  // ===============================================================================================
  describe("datos fiscales", () => {
    /** Un domicilio ya guardado de la empresa, para el domicilio fiscal. */
    const conDomicilio = async (m: Mundo) => {
      const id = domicilioId(nuevoId());
      await correr(app(m), (tx) => tx.domicilios.crear(empresaDe(m), id, unDomicilio()));
      return id;
    };
    /** Un borrador completo (con un domicilio fiscal ya guardado), listo para confirmar. */
    const borradorCompleto = async (m: Mundo, principal: Emisor) =>
      exito(
        editarBorrador(unBorrador(m, principal), {
          razonSocial: "Pozo y Asociados SA",
          condicionIva: "RESPONSABLE_INSCRIPTO",
          domicilioFiscalId: await conDomicilio(m),
          inicioActividades: "2020-01-01",
          iibbNumero: "901-123456-7",
          iibbCondicion: "CONVENIO_MULTILATERAL",
        }),
      );

    it("el borrador se crea con el id de la aplicación (repetir devuelve el mismo) y se lee por id y por emisor", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const b = unBorrador(m, principal);
      const primero = await correr(app(m), async (tx) =>
        exito(await tx.datosFiscales.crearBorrador(b)),
      );
      expect(primero).toEqual({ creado: true, valor: b });
      const segundo = await correr(app(m), async (tx) =>
        exito(await tx.datosFiscales.crearBorrador(b)),
      );
      expect(segundo).toEqual({ creado: false, valor: b });
      const leidos = await correr(app(m), async (tx) => ({
        porId: await tx.datosFiscales.obtener(empresaDe(m), b.id),
        delEmisor: await tx.datosFiscales.obtenerBorrador(empresaDe(m), principal.id),
        confirmadas: await tx.datosFiscales.confirmadas(empresaDe(m), principal.id),
      }));
      expect(leidos).toEqual({
        porId: { estado: "BORRADOR", borrador: b },
        delEmisor: b,
        confirmadas: [],
      });
    });

    it("un segundo borrador del mismo emisor con otro id es YA_HAY_BORRADOR", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      await correr(app(m), (tx) => tx.datosFiscales.crearBorrador(unBorrador(m, principal)));
      const r = await intentar(app(m), (tx) =>
        tx.datosFiscales.crearBorrador(unBorrador(m, principal)),
      );
      expect(traducirErroresDeFiscal(r, ["YA_HAY_BORRADOR"])).toEqual(err("YA_HAY_BORRADOR"));
    });

    it("guardar el borrador conserva la fecha civil tal cual, sin importar el huso horario del proceso", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const inicial = unBorrador(m, principal);
      await correr(app(m), (tx) => tx.datosFiscales.crearBorrador(inicial));
      const dom = await conDomicilio(m);
      const huso = process.env["TZ"];
      try {
        for (const zona of ["Pacific/Auckland", "America/Los_Angeles", "UTC"]) {
          process.env["TZ"] = zona;
          const editado = exito(
            editarBorrador(
              (await correr(app(m), (tx) =>
                tx.datosFiscales.obtenerBorrador(empresaDe(m), principal.id),
              ))!,
              { inicioActividades: "2020-01-01", domicilioFiscalId: dom },
            ),
          );
          const guardado = await correr(app(m), (tx) => tx.datosFiscales.guardarBorrador(editado));
          expect(guardado?.inicioActividades, zona).toBe("2020-01-01");
          const leido = await correr(app(m), (tx) =>
            tx.datosFiscales.obtenerBorrador(empresaDe(m), principal.id),
          );
          expect(leido?.inicioActividades, zona).toBe("2020-01-01");
        }
      } finally {
        if (huso === undefined) delete process.env["TZ"];
        else process.env["TZ"] = huso;
      }
    });

    it("guardarBorrador cambia el contenido y la versión; con una versión vieja o sobre un confirmado devuelve null", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const b = await borradorCompleto(m, principal);
      await correr(app(m), (tx) => tx.datosFiscales.crearBorrador(unBorrador(m, principal, b.id)));
      const guardado = await correr(app(m), (tx) => tx.datosFiscales.guardarBorrador(b));
      expect(guardado).toEqual({ ...b, version: 2 });
      // Con la versión vieja (otra transacción ya lo cambió): null, y no pisa nada.
      const viejo = await correr(app(m), (tx) =>
        tx.datosFiscales.guardarBorrador({ ...b, razonSocial: "Pisada SA" }),
      );
      expect(viejo).toBeNull();
      expect(
        (await correr(app(m), (tx) => tx.datosFiscales.obtenerBorrador(empresaDe(m), principal.id)))
          ?.razonSocial,
      ).toBe("Pozo y Asociados SA");
    });

    it("confirmar fija número, vigencia y autor; repetir devuelve null y la lectura muestra «ya estaba»; un confirmado no se edita", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const b = await borradorCompleto(m, principal);
      await correr(app(m), (tx) => tx.datosFiscales.crearBorrador(unBorrador(m, principal, b.id)));
      const guardado = (await correr(app(m), (tx) => tx.datosFiscales.guardarBorrador(b)))!;
      const confirmada = exito(
        confirmarDatosFiscales(guardado, [], {
          ahora: AHORA,
          vigenteDesde: MAS_TARDE,
          motivo: "Alta inicial",
          confirmadaPor: personaId(m.persona),
        }),
      );
      const resultado = await correr(app(m), (tx) => tx.datosFiscales.confirmar(confirmada));
      expect(resultado).toEqual({ ...confirmada, version: confirmada.version + 1 });
      // Repetir: la fila ya no es un borrador.
      expect(await correr(app(m), (tx) => tx.datosFiscales.confirmar(confirmada))).toBeNull();
      const despues = await correr(app(m), async (tx) => ({
        porId: await tx.datosFiscales.obtener(empresaDe(m), versionId(b.id)),
        confirmadas: await tx.datosFiscales.confirmadas(empresaDe(m), principal.id),
        borrador: await tx.datosFiscales.obtenerBorrador(empresaDe(m), principal.id),
        editar: await tx.datosFiscales.guardarBorrador({ ...guardado, razonSocial: "Otra SA" }),
      }));
      expect(despues.porId).toEqual({ estado: "CONFIRMADA", confirmada: resultado });
      expect(despues.confirmadas).toEqual([resultado]);
      expect(despues.borrador).toBeNull();
      expect(despues.editar).toBeNull();
      // Un id confirmado ya no es el de un borrador: crearlo de nuevo no es una repetición.
      expect(
        await correr(app(m), (tx) =>
          tx.datosFiscales.crearBorrador(unBorrador(m, principal, b.id)),
        ),
      ).toEqual(err("ID_EN_USO"));
    });

    it("las versiones se numeran 1, 2 y la vigente se calcula con el dominio sobre lo que devuelve el repositorio", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const confirmar = async (vigenteDesde: Date, razon: string) => {
        const existentes = await correr(app(m), (tx) =>
          tx.datosFiscales.confirmadas(empresaDe(m), principal.id),
        );
        const dom = await conDomicilio(m);
        const nuevo = unBorrador(m, principal);
        await correr(app(m), (tx) => tx.datosFiscales.crearBorrador(nuevo));
        const b = exito(
          editarBorrador(nuevo, {
            razonSocial: razon,
            condicionIva: "MONOTRIBUTO",
            domicilioFiscalId: dom,
            inicioActividades: "2021-05-04",
          }),
        );
        const guardado = (await correr(app(m), (tx) => tx.datosFiscales.guardarBorrador(b)))!;
        const c = exito(
          confirmarDatosFiscales(guardado, existentes, {
            ahora: AHORA,
            vigenteDesde,
            motivo: "cambio",
            confirmadaPor: personaId(m.persona),
          }),
        );
        return (await correr(app(m), (tx) => tx.datosFiscales.confirmar(c)))!;
      };
      const v1 = await confirmar(AHORA, "Primera SA");
      const v2 = await confirmar(MAS_TARDE, "Segunda SA");
      expect([v1.numero, v2.numero]).toEqual([1, 2]);
      const todas = await correr(app(m), (tx) =>
        tx.datosFiscales.confirmadas(empresaDe(m), principal.id),
      );
      expect(todas.map((v) => v.razonSocial)).toEqual(["Primera SA", "Segunda SA"]);
      expect(versionVigente(todas, AHORA)?.razonSocial).toBe("Primera SA");
      expect(versionVigente(todas, MAS_TARDE)?.razonSocial).toBe("Segunda SA");
    });

    it("quien confirma tiene que ser la persona del contexto: a nombre de otra la política de la base lo niega", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const b = await borradorCompleto(m, principal);
      await correr(app(m), (tx) => tx.datosFiscales.crearBorrador(unBorrador(m, principal, b.id)));
      const guardado = (await correr(app(m), (tx) => tx.datosFiscales.guardarBorrador(b)))!;
      const otraPersona = (
        await consultar<{ id: string }>("insert into persona (email) values ($1) returning id", [
          `${nuevoId().slice(0, 12)}@prueba.test`,
        ])
      )[0]!.id;
      const confirmada = exito(
        confirmarDatosFiscales(guardado, [], {
          ahora: AHORA,
          vigenteDesde: MAS_TARDE,
          motivo: "suplantación",
          confirmadaPor: personaId(otraPersona),
        }),
      );
      expect(await intentar(app(m), (tx) => tx.datosFiscales.confirmar(confirmada))).toEqual(
        err({ tipo: "AccesoDenegado" }),
      );
    });

    it("aislamiento: otra empresa (del mismo tenant) no ve ni toca los borradores ni las versiones", async () => {
      const a = await mundo();
      const b = await mundo({ tenant: a.tenant });
      const principalA = await correr(app(a), (tx) => elPrincipal(tx, a));
      const borrador = await borradorCompleto(a, principalA);
      await correr(app(a), (tx) =>
        tx.datosFiscales.crearBorrador(unBorrador(a, principalA, borrador.id)),
      );
      const guardado = (await correr(app(a), (tx) => tx.datosFiscales.guardarBorrador(borrador)))!;
      const desdeB = await correr(app(b), async (tx) => ({
        porId: await tx.datosFiscales.obtener(empresaDe(a), versionId(borrador.id)),
        propio: await tx.datosFiscales.obtener(empresaDe(b), versionId(borrador.id)),
        borrador: await tx.datosFiscales.obtenerBorrador(empresaDe(a), principalA.id),
        confirmadas: await tx.datosFiscales.confirmadas(empresaDe(a), principalA.id),
        // Con la identidad y la versión justas, pero desde otra empresa: no toca nada.
        guardar: await tx.datosFiscales.guardarBorrador({ ...guardado, razonSocial: "Ajena SA" }),
      }));
      expect(desdeB).toEqual({
        porId: null,
        propio: null,
        borrador: null,
        confirmadas: [],
        guardar: null,
      });
      expect(
        (
          await correr(app(a), (tx) =>
            tx.datosFiscales.obtenerBorrador(empresaDe(a), principalA.id),
          )
        )?.razonSocial,
      ).toBe("Pozo y Asociados SA");
    });
  });

  // ===============================================================================================
  // 2. Regla del emisor
  // ===============================================================================================
  describe("regla del emisor", () => {
    const nuevoBorradorDeRegla = (m: Mundo, permitir = true) => ({
      id: versionId(nuevoId()),
      empresaId: empresaDe(m),
      permitirEleccionManual: permitir,
      creadoPor: personaId(m.persona),
    });

    it("el borrador es idempotente por id, se edita con la versión y se confirma con el dominio", async () => {
      const m = await mundo();
      const b = nuevoBorradorDeRegla(m);
      const primero = await correr(app(m), async (tx) => exito(await tx.reglas.crearBorrador(b)));
      expect(primero).toEqual({ creado: true, valor: { ...b, version: 1 } });
      const segundo = await correr(app(m), async (tx) => exito(await tx.reglas.crearBorrador(b)));
      expect(segundo).toEqual({ creado: false, valor: { ...b, version: 1 } });

      const editado = await correr(app(m), (tx) =>
        tx.reglas.guardarBorrador({ ...primero.valor, permitirEleccionManual: false }),
      );
      expect(editado).toEqual({ ...b, permitirEleccionManual: false, version: 2 });
      expect(
        await correr(app(m), (tx) =>
          tx.reglas.guardarBorrador({ ...primero.valor, permitirEleccionManual: true }),
        ),
      ).toBeNull();

      const confirmada = exito(
        confirmarReglaDeEmisor({ permitirEleccionManual: false }, [], {
          id: b.id,
          empresaId: b.empresaId,
          confirmadaPor: personaId(m.persona),
          ahora: AHORA,
          vigenteDesde: AHORA,
          motivo: "solo el punto de venta",
        }),
      );
      const guardada = await correr(app(m), (tx) => tx.reglas.confirmar(confirmada, 2));
      expect(guardada).toEqual(confirmada);
      // Repetir: ya no es borrador.
      expect(await correr(app(m), (tx) => tx.reglas.confirmar(confirmada, 2))).toBeNull();
      const leido = await correr(app(m), async (tx) => ({
        porId: await tx.reglas.obtener(empresaDe(m), b.id),
        borrador: await tx.reglas.obtenerBorrador(empresaDe(m)),
        confirmadas: await tx.reglas.confirmadas(empresaDe(m)),
      }));
      expect(leido.porId).toEqual({ estado: "CONFIRMADA", confirmada });
      expect(leido.borrador).toBeNull();
      expect(leido.confirmadas).toEqual([confirmada]);
      expect(reglaDeEmisorVigente(leido.confirmadas, AHORA)).toEqual({
        permitirEleccionManual: false,
      });
    });

    it("sin versiones confirmadas rige la regla por defecto; un segundo borrador con otro id es YA_HAY_BORRADOR", async () => {
      const m = await mundo();
      expect(
        reglaDeEmisorVigente(
          await correr(app(m), (tx) => tx.reglas.confirmadas(empresaDe(m))),
          AHORA,
        ),
      ).toEqual({ permitirEleccionManual: true });
      await correr(app(m), (tx) => tx.reglas.crearBorrador(nuevoBorradorDeRegla(m)));
      const r = await intentar(app(m), (tx) => tx.reglas.crearBorrador(nuevoBorradorDeRegla(m)));
      expect(traducirErroresDeFiscal(r, ["YA_HAY_BORRADOR"])).toEqual(err("YA_HAY_BORRADOR"));
    });

    it("aislamiento: otra empresa no ve las reglas ni las confirma o edita", async () => {
      const a = await mundo();
      const b = await mundo({ tenant: a.tenant });
      const borrador = nuevoBorradorDeRegla(a);
      const creado = exito(await correr(app(a), (tx) => tx.reglas.crearBorrador(borrador)));
      const desdeB = await correr(app(b), async (tx) => ({
        porId: await tx.reglas.obtener(empresaDe(a), borrador.id),
        borrador: await tx.reglas.obtenerBorrador(empresaDe(a)),
        confirmadas: await tx.reglas.confirmadas(empresaDe(a)),
        guardar: await tx.reglas.guardarBorrador({
          ...creado.valor,
          permitirEleccionManual: false,
        }),
      }));
      expect(desdeB).toEqual({ porId: null, borrador: null, confirmadas: [], guardar: null });
      // El mismo id desde otra empresa: tomado.
      expect(
        await correr(app(b), (tx) =>
          tx.reglas.crearBorrador({ ...nuevoBorradorDeRegla(b), id: borrador.id }),
        ),
      ).toEqual(err("ID_EN_USO"));
    });
  });

  // ===============================================================================================
  // 2. Puntos de venta
  // ===============================================================================================
  describe("puntos de venta", () => {
    it("se crean INACTIVOS con el id de la aplicación (repetir devuelve el mismo) y se leen de todas las maneras", async () => {
      const m = await mundo();
      const sec = await secundarioDe(m);
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const pv1 = unPuntoDeVenta(m, principal, { numero: 1 });
      const pv2 = unPuntoDeVenta(m, sec, { numero: 1 }); // el mismo número en otro emisor: entra
      const pv3 = unPuntoDeVenta(m, principal, { numero: 2 });
      for (const pv of [pv1, pv2, pv3]) {
        expect(await correr(app(m), async (tx) => exito(await tx.puntosDeVenta.crear(pv)))).toEqual(
          {
            creado: true,
            valor: { ...pv, ambiente: "HOMOLOGACION" },
          },
        );
      }
      expect(await correr(app(m), async (tx) => exito(await tx.puntosDeVenta.crear(pv1)))).toEqual({
        creado: false,
        valor: { ...pv1, ambiente: "HOMOLOGACION" },
      });
      const leidos = await correr(app(m), async (tx) => ({
        uno: await tx.puntosDeVenta.obtener(empresaDe(m), pv1.id),
        delPrincipal: await tx.puntosDeVenta.listarDelEmisor(empresaDe(m), principal.id),
        delSecundario: await tx.puntosDeVenta.listarDelEmisor(empresaDe(m), sec.id),
        deLaSucursal: await tx.puntosDeVenta.listarDeLaSucursal(
          empresaDe(m),
          sucursalId(m.sucursal),
        ),
        todos: await tx.puntosDeVenta.listar(empresaDe(m)),
      }));
      // Desde 0009 el punto de venta trae su ambiente: nace en homologación.
      const enHomologacion = <T extends object>(pv: T) => ({ ...pv, ambiente: "HOMOLOGACION" });
      expect(leidos.uno).toEqual(enHomologacion(pv1));
      expect(leidos.delPrincipal).toEqual([pv1, pv3].map(enHomologacion));
      expect(leidos.delSecundario).toEqual([enHomologacion(pv2)]);
      expect(leidos.deLaSucursal).toHaveLength(3);
      expect(leidos.todos).toHaveLength(3);
      expect(leidos.uno).toMatchObject({
        estado: "INACTIVO",
        verificacionArca: "NO_VERIFICADO",
        version: 1,
      });
    });

    it("un punto de venta ACTIVO no se crea: nace INACTIVO", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const pv = { ...unPuntoDeVenta(m, principal), estado: "ACTIVO" as const };
      await expect(correr(app(m), (tx) => tx.puntosDeVenta.crear(pv))).rejects.toThrow(/INACTIVO/);
    });

    it("dos puntos de venta con el mismo número del mismo emisor: PUNTO_DE_VENTA_DUPLICADO; el mismo id repetido, en cambio, es un éxito", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      await correr(app(m), (tx) =>
        tx.puntosDeVenta.crear(unPuntoDeVenta(m, principal, { numero: 7 })),
      );
      const r = await intentar(app(m), (tx) =>
        tx.puntosDeVenta.crear(unPuntoDeVenta(m, principal, { numero: 7 })),
      );
      expect(r).toEqual(err({ tipo: "Unicidad", restriccion: "punto_de_venta_numero_uk" }));
      expect(traducirErroresDeFiscal(r, ["PUNTO_DE_VENTA_DUPLICADO"])).toEqual(
        err("PUNTO_DE_VENTA_DUPLICADO"),
      );
    });

    it("guardar aplica lo que calculó el dominio (editar, activar, desactivar) con control de versión", async () => {
      const m = await mundo();
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const dom = await correr(app(m), async (tx) => {
        const id = domicilioId(nuevoId());
        await tx.domicilios.crear(empresaDe(m), id, unDomicilio());
        return id;
      });
      const pv = unPuntoDeVenta(m, principal, { numero: 3 });
      await correr(app(m), (tx) => tx.puntosDeVenta.crear(pv));

      const editado = exito(
        editarPuntoDeVenta(
          pv,
          { numero: 4, domicilioId: dom },
          { tieneNumerosUsados: false, delEmisor: [pv] },
        ),
      ).puntoDeVenta;
      const guardado = (await correr(app(m), (tx) => tx.puntosDeVenta.guardar(editado)))!;
      expect(guardado).toEqual({ ...editado, ambiente: "HOMOLOGACION", version: 2 });

      const activo = exito(activarPuntoDeVenta(guardado, principal)).puntoDeVenta;
      const activado = (await correr(app(m), (tx) => tx.puntosDeVenta.guardar(activo)))!;
      expect(activado).toMatchObject({ estado: "ACTIVO", numero: 4, domicilioId: dom, version: 3 });

      // Versión vieja: null, sin pisar.
      expect(
        await correr(app(m), (tx) => tx.puntosDeVenta.guardar({ ...pv, numero: 9 })),
      ).toBeNull();
      expect(
        (await correr(app(m), (tx) => tx.puntosDeVenta.obtener(empresaDe(m), pv.id)))?.numero,
      ).toBe(4);
    });

    it("la base frena lo que el dominio decide antes: sin domicilio no se activa, la sucursal y el domicilio tienen que ser de la empresa", async () => {
      const m = await mundo();
      const otra = await mundo({ tenant: m.tenant });
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const pv = unPuntoDeVenta(m, principal);
      await correr(app(m), (tx) => tx.puntosDeVenta.crear(pv));
      // Sin domicilio.
      const sinDomicilio = await intentar(app(m), (tx) =>
        tx.puntosDeVenta.guardar({ ...pv, estado: "ACTIVO" }),
      );
      expect(traducirErroresDeFiscal(sinDomicilio, ["PUNTO_DE_VENTA_SIN_DOMICILIO"])).toEqual(
        err("PUNTO_DE_VENTA_SIN_DOMICILIO"),
      );
      // Sucursal de otra empresa (existe, pero no es de ésta).
      const deOtraSucursal = await intentar(app(m), (tx) =>
        tx.puntosDeVenta.crear(
          unPuntoDeVentaCrudo({
            empresa: m.empresa,
            emisor: principal.id,
            sucursal: otra.sucursal,
            numero: 8,
          }),
        ),
      );
      expect(traducirErroresDeFiscal(deOtraSucursal, ["SUCURSAL_DE_OTRA_EMPRESA"])).toEqual(
        err("SUCURSAL_DE_OTRA_EMPRESA"),
      );
      // Domicilio de otra empresa.
      const domAjeno = domicilioId(await crearDomicilio(dueno, otra.empresa));
      const conDomicilioAjeno = await intentar(app(m), (tx) =>
        tx.puntosDeVenta.crear(unPuntoDeVenta(m, principal, { numero: 9, domicilio: domAjeno })),
      );
      expect(traducirErroresDeFiscal(conDomicilioAjeno, ["DOMICILIO_NO_ENCONTRADO"])).toEqual(
        err("DOMICILIO_NO_ENCONTRADO"),
      );
      // Número fuera de rango.
      const fueraDeRango = await intentar(app(m), (tx) =>
        tx.puntosDeVenta.crear(
          unPuntoDeVentaCrudo({
            empresa: m.empresa,
            emisor: principal.id,
            sucursal: m.sucursal,
            numero: 100000,
          }),
        ),
      );
      expect(traducirErroresDeFiscal(fueraDeRango, ["PUNTO_DE_VENTA_NUMERO_INVALIDO"])).toEqual(
        err("PUNTO_DE_VENTA_NUMERO_INVALIDO"),
      );
    });

    it("aislamiento: otra empresa no ve los puntos de venta, no los cambia y no crea uno a nombre ajeno", async () => {
      const a = await mundo();
      const b = await mundo({ tenant: a.tenant });
      const principalA = await correr(app(a), (tx) => elPrincipal(tx, a));
      const pv = unPuntoDeVenta(a, principalA);
      await correr(app(a), (tx) => tx.puntosDeVenta.crear(pv));
      const desdeB = await correr(app(b), async (tx) => ({
        uno: await tx.puntosDeVenta.obtener(empresaDe(a), pv.id),
        lista: await tx.puntosDeVenta.listar(empresaDe(a)),
        delEmisor: await tx.puntosDeVenta.listarDelEmisor(empresaDe(a), principalA.id),
        guardar: await tx.puntosDeVenta.guardar({ ...pv, numero: 55 }),
        cuenta: await tx.puntosDeVenta.contarActivosDelEmisor(empresaDe(a), principalA.id),
      }));
      expect(desdeB).toEqual({ uno: null, lista: [], delEmisor: [], guardar: null, cuenta: 0 });
      // El mismo id: tomado. A nombre de la otra empresa: la política lo niega.
      expect(
        await correr(app(b), (tx) =>
          tx.puntosDeVenta.crear(
            unPuntoDeVentaCrudo({
              empresa: b.empresa,
              emisor: principalA.id,
              sucursal: b.sucursal,
              id: pv.id,
            }),
          ),
        ),
      ).toEqual(err("ID_EN_USO"));
      expect(
        await intentar(app(b), (tx) =>
          tx.puntosDeVenta.crear(
            unPuntoDeVentaCrudo({
              empresa: a.empresa,
              emisor: principalA.id,
              sucursal: a.sucursal,
              numero: 2,
            }),
          ),
        ),
      ).toEqual(err({ tipo: "AccesoDenegado" }));
    });

    it("la plataforma cuenta los activos del emisor con las 4 columnas que ve, pero no puede leer el punto de venta entero", async () => {
      const m = await mundo();
      const sec = await secundarioDe(m);
      await crearPuntoDeVenta(dueno, m, { emisor: sec.id, numero: 1, activo: true });
      await crearPuntoDeVenta(dueno, m, { emisor: sec.id, numero: 2 });
      await crearPuntoDeVenta(dueno, m, { numero: 1, activo: true });
      expect(
        await correr(plataforma(), (tx) =>
          tx.puntosDeVenta.contarActivosDelEmisor(empresaDe(m), sec.id),
        ),
      ).toBe(1);
      expect(
        await correr(app(m), (tx) => tx.puntosDeVenta.contarActivosDelEmisor(empresaDe(m), sec.id)),
      ).toBe(1);
      expect(await intentar(plataforma(), (tx) => tx.puntosDeVenta.listar(empresaDe(m)))).toEqual(
        err({ tipo: "AccesoDenegado" }),
      );
    });
  });

  // ===============================================================================================
  // 2. Series de comprobantes
  // ===============================================================================================
  describe("series", () => {
    const unaSerie = (
      m: Mundo,
      pv: { id: string },
      emisor: { id: string },
      ultimo = 0n,
      tipo: "FACTURA_B" | "FACTURA_A" = "FACTURA_B",
    ) =>
      exito(
        iniciarSerie(
          {
            empresaId: empresaDe(m),
            puntoDeVentaId: puntoDeVentaId(pv.id),
            emisorId: emisorId(emisor.id),
            tipo,
            ambiente: "HOMOLOGACION",
          },
          ultimo,
        ),
      );
    /** Un punto de venta con su emisor principal, listo para tener series. */
    const conPuntoDeVenta = async (m: Mundo) => {
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const pv = unPuntoDeVenta(m, principal);
      await correr(app(m), (tx) => tx.puntosDeVenta.crear(pv));
      return { principal, pv };
    };

    it("la serie nace con el último número del servicio; repetir devuelve la existente SIN pisar su último número", async () => {
      const m = await mundo();
      const { principal, pv } = await conPuntoDeVenta(m);
      const s = unaSerie(m, pv, principal, 41n);
      // La serie trae su ambiente (0009): nace en el de su punto de venta (homologación).
      const guardada = { ...s, version: 1 };
      expect(await correr(app(m), (tx) => tx.series.crear(s))).toEqual({
        creado: true,
        valor: guardada,
      });
      const repetida = await correr(app(m), (tx) =>
        tx.series.crear(unaSerie(m, pv, principal, 99n)),
      );
      expect(repetida).toEqual({ creado: false, valor: guardada });
      const leidas = await correr(app(m), async (tx) => ({
        una: await tx.series.obtener(empresaDe(m), pv.id, "FACTURA_B", "HOMOLOGACION"),
        otra: await tx.series.obtener(empresaDe(m), pv.id, "FACTURA_A", "HOMOLOGACION"),
        todas: await tx.series.delPuntoDeVenta(empresaDe(m), pv.id),
      }));
      expect(leidas.una).toEqual(guardada);
      expect(leidas.otra).toBeNull();
      expect(leidas.todas).toEqual([guardada]);
    });

    it("los números más grandes que Number.MAX_SAFE_INTEGER viajan exactos (bigint)", async () => {
      const m = await mundo();
      const { principal, pv } = await conPuntoDeVenta(m);
      const grande = 9_223_372_036_854_775_805n;
      const s = unaSerie(m, pv, principal, grande);
      await correr(app(m), (tx) => tx.series.crear(s));
      // El tope de la base es el del bigint (2^63 − 1), no el de ARCA (99 999 999) que fija el dominio.
      const tope = { ...OPCIONES_DE_NUMERACION, numeroMaximo: 9_223_372_036_854_775_807n };
      const reservada = exito(
        reservarNumero({ ...s, version: 1 }, solicitudId(nuevoId()), AHORA, tope),
      );
      expect(reservada.tipo).toBe("RESERVADA");
      if (reservada.tipo !== "RESERVADA") return;
      const guardada = (await correr(app(m), (tx) => tx.series.guardar(reservada.serie)))!;
      expect(guardada).toMatchObject({
        estado: "EN_CURSO",
        ultimoNumero: grande,
        numeroEnCurso: grande + 1n,
      });
      const cerrada = exito(
        cerrarSerie(
          guardada,
          guardada.estado === "EN_CURSO" ? guardada.solicitud : solicitudId("x"),
          "AUTORIZADO",
        ),
      );
      const final = (await correr(app(m), (tx) => tx.series.guardar(cerrada.serie)))!;
      expect(final).toMatchObject({ estado: "LIBRE", ultimoNumero: grande + 1n });
    });

    it("el ciclo completo con el dominio: reservar, incierto, reconciliar y cerrar, y la lectura devuelve exactamente lo guardado", async () => {
      const m = await mundo();
      const { principal, pv } = await conPuntoDeVenta(m);
      const inicial = (
        await correr(app(m), (tx) => tx.series.crear(unaSerie(m, pv, principal, 0n)))
      ).valor;
      const sol = solicitudId(nuevoId());
      const reserva = exito(reservarNumero(inicial, sol, AHORA));
      if (reserva.tipo !== "RESERVADA") throw new Error("tenía que reservar");
      const enCurso = (await correr(app(m), (tx) => tx.series.guardar(reserva.serie)))!;
      expect(enCurso).toEqual({ ...reserva.serie, ambiente: "HOMOLOGACION", version: 2 });
      expect(enCurso.estado === "EN_CURSO" && enCurso.enCursoHasta.getTime()).toBe(
        AHORA.getTime() + 5 * 60_000,
      );

      // Reconciliar una reserva vencida cuyo servicio no la autorizó: se libera sin avanzar.
      const vencido = new Date(AHORA.getTime() + 6 * 60_000);
      const liberada = exito(reconciliarSerie(enCurso, 0n, vencido));
      expect(liberada.resolucion).toBe("LIBERADA");
      const libre = (await correr(app(m), (tx) => tx.series.guardar(liberada.serie)))!;
      expect(libre).toMatchObject({ estado: "LIBRE", ultimoNumero: 0n, version: 3 });

      // Reservar de nuevo y cerrar como autorizada.
      const reserva2 = exito(reservarNumero(libre, solicitudId(nuevoId()), AHORA));
      if (reserva2.tipo !== "RESERVADA") throw new Error("tenía que reservar");
      const enCurso2 = (await correr(app(m), (tx) => tx.series.guardar(reserva2.serie)))!;
      const cierre = exito(cerrarSerie(enCurso2, reserva2.serie.solicitud, "AUTORIZADO"));
      const cerrada = (await correr(app(m), (tx) => tx.series.guardar(cierre.serie)))!;
      expect(cerrada).toMatchObject({ estado: "LIBRE", ultimoNumero: 1n, version: 5 });

      // Bloqueo por desfase: la base lo guarda con su motivo y no tiene salida.
      const reserva3 = exito(reservarNumero(cerrada, solicitudId(nuevoId()), AHORA));
      if (reserva3.tipo !== "RESERVADA") throw new Error("tenía que reservar");
      const enCurso3 = (await correr(app(m), (tx) => tx.series.guardar(reserva3.serie)))!;
      const bloqueo = exito(reconciliarSerie(enCurso3, 77n, vencido));
      expect(bloqueo.resolucion).toBe("BLOQUEADA");
      const bloqueada = (await correr(app(m), (tx) => tx.series.guardar(bloqueo.serie)))!;
      expect(bloqueada.estado).toBe("BLOQUEADA");
      expect(
        await correr(app(m), (tx) =>
          tx.series.obtener(empresaDe(m), pv.id, "FACTURA_B", "HOMOLOGACION"),
        ),
      ).toEqual(bloqueada);
      // Una BLOQUEADA sale solo hacia LIBRE (`resincronizarSerie`) y nunca hacia atrás. Hacia atrás es un
      // error de la base con su nombre.
      const salir = await intentar(app(m), (tx) =>
        tx.series.guardar({
          empresaId: bloqueada.empresaId,
          puntoDeVentaId: bloqueada.puntoDeVentaId,
          emisorId: bloqueada.emisorId,
          tipo: bloqueada.tipo,
          ambiente: bloqueada.ambiente,
          version: bloqueada.version,
          estado: "LIBRE",
          ultimoNumero: bloqueada.ultimoNumero - 1n,
        }),
      );
      expect(traducirErroresDeFiscal(salir, ["SERIE_NUMERO_FUERA_DE_SECUENCIA"])).toEqual(
        err("SERIE_NUMERO_FUERA_DE_SECUENCIA"),
      );
    });

    it("guardar con una versión vieja devuelve null y no pisa lo que guardó otra transacción", async () => {
      const m = await mundo();
      const { principal, pv } = await conPuntoDeVenta(m);
      const inicial = (await correr(app(m), (tx) => tx.series.crear(unaSerie(m, pv, principal))))
        .valor;
      const r1 = exito(reservarNumero(inicial, solicitudId(nuevoId()), AHORA));
      const r2 = exito(reservarNumero(inicial, solicitudId(nuevoId()), AHORA));
      if (r1.tipo !== "RESERVADA" || r2.tipo !== "RESERVADA") throw new Error("tenía que reservar");
      expect(await correr(app(m), (tx) => tx.series.guardar(r1.serie))).not.toBeNull();
      expect(await correr(app(m), (tx) => tx.series.guardar(r2.serie))).toBeNull();
      const guardada = await correr(app(m), (tx) =>
        tx.series.obtener(empresaDe(m), pv.id, "FACTURA_B", "HOMOLOGACION"),
      );
      expect(guardada?.estado === "EN_CURSO" && guardada.solicitud).toBe(r1.serie.solicitud);
    });

    it("hayNumerosUsadosDelEmisor / DelPuntoDeVenta: falso con la serie nueva, verdadero con un número, una reserva o un bloqueo", async () => {
      const m = await mundo();
      const sec = await secundarioDe(m);
      const casos = [
        { como: null, usada: false },
        { como: "NUMERO", usada: true },
        { como: "EN_CURSO", usada: true },
        { como: "BLOQUEADA", usada: true },
      ] as const;
      for (const [i, caso] of casos.entries()) {
        const pv = await crearPuntoDeVenta(dueno, m, { emisor: sec.id, numero: i + 1 });
        await crearSerie(dueno, m.empresa, pv, sec.id);
        if (caso.como !== null) await usarSerie(dueno, pv, caso.como);
        const r = await correr(plataforma(), async (tx) => ({
          delPv: await tx.series.hayNumerosUsadosDelPuntoDeVenta(empresaDe(m), puntoDeVentaId(pv)),
          delEmisor: await tx.series.hayNumerosUsadosDelEmisor(empresaDe(m), sec.id),
        }));
        expect(r.delPv, String(caso.como)).toBe(caso.usada);
        // Las de los casos anteriores ya quedaron usadas: el emisor acumula.
        expect(r.delEmisor, String(caso.como)).toBe(casos.slice(0, i + 1).some((c) => c.usada));
      }
      // El principal nunca usó una serie.
      expect(
        await correr(plataforma(), (tx) =>
          tx.series.hayNumerosUsadosDelEmisor(empresaDe(m), emisorId(m.emisor)),
        ),
      ).toBe(false);
    });

    it("una serie no mezcla emisor y punto de venta, y su tipo es uno de los nueve", async () => {
      const m = await mundo();
      const sec = await secundarioDe(m);
      const { pv } = await conPuntoDeVenta(m); // del principal
      const mezclada = await intentar(app(m), (tx) => tx.series.crear(unaSerie(m, pv, sec)));
      expect(traducirErroresDeFiscal(mezclada, ["PUNTO_DE_VENTA_NO_ENCONTRADO"])).toEqual(
        err("PUNTO_DE_VENTA_NO_ENCONTRADO"),
      );
      const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
      const raro = await intentar(app(m), (tx) =>
        tx.series.crear({
          ...unaSerie(m, pv, principal),
          tipo: "FACTURA_Z" as unknown as "FACTURA_A",
        }),
      );
      expect(traducirErroresDeFiscal(raro, ["TIPO_DE_COMPROBANTE_INVALIDO"])).toEqual(
        err("TIPO_DE_COMPROBANTE_INVALIDO"),
      );
    });

    it("aislamiento: otra empresa no ve las series, no las cambia, y no crea una a nombre ajeno", async () => {
      const a = await mundo();
      const b = await mundo({ tenant: a.tenant });
      const { principal, pv } = await conPuntoDeVenta(a);
      const serie = (await correr(app(a), (tx) => tx.series.crear(unaSerie(a, pv, principal, 5n))))
        .valor;
      const reserva = exito(reservarNumero(serie, solicitudId(nuevoId()), AHORA));
      if (reserva.tipo !== "RESERVADA") throw new Error("tenía que reservar");
      const desdeB = await correr(app(b), async (tx) => ({
        una: await tx.series.obtener(empresaDe(a), pv.id, "FACTURA_B", "HOMOLOGACION"),
        todas: await tx.series.delPuntoDeVenta(empresaDe(a), pv.id),
        usadas: await tx.series.hayNumerosUsadosDelEmisor(empresaDe(a), principal.id),
        guardar: await tx.series.guardar(reserva.serie),
      }));
      expect(desdeB).toEqual({ una: null, todas: [], usadas: false, guardar: null });
      expect(
        await intentar(app(b), (tx) =>
          tx.series.crear(unaSerie(a, pv, principal, 0n, "FACTURA_A")),
        ),
      ).toEqual(err({ tipo: "AccesoDenegado" }));
      expect(
        (
          await consultar<{ estado: string }>(
            "select estado from serie_comprobante where punto_de_venta_id = $1",
            [pv.id],
          )
        )[0],
      ).toEqual({ estado: "LIBRE" });
    });
  });

  // ===============================================================================================
  // 3. Los 24 errores de los disparadores de las tablas de 0006, provocados de verdad (los 11 de las tablas
  //    de la facturación, de 0009, los prueba `facturacion-persistencia.test.ts`)
  // ===============================================================================================
  describe("los 24 errores de los disparadores se traducen a su error de negocio", () => {
    type Caso = Readonly<{
      restriccion: (typeof RESTRICCIONES_DE_DISPARADORES_DE_FISCAL)[number];
      esperado: ErrorDeFiscalPorRestriccion;
      /** `repositorio`: por el camino real de un repositorio y el adaptador; `dueño`: solo el dueño de la base puede provocarlo. */
      via: "repositorio" | "dueño";
      provocar: () => Promise<ErrorDePersistencia>;
    }>;

    /** El error que el adaptador de transacciones devuelve ante el fallo de un repositorio. */
    const porRepositorio = async (
      contexto: Contexto,
      trabajo: (tx: TxFiscalDePrueba) => Promise<unknown>,
    ): Promise<ErrorDePersistencia> => {
      const r = await intentar(contexto, trabajo);
      if (r.ok) throw new Error("tenía que fallar y salió bien");
      return r.error;
    };
    /** El error de una sentencia del dueño, traducido por el mismo traductor del adaptador. */
    const porElDueno = async (
      texto: string,
      parametros: unknown[],
    ): Promise<ErrorDePersistencia> => {
      try {
        await dueno.query(texto, parametros);
      } catch (error) {
        const traducido = traducirErrorDeBase(error);
        if (traducido === null) throw error;
        return traducido;
      }
      throw new Error("tenía que fallar y salió bien");
    };

    /** Datos fiscales confirmados a mano (por el dueño), para probar su inmutabilidad. */
    const datosConfirmadosPorElDueno = async (m: Mundo) => {
      const dom = await crearDomicilio(dueno, m.empresa);
      const id = nuevoId();
      await dueno.query(
        `insert into datos_fiscales (id, empresa_id, emisor_id, razon_social, condicion_iva, domicilio_fiscal_id,
                                     inicio_actividades, creado_por)
         values ($1, $2, $3, 'Fija SA', 'EXENTO', $4, '2020-01-01', $5)`,
        [id, m.empresa, m.emisor, dom, m.persona],
      );
      await dueno.query(
        `update datos_fiscales set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), confirmada_en = now(),
                confirmada_por = $2, motivo = 'alta' where id = $1`,
        [id, m.persona],
      );
      return id;
    };
    const reglaConfirmadaPorElDueno = async (m: Mundo) => {
      const id = nuevoId();
      await dueno.query(
        "insert into regla_emisor (id, empresa_id, creado_por) values ($1, $2, $3)",
        [id, m.empresa, m.persona],
      );
      await dueno.query(
        `update regla_emisor set estado = 'CONFIRMADA', numero = 1, vigente_desde = now(), confirmada_en = now(),
                confirmada_por = $2, motivo = 'alta' where id = $1`,
        [id, m.persona],
      );
      return id;
    };

    const casos: readonly Caso[] = [
      {
        restriccion: "empresa_cuit_es_emisor",
        esperado: "CUIT_EN_USO",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const sec = await secundarioDe(m);
          const otra = await mundo();
          return porRepositorio(plataforma(), (tx) =>
            tx.empresas.crear({
              tenantId: tenantId(otra.tenant),
              cuit: sec.cuit,
              razonSocial: "Quiere el CUIT de un secundario",
            }),
          );
        },
      },
      {
        restriccion: "empresa_cuit_inmutable",
        esperado: "CUIT_INMUTABLE",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const pv = await crearPuntoDeVenta(dueno, m);
          await crearSerie(dueno, m.empresa, pv, m.emisor);
          await usarSerie(dueno, pv, "NUMERO");
          return porRepositorio(plataforma(), async (tx) => {
            const { sql } = await import("kysely");
            await sql`update empresa set cuit = ${cuitValido()} where id = ${m.empresa}`.execute(
              tx.db,
            );
          });
        },
      },
      {
        restriccion: "emisor_inmutable",
        esperado: "EMISOR_INMUTABLE",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          return porElDueno("update emisor set es_principal = false where id = $1", [m.emisor]);
        },
      },
      {
        restriccion: "emisor_empresa_no_operable",
        esperado: "EMPRESA_NO_OPERABLE",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo({ estado: "PROVISIONING" });
          return porRepositorio(plataforma(), (tx) =>
            tx.emisores.crearSecundario(empresaDe(m), cuitValido()),
          );
        },
      },
      {
        restriccion: "emisor_cuit_es_empresa",
        esperado: "CUIT_EN_USO",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const otra = await mundo();
          return porRepositorio(plataforma(), (tx) =>
            tx.emisores.crearSecundario(empresaDe(m), otra.cuit as Cuit),
          );
        },
      },
      {
        restriccion: "emisor_cuit_inmutable",
        esperado: "CUIT_INMUTABLE",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const sec = await secundarioDe(m);
          const pv = await crearPuntoDeVenta(dueno, m, { emisor: sec.id });
          await crearSerie(dueno, m.empresa, pv, sec.id);
          await usarSerie(dueno, pv, "NUMERO");
          return porRepositorio(plataforma(), (tx) =>
            tx.emisores.guardar({ ...sec, cuit: cuitValido() }),
          );
        },
      },
      {
        restriccion: "emisor_con_pv_activos",
        esperado: "EMISOR_CON_PUNTOS_DE_VENTA_ACTIVOS",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const sec = await secundarioDe(m);
          await crearPuntoDeVenta(dueno, m, { emisor: sec.id, activo: true });
          return porRepositorio(plataforma(), (tx) =>
            tx.emisores.guardar({ ...sec, activo: false }),
          );
        },
      },
      {
        restriccion: "punto_de_venta_inmutable",
        esperado: "PUNTO_DE_VENTA_EMISOR_INMUTABLE",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          const sec = await secundarioDe(m);
          const pv = await crearPuntoDeVenta(dueno, m);
          return porElDueno("update punto_de_venta set emisor_id = $2 where id = $1", [pv, sec.id]);
        },
      },
      {
        restriccion: "punto_de_venta_numero_inmutable",
        esperado: "PUNTO_DE_VENTA_NUMERO_INMUTABLE",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const pvId = await crearPuntoDeVenta(dueno, m, { numero: 1 });
          await crearSerie(dueno, m.empresa, pvId, m.emisor);
          await usarSerie(dueno, pvId, "NUMERO");
          const pv = (await correr(app(m), (tx) =>
            tx.puntosDeVenta.obtener(empresaDe(m), puntoDeVentaId(pvId)),
          ))!;
          return porRepositorio(app(m), (tx) => tx.puntosDeVenta.guardar({ ...pv, numero: 2 }));
        },
      },
      {
        restriccion: "punto_de_venta_emisor_inactivo",
        esperado: "EMISOR_INACTIVO",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const sec = await secundarioDe(m);
          const dom = await crearDomicilio(dueno, m.empresa);
          const pvId = await crearPuntoDeVenta(dueno, m, { emisor: sec.id, domicilio: dom });
          await correr(plataforma(), (tx) => tx.emisores.guardar({ ...sec, activo: false }));
          const pv = (await correr(app(m), (tx) =>
            tx.puntosDeVenta.obtener(empresaDe(m), puntoDeVentaId(pvId)),
          ))!;
          return porRepositorio(app(m), (tx) =>
            tx.puntosDeVenta.guardar({ ...pv, estado: "ACTIVO" }),
          );
        },
      },
      {
        restriccion: "datos_fiscales_transicion_invalida",
        esperado: "VERSION_TRANSICION_INVALIDA",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          return porElDueno(
            "insert into datos_fiscales (empresa_id, emisor_id, estado, creado_por) values ($1, $2, 'CONFIRMADA', $3)",
            [m.empresa, m.emisor, m.persona],
          );
        },
      },
      {
        restriccion: "datos_fiscales_inmutable",
        esperado: "VERSION_INMUTABLE",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          const sec = await secundarioDe(m);
          const id = nuevoId();
          await dueno.query(
            "insert into datos_fiscales (id, empresa_id, emisor_id, creado_por) values ($1, $2, $3, $4)",
            [id, m.empresa, m.emisor, m.persona],
          );
          return porElDueno("update datos_fiscales set emisor_id = $2 where id = $1", [id, sec.id]);
        },
      },
      {
        restriccion: "datos_fiscales_confirmada_inmutable",
        esperado: "VERSION_CONFIRMADA_INMUTABLE",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          const id = await datosConfirmadosPorElDueno(m);
          return porElDueno(
            "update datos_fiscales set razon_social = 'Cambiada SA' where id = $1",
            [id],
          );
        },
      },
      {
        restriccion: "datos_fiscales_numero_invalido",
        esperado: "NUMERO_DE_VERSION_INVALIDO",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const principal = await correr(app(m), (tx) => elPrincipal(tx, m));
          const dom = domicilioId(await crearDomicilio(dueno, m.empresa));
          const nuevo = unBorrador(m, principal);
          await correr(app(m), (tx) => tx.datosFiscales.crearBorrador(nuevo));
          const completo = exito(
            editarBorrador(nuevo, {
              razonSocial: "Número Mal SA",
              condicionIva: "EXENTO",
              domicilioFiscalId: dom,
              inicioActividades: "2020-01-01",
            }),
          );
          const guardado = (await correr(app(m), (tx) =>
            tx.datosFiscales.guardarBorrador(completo),
          ))!;
          const confirmada = exito(
            confirmarDatosFiscales(guardado, [], {
              ahora: AHORA,
              vigenteDesde: AHORA,
              motivo: "número equivocado",
              confirmadaPor: personaId(m.persona),
            }),
          );
          return porRepositorio(app(m), (tx) =>
            tx.datosFiscales.confirmar({ ...confirmada, numero: 5 }),
          );
        },
      },
      {
        restriccion: "regla_emisor_transicion_invalida",
        esperado: "VERSION_TRANSICION_INVALIDA",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          return porElDueno(
            "insert into regla_emisor (empresa_id, estado, creado_por) values ($1, 'CONFIRMADA', $2)",
            [m.empresa, m.persona],
          );
        },
      },
      {
        restriccion: "regla_emisor_inmutable",
        esperado: "VERSION_INMUTABLE",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          const otra = await mundo();
          const id = nuevoId();
          await dueno.query(
            "insert into regla_emisor (id, empresa_id, creado_por) values ($1, $2, $3)",
            [id, m.empresa, m.persona],
          );
          return porElDueno("update regla_emisor set creado_por = $2 where id = $1", [
            id,
            otra.persona,
          ]);
        },
      },
      {
        restriccion: "regla_emisor_confirmada_inmutable",
        esperado: "VERSION_CONFIRMADA_INMUTABLE",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          const id = await reglaConfirmadaPorElDueno(m);
          return porElDueno(
            "update regla_emisor set permitir_eleccion_manual = false where id = $1",
            [id],
          );
        },
      },
      {
        restriccion: "regla_emisor_numero_invalido",
        esperado: "NUMERO_DE_VERSION_INVALIDO",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const borrador = {
            id: versionId(nuevoId()),
            empresaId: empresaDe(m),
            permitirEleccionManual: true,
            creadoPor: personaId(m.persona),
          };
          await correr(app(m), (tx) => tx.reglas.crearBorrador(borrador));
          const confirmada = exito(
            confirmarReglaDeEmisor({ permitirEleccionManual: true }, [], {
              id: borrador.id,
              empresaId: borrador.empresaId,
              confirmadaPor: borrador.creadoPor,
              ahora: AHORA,
              vigenteDesde: AHORA,
              motivo: "número equivocado",
            }),
          );
          return porRepositorio(app(m), (tx) =>
            tx.reglas.confirmar({ ...confirmada, numero: 4 }, 1),
          );
        },
      },
      {
        restriccion: "serie_inmutable",
        esperado: "SERIE_INMUTABLE",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          const pv = await crearPuntoDeVenta(dueno, m);
          await crearSerie(dueno, m.empresa, pv, m.emisor);
          return porElDueno(
            "update serie_comprobante set tipo_comprobante = 'FACTURA_A' where punto_de_venta_id = $1",
            [pv],
          );
        },
      },
      {
        restriccion: "serie_numero_invalido",
        esperado: "SERIE_NUMERO_FUERA_DE_SECUENCIA",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const pv = await crearPuntoDeVenta(dueno, m);
          await crearSerie(dueno, m.empresa, pv, m.emisor);
          const serie = (await correr(app(m), (tx) =>
            tx.series.obtener(empresaDe(m), puntoDeVentaId(pv), "FACTURA_B", "HOMOLOGACION"),
          ))!;
          if (serie.estado !== "LIBRE") throw new Error("tenía que estar libre");
          // Saltear números: de 0 a 5 sin pasar por una reserva.
          return porRepositorio(app(m), (tx) => tx.series.guardar({ ...serie, ultimoNumero: 5n }));
        },
      },
      {
        restriccion: "serie_transicion_invalida",
        esperado: "SERIE_TRANSICION_INVALIDA",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const pv = await crearPuntoDeVenta(dueno, m);
          await crearSerie(dueno, m.empresa, pv, m.emisor);
          const serie = (await correr(app(m), (tx) =>
            tx.series.obtener(empresaDe(m), puntoDeVentaId(pv), "FACTURA_B", "HOMOLOGACION"),
          ))!;
          // LIBRE -> BLOQUEADA no existe: se pasa por EN_CURSO.
          const bloqueada: Serie = {
            empresaId: serie.empresaId,
            puntoDeVentaId: serie.puntoDeVentaId,
            emisorId: serie.emisorId,
            tipo: serie.tipo,
            ambiente: serie.ambiente,
            version: serie.version,
            estado: "BLOQUEADA",
            ultimoNumero: serie.ultimoNumero,
            motivoBloqueo: "salto de LIBRE a BLOQUEADA",
          };
          return porRepositorio(app(m), (tx) => tx.series.guardar(bloqueada));
        },
      },
      // 0009 (facturación): el ambiente del punto de venta (QF2) y de la serie. El punto de venta lo mueve
      // `cambiarAmbiente`; la serie de otro ambiente que el de su punto de venta no tiene camino por el
      // repositorio sin pedirlo (`crear(serie, ambiente)`), pero el dueño lo prueba igual.
      {
        restriccion: "punto_de_venta_ambiente_con_serie_en_curso",
        esperado: "SERIE_EN_CURSO",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const pv = await crearPuntoDeVenta(dueno, m);
          await crearSerie(dueno, m.empresa, pv, m.emisor);
          await usarSerie(dueno, pv, "EN_CURSO");
          return porRepositorio(app(m), async (tx) => {
            const actual = await tx.puntosDeVenta.obtener(empresaDe(m), puntoDeVentaId(pv));
            return tx.puntosDeVenta.cambiarAmbiente(
              empresaDe(m),
              puntoDeVentaId(pv),
              "PRODUCCION",
              actual?.version ?? 0,
            );
          });
        },
      },
      {
        restriccion: "punto_de_venta_ambiente_no_vuelve",
        esperado: "PUNTO_DE_VENTA_YA_EMITIO_EN_PRODUCCION",
        via: "repositorio",
        provocar: async () => {
          const m = await mundo();
          const pv = await crearPuntoDeVenta(dueno, m);
          await dueno.query("update punto_de_venta set ambiente = 'PRODUCCION' where id = $1", [
            pv,
          ]);
          await crearSerie(dueno, m.empresa, pv, m.emisor, "FACTURA_B", 7, "PRODUCCION");
          return porRepositorio(app(m), async (tx) => {
            const actual = await tx.puntosDeVenta.obtener(empresaDe(m), puntoDeVentaId(pv));
            return tx.puntosDeVenta.cambiarAmbiente(
              empresaDe(m),
              puntoDeVentaId(pv),
              "HOMOLOGACION",
              actual?.version ?? 0,
            );
          });
        },
      },
      {
        restriccion: "serie_ambiente_invalido",
        esperado: "SERIE_AMBIENTE_INVALIDO",
        via: "dueño",
        provocar: async () => {
          const m = await mundo();
          const pv = await crearPuntoDeVenta(dueno, m);
          return porElDueno(
            `insert into serie_comprobante (empresa_id, punto_de_venta_id, emisor_id, tipo_comprobante, ultimo_numero, ambiente)
             values ($1, $2, $3, 'FACTURA_B', 0, 'PRODUCCION')`,
            [m.empresa, pv, m.emisor],
          );
        },
      },
    ];

    it("los casos cubren exactamente los 24 nombres de las tablas de 0006, una vez cada uno (14 por repositorio, 10 solo del dueño); los otros 11 son de la facturación", () => {
      const deLaFacturacion = RESTRICCIONES_DE_DISPARADORES_DE_FISCAL.filter((n) =>
        /^(comprobante|certificado)_/.test(n),
      );
      expect(deLaFacturacion).toHaveLength(11);
      expect(casos.map((c) => c.restriccion).sort()).toEqual(
        RESTRICCIONES_DE_DISPARADORES_DE_FISCAL.filter((n) => !deLaFacturacion.includes(n)).sort(),
      );
      expect(casos).toHaveLength(24);
      expect(casos.filter((c) => c.via === "repositorio")).toHaveLength(14);
      expect(casos.filter((c) => c.via === "dueño")).toHaveLength(10);
    });

    for (const caso of casos) {
      it(`${caso.restriccion} → ${caso.esperado} (${caso.via})`, async () => {
        const e = await caso.provocar();
        // La base lanzó exactamente esa restricción (con el error de CHECK, 23514)...
        expect(e).toEqual({ tipo: "Check", restriccion: caso.restriccion });
        // ...el mapa la traduce a su error de negocio...
        expect(errorFiscalDeRestriccion(e)).toBe(caso.esperado);
        // ...y el caso de uso que la admite recibe un Resultado con nombre, nunca una excepción cruda.
        expect(traducirErroresDeFiscal(err(e), [caso.esperado])).toEqual(err(caso.esperado));
        // Un caso de uso que no la admite recibe el error de persistencia tipado, intacto.
        expect(traducirErroresDeFiscal(err(e), [])).toEqual(err(e));
      });
    }

    it("el resto de las restricciones tampoco se pierde: cada una cae en un error de negocio o en NO_TRADUCIDA explícito", () => {
      for (const [restriccion, codigo] of Object.entries(ERRORES_DE_FISCAL_POR_RESTRICCION)) {
        for (const tipo of ["Unicidad", "Referencia", "Check"] as const) {
          expect(errorFiscalDeRestriccion({ tipo, restriccion }), restriccion).toBe(
            codigo === "NO_TRADUCIDA" ? null : codigo,
          );
        }
      }
    });
  });

  // ===============================================================================================
  // 4. «No confíes en la RLS»: cada repositorio filtra por empresa por su cuenta
  // ===============================================================================================
  describe("sin RLS (el dueño de la base la evade), cada repositorio sigue filtrando por empresa", () => {
    let pool: pg.Pool;
    let sinRls: Kysely<FiscalDb>;

    beforeAll(() => {
      if (base === null) return;
      pool = new pg.Pool({ connectionString: base.dueno, max: 2 });
      sinRls = new Kysely<FiscalDb>({ dialect: new PostgresDialect({ pool }) });
    });
    afterAll(async () => {
      await sinRls.destroy();
    });

    it("lo que es de otra empresa no se lee ni se toca aunque se tenga el id, con el filtro como única defensa", async () => {
      const a = await mundo();
      const b = await mundo({ tenant: a.tenant });
      const principalA = await correr(app(a), (tx) => elPrincipal(tx, a));
      const sec = await secundarioDe(a);

      // Datos de A, armados con sus repositorios y el rol real.
      const dom = domicilioId(nuevoId());
      await correr(app(a), (tx) => tx.domicilios.crear(empresaDe(a), dom, unDomicilio()));
      const pv = unPuntoDeVenta(a, principalA, { domicilio: dom });
      await correr(app(a), (tx) => tx.puntosDeVenta.crear(pv));
      const serie = exito(
        iniciarSerie(
          {
            empresaId: empresaDe(a),
            puntoDeVentaId: pv.id,
            emisorId: principalA.id,
            tipo: "FACTURA_B",
            ambiente: "HOMOLOGACION",
          },
          3n,
        ),
      );
      await correr(app(a), (tx) => tx.series.crear(serie));
      const borrador = unBorrador(a, principalA);
      await correr(app(a), (tx) => tx.datosFiscales.crearBorrador(borrador));
      const regla = {
        id: versionId(nuevoId()),
        empresaId: empresaDe(a),
        permitirEleccionManual: true,
        creadoPor: personaId(a.persona),
      };
      await correr(app(a), (tx) => tx.reglas.crearBorrador(regla));

      // Los repositorios sobre una conexión SIN RLS, preguntando "como B".
      const emisores = crearRepositorioDeEmisores(sinRls);
      const domicilios = crearRepositorioDeDomicilios(sinRls);
      const datos = crearRepositorioDeDatosFiscales(sinRls);
      const reglas = crearRepositorioDeReglasDeEmisor(sinRls);
      const puntos = crearRepositorioDePuntosDeVenta(sinRls);
      const series = crearRepositorioDeSeries(sinRls);
      const eB = empresaDe(b);

      expect(await emisores.listar(eB)).toEqual([await emisores.delPrincipal(eB)].filter(Boolean));
      expect(await emisores.listar(empresaDe(a))).toHaveLength(2); // control: sin filtro de B, A sí está ahí
      expect(await emisores.obtener(eB, sec.id)).toBeNull();
      expect(await emisores.guardar({ ...sec, empresaId: eB, activo: false })).toBeNull();
      expect(await domicilios.obtener(eB, dom)).toBeNull();
      expect(await datos.obtener(eB, borrador.id)).toBeNull();
      expect(await datos.obtenerBorrador(eB, principalA.id)).toBeNull();
      expect(await datos.confirmadas(eB, principalA.id)).toEqual([]);
      expect(await datos.guardarBorrador({ ...borrador, empresaId: eB })).toBeNull();
      expect(await reglas.obtener(eB, regla.id)).toBeNull();
      expect(await reglas.obtenerBorrador(eB)).toBeNull();
      expect(await reglas.confirmadas(eB)).toEqual([]);
      expect(
        await reglas.guardarBorrador({
          ...regla,
          empresaId: eB,
          version: 1,
          permitirEleccionManual: false,
        }),
      ).toBeNull();
      expect(await puntos.obtener(eB, pv.id)).toBeNull();
      expect(await puntos.listar(eB)).toEqual([]);
      expect(await puntos.listarDelEmisor(eB, principalA.id)).toEqual([]);
      expect(await puntos.listarDeLaSucursal(eB, sucursalId(a.sucursal))).toEqual([]);
      expect(await puntos.guardar({ ...pv, empresaId: eB, numero: 77 })).toBeNull();
      expect(await puntos.contarActivosDelEmisor(eB, principalA.id)).toBe(0);
      expect(await series.obtener(eB, pv.id, "FACTURA_B", "HOMOLOGACION")).toBeNull();
      expect(await series.delPuntoDeVenta(eB, pv.id)).toEqual([]);
      expect(await series.guardar({ ...serie, empresaId: eB })).toBeNull();
      expect(await series.hayNumerosUsadosDelEmisor(eB, principalA.id)).toBe(false);
      expect(await series.hayNumerosUsadosDelPuntoDeVenta(eB, pv.id)).toBe(false);

      // Nada de A cambió.
      expect(
        (
          await consultar<{ activo: boolean }>("select activo from emisor where id = $1", [sec.id])
        )[0],
      ).toEqual({ activo: true });
      expect(
        (
          await consultar<{ numero: number }>("select numero from punto_de_venta where id = $1", [
            pv.id,
          ])
        )[0],
      ).toEqual({ numero: 1 });
    });
  });

  // ===============================================================================================
  // La plataforma y el CUIT: lo que arma el contexto de `corregirCuit`
  // ===============================================================================================
  it("un secundario sin números usados se puede desactivar con el dominio y el repositorio de punta a punta", async () => {
    const m = await mundo();
    const sec = await secundarioDe(m);
    const resultado = await correr(plataforma(), async (tx) => {
      const activos = await tx.puntosDeVenta.contarActivosDelEmisor(empresaDe(m), sec.id);
      const d = exito(desactivarEmisor(sec, activos));
      return tx.emisores.guardar(d.emisor);
    });
    expect(resultado).toMatchObject({ activo: false, version: 2 });
  });
});
