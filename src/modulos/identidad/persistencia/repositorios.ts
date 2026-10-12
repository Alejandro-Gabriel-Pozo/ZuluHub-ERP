import type { Kysely } from "kysely";
import { ROLES_DE_EMPRESA } from "../../../capacidades/permisos/roles";
import {
  empresaId,
  invitacionId,
  personaId,
  sucursalId,
  tenantId,
  type EmpresaId,
  type InvitacionId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { emailDesdeTexto, type Email } from "../dominio/email";
import type {
  EmpresaInvitada,
  EstadoGuardado,
  Invitacion,
  NuevaInvitacion,
  RolDeEmpresa,
  TipoDeInvitacion,
} from "../dominio/invitacion";
import type { Membresia, Persona } from "../dominio/membresia";
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

const TIPOS: readonly TipoDeInvitacion[] = ["ALTA_GERENTE", "USUARIO"];
const ESTADOS: readonly EstadoGuardado[] = ["PENDIENTE", "ACEPTADA", "REVOCADA"];

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

export interface RepositorioDePersonas {
  buscarPorEmail(email: Email): Promise<Persona | null>;
  obtener(id: PersonaId): Promise<Persona | null>;
  /** Da de alta a una persona (solo con su email; el resto lo fija la base). */
  crear(email: Email): Promise<Persona>;
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
}

export interface RepositorioDeAsignaciones {
  deLaPersona(empresa: EmpresaId, persona: PersonaId): Promise<Asignacion[]>;
  crear(empresa: EmpresaId, persona: PersonaId, sucursales: readonly SucursalId[]): Promise<void>;
  reactivar(
    empresa: EmpresaId,
    persona: PersonaId,
    sucursal: SucursalId,
    versionEsperada: number,
  ): Promise<boolean>;
  /** Apaga todas las asignaciones activas de la persona en la empresa; devuelve cuántas. */
  apagarTodas(empresa: EmpresaId, persona: PersonaId): Promise<number>;
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
  const columnas = ["id", "email", "activo_global"] as const;
  const aPersona = (fila: { id: string; email: string; activo_global: boolean }): Persona => ({
    id: personaId(fila.id),
    email: aEmail(fila.email),
    activoGlobal: fila.activo_global,
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
  };
}

export function crearRepositorioDeAsignaciones(db: Kysely<IdentidadDb>): RepositorioDeAsignaciones {
  return {
    async deLaPersona(empresa, persona) {
      const filas = await db
        .selectFrom("asignacion_sucursal")
        .select(["empresa_id", "persona_id", "sucursal_id", "activa", "version"])
        .where("empresa_id", "=", empresa)
        .where("persona_id", "=", persona)
        .orderBy("sucursal_id")
        .execute();
      return filas.map((f) => ({
        empresaId: empresaId(f.empresa_id),
        personaId: personaId(f.persona_id),
        sucursalId: sucursalId(f.sucursal_id),
        activa: f.activa,
        version: f.version,
      }));
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
