import type { Kysely } from "kysely";
import { ROLES_DE_EMPRESA } from "../../../capacidades/permisos/roles";
import {
  empresaId,
  invitacionId,
  personaId,
  sucursalId,
  tenantId,
  traspasoId,
  usuarioAuthId,
  type EmpresaId,
  type InvitacionId,
  type PersonaId,
  type SucursalId,
  type TraspasoId,
  type UsuarioAuthId,
} from "../../../primitivas/identificadores/marca";
import { emailDesdeTexto, type Email } from "../../../primitivas/contacto/email";
import type {
  EmpresaInvitada,
  EstadoGuardado,
  Invitacion,
  NuevaInvitacion,
  RolDeEmpresa,
  TipoDeInvitacion,
} from "../dominio/invitacion";
import type { Membresia, PersonaConUsuario } from "../dominio/membresia";
import type { EstadoGuardadoDeTraspaso, OrigenDeTraspaso, Traspaso } from "../dominio/traspaso";
import type { IdentidadDb } from "./tablas";

/**
 * Repositorios de identidad (ADR-005, ADR-009). Cada método tiene una intención y devuelve tipos del
 * dominio. Reglas de este archivo:
 *
 *  - Los cambios de estado son `UPDATE ... WHERE estado = ... AND version = ...` y devuelven si
 *    tocaron la fila: nada de `FOR UPDATE` ni de upserts.
 *  - Ninguna restricción de la base se atrapa acá: salen tal cual y el adaptador de transacciones
 *    las traduce a `ErrorDePersistencia` (la traducción a errores de negocio está en
 *    `casos-de-uso/traducir.ts`).
 *  - El alta de una invitación NO lleva `RETURNING`: por RLS no se puede leer hasta que existe su
 *    fila en `invitacion_empresa` (0002, D7). El id lo genera la aplicación.
 *  - Lo que se lee depende del contexto firmado de la transacción (RLS): por ejemplo, un contexto
 *    operativo ve de una invitación solo la parte de su empresa.
 */

const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const TIPOS: readonly TipoDeInvitacion[] = ["ALTA_GERENTE", "USUARIO"];
const ESTADOS: readonly EstadoGuardado[] = ["PENDIENTE", "ACEPTADA", "REVOCADA"];
const ORIGENES_DE_TRASPASO: readonly OrigenDeTraspaso[] = ["GERENTE", "PLATAFORMA"];
const ESTADOS_DE_TRASPASO: readonly EstadoGuardadoDeTraspaso[] = [
  "PROPUESTO",
  "ACEPTADO",
  "RECHAZADO",
  "CANCELADO",
];

/** Un valor de la base que el CHECK correspondiente no deja pasar: si llega otro, algo se rompió. */
function deLaLista<T extends string>(lista: readonly T[], valor: string, nombre: string): T {
  const encontrado = lista.find((v) => v === valor);
  if (encontrado === undefined) throw new RangeError(`${nombre} desconocido en la base: ${valor}`);
  return encontrado;
}

function aEmail(texto: string): Email {
  const r = emailDesdeTexto(texto);
  if (!r.ok) throw new RangeError("email guardado inválido en la base");
  return r.valor;
}

export type Asignacion = Readonly<{
  empresaId: EmpresaId;
  personaId: PersonaId;
  sucursalId: SucursalId;
  activa: boolean;
  version: number;
}>;

/** Un miembro de la empresa (activo o no) con el email de su persona, para las listas de la pantalla. */
export type MiembroConEmail = Readonly<{ membresia: Membresia; email: Email }>;

/** Una invitación de usuario pendiente (vigente o vencida), tal como la lista la necesita. */
export type InvitacionPendienteDeLista = Readonly<{
  id: InvitacionId;
  email: Email;
  rol: RolDeEmpresa;
  /** Las sucursales a las que se invitó, tal como se pidieron (hoy pueden estar desactivadas). */
  sucursales: readonly SucursalId[];
  emitidaEn: Date;
  venceEn: Date;
  /** `null`: la emitió el sistema (sin persona). */
  emitidaPor: PersonaId | null;
}>;

