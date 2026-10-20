import { crearAdminsDePostgres, type AdminsDb } from "../adaptadores/postgres/admins";
import { crearAuditoriaDePostgres, type AuditoriaDb } from "../adaptadores/postgres/auditoria";
import {
  crearAuditoriaDePlataformaDePostgres,
  type AuditoriaDePlataformaDb,
} from "../adaptadores/postgres/auditoria-de-plataforma";
import {
  crearAutorizacionDePlataformaDePostgres,
  type AutorizacionDePlataformaDb,
} from "../adaptadores/postgres/autorizacion-de-plataforma";
import {
  PEDERNAL_CLAVE_CONTEXTO,
  leerClaveDeContexto,
} from "../adaptadores/postgres/contexto-firmado";
import { crearLecturaDeDerechosDeUso } from "../adaptadores/postgres/derechos-de-uso";
import {
  crearIdempotenciaDePostgres,
  type IdempotenciaDb,
} from "../adaptadores/postgres/idempotencia";
import {
  crearReferenciasDeErrorDePostgres,
  type ReferenciasDeErrorDb,
} from "../adaptadores/postgres/referencias-de-error";
import {
  crearLecturaDeSoporteDePostgres,
  type SoporteDb,
} from "../adaptadores/postgres/soporte-de-plataforma";
import { crearTrabajosDePostgres, type TrabajosDb } from "../adaptadores/postgres/trabajos";
import {
  crearTransacciones,
  type ConfiguracionDeTransacciones,
  type TransaccionesDePostgres,
} from "../adaptadores/postgres/transacciones";
import {
  PEDERNAL_SECRETO_INVITACIONES,
  crearTokensHmac,
  leerSecretoDeInvitaciones,
} from "../adaptadores/tokens/tokens-hmac";
import { CATALOGO_DE_MODULOS } from "../capacidades/modulos/catalogo";
import { REGLAS_DE_EMPRESA } from "../capacidades/permisos/empresa";
import { REGLAS_DE_PLATAFORMA } from "../capacidades/permisos/plataforma";
import { CATALOGO_DE_PERILLAS } from "../capacidades/planes/perillas";
import {
  crearRepositorioDeEmpresas,
  crearRepositorioDeSucursales,
  type EmpresasDb,
} from "../modulos/empresas/publico";
import {
  crearMembresiasParaPlataforma,
  crearRepositorioDeInvitaciones,
  crearRepositorioDePersonas,
  type IdentidadDb,
  type MembresiasParaPlataformaDb,
} from "../modulos/identidad/publico";
import {
  crearLecturaDeMarcaParaElAlta,
  crearRepositorioDeDominios,
  crearRepositorioDeMarcas,
  type DominiosDb,
  type LecturaParaElAltaDb,
  type MarcasDb,
} from "../modulos/marcas/publico";
import {
  crearAsignacionesDePlanDelAlta,
  crearLecturaDePlanes,
  crearLecturaDeVersionesDePlanParaElAlta,
  crearModulosDeEmpresaDelAlta,
  crearRepositorioDePlanes,
  type PlanesDb,
  type PlanesDePlataformaDb,
  type PlanesDelAltaDb,
} from "../modulos/planes/publico";
import { crearRepositorioDeTenants, type TenantsDb } from "../modulos/tenants/publico";
import { crearCasosDeUsoDeAltas } from "../plataforma/casos-de-uso/altas";
import type { TxDeAlta } from "../plataforma/casos-de-uso/alta-nucleo";
import type { TxDeCancelacionDeAlta } from "../plataforma/casos-de-uso/cancelar-alta";
import type { TxDeCicloDeVida } from "../plataforma/casos-de-uso/ciclo-de-vida";
import type { TxDeDominios } from "../plataforma/casos-de-uso/dominios-comun";
import { crearCasosDeUsoDeDominios } from "../plataforma/casos-de-uso/dominios";
import type { TxDeExplicar } from "../plataforma/casos-de-uso/explicar-por-que";
import type { TxDeReenvioDelAlta } from "../plataforma/casos-de-uso/invitacion-del-alta";
import { crearCasosDeUsoDeMarcasYPlanes } from "../plataforma/casos-de-uso/marcas-y-planes";
import type { TxDeMarcasYPlanes } from "../plataforma/casos-de-uso/marcas-y-planes-comun";
import type { TxDePersonas } from "../plataforma/casos-de-uso/personas";
import type { TxDeReferencias } from "../plataforma/casos-de-uso/registrar-referencia";
import type { TxDeRevocacionDelAlta } from "../plataforma/casos-de-uso/invitacion-del-alta";
import { crearCasosDeUsoDeSoporte } from "../plataforma/casos-de-uso/soporte";
import { crearConsultasDePlataforma } from "../plataforma/consultas/consultas";
import type { TxDeConsultasDePlataforma } from "../plataforma/consultas/contrato";
import type { TxDeConsultasDeMarcasYPlanes } from "../plataforma/consultas/contrato-de-marcas-y-planes";
import { crearConsultasDeMarcasYPlanes } from "../plataforma/consultas/consultas-de-marcas-y-planes";
import { ok } from "../primitivas/resultado/resultado";
import type { AdminEncontrado } from "../puertos/admins-de-plataforma";
import type { Tokens } from "../puertos/tokens";
import { registrandoFallosDeEntorno, entornoDelProceso, type FuenteDeEntorno } from "./entorno";
import { PEDERNAL_DB_PLATAFORMA, valoresDeLaPiezaDePlataforma } from "./entorno-de-plataforma";
import { contextoDePlataforma } from "./contextos";
import { perezoso } from "./perezoso";

