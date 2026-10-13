import { sql, type Kysely } from "kysely";
import type { Domicilio } from "../../../primitivas/domicilio/domicilio";
import { provinciaDesdeCodigo } from "../../../primitivas/domicilio/provincias";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import {
  empresaId,
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { TIPOS_DE_COMPROBANTE, type TipoDeComprobante } from "../dominio/comprobante-emitido";
import {
  esCondicionDeIibb,
  type CondicionIibb,
  type DatosFiscalesBorrador,
  type DatosFiscalesConfirmados,
} from "../dominio/datos-fiscales";
import { esCondicionDeIva, type CondicionIva, type Emisor } from "../dominio/emisor";
import {
  domicilioId,
  emisorId,
  puntoDeVentaId,
  solicitudId,
  versionId,
  type DomicilioId,
  type EmisorId,
  type PuntoDeVentaId,
  type VersionId,
} from "../dominio/identificadores";
import type { Serie, SerieLibre } from "../dominio/numeracion";
import type { EstadoDePuntoDeVenta, PuntoDeVenta } from "../dominio/punto-de-venta";
import type {
  ReglaDeEmisor,
  VersionGuardadaDeReglaDeEmisor,
} from "../dominio/resolucion-de-emisor";
import type { FiscalDb } from "./tablas";

/**
 * Repositorios fiscales (ADR-005, ADR-009). Cada método tiene una intención y devuelve tipos del
 * dominio. Reglas de este archivo:
 *
 *  - Todo filtra por empresa, aunque la RLS ya lo imponga: la base es la última defensa, no la
 *    primera. Las únicas excepciones son los métodos de PLATAFORMA (`cuitsTomados`, que mira toda la
 *    instalación a propósito) y la lectura del emisor por id sin empresa, que no existe.
 *  - Los cambios son `UPDATE ... WHERE version = <la que se leyó>` y devuelven la fila nueva, o
 *    `null` si no la tocaron (otra transacción cambió antes, o no es de la empresa): nada de
 *    `FOR UPDATE` ni de upserts. Cuando es `null`, el caso de uso vuelve a leer y decide (un «ya
 *    estaba» es éxito).
 *  - Las altas que traen un `id` de la aplicación son idempotentes: `INSERT ... ON CONFLICT (id) DO
 *    NOTHING`. Repetir devuelve la fila que ya existe con `creado: false`; es el caso de uso quien
 *    compara si lo repetido es lo mismo. Un `id` tomado por una fila que esta empresa no ve es
 *    `ID_EN_USO`. El conflicto es SOLO sobre el `id`: el resto de las únicas (número de punto de
 *    venta, borrador único) salen tal cual como error de la base.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones
 *    las traduce a `ErrorDePersistencia` (la traducción a errores de negocio está en `traducir.ts`).
 *  - La plataforma no tiene permiso sobre casi nada fiscal: ve `emisor`, `serie_comprobante` y 4
 *    columnas de `punto_de_venta`. Los métodos pensados para ella (los de emisores,
 *    `contarActivosDelEmisor` y `hayNumerosUsadosDelEmisor`) solo tocan eso.
 */

/** Un alta con `id` de la aplicación: `creado: false` es que ya existía (la repetición es un éxito). */
export type ResultadoDeAlta<T> = Readonly<{ creado: boolean; valor: T }>;

/** El `id` está tomado por algo que esta empresa no puede ver (o por otra clase de fila). */
export type ErrorDeAlta = "ID_EN_USO";

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
function exigir<T>(valor: T | null, nombre: string): T {
  if (valor === null) throw new RangeError(`${nombre} vacío en la base`);
  return valor;
}

function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

/**
 * Serializa dos altas con el MISMO `id` (`pg_advisory_xact_lock`, se libera al terminar la
 * transacción). `ON CONFLICT (id) DO NOTHING` solo absorbe el conflicto del `id`: dos altas
 * simultáneas de la misma fila chocan además en las OTRAS únicas que ella tiene (el par `(id,
 * empresa_id)`, el número del punto de venta, el borrador único del emisor) y la perdedora recibía
 * un error de unicidad en vez del «ya estaba», tanto bajo READ COMMITTED como bajo SERIALIZABLE
 * (se comprobó contra la base real). Con el bloqueo, la segunda espera a que la primera termine, ve
 * su fila y no hace nada (bajo SERIALIZABLE, además, el adaptador repite el trabajo si el motor
 * aborta con 40001).
 */
async function serializarAltaDeId(db: Kysely<FiscalDb>, tabla: string, id: string): Promise<void> {
  await sql`select pg_advisory_xact_lock(hashtextextended(${`zuluhub.fiscal.alta.${tabla}:${id}`}, 0))`.execute(
    db,
  );
}

// =================================================================================================
// Emisores
// =================================================================================================

type FilaDeEmisor = Readonly<{
  id: string;
  empresa_id: string;
  es_principal: boolean;
  activo: boolean;
  cuit: string;
  version: number;
}>;

function aEmisor(fila: FilaDeEmisor): Emisor {
  return {
    id: emisorId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    esPrincipal: fila.es_principal,
    cuit: fila.cuit as Cuit,
    activo: fila.activo,
    version: fila.version,
  };
}

export interface RepositorioDeEmisores {
  /** Un emisor de la empresa; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: EmisorId): Promise<Emisor | null>;
  /** El emisor principal (siempre existe: lo crea el disparador de la empresa, y el relleno de 0006). */
  delPrincipal(empresa: EmpresaId): Promise<Emisor | null>;
  /** Todos los emisores de la empresa: primero el principal, después los secundarios por antigüedad. */
  listar(empresa: EmpresaId): Promise<Emisor[]>;
  /**
   * SOLO PLATAFORMA. Crea un emisor secundario, activo, con su CUIT propio. Repetir el alta del
   * mismo CUIT en la misma empresa devuelve el emisor que ya existe (`creado: false`); un CUIT que
   * es de otra empresa o de otro emisor es `CUIT_EN_USO`. El `id` lo genera la base (la plataforma
   * no tiene permiso para elegirlo). Las demás reglas (empresa operable, CUIT que ya es de una
   * empresa) las impone la base y salen como error de la base.
   */
  crearSecundario(
    empresa: EmpresaId,
    cuit: Cuit,
  ): Promise<Resultado<ResultadoDeAlta<Emisor>, "CUIT_EN_USO">>;
  /**
   * SOLO PLATAFORMA. Guarda el CUIT y el estado de un emisor SECUNDARIO si la versión coincide.
   * El CUIT del principal es `empresa.cuit`: ese no se guarda acá (lanza `RangeError`).
   */
  guardar(emisor: Emisor): Promise<Emisor | null>;
  /**
   * SOLO PLATAFORMA (los demás ven solo lo propio). Cuáles de esos CUIT ya están tomados en la
   * instalación: el de todo emisor secundario y el de toda empresa no cancelada (la entrada de
   * `ContextoDeCuit.cuitsEnUso`).
   */
  cuitsTomados(candidatos: readonly Cuit[]): Promise<ReadonlySet<Cuit>>;
}

export function crearRepositorioDeEmisores(db: Kysely<FiscalDb>): RepositorioDeEmisores {
  // El CUIT del principal es el de la empresa: una sola fuente, sin copias (spec H7 §B.2).
  const seleccionar = () =>
    db
      .selectFrom("emisor")
      .innerJoin("empresa", "empresa.id", "emisor.empresa_id")
      .select([
        "emisor.id",
        "emisor.empresa_id",
        "emisor.es_principal",
        "emisor.activo",
        "emisor.version",
        sql<string>`coalesce(emisor.cuit, empresa.cuit)`.as("cuit"),
      ]);

  async function obtener(empresa: EmpresaId, id: EmisorId): Promise<Emisor | null> {
    const fila = await seleccionar()
      .where("emisor.empresa_id", "=", empresa)
      .where("emisor.id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aEmisor(fila);
  }

  return {
    obtener,

    async delPrincipal(empresa) {
      const fila = await seleccionar()
        .where("emisor.empresa_id", "=", empresa)
        .where("emisor.es_principal", "=", true)
        .executeTakeFirst();
      return fila === undefined ? null : aEmisor(fila);
    },

    async listar(empresa) {
      const filas = await seleccionar()
        .where("emisor.empresa_id", "=", empresa)
        .orderBy("emisor.es_principal", "desc")
        .orderBy("emisor.creado_en")
        .orderBy("emisor.id")
        .execute();
      return filas.map(aEmisor);
    },

    async crearSecundario(empresa, cuit) {
      const nuevo = await db
        .insertInto("emisor")
        .values({ empresa_id: empresa, es_principal: false, cuit })
        .onConflict((oc) => oc.doNothing())
        .returning("id")
        .executeTakeFirst();
      if (nuevo !== undefined) {
        const creado = await obtener(empresa, emisorId(nuevo.id));
        if (creado === null) throw new Error("el emisor recién creado no se pudo leer");
        return ok({ creado: true, valor: creado });
      }
      // No insertó: el CUIT ya es de un emisor. Si es de esta empresa, la repetición es un éxito.
      const existente = await seleccionar()
        .where("emisor.empresa_id", "=", empresa)
        .where("emisor.cuit", "=", cuit)
        .executeTakeFirst();
      return existente === undefined
        ? err("CUIT_EN_USO")
        : ok({ creado: false, valor: aEmisor(existente) });
    },

    async guardar(emisor) {
      if (emisor.esPrincipal) {
        throw new RangeError("el CUIT del emisor principal es el de la empresa: no se guarda acá");
      }
      const actualizado = await db
        .updateTable("emisor")
        .set({ cuit: emisor.cuit, activo: emisor.activo })
        .where("empresa_id", "=", emisor.empresaId)
        .where("id", "=", emisor.id)
        .where("version", "=", emisor.version)
        .returning("id")
        .executeTakeFirst();
      return actualizado === undefined ? null : obtener(emisor.empresaId, emisor.id);
    },

    async cuitsTomados(candidatos) {
      if (candidatos.length === 0) return new Set();
      const lista = [...candidatos];
      const deEmisores = await db
        .selectFrom("emisor")
        .select("cuit")
        .where("cuit", "in", lista)
        .execute();
      const deEmpresas = await db
        .selectFrom("empresa")
        .select("cuit")
        .where("cuit", "in", lista)
        .where("estado", "<>", "CANCELLED")
        .execute();
      return new Set([...deEmisores, ...deEmpresas].map((f) => f.cuit as Cuit));
    },
  };
}

// =================================================================================================
// Domicilios (solo inserción: cambiar un domicilio es crear otro)
// =================================================================================================

export type DomicilioGuardado = Readonly<{
  id: DomicilioId;
  empresaId: EmpresaId;
  domicilio: Domicilio;
}>;

function mismoDomicilio(a: Domicilio, b: Domicilio): boolean {
  return (
    a.calle === b.calle &&
    a.numero === b.numero &&
    a.piso === b.piso &&
    a.departamento === b.departamento &&
    a.localidad === b.localidad &&
    a.provincia === b.provincia &&
    a.codigoPostal === b.codigoPostal
  );
}

export interface RepositorioDeDomicilios {
  /**
   * Guarda un domicilio con el `id` que manda la aplicación. Repetir el mismo `id` con el MISMO
   * contenido devuelve el que ya existe (`creado: false`); el mismo `id` con otro contenido, o un
   * `id` de una fila que esta empresa no ve, es `ID_EN_USO` (un domicilio no se edita).
   */
  crear(
    empresa: EmpresaId,
    id: DomicilioId,
    domicilio: Domicilio,
  ): Promise<Resultado<ResultadoDeAlta<DomicilioGuardado>, ErrorDeAlta>>;
  obtener(empresa: EmpresaId, id: DomicilioId): Promise<DomicilioGuardado | null>;
}

export function crearRepositorioDeDomicilios(db: Kysely<FiscalDb>): RepositorioDeDomicilios {
  async function obtener(empresa: EmpresaId, id: DomicilioId): Promise<DomicilioGuardado | null> {
    const fila = await db
      .selectFrom("domicilio")
      .selectAll()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    if (fila === undefined) return null;
    const provincia = provinciaDesdeCodigo(fila.provincia);
    if (provincia === null)
      throw new RangeError(`provincia desconocida en la base: ${fila.provincia}`);
    return {
      id: domicilioId(fila.id),
      empresaId: empresaId(fila.empresa_id),
      domicilio: {
        calle: fila.calle,
        numero: fila.numero,
        piso: fila.piso,
        departamento: fila.departamento,
        localidad: fila.localidad,
        provincia: provincia.codigo,
        codigoPostal: fila.codigo_postal,
      },
    };
  }

  return {
    obtener,

    async crear(empresa, id, domicilio) {
      await serializarAltaDeId(db, "domicilio", id);
      const nuevo = await db
        .insertInto("domicilio")
        .values({
          id,
          empresa_id: empresa,
          calle: domicilio.calle,
          numero: domicilio.numero,
          piso: domicilio.piso,
          departamento: domicilio.departamento,
          localidad: domicilio.localidad,
          provincia: domicilio.provincia,
          codigo_postal: domicilio.codigoPostal,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(empresa, id);
      if (guardado === null) return err("ID_EN_USO");
      if (nuevo !== undefined) return ok({ creado: true, valor: guardado });
      return mismoDomicilio(guardado.domicilio, domicilio)
        ? ok({ creado: false, valor: guardado })
        : err("ID_EN_USO");
    },
  };
}

// =================================================================================================
// Datos fiscales (por emisor, versionados)
// =================================================================================================

/** Un borrador o una versión confirmada, tal como se lee por id. */
export type VersionDeDatosFiscales =
  | Readonly<{ estado: "BORRADOR"; borrador: DatosFiscalesBorrador }>
  | Readonly<{ estado: "CONFIRMADA"; confirmada: DatosFiscalesConfirmados }>;

// `inicio_actividades` es una fecha civil: se lee como texto `YYYY-MM-DD` y no como `Date` (que `pg`
// armaría a la medianoche local y correría un día).
const INICIO_DE_ACTIVIDADES = sql<string | null>`to_char(inicio_actividades, 'YYYY-MM-DD')`.as(
  "inicio_actividades",
);

const COLUMNAS_DE_DATOS_FISCALES = [
  "id",
  "empresa_id",
  "emisor_id",
  "estado",
  "numero",
  "razon_social",
  "condicion_iva",
  "domicilio_fiscal_id",
  INICIO_DE_ACTIVIDADES,
  "iibb_numero",
  "iibb_condicion",
  "vigente_desde",
  "confirmada_en",
  "confirmada_por",
  "motivo",
  "creado_por",
  "version",
] as const;

type FilaDeDatosFiscales = Readonly<{
  id: string;
  empresa_id: string;
  emisor_id: string;
  estado: string;
  numero: number | null;
  razon_social: string | null;
  condicion_iva: string | null;
  domicilio_fiscal_id: string | null;
  inicio_actividades: string | null;
  iibb_numero: string | null;
  iibb_condicion: string | null;
  vigente_desde: Date | null;
  confirmada_en: Date | null;
  confirmada_por: string | null;
  motivo: string | null;
  creado_por: string;
  version: number;
}>;

function condicionDeIva(texto: string | null): CondicionIva | null {
  if (texto === null) return null;
  if (!esCondicionDeIva(texto))
    throw new RangeError(`condición de IVA desconocida en la base: ${texto}`);
  return texto;
}

function condicionDeIibb(texto: string | null): CondicionIibb | null {
  if (texto === null) return null;
  if (!esCondicionDeIibb(texto))
    throw new RangeError(`condición de IIBB desconocida en la base: ${texto}`);
  return texto;
}

function aBorrador(fila: FilaDeDatosFiscales): DatosFiscalesBorrador {
  return {
    id: versionId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    emisorId: emisorId(fila.emisor_id),
    razonSocial: fila.razon_social,
    condicionIva: condicionDeIva(fila.condicion_iva),
    domicilioFiscalId:
      fila.domicilio_fiscal_id === null ? null : domicilioId(fila.domicilio_fiscal_id),
    inicioActividades: fila.inicio_actividades,
    iibbNumero: fila.iibb_numero,
    iibbCondicion: condicionDeIibb(fila.iibb_condicion),
    creadoPor: personaId(fila.creado_por),
    version: fila.version,
  };
}

function aConfirmada(fila: FilaDeDatosFiscales): DatosFiscalesConfirmados {
  return {
    id: versionId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    emisorId: emisorId(fila.emisor_id),
    numero: exigir(fila.numero, "numero"),
    razonSocial: exigir(fila.razon_social, "razon_social"),
    condicionIva: exigir(condicionDeIva(fila.condicion_iva), "condicion_iva"),
    domicilioFiscalId: domicilioId(exigir(fila.domicilio_fiscal_id, "domicilio_fiscal_id")),
    inicioActividades: exigir(fila.inicio_actividades, "inicio_actividades"),
    iibbNumero: fila.iibb_numero,
    iibbCondicion: condicionDeIibb(fila.iibb_condicion),
    vigenteDesde: exigir(fila.vigente_desde, "vigente_desde"),
    confirmadaEn: exigir(fila.confirmada_en, "confirmada_en"),
    confirmadaPor: personaId(exigir(fila.confirmada_por, "confirmada_por")),
    motivo: exigir(fila.motivo, "motivo"),
    version: fila.version,
  };
}

function aVersionDeDatos(fila: FilaDeDatosFiscales): VersionDeDatosFiscales {
  return fila.estado === "CONFIRMADA"
    ? { estado: "CONFIRMADA", confirmada: aConfirmada(fila) }
    : { estado: "BORRADOR", borrador: aBorrador(fila) };
}

export interface RepositorioDeDatosFiscales {
  /** Un borrador o una versión confirmada; `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: VersionId): Promise<VersionDeDatosFiscales | null>;
  /** El borrador del emisor (hay a lo sumo uno). */
  obtenerBorrador(empresa: EmpresaId, emisor: EmisorId): Promise<DatosFiscalesBorrador | null>;
  /** Las versiones confirmadas del emisor, por número creciente. */
  confirmadas(empresa: EmpresaId, emisor: EmisorId): Promise<DatosFiscalesConfirmados[]>;
  /**
   * Crea el borrador con el `id` de la aplicación (idempotente). Un segundo borrador del mismo
   * emisor con otro `id` sale como error de la base (`datos_fiscales_borrador_uk`).
   */
  crearBorrador(
    borrador: DatosFiscalesBorrador,
  ): Promise<Resultado<ResultadoDeAlta<DatosFiscalesBorrador>, ErrorDeAlta>>;
  /** Guarda el contenido de un borrador si la versión coincide y sigue en borrador; si no, `null`. */
  guardarBorrador(borrador: DatosFiscalesBorrador): Promise<DatosFiscalesBorrador | null>;
  /**
   * `BORRADOR` → `CONFIRMADA` con lo que fijó el dominio (`confirmarDatosFiscales`), si la versión
   * coincide con la del borrador leído y sigue en borrador; si no, `null` (otra transacción ya lo
   * confirmó o lo cambió: el caso de uso vuelve a leer, y un «ya estaba» es éxito).
   */
  confirmar(confirmada: DatosFiscalesConfirmados): Promise<DatosFiscalesConfirmados | null>;
}

export function crearRepositorioDeDatosFiscales(db: Kysely<FiscalDb>): RepositorioDeDatosFiscales {
  const seleccionar = () => db.selectFrom("datos_fiscales").select(COLUMNAS_DE_DATOS_FISCALES);

  async function obtener(
    empresa: EmpresaId,
    id: VersionId,
  ): Promise<VersionDeDatosFiscales | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aVersionDeDatos(fila);
  }

  return {
    obtener,

    async obtenerBorrador(empresa, emisor) {
      const fila = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("estado", "=", "BORRADOR")
        .executeTakeFirst();
      return fila === undefined ? null : aBorrador(fila);
    },

    async confirmadas(empresa, emisor) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("estado", "=", "CONFIRMADA")
        .orderBy("numero")
        .execute();
      return filas.map(aConfirmada);
    },

    async crearBorrador(borrador) {
      await serializarAltaDeId(db, "datos_fiscales", borrador.id);
      const nuevo = await db
        .insertInto("datos_fiscales")
        .values({
          id: borrador.id,
          empresa_id: borrador.empresaId,
          emisor_id: borrador.emisorId,
          razon_social: borrador.razonSocial,
          condicion_iva: borrador.condicionIva,
          domicilio_fiscal_id: borrador.domicilioFiscalId,
          inicio_actividades: borrador.inicioActividades,
          iibb_numero: borrador.iibbNumero,
          iibb_condicion: borrador.iibbCondicion,
          creado_por: borrador.creadoPor,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(borrador.empresaId, borrador.id);
      if (guardado === null) return err("ID_EN_USO");
      // El `id` de una versión CONFIRMADA ya no es de un borrador: no es una repetición.
      if (guardado.estado !== "BORRADOR") return err("ID_EN_USO");
      return ok({ creado: nuevo !== undefined, valor: guardado.borrador });
    },

    async guardarBorrador(borrador) {
      const actualizado = await db
        .updateTable("datos_fiscales")
        .set({
          razon_social: borrador.razonSocial,
          condicion_iva: borrador.condicionIva,
          domicilio_fiscal_id: borrador.domicilioFiscalId,
          inicio_actividades: borrador.inicioActividades,
          iibb_numero: borrador.iibbNumero,
          iibb_condicion: borrador.iibbCondicion,
        })
        .where("empresa_id", "=", borrador.empresaId)
        .where("id", "=", borrador.id)
        .where("estado", "=", "BORRADOR")
        .where("version", "=", borrador.version)
        .returning(COLUMNAS_DE_DATOS_FISCALES)
        .executeTakeFirst();
      return actualizado === undefined ? null : aBorrador(actualizado);
    },

    async confirmar(confirmada) {
      const actualizado = await db
        .updateTable("datos_fiscales")
        .set({
          estado: "CONFIRMADA",
          numero: confirmada.numero,
          razon_social: confirmada.razonSocial,
          condicion_iva: confirmada.condicionIva,
          domicilio_fiscal_id: confirmada.domicilioFiscalId,
          inicio_actividades: confirmada.inicioActividades,
          iibb_numero: confirmada.iibbNumero,
          iibb_condicion: confirmada.iibbCondicion,
          vigente_desde: confirmada.vigenteDesde,
          confirmada_en: confirmada.confirmadaEn,
          confirmada_por: confirmada.confirmadaPor,
          motivo: confirmada.motivo,
        })
        .where("empresa_id", "=", confirmada.empresaId)
        .where("id", "=", confirmada.id)
        .where("estado", "=", "BORRADOR")
        .where("version", "=", confirmada.version)
        .returning(COLUMNAS_DE_DATOS_FISCALES)
        .executeTakeFirst();
      return actualizado === undefined ? null : aConfirmada(actualizado);
    },
  };
}

// =================================================================================================
// Regla del emisor (por empresa, versionada igual que los datos fiscales)
// =================================================================================================

/** El borrador de la regla: hoy un solo campo. */
export type BorradorDeReglaDeEmisor = ReglaDeEmisor &
  Readonly<{ id: VersionId; empresaId: EmpresaId; creadoPor: PersonaId; version: number }>;

export type VersionDeRegla =
  | Readonly<{ estado: "BORRADOR"; borrador: BorradorDeReglaDeEmisor }>
  | Readonly<{ estado: "CONFIRMADA"; confirmada: VersionGuardadaDeReglaDeEmisor }>;

type FilaDeRegla = Readonly<{
  id: string;
  empresa_id: string;
  estado: string;
  numero: number | null;
  permitir_eleccion_manual: boolean;
  vigente_desde: Date | null;
  confirmada_en: Date | null;
  confirmada_por: string | null;
  motivo: string | null;
  creado_por: string;
  version: number;
}>;

const COLUMNAS_DE_REGLA = [
  "id",
  "empresa_id",
  "estado",
  "numero",
  "permitir_eleccion_manual",
  "vigente_desde",
  "confirmada_en",
  "confirmada_por",
  "motivo",
  "creado_por",
  "version",
] as const;

function aBorradorDeRegla(fila: FilaDeRegla): BorradorDeReglaDeEmisor {
  return {
    id: versionId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    permitirEleccionManual: fila.permitir_eleccion_manual,
    creadoPor: personaId(fila.creado_por),
    version: fila.version,
  };
}

function aReglaConfirmada(fila: FilaDeRegla): VersionGuardadaDeReglaDeEmisor {
  return {
    id: versionId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    permitirEleccionManual: fila.permitir_eleccion_manual,
    numero: exigir(fila.numero, "numero"),
    vigenteDesde: exigir(fila.vigente_desde, "vigente_desde"),
    confirmadaEn: exigir(fila.confirmada_en, "confirmada_en"),
    confirmadaPor: personaId(exigir(fila.confirmada_por, "confirmada_por")),
    motivo: exigir(fila.motivo, "motivo"),
  };
}

export interface RepositorioDeReglasDeEmisor {
  obtener(empresa: EmpresaId, id: VersionId): Promise<VersionDeRegla | null>;
  obtenerBorrador(empresa: EmpresaId): Promise<BorradorDeReglaDeEmisor | null>;
  /** Las versiones confirmadas de la empresa, por número creciente (para `reglaDeEmisorVigente`). */
  confirmadas(empresa: EmpresaId): Promise<VersionGuardadaDeReglaDeEmisor[]>;
  /** Crea el borrador con el `id` de la aplicación (idempotente). Otro borrador con otro `id` es error de la base. */
  crearBorrador(
    borrador: Omit<BorradorDeReglaDeEmisor, "version">,
  ): Promise<Resultado<ResultadoDeAlta<BorradorDeReglaDeEmisor>, ErrorDeAlta>>;
  guardarBorrador(borrador: BorradorDeReglaDeEmisor): Promise<BorradorDeReglaDeEmisor | null>;
  /**
   * `BORRADOR` → `CONFIRMADA` con lo que fijó el dominio (`confirmarReglaDeEmisor`), si la versión
   * del borrador coincide y sigue en borrador; si no, `null`.
   */
  confirmar(
    confirmada: VersionGuardadaDeReglaDeEmisor,
    versionEsperada: number,
  ): Promise<VersionGuardadaDeReglaDeEmisor | null>;
}

export function crearRepositorioDeReglasDeEmisor(
  db: Kysely<FiscalDb>,
): RepositorioDeReglasDeEmisor {
  const seleccionar = () => db.selectFrom("regla_emisor").select(COLUMNAS_DE_REGLA);

  async function obtener(empresa: EmpresaId, id: VersionId): Promise<VersionDeRegla | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    if (fila === undefined) return null;
    return fila.estado === "CONFIRMADA"
      ? { estado: "CONFIRMADA", confirmada: aReglaConfirmada(fila) }
      : { estado: "BORRADOR", borrador: aBorradorDeRegla(fila) };
  }

  return {
    obtener,

    async obtenerBorrador(empresa) {
      const fila = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "BORRADOR")
        .executeTakeFirst();
      return fila === undefined ? null : aBorradorDeRegla(fila);
    },

    async confirmadas(empresa) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "CONFIRMADA")
        .orderBy("numero")
        .execute();
      return filas.map(aReglaConfirmada);
    },

    async crearBorrador(borrador) {
      await serializarAltaDeId(db, "regla_emisor", borrador.id);
      const nuevo = await db
        .insertInto("regla_emisor")
        .values({
          id: borrador.id,
          empresa_id: borrador.empresaId,
          permitir_eleccion_manual: borrador.permitirEleccionManual,
          creado_por: borrador.creadoPor,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(borrador.empresaId, borrador.id);
      if (guardado === null || guardado.estado !== "BORRADOR") return err("ID_EN_USO");
      return ok({ creado: nuevo !== undefined, valor: guardado.borrador });
    },

    async guardarBorrador(borrador) {
      const actualizado = await db
        .updateTable("regla_emisor")
        .set({ permitir_eleccion_manual: borrador.permitirEleccionManual })
        .where("empresa_id", "=", borrador.empresaId)
        .where("id", "=", borrador.id)
        .where("estado", "=", "BORRADOR")
        .where("version", "=", borrador.version)
        .returning(COLUMNAS_DE_REGLA)
        .executeTakeFirst();
      return actualizado === undefined ? null : aBorradorDeRegla(actualizado);
    },

    async confirmar(confirmada, versionEsperada) {
      const actualizado = await db
        .updateTable("regla_emisor")
        .set({
          estado: "CONFIRMADA",
          numero: confirmada.numero,
          permitir_eleccion_manual: confirmada.permitirEleccionManual,
          vigente_desde: confirmada.vigenteDesde,
          confirmada_en: confirmada.confirmadaEn,
          confirmada_por: confirmada.confirmadaPor,
          motivo: confirmada.motivo,
        })
        .where("empresa_id", "=", confirmada.empresaId)
        .where("id", "=", confirmada.id)
        .where("estado", "=", "BORRADOR")
        .where("version", "=", versionEsperada)
        .returning(COLUMNAS_DE_REGLA)
        .executeTakeFirst();
      return actualizado === undefined ? null : aReglaConfirmada(actualizado);
    },
  };
}

// =================================================================================================
// Puntos de venta
// =================================================================================================

const ESTADOS_DE_PUNTO_DE_VENTA: readonly EstadoDePuntoDeVenta[] = ["INACTIVO", "ACTIVO"];

type FilaDePuntoDeVenta = Readonly<{
  id: string;
  empresa_id: string;
  emisor_id: string;
  sucursal_id: string;
  domicilio_id: string | null;
  numero: number;
  estado: string;
  version: number;
}>;

const COLUMNAS_DE_PUNTO_DE_VENTA = [
  "id",
  "empresa_id",
  "emisor_id",
  "sucursal_id",
  "domicilio_id",
  "numero",
  "estado",
  "version",
] as const;

function aPuntoDeVenta(fila: FilaDePuntoDeVenta): PuntoDeVenta {
  return {
    id: puntoDeVentaId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    emisorId: emisorId(fila.emisor_id),
    sucursalId: sucursalId(fila.sucursal_id),
    domicilioId: fila.domicilio_id === null ? null : domicilioId(fila.domicilio_id),
    numero: fila.numero,
    estado: deLaLista(ESTADOS_DE_PUNTO_DE_VENTA, fila.estado, "estado de punto de venta"),
    // Único valor que la base admite en H7 (`punto_de_venta_verificacion_ck`).
    verificacionArca: "NO_VERIFICADO",
    version: fila.version,
  };
}

export interface RepositorioDePuntosDeVenta {
  obtener(empresa: EmpresaId, id: PuntoDeVentaId): Promise<PuntoDeVenta | null>;
  /** Todos los puntos de venta de la empresa, por emisor y número. */
  listar(empresa: EmpresaId): Promise<PuntoDeVenta[]>;
  /** Los del emisor (para el número único), por número. */
  listarDelEmisor(empresa: EmpresaId, emisor: EmisorId): Promise<PuntoDeVenta[]>;
  /** Los de la sucursal (activos o no), por emisor y número. */
  listarDeLaSucursal(empresa: EmpresaId, sucursal: SucursalId): Promise<PuntoDeVenta[]>;
  /**
   * Da de alta el punto de venta con el `id` de la aplicación (idempotente: repetir devuelve el que
   * ya existe, `creado: false`). Nace como lo dice el dominio (`INACTIVO`). Un número ya usado por
   * el emisor sale como error de la base (`punto_de_venta_numero_uk`).
   */
  crear(puntoDeVenta: PuntoDeVenta): Promise<Resultado<ResultadoDeAlta<PuntoDeVenta>, ErrorDeAlta>>;
  /**
   * Guarda número, sucursal, domicilio y estado si la versión coincide; si no, `null`. El emisor no
   * se guarda nunca (no cambia).
   */
  guardar(puntoDeVenta: PuntoDeVenta): Promise<PuntoDeVenta | null>;
  /**
   * SOLO PLATAFORMA (la que más lo necesita): cuántos puntos de venta `ACTIVO` tiene el emisor.
   * Lee solo `id`, `empresa_id`, `emisor_id` y `estado`, las 4 columnas que la plataforma ve.
   */
  contarActivosDelEmisor(empresa: EmpresaId, emisor: EmisorId): Promise<number>;
}

export function crearRepositorioDePuntosDeVenta(db: Kysely<FiscalDb>): RepositorioDePuntosDeVenta {
  const seleccionar = () => db.selectFrom("punto_de_venta").select(COLUMNAS_DE_PUNTO_DE_VENTA);

  async function obtener(empresa: EmpresaId, id: PuntoDeVentaId): Promise<PuntoDeVenta | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("id", "=", id)
      .executeTakeFirst();
    return fila === undefined ? null : aPuntoDeVenta(fila);
  }

  return {
    obtener,

    async listar(empresa) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .orderBy("emisor_id")
        .orderBy("numero")
        .execute();
      return filas.map(aPuntoDeVenta);
    },

    async listarDelEmisor(empresa, emisor) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .orderBy("numero")
        .execute();
      return filas.map(aPuntoDeVenta);
    },

    async listarDeLaSucursal(empresa, sucursal) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("sucursal_id", "=", sucursal)
        .orderBy("emisor_id")
        .orderBy("numero")
        .execute();
      return filas.map(aPuntoDeVenta);
    },

    async crear(puntoDeVenta) {
      // El estado inicial lo fija la base (`INACTIVO`): no hay permiso para elegirlo al insertar.
      if (puntoDeVenta.estado !== "INACTIVO") {
        throw new RangeError("un punto de venta nace INACTIVO: se activa después");
      }
      await serializarAltaDeId(db, "punto_de_venta", puntoDeVenta.id);
      const nuevo = await db
        .insertInto("punto_de_venta")
        .values({
          id: puntoDeVenta.id,
          empresa_id: puntoDeVenta.empresaId,
          emisor_id: puntoDeVenta.emisorId,
          sucursal_id: puntoDeVenta.sucursalId,
          domicilio_id: puntoDeVenta.domicilioId,
          numero: puntoDeVenta.numero,
        })
        .onConflict((oc) => oc.column("id").doNothing())
        .returning("id")
        .executeTakeFirst();
      const guardado = await obtener(puntoDeVenta.empresaId, puntoDeVenta.id);
      if (guardado === null) return err("ID_EN_USO");
      return ok({ creado: nuevo !== undefined, valor: guardado });
    },

    async guardar(puntoDeVenta) {
      const actualizado = await db
        .updateTable("punto_de_venta")
        .set({
          numero: puntoDeVenta.numero,
          sucursal_id: puntoDeVenta.sucursalId,
          domicilio_id: puntoDeVenta.domicilioId,
          estado: puntoDeVenta.estado,
        })
        .where("empresa_id", "=", puntoDeVenta.empresaId)
        .where("id", "=", puntoDeVenta.id)
        .where("version", "=", puntoDeVenta.version)
        .returning(COLUMNAS_DE_PUNTO_DE_VENTA)
        .executeTakeFirst();
      return actualizado === undefined ? null : aPuntoDeVenta(actualizado);
    },

    async contarActivosDelEmisor(empresa, emisor) {
      const fila = await db
        .selectFrom("punto_de_venta")
        .select((eb) => eb.fn.count<string>("id").as("n"))
        .where("empresa_id", "=", empresa)
        .where("emisor_id", "=", emisor)
        .where("estado", "=", "ACTIVO")
        .executeTakeFirstOrThrow();
      return Number(fila.n);
    },
  };
}