/**
 * Un traspaso tal como está guardado: el del dominio (con su identificador con marca) y la fecha en
 * que se propuso, que la pantalla necesita y el dominio no.
 */
export type TraspasoGuardado = Readonly<
  Omit<Traspaso, "id"> & { id: TraspasoId; propuestoEn: Date }
>;

export interface RepositorioDePersonas {
  buscarPorEmail(email: Email): Promise<PersonaConUsuario | null>;
  obtener(id: PersonaId): Promise<PersonaConUsuario | null>;
  /** Da de alta a una persona (solo con su email; el resto lo fija la base). Nace sin usuario vinculado. */
  crear(email: Email): Promise<PersonaConUsuario>;
  /**
   * Vincula a la persona con el usuario autenticado: `UPDATE ... SET usuario_auth_id = <usuario> WHERE id =
   * <id> AND usuario_auth_id IS NULL`. Solo lo deja pasar la base en el contexto de INVITACION, sobre la
   * persona del email del enlace y hacia el usuario firmado en el contexto. `true`: lo fijó. `false`: ya
   * tenía usuario (o la base no se lo permitió a ese contexto: 0 filas); el caso de uso lee antes y decide.
   */
  vincularUsuario(id: PersonaId, usuario: UsuarioAuthId): Promise<boolean>;
  /**
   * Suspende (`false`) o reactiva (`true`) a la persona en todas las empresas: `UPDATE ... SET
   * activo_global = <nuevo> WHERE id = <id> AND activo_global <> <nuevo>`. La tabla no tiene versión; el
   * estado esperado hace de control optimista. `true`: lo cambió. `false`: no lo cambió, porque ya estaba
   * así, porque no existe, o porque la base no se lo permitió a ese actor (afecta 0 filas): el caso de
   * uso lee a la persona antes y distingue `YA_SUSPENDIDA` / `NO_SUSPENDIDA`.
   */
  cambiarActivoGlobal(id: PersonaId, activo: boolean): Promise<boolean>;
}

export interface RepositorioDeMembresias {
  obtener(empresa: EmpresaId, persona: PersonaId): Promise<Membresia | null>;
  /** Las membresías activas de la empresa. */
  listarActivas(empresa: EmpresaId): Promise<Membresia[]>;
  /** TODAS las membresías de la empresa (activas o apagadas) con el email de su persona. */
  listarConEmail(empresa: EmpresaId): Promise<MiembroConEmail[]>;
  /** Las membresías de la persona (activas o no) en las empresas indicadas. */
  deLaPersonaEn(persona: PersonaId, empresas: readonly EmpresaId[]): Promise<Membresia[]>;
  crear(datos: {
    empresaId: EmpresaId;
    personaId: PersonaId;
    rol: RolDeEmpresa;
    invitacionId: InvitacionId;
  }): Promise<void>;
  /** Reactiva una membresía apagada. `false`: ya no estaba apagada o cambió de versión. */
  reactivar(empresa: EmpresaId, persona: PersonaId, versionEsperada: number): Promise<boolean>;
  /** Apaga una membresía activa. `false`: ya no estaba activa o cambió de versión. */
  apagar(empresa: EmpresaId, persona: PersonaId, versionEsperada: number): Promise<boolean>;
  /**
   * Cambia el rol de una membresía ACTIVA. Solo existe para el traspaso de gerencia: la base lo admite
   * únicamente dentro de la transacción que acepta un traspaso (0005) y en el orden saliente →
   * entrante. `false`: ya no estaba activa, cambió de versión o no es de la empresa.
   */
  cambiarRol(
    empresa: EmpresaId,
    persona: PersonaId,
    versionEsperada: number,
    rol: RolDeEmpresa,
  ): Promise<boolean>;
}