/**
 * La puerta de PLATAFORMA (web-armazon-y-despliegue §6.2): la usan los scripts del dueño y, más adelante, la
 * consola `apps/plataforma/servidor` (proyecto de Vercel propio, todavía sin crear). Arma, a mano y perezoso como
 * `web.ts`, los casos de uso y las consultas de plataforma que ya existen, sobre las conexiones del rol
 * `pedernal_plataforma`. Importar este archivo o llamar a `armarPlataforma` no lee ni valida nada; cada pieza
 * se arma la primera vez que se la pide, y entonces valida SUS variables (`entorno-de-plataforma.ts`).
 *
 * SOLO la importan `scripts/`, las pruebas y la puerta de la consola (`puerta-de-consola.ts`) (regla de arquitectura
 * `plataforma-solo-desde-scripts`). Falla que previene: que `apps/web` (o cualquier parte de `src/`) pueda
 * obtener la credencial de plataforma, y con ella actuar como plataforma desde un error de la web (R10).
 *
 * Esta puerta corre los casos con el contexto que arma quien llama y NO exige el segundo factor reciente (h5-p8 §2.4 bis):
 * es la de los scripts del dueño (P7), que no tienen sesión web (el administrador se identifica por su email y el dueño
 * tiene la credencial), y por eso quedan FUERA de esa exigencia, a propósito. La consola `apps/plataforma` NO entra por
 * acá: entra por `puerta-de-consola.ts`, que arma el contexto desde la sesión y comprueba el segundo factor reciente de
 * cada acción marcada antes de correr el caso (regla `plataforma-solo-desde-scripts`: la consola no puede importar este archivo).
 *
 * Tres conexiones (cada una con su pool, de hasta 2 conexiones, que se abre recién al primer uso): los
 * repositorios de las altas, los de marcas y planes, y los de dominios y soporte. No se pueden juntar en una
 * sola transacción porque dos de ellas llaman `marcas` a cosas distintas (la lectura para el alta, y el
 * repositorio de marcas). Mismo armado que usan las pruebas de integración de cada caso.
 */