// =================================================================================================
// Series de comprobantes (solo persistencia: reservar, cerrar y reconciliar son casos de uso, T6)
// =================================================================================================

type FilaDeSerie = Readonly<{
  empresa_id: string;
  punto_de_venta_id: string;
  emisor_id: string;
  tipo_comprobante: string;
  ultimo_numero: string;
  estado: string;
  numero_en_curso: string | null;
  solicitud_en_curso: string | null;
  en_curso_hasta: Date | null;
  motivo_bloqueo: string | null;
  version: number;
}>;

const COLUMNAS_DE_SERIE = [
  "empresa_id",
  "punto_de_venta_id",
  "emisor_id",
  "tipo_comprobante",
  "ultimo_numero",
  "estado",
  "numero_en_curso",
  "solicitud_en_curso",
  "en_curso_hasta",
  "motivo_bloqueo",
  "version",
] as const;

function aSerie(fila: FilaDeSerie): Serie {
  const identidad = {
    empresaId: empresaId(fila.empresa_id),
    puntoDeVentaId: puntoDeVentaId(fila.punto_de_venta_id),
    emisorId: emisorId(fila.emisor_id),
    tipo: deLaLista(TIPOS_DE_COMPROBANTE, fila.tipo_comprobante, "tipo de comprobante"),
    version: fila.version,
  };
  // `bigint` llega como texto desde `pg`.
  const ultimoNumero = BigInt(fila.ultimo_numero);
  switch (fila.estado) {
    case "LIBRE":
      return { ...identidad, estado: "LIBRE", ultimoNumero };
    case "EN_CURSO":
      return {
        ...identidad,
        estado: "EN_CURSO",
        ultimoNumero,
        numeroEnCurso: BigInt(exigir(fila.numero_en_curso, "numero_en_curso")),
        solicitud: solicitudId(exigir(fila.solicitud_en_curso, "solicitud_en_curso")),
        enCursoHasta: exigir(fila.en_curso_hasta, "en_curso_hasta"),
      };
    case "BLOQUEADA":
      return {
        ...identidad,
        estado: "BLOQUEADA",
        ultimoNumero,
        motivoBloqueo: exigir(fila.motivo_bloqueo, "motivo_bloqueo"),
      };
    default:
      throw new RangeError(`estado de serie desconocido en la base: ${fila.estado}`);
  }
}