export interface RepositorioDeAsignaciones {
  deLaPersona(empresa: EmpresaId, persona: PersonaId): Promise<Asignacion[]>;
  /** Las asignaciones ACTIVAS de todos los miembros de la empresa (no mira si la sucursal está activa). */
  activasDeLaEmpresa(empresa: EmpresaId): Promise<Asignacion[]>;
  crear(empresa: EmpresaId, persona: PersonaId, sucursales: readonly SucursalId[]): Promise<void>;
  reactivar(
    empresa: EmpresaId,
    persona: PersonaId,
    sucursal: SucursalId,
    versionEsperada: number,
  ): Promise<boolean>;
  /** Apaga una asignación activa. `false`: ya no estaba activa o cambió de versión. */
  apagar(
    empresa: EmpresaId,
    persona: PersonaId,
    sucursal: SucursalId,
    versionEsperada: number,
  ): Promise<boolean>;
  /** Apaga todas las asignaciones activas de la persona en la empresa; devuelve cuántas. */
  apagarTodas(empresa: EmpresaId, persona: PersonaId): Promise<number>;
}

export interface RepositorioDeTraspasos {
  /** Un traspaso de la empresa (en cualquier estado); `null` si no existe o es de otra empresa. */
  obtener(empresa: EmpresaId, id: string): Promise<TraspasoGuardado | null>;
  /**
   * El traspaso guardado como `PROPUESTO` de la empresa, vigente o vencido (el vencimiento no se
   * guarda). La base admite a lo sumo uno (`traspaso_gerencia_en_curso_uk`).
   */
  enCurso(empresa: EmpresaId): Promise<TraspasoGuardado | null>;
  /**
   * Propone un traspaso con origen `GERENTE`: quien propone es también el saliente. Devuelve el id que
   * generó la base. Que sea el gerente vigente y que el entrante sea un miembro activo lo impone la base.
   */
  proponer(datos: {
    empresaId: EmpresaId;
    proponePor: PersonaId;
    entrante: PersonaId;
    propuestoEn: Date;
    venceEn: Date;
  }): Promise<TraspasoId>;
  /** `PROPUESTO` → `ACEPTADO`, anotando al saliente. `false`: ya no estaba propuesto o cambió de versión. */
  aceptar(
    empresa: EmpresaId,
    id: TraspasoId,
    versionEsperada: number,
    resueltoEn: Date,
    saliente: PersonaId,
  ): Promise<boolean>;
  /** `PROPUESTO` → `RECHAZADO`. `false`: ya no estaba propuesto o cambió de versión. */
  rechazar(
    empresa: EmpresaId,
    id: TraspasoId,
    versionEsperada: number,
    resueltoEn: Date,
  ): Promise<boolean>;
  /** `PROPUESTO` → `CANCELADO`, con un motivo (clave) o sin él. `false`: ya no estaba propuesto o cambió de versión. */
  cancelar(
    empresa: EmpresaId,
    id: TraspasoId,
    versionEsperada: number,
    resueltoEn: Date,
    motivo: string | null,
  ): Promise<boolean>;
}