/** Lo que recibe el trabajo de una transacción de las altas: todo lo que piden sus casos de uso. */
export type TxDeAltasDePlataforma = TxDeAlta &
  TxDeCancelacionDeAlta &
  TxDeCicloDeVida &
  TxDePersonas &
  TxDeReenvioDelAlta &
  TxDeRevocacionDelAlta;

/** Lo que recibe el trabajo de una transacción de dominios y soporte. */
export type TxDeDominiosYSoporte = TxDeDominios &
  TxDeReferencias &
  TxDeExplicar &
  TxDeConsultasDePlataforma;

/**
 * Lo que recibe el trabajo de una transacción de marcas y planes: lo de sus casos de uso más lo que suman sus
 * consultas (`marcasParaElAlta` decide con la misma lectura de la marca y de las versiones de plan que el alta).
 */
export type TxDeMarcasYPlanesDePlataforma = TxDeMarcasYPlanes &
  Pick<TxDeConsultasDeMarcasYPlanes, "marcaParaElAlta" | "versionesDePlan">;

export type OpcionesDePlataforma = Readonly<{
  /** De dónde se leen las variables; por defecto, el entorno del proceso. Se evalúa en cada armado. */
  fuente?: () => FuenteDeEntorno;
  /** Registro del servidor: recibe el detalle (con NOMBRES, nunca valores) de un fallo de entorno. */
  registrar?: (detalle: string) => void;
  /** Los bytes de azar de las referencias de error; por defecto, los del sistema. */
  azar?: () => Uint8Array;
}>;

/** Conexiones por transacción que abre cada pool: un script hace una cosa por vez. */
const CONEXIONES_POR_POOL = 2;