export interface RepositorioDeSeries {
  obtener(
    empresa: EmpresaId,
    puntoDeVenta: PuntoDeVentaId,
    tipo: TipoDeComprobante,
  ): Promise<Serie | null>;
  /** Las series del punto de venta, por tipo. */
  delPuntoDeVenta(empresa: EmpresaId, puntoDeVenta: PuntoDeVentaId): Promise<Serie[]>;
  /**
   * Crea la serie `LIBRE` de (punto de venta, tipo) con el último número que informó el servicio de
   * emisión (`iniciarSerie`). Idempotente por su clave `(empresa, punto de venta, tipo)`: repetir
   * devuelve la que existe (`creado: false`) SIN pisar su último número.
   */
  crear(serie: SerieLibre): Promise<ResultadoDeAlta<Serie>>;
  /**
   * Guarda el estado que calculó el dominio (`reservarNumero`, `cerrarSerie`, `reconciliarSerie`) si
   * la versión coincide; si no, `null`. Los disparadores de la base repiten las reglas de la
   * numeración (`ultimo_numero` solo sube de a uno cerrando su reserva, `BLOQUEADA` sin salida):
   * una transición que el dominio no hubiera permitido sale como error de la base.
   */
  guardar(serie: Serie): Promise<Serie | null>;
  /**
   * Las series de la empresa con una reserva vencida (`EN_CURSO` y `en_curso_hasta <= ahora`), las
   * más viejas primero, hasta `limite`. Es lo que la reconciliación (T6) tiene que resolver.
   */
  enCursoVencidas(empresa: EmpresaId, ahora: Date, limite: number): Promise<Serie[]>;
  /**
   * ¿Alguna serie del emisor tiene `ultimo_numero > 0` o no está `LIBRE`? Es el contexto de
   * `corregirCuit` (`tieneNumerosUsados`). Sirve a la plataforma: las series enteras son legibles.
   */
  hayNumerosUsadosDelEmisor(empresa: EmpresaId, emisor: EmisorId): Promise<boolean>;
  /** Lo mismo para las series de un punto de venta: es el contexto de `editarPuntoDeVenta`. */
  hayNumerosUsadosDelPuntoDeVenta(
    empresa: EmpresaId,
    puntoDeVenta: PuntoDeVentaId,
  ): Promise<boolean>;
}