export interface RepositorioDeInvitaciones {
  /** Por el hash del token (contexto de INVITACION). */
  obtenerPorHash(tokenHash: string): Promise<Invitacion | null>;
  obtenerPorId(id: InvitacionId): Promise<Invitacion | null>;
  /**
   * La ÚLTIMA invitación del alta del gerente de esa empresa (tipo `ALTA_GERENTE`, la de `emitida_en`
   * más reciente, desempate por id), sea cual sea su estado: pendiente (vigente o vencida), aceptada o
   * revocada con o sin reemplazo. `null`: la empresa nunca tuvo alta. Es lo que necesitan el reenvío y
   * la revocación del alta. Sin `invitacion_sucursal` (la plataforma no la lee): las empresas de la
   * invitación llegan con `sucursales: []`, que es lo que lleva un alta por construcción.
   */
  obtenerAltaVigente(empresa: EmpresaId): Promise<Invitacion | null>;
  /** Las guardadas como `PENDIENTE` que incluyen a la empresa, dirigidas a ese email. */
  pendientesDeEmail(empresa: EmpresaId, email: Email): Promise<Invitacion[]>;
  /**
   * Las invitaciones de USUARIO guardadas como `PENDIENTE` que incluyen a la empresa (vigentes y
   * vencidas: el vencimiento no se guarda), con el rol y las sucursales de ESTA empresa. El alta del
   * gerente no entra: no la administra la empresa. Sin el token ni su hash.
   */
  pendientesDeLaEmpresa(empresa: EmpresaId): Promise<InvitacionPendienteDeLista[]>;
  /** Cabecera, empresas y sucursales (en ese orden: la cabecera no se puede leer sola, D7). */
  crear(nueva: NuevaInvitacion): Promise<void>;
  /** `PENDIENTE` → `ACEPTADA`. `false`: ya no estaba pendiente o cambió de versión. */
  marcarAceptada(
    id: InvitacionId,
    versionEsperada: number,
    persona: PersonaId,
    ahora: Date,
  ): Promise<boolean>;
  /** `PENDIENTE` → `REVOCADA`. `false`: ya no estaba pendiente o cambió de versión. */
  revocar(id: InvitacionId, versionEsperada: number, ahora: Date, motivo: string): Promise<boolean>;
  /** Anota qué invitación reemplaza a una ya revocada. `false`: no estaba revocada o ya tenía una. */
  vincularReemplazo(id: InvitacionId, reemplazadaPor: InvitacionId): Promise<boolean>;
}