export function armarPlataforma(opciones: OpcionesDePlataforma = {}) {
  const fuente = opciones.fuente ?? entornoDelProceso;
  const registrar = opciones.registrar ?? (() => undefined);
  const azar = opciones.azar ?? (() => crypto.getRandomValues(new Uint8Array(4)));

  /** Valida las variables de la pieza y arma; cualquier fallo de entorno se registra y falla cerrado. */
  const conexionesDePlataforma = perezoso(() =>
    registrandoFallosDeEntorno(registrar, () => {
      const valores = valoresDeLaPiezaDePlataforma(fuente(), "transacciones-de-plataforma");
      return {
        urls: { PLATAFORMA: valores[PEDERNAL_DB_PLATAFORMA] },
        clave: leerClaveDeContexto(valores[PEDERNAL_CLAVE_CONTEXTO]),
        maximoDeConexiones: CONEXIONES_POR_POOL,
      } as const;
    }),
  );

  const tokens = perezoso((): Tokens =>
    registrandoFallosDeEntorno(registrar, () =>
      crearTokensHmac(
        leerSecretoDeInvitaciones(
          valoresDeLaPiezaDePlataforma(fuente(), "tokens-de-plataforma")[
            PEDERNAL_SECRETO_INVITACIONES
          ],
        ),
      ),
    ),
  );

  /** Los pools que se llegaron a armar: `cerrar` solo toca esos (cerrar no puede exigir un entorno que nunca se usó). */
  const armadas: Array<Pick<TransaccionesDePostgres<unknown>, "cerrar">> = [];
  const transaccionesDe = <Tx>(armar: ConfiguracionDeTransacciones<Tx>["armar"]) =>
    perezoso(() => {
      const transacciones = crearTransacciones<Tx>({ ...conexionesDePlataforma(), armar });
      armadas.push(transacciones);
      return transacciones;
    });

  const transaccionesDeAltas = transaccionesDe<TxDeAltasDePlataforma>((db, contexto) => {
    const planes = crearLecturaDePlanes(db.withTables<PlanesDb>());
    return {
      autorizacionDePlataforma: crearAutorizacionDePlataformaDePostgres(
        db.withTables<AutorizacionDePlataformaDb>(),
      ),
      auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
        db.withTables<AuditoriaDePlataformaDb>(),
        contexto,
      ),
      idempotencia: crearIdempotenciaDePostgres(db.withTables<IdempotenciaDb>(), contexto),
      admins: crearAdminsDePostgres(db.withTables<AdminsDb>()),
      tenants: crearRepositorioDeTenants(db.withTables<TenantsDb>()),
      empresas: crearRepositorioDeEmpresas(db.withTables<EmpresasDb>()),
      sucursales: crearRepositorioDeSucursales(db.withTables<EmpresasDb>()),
      invitaciones: crearRepositorioDeInvitaciones(db.withTables<IdentidadDb>()),
      personas: crearRepositorioDePersonas(db.withTables<IdentidadDb>()),
      membresias: crearMembresiasParaPlataforma(db.withTables<MembresiasParaPlataformaDb>()),
      trabajos: crearTrabajosDePostgres(db.withTables<TrabajosDb>()),
      auditoria: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
      marcas: crearLecturaDeMarcaParaElAlta(db.withTables<LecturaParaElAltaDb>()),
      versionesDePlan: crearLecturaDeVersionesDePlanParaElAlta(db.withTables<PlanesDelAltaDb>()),
      asignacionesDePlan: crearAsignacionesDePlanDelAlta(db.withTables<PlanesDelAltaDb>()),
      modulosDeEmpresa: crearModulosDeEmpresaDelAlta(db.withTables<PlanesDelAltaDb>()),
      derechos: crearLecturaDeDerechosDeUso(planes, {
        catalogoDeModulos: CATALOGO_DE_MODULOS,
        catalogoDePerillas: CATALOGO_DE_PERILLAS,
      }),
    };
  });

  const transaccionesDeMarcasYPlanes = transaccionesDe<TxDeMarcasYPlanesDePlataforma>(
    (db, contexto) => ({
      marcaParaElAlta: crearLecturaDeMarcaParaElAlta(db.withTables<LecturaParaElAltaDb>()),
      versionesDePlan: crearLecturaDeVersionesDePlanParaElAlta(db.withTables<PlanesDelAltaDb>()),
      marcas: crearRepositorioDeMarcas(db.withTables<MarcasDb & DominiosDb>()),
      planes: crearRepositorioDePlanes(db.withTables<PlanesDePlataformaDb>()),
      derechos: crearLecturaDeDerechosDeUso(crearLecturaDePlanes(db.withTables<PlanesDb>()), {
        catalogoDeModulos: CATALOGO_DE_MODULOS,
        catalogoDePerillas: CATALOGO_DE_PERILLAS,
      }),
      auditoriaDeEmpresa: crearAuditoriaDePostgres(db.withTables<AuditoriaDb>()),
      autorizacionDePlataforma: crearAutorizacionDePlataformaDePostgres(
        db.withTables<AutorizacionDePlataformaDb>(),
      ),
      auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
        db.withTables<AuditoriaDePlataformaDb>(),
        contexto,
      ),
      idempotencia: crearIdempotenciaDePostgres(db.withTables<IdempotenciaDb>(), contexto),
    }),
  );

  const transaccionesDeDominiosYSoporte = transaccionesDe<TxDeDominiosYSoporte>((db, contexto) => ({
    dominios: crearRepositorioDeDominios(db.withTables<DominiosDb>()),
    soporte: crearLecturaDeSoporteDePostgres(db.withTables<SoporteDb>()),
    autorizacionDePlataforma: crearAutorizacionDePlataformaDePostgres(
      db.withTables<AutorizacionDePlataformaDb>(),
    ),
    auditoriaDePlataforma: crearAuditoriaDePlataformaDePostgres(
      db.withTables<AuditoriaDePlataformaDb>(),
      contexto,
    ),
    idempotencia: crearIdempotenciaDePostgres(db.withTables<IdempotenciaDb>(), contexto),
    referenciasDeError: crearReferenciasDeErrorDePostgres(db.withTables<ReferenciasDeErrorDb>()),
  }));

  const reglas = REGLAS_DE_PLATAFORMA;
  const catalogos = {
    catalogoDeModulos: CATALOGO_DE_MODULOS,
    catalogoDePerillas: CATALOGO_DE_PERILLAS,
  } as const;

  return {
    /**
     * El administrador con ese email (activo o no), o `null`. Lee con el actor `sistema`: todavía no se sabe
     * quién actúa, y las lecturas de plataforma exigen un actor vigente (`sistema` o un administrador activo).
     * Solo lectura; no deja constancia.
     */
    buscarAdmin: async (email: string, ahora: Date): Promise<AdminEncontrado | null> => {
      const contexto = contextoDePlataforma({
        actor: { tipo: "SISTEMA", proceso: "puerta-de-scripts" },
        ahora,
      });
      const r = await transaccionesDeAltas().ejecutar(
        { contexto, soloLectura: true, aislamiento: "read committed" },
        async (tx) => ok(await tx.admins.buscarPorEmail(email)),
      );
      if (!r.ok) throw new Error(`no se pudo buscar al administrador: ${r.error.tipo}`);
      return r.valor;
    },
    casosDeUsoDeAltas: perezoso(() =>
      crearCasosDeUsoDeAltas({
        altaDeEmpresa: {
          transacciones: transaccionesDeAltas(),
          reglas,
          tokens: tokens(),
          catalogoDeModulos: CATALOGO_DE_MODULOS,
        },
        cancelarAlta: { transacciones: transaccionesDeAltas(), reglas },
        cancelarAltasVencidas: { transacciones: transaccionesDeAltas() },
        reenviarInvitacionDelAlta: {
          transacciones: transaccionesDeAltas(),
          reglas,
          tokens: tokens(),
        },
        revocarInvitacionDelAlta: { transacciones: transaccionesDeAltas(), reglas },
        cicloDeVida: { transacciones: transaccionesDeAltas(), reglas },
        personas: { transacciones: transaccionesDeAltas(), reglas },
      }),
    ),
    casosDeUsoDeMarcasYPlanes: perezoso(() =>
      crearCasosDeUsoDeMarcasYPlanes({
        transacciones: transaccionesDeMarcasYPlanes(),
        reglas,
        ...catalogos,
      }),
    ),
    casosDeUsoDeDominios: perezoso(() =>
      crearCasosDeUsoDeDominios({ transacciones: transaccionesDeDominiosYSoporte(), reglas }),
    ),
    casosDeUsoDeSoporte: perezoso(() =>
      crearCasosDeUsoDeSoporte({
        explicar: {
          transacciones: transaccionesDeDominiosYSoporte(),
          reglas,
          reglasDeEmpresa: REGLAS_DE_EMPRESA,
        },
        referencias: { transacciones: transaccionesDeDominiosYSoporte(), azar },
      }),
    ),
    consultasDePlataforma: perezoso(() =>
      crearConsultasDePlataforma({
        transacciones: transaccionesDeDominiosYSoporte(),
        reglas,
        catalogoDeEmpresa: CATALOGO_DE_MODULOS,
        catalogoDePerillas: CATALOGO_DE_PERILLAS,
      }),
    ),
    consultasDeMarcasYPlanes: perezoso(() =>
      crearConsultasDeMarcasYPlanes({
        transacciones: transaccionesDeMarcasYPlanes(),
        reglas,
        ...catalogos,
      }),
    ),
    /** Cierra las conexiones que se hayan abierto (un script termina; el proceso no debe quedar colgado). */
    cerrar: async (): Promise<void> => {
      await Promise.all(armadas.splice(0).map((transacciones) => transacciones.cerrar()));
    },
  };
}

export type Plataforma = ReturnType<typeof armarPlataforma>;