export function crearRepositorioDeSeries(db: Kysely<FiscalDb>): RepositorioDeSeries {
  const seleccionar = () => db.selectFrom("serie_comprobante").select(COLUMNAS_DE_SERIE);

  async function obtener(
    empresa: EmpresaId,
    puntoDeVenta: PuntoDeVentaId,
    tipo: TipoDeComprobante,
  ): Promise<Serie | null> {
    const fila = await seleccionar()
      .where("empresa_id", "=", empresa)
      .where("punto_de_venta_id", "=", puntoDeVenta)
      .where("tipo_comprobante", "=", tipo)
      .executeTakeFirst();
    return fila === undefined ? null : aSerie(fila);
  }

  // Una serie «usada» ya no permite cambiar el CUIT del emisor ni el número del punto de venta
  // (`serieUsada` del dominio, repetido en SQL).
  const hayUsadas = async (
    cual: { empresa: EmpresaId } & ({ emisor: EmisorId } | { puntoDeVenta: PuntoDeVentaId }),
  ) => {
    let consulta = db
      .selectFrom("serie_comprobante")
      .select("tipo_comprobante")
      .where("empresa_id", "=", cual.empresa)
      .where(sql<boolean>`(ultimo_numero > 0 or estado <> 'LIBRE')`)
      .limit(1);
    consulta =
      "emisor" in cual
        ? consulta.where("emisor_id", "=", cual.emisor)
        : consulta.where("punto_de_venta_id", "=", cual.puntoDeVenta);
    return (await consulta.executeTakeFirst()) !== undefined;
  };

  return {
    obtener,

    async delPuntoDeVenta(empresa, puntoDeVenta) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("punto_de_venta_id", "=", puntoDeVenta)
        .orderBy("tipo_comprobante")
        .execute();
      return filas.map(aSerie);
    },

    async crear(serie) {
      const nueva = await db
        .insertInto("serie_comprobante")
        .values({
          empresa_id: serie.empresaId,
          punto_de_venta_id: serie.puntoDeVentaId,
          emisor_id: serie.emisorId,
          tipo_comprobante: serie.tipo,
          ultimo_numero: serie.ultimoNumero.toString(),
          // Puente hasta F3/F4 (0009 puso el ambiente en la clave de la serie): el dominio de la serie todavía
          // no lo conoce y todo punto de venta nace en homologación, así que acá es siempre ese.
          ambiente: "HOMOLOGACION",
        })
        .onConflict((oc) =>
          oc
            .columns(["empresa_id", "punto_de_venta_id", "tipo_comprobante", "ambiente"])
            .doNothing(),
        )
        .returning(COLUMNAS_DE_SERIE)
        .executeTakeFirst();
      if (nueva !== undefined) return { creado: true, valor: aSerie(nueva) };
      const existente = await obtener(serie.empresaId, serie.puntoDeVentaId, serie.tipo);
      if (existente === null) throw new Error("el alta de la serie no insertó y tampoco existe");
      return { creado: false, valor: existente };
    },

    async guardar(serie) {
      const enCurso = serie.estado === "EN_CURSO" ? serie : null;
      const actualizada = await db
        .updateTable("serie_comprobante")
        .set({
          estado: serie.estado,
          ultimo_numero: serie.ultimoNumero.toString(),
          numero_en_curso: enCurso === null ? null : enCurso.numeroEnCurso.toString(),
          solicitud_en_curso: enCurso === null ? null : enCurso.solicitud,
          en_curso_hasta: enCurso === null ? null : enCurso.enCursoHasta,
          motivo_bloqueo: serie.estado === "BLOQUEADA" ? serie.motivoBloqueo : null,
        })
        .where("empresa_id", "=", serie.empresaId)
        .where("punto_de_venta_id", "=", serie.puntoDeVentaId)
        .where("tipo_comprobante", "=", serie.tipo)
        .where("version", "=", serie.version)
        .returning(COLUMNAS_DE_SERIE)
        .executeTakeFirst();
      return actualizada === undefined ? null : aSerie(actualizada);
    },

    async enCursoVencidas(empresa, ahora, limite) {
      const filas = await seleccionar()
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "EN_CURSO")
        .where("en_curso_hasta", "<=", ahora)
        .orderBy("en_curso_hasta")
        .orderBy("punto_de_venta_id")
        .orderBy("tipo_comprobante")
        .limit(limite)
        .execute();
      return filas.map(aSerie);
    },

    hayNumerosUsadosDelEmisor: (empresa, emisor) => hayUsadas({ empresa, emisor }),
    hayNumerosUsadosDelPuntoDeVenta: (empresa, puntoDeVenta) =>
      hayUsadas({ empresa, puntoDeVenta }),
  };
}