export function crearRepositorioDePersonas(db: Kysely<IdentidadDb>): RepositorioDePersonas {
  const columnas = ["id", "email", "activo_global", "usuario_auth_id"] as const;
  const aPersona = (fila: {
    id: string;
    email: string;
    activo_global: boolean;
    usuario_auth_id: string | null;
  }): PersonaConUsuario => ({
    id: personaId(fila.id),
    email: aEmail(fila.email),
    activoGlobal: fila.activo_global,
    usuarioAuth: fila.usuario_auth_id === null ? null : usuarioAuthId(fila.usuario_auth_id),
  });
  return {
    async buscarPorEmail(email) {
      const fila = await db
        .selectFrom("persona")
        .select(columnas)
        .where("email", "=", email)
        .executeTakeFirst();
      return fila === undefined ? null : aPersona(fila);
    },

    async obtener(id) {
      const fila = await db
        .selectFrom("persona")
        .select(columnas)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aPersona(fila);
    },

    async crear(email) {
      const fila = await db
        .insertInto("persona")
        .values({ email })
        .returning(columnas)
        .executeTakeFirstOrThrow();
      return aPersona(fila);
    },

    async vincularUsuario(id, usuario) {
      const r = await db
        .updateTable("persona")
        .set({ usuario_auth_id: usuario })
        .where("id", "=", id)
        .where("usuario_auth_id", "is", null)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async cambiarActivoGlobal(id, activo) {
      const r = await db
        .updateTable("persona")
        .set({ activo_global: activo })
        .where("id", "=", id)
        .where("activo_global", "=", !activo)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },
  };
}

export function crearRepositorioDeMembresias(db: Kysely<IdentidadDb>): RepositorioDeMembresias {
  const columnas = ["empresa_id", "persona_id", "rol", "activo", "version"] as const;
  const aMembresia = (fila: {
    empresa_id: string;
    persona_id: string;
    rol: string;
    activo: boolean;
    version: number;
  }): Membresia => ({
    empresaId: empresaId(fila.empresa_id),
    personaId: personaId(fila.persona_id),
    rol: deLaLista(ROLES_DE_EMPRESA, fila.rol, "rol"),
    activo: fila.activo,
    version: fila.version,
  });
  return {
    async obtener(empresa, persona) {
      const fila = await db
        .selectFrom("membresia")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .executeTakeFirst();
      return fila === undefined ? null : aMembresia(fila);
    },

    async listarActivas(empresa) {
      const filas = await db
        .selectFrom("membresia")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("activo", "=", true)
        .orderBy("persona_id")
        .execute();
      return filas.map(aMembresia);
    },

    async listarConEmail(empresa) {
      const filas = await db
        .selectFrom("membresia as m")
        .innerJoin("persona as p", "p.id", "m.persona_id")
        .select([
          "m.empresa_id",
          "m.persona_id",
          "m.rol",
          "m.activo",
          "m.version",
          "p.email as email",
        ])
        .where("m.empresa_id", "=", empresa)
        .orderBy("m.persona_id")
        .execute();
      return filas.map((fila) => ({ membresia: aMembresia(fila), email: aEmail(fila.email) }));
    },

    async deLaPersonaEn(persona, empresas) {
      if (empresas.length === 0) return [];
      const filas = await db
        .selectFrom("membresia")
        .select(columnas)
        .where("persona_id", "=", persona)
        .where("empresa_id", "in", [...empresas])
        .orderBy("empresa_id")
        .execute();
      return filas.map(aMembresia);
    },

    async crear(datos) {
      await db
        .insertInto("membresia")
        .values({
          empresa_id: datos.empresaId,
          persona_id: datos.personaId,
          rol: datos.rol,
          invitacion_id: datos.invitacionId,
        })
        .execute();
    },

    async reactivar(empresa, persona, versionEsperada) {
      const r = await db
        .updateTable("membresia")
        .set({ activo: true })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("activo", "=", false)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async apagar(empresa, persona, versionEsperada) {
      const r = await db
        .updateTable("membresia")
        .set({ activo: false })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("activo", "=", true)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async cambiarRol(empresa, persona, versionEsperada, rol) {
      const r = await db
        .updateTable("membresia")
        .set({ rol })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("activo", "=", true)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },
  };
}

export function crearRepositorioDeAsignaciones(db: Kysely<IdentidadDb>): RepositorioDeAsignaciones {
  const aAsignacion = (f: {
    empresa_id: string;
    persona_id: string;
    sucursal_id: string;
    activa: boolean;
    version: number;
  }): Asignacion => ({
    empresaId: empresaId(f.empresa_id),
    personaId: personaId(f.persona_id),
    sucursalId: sucursalId(f.sucursal_id),
    activa: f.activa,
    version: f.version,
  });
  return {
    async deLaPersona(empresa, persona) {
      const filas = await db
        .selectFrom("asignacion_sucursal")
        .select(["empresa_id", "persona_id", "sucursal_id", "activa", "version"])
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .orderBy("sucursal_id")
        .execute();
      return filas.map(aAsignacion);
    },

    async activasDeLaEmpresa(empresa) {
      const filas = await db
        .selectFrom("asignacion_sucursal")
        .select(["empresa_id", "persona_id", "sucursal_id", "activa", "version"])
        .where("empresa_id", "=", empresa)
        .where("activa", "=", true)
        .orderBy("persona_id")
        .orderBy("sucursal_id")
        .execute();
      return filas.map(aAsignacion);
    },

    async crear(empresa, persona, sucursales) {
      if (sucursales.length === 0) return;
      await db
        .insertInto("asignacion_sucursal")
        .values(
          sucursales.map((sucursal) => ({
            empresa_id: empresa,
            persona_id: persona,
            sucursal_id: sucursal,
          })),
        )
        .execute();
    },

    async reactivar(empresa, persona, sucursal, versionEsperada) {
      const r = await db
        .updateTable("asignacion_sucursal")
        .set({ activa: true })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("sucursal_id", "=", sucursal)
        .where("activa", "=", false)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async apagar(empresa, persona, sucursal, versionEsperada) {
      const r = await db
        .updateTable("asignacion_sucursal")
        .set({ activa: false })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("sucursal_id", "=", sucursal)
        .where("activa", "=", true)
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async apagarTodas(empresa, persona) {
      const r = await db
        .updateTable("asignacion_sucursal")
        .set({ activa: false })
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .where("activa", "=", true)
        .executeTakeFirst();
      return Number(r.numUpdatedRows);
    },
  };
}

export function crearRepositorioDeInvitaciones(db: Kysely<IdentidadDb>): RepositorioDeInvitaciones {
  const columnas = [
    "id",
    "tenant_id",
    "tipo",
    "email",
    "estado",
    "emitida_en",
    "vence_en",
    "aceptada_por",
    "reemplazada_por",
    "version",
  ] as const;

  /**
   * Arma las invitaciones con sus empresas y sucursales (ordenadas por id: orden estable). Con
   * `conSucursales: false` no lee `invitacion_sucursal` (la plataforma no tiene permiso) y todas las
   * empresas llevan `sucursales: []`.
   */
  async function armar(
    filas: readonly {
      id: string;
      tenant_id: string;
      tipo: string;
      email: string;
      estado: string;
      emitida_en: Date;
      vence_en: Date;
      aceptada_por: string | null;
      reemplazada_por: string | null;
      version: number;
    }[],
    conSucursales = true,
  ): Promise<Invitacion[]> {
    if (filas.length === 0) return [];
    const ids = filas.map((f) => f.id);
    const empresas = await db
      .selectFrom("invitacion_empresa")
      .select(["invitacion_id", "empresa_id", "rol"])
      .where("invitacion_id", "in", ids)
      .orderBy("empresa_id")
      .execute();
    const sucursales = conSucursales
      ? await db
          .selectFrom("invitacion_sucursal")
          .select(["invitacion_id", "empresa_id", "sucursal_id"])
          .where("invitacion_id", "in", ids)
          .orderBy("sucursal_id")
          .execute()
      : [];
    return filas.map((f) => ({
      id: invitacionId(f.id),
      tenantId: tenantId(f.tenant_id),
      tipo: deLaLista(TIPOS, f.tipo, "tipo de invitación"),
      email: aEmail(f.email),
      estado: deLaLista(ESTADOS, f.estado, "estado de invitación"),
      emitidaEn: f.emitida_en,
      venceEn: f.vence_en,
      empresas: empresas
        .filter((e) => e.invitacion_id === f.id)
        .map((e): EmpresaInvitada => ({
          empresaId: empresaId(e.empresa_id),
          rol: deLaLista(ROLES_DE_EMPRESA, e.rol, "rol"),
          sucursales: sucursales
            .filter((s) => s.invitacion_id === f.id && s.empresa_id === e.empresa_id)
            .map((s) => sucursalId(s.sucursal_id)),
        })),
      aceptadaPor: f.aceptada_por === null ? null : personaId(f.aceptada_por),
      reemplazadaPor: f.reemplazada_por === null ? null : invitacionId(f.reemplazada_por),
      version: f.version,
    }));
  }

  return {
    async obtenerPorHash(tokenHash) {
      const fila = await db
        .selectFrom("invitacion")
        .select(columnas)
        .where("token_hash", "=", tokenHash)
        .executeTakeFirst();
      return fila === undefined ? null : ((await armar([fila]))[0] ?? null);
    },

    async obtenerPorId(id) {
      // Un texto que no es un UUID no puede ser el id de ninguna invitación: la base lo rechazaría
      // con un error de formato, y para quien pregunta es una invitación que no existe.
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("invitacion")
        .select(columnas)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : ((await armar([fila]))[0] ?? null);
    },

    async obtenerAltaVigente(empresa) {
      const fila = await db
        .selectFrom("invitacion as i")
        .innerJoin("invitacion_empresa as ie", "ie.invitacion_id", "i.id")
        .select([
          "i.id",
          "i.tenant_id",
          "i.tipo",
          "i.email",
          "i.estado",
          "i.emitida_en",
          "i.vence_en",
          "i.aceptada_por",
          "i.reemplazada_por",
          "i.version",
        ])
        .where("ie.empresa_id", "=", empresa)
        .where("i.tipo", "=", "ALTA_GERENTE")
        .orderBy("i.emitida_en", "desc")
        .orderBy("i.id", "desc")
        .limit(1)
        .executeTakeFirst();
      return fila === undefined ? null : ((await armar([fila], false))[0] ?? null);
    },

    async pendientesDeEmail(empresa, email) {
      const ids = await db
        .selectFrom("invitacion_empresa")
        .select("invitacion_id")
        .where("empresa_id", "=", empresa)
        .where("email", "=", email)
        .where("estado", "=", "PENDIENTE")
        .execute();
      if (ids.length === 0) return [];
      const filas = await db
        .selectFrom("invitacion")
        .select(columnas)
        .where(
          "id",
          "in",
          ids.map((i) => i.invitacion_id),
        )
        .orderBy("id")
        .execute();
      return armar(filas);
    },

    async pendientesDeLaEmpresa(empresa) {
      const filas = await db
        .selectFrom("invitacion_empresa as ie")
        .innerJoin("invitacion as i", "i.id", "ie.invitacion_id")
        .select(["i.id", "ie.email", "ie.rol", "i.emitida_en", "i.vence_en", "i.emitida_por"])
        .where("ie.empresa_id", "=", empresa)
        .where("ie.tipo", "=", "USUARIO")
        .where("i.estado", "=", "PENDIENTE")
        .orderBy("ie.email")
        .orderBy("i.id")
        .execute();
      if (filas.length === 0) return [];
      const sucursales = await db
        .selectFrom("invitacion_sucursal")
        .select(["invitacion_id", "sucursal_id"])
        .where("empresa_id", "=", empresa)
        .where(
          "invitacion_id",
          "in",
          filas.map((f) => f.id),
        )
        .orderBy("sucursal_id")
        .execute();
      return filas.map((f) => ({
        id: invitacionId(f.id),
        email: aEmail(f.email),
        rol: deLaLista(ROLES_DE_EMPRESA, f.rol, "rol"),
        sucursales: sucursales
          .filter((s) => s.invitacion_id === f.id)
          .map((s) => sucursalId(s.sucursal_id)),
        emitidaEn: f.emitida_en,
        venceEn: f.vence_en,
        emitidaPor: f.emitida_por === null ? null : personaId(f.emitida_por),
      }));
    },

    async crear(nueva) {
      await db
        .insertInto("invitacion")
        .values({
          id: nueva.id,
          tenant_id: nueva.tenantId,
          tipo: nueva.tipo,
          email: nueva.email,
          token_hash: nueva.tokenHash,
          emitida_en: nueva.emitidaEn,
          vence_en: nueva.venceEn,
          emitida_por: nueva.emitidaPor,
        })
        .execute();
      await db
        .insertInto("invitacion_empresa")
        .values(
          nueva.empresas.map((e) => ({
            invitacion_id: nueva.id,
            empresa_id: e.empresaId,
            tenant_id: nueva.tenantId,
            rol: e.rol,
            email: nueva.email,
            token_hash: nueva.tokenHash,
            estado: "PENDIENTE",
            tipo: nueva.tipo,
          })),
        )
        .execute();
      const sucursales = nueva.empresas.flatMap((e) =>
        e.sucursales.map((s) => ({
          invitacion_id: nueva.id,
          empresa_id: e.empresaId,
          sucursal_id: s,
        })),
      );
      if (sucursales.length > 0) {
        await db.insertInto("invitacion_sucursal").values(sucursales).execute();
      }
    },

    async marcarAceptada(id, versionEsperada, persona, ahora) {
      const r = await db
        .updateTable("invitacion")
        .set({ estado: "ACEPTADA", aceptada_por: persona, aceptada_en: ahora })
        .where("id", "=", id)
        .where("estado", "=", "PENDIENTE")
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async revocar(id, versionEsperada, ahora, motivo) {
      const r = await db
        .updateTable("invitacion")
        .set({ estado: "REVOCADA", revocada_en: ahora, motivo_revocacion: motivo })
        .where("id", "=", id)
        .where("estado", "=", "PENDIENTE")
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async vincularReemplazo(id, reemplazadaPor) {
      const r = await db
        .updateTable("invitacion")
        .set({ reemplazada_por: reemplazadaPor })
        .where("id", "=", id)
        .where("estado", "=", "REVOCADA")
        .where("reemplazada_por", "is", null)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },
  };
}

export function crearRepositorioDeTraspasos(db: Kysely<IdentidadDb>): RepositorioDeTraspasos {
  const columnas = [
    "id",
    "empresa_id",
    "origen",
    "saliente_persona_id",
    "entrante_persona_id",
    "estado",
    "propuesto_en",
    "vence_en",
    "version",
  ] as const;
  const aTraspaso = (fila: {
    id: string;
    empresa_id: string;
    origen: string;
    saliente_persona_id: string | null;
    entrante_persona_id: string;
    estado: string;
    propuesto_en: Date;
    vence_en: Date;
    version: number;
  }): TraspasoGuardado => ({
    id: traspasoId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    origen: deLaLista(ORIGENES_DE_TRASPASO, fila.origen, "origen de traspaso"),
    salientePersonaId:
      fila.saliente_persona_id === null ? null : personaId(fila.saliente_persona_id),
    entrantePersonaId: personaId(fila.entrante_persona_id),
    estado: deLaLista(ESTADOS_DE_TRASPASO, fila.estado, "estado de traspaso"),
    propuestoEn: fila.propuesto_en,
    venceEn: fila.vence_en,
    version: fila.version,
  });
  return {
    async obtener(empresa, id) {
      // Un texto que no es un UUID no puede ser el id de ningún traspaso: la base lo rechazaría con
      // un error de formato, y para quien pregunta es un traspaso que no existe.
      if (!FORMA_DE_UUID.test(id)) return null;
      const fila = await db
        .selectFrom("traspaso_gerencia")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .executeTakeFirst();
      return fila === undefined ? null : aTraspaso(fila);
    },

    async enCurso(empresa) {
      const fila = await db
        .selectFrom("traspaso_gerencia")
        .select(columnas)
        .where("empresa_id", "=", empresa)
        .where("estado", "=", "PROPUESTO")
        .executeTakeFirst();
      return fila === undefined ? null : aTraspaso(fila);
    },

    async proponer(datos) {
      const fila = await db
        .insertInto("traspaso_gerencia")
        .values({
          empresa_id: datos.empresaId,
          origen: "GERENTE",
          propuesto_por: datos.proponePor,
          saliente_persona_id: datos.proponePor,
          entrante_persona_id: datos.entrante,
          propuesto_en: datos.propuestoEn,
          vence_en: datos.venceEn,
        })
        .returning("id")
        .executeTakeFirstOrThrow();
      return traspasoId(fila.id);
    },

    async aceptar(empresa, id, versionEsperada, resueltoEn, saliente) {
      const r = await db
        .updateTable("traspaso_gerencia")
        .set({ estado: "ACEPTADO", resuelto_en: resueltoEn, saliente_persona_id: saliente })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PROPUESTO")
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async rechazar(empresa, id, versionEsperada, resueltoEn) {
      const r = await db
        .updateTable("traspaso_gerencia")
        .set({ estado: "RECHAZADO", resuelto_en: resueltoEn })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PROPUESTO")
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },

    async cancelar(empresa, id, versionEsperada, resueltoEn, motivo) {
      const r = await db
        .updateTable("traspaso_gerencia")
        .set({ estado: "CANCELADO", resuelto_en: resueltoEn, motivo })
        .where("empresa_id", "=", empresa)
        .where("id", "=", id)
        .where("estado", "=", "PROPUESTO")
        .where("version", "=", versionEsperada)
        .executeTakeFirst();
      return r.numUpdatedRows === 1n;
    },
  };
}
