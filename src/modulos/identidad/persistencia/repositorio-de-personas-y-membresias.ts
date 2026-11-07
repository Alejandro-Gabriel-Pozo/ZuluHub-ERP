import type { Kysely } from "kysely";
import { ROLES_DE_EMPRESA } from "../../../capacidades/permisos/roles";
import {
  empresaId,
  invitacionId,
  personaId,
  usuarioAuthId,
  type EmpresaId,
  type InvitacionId,
  type PersonaId,
  type UsuarioAuthId,
} from "../../../primitivas/identificadores/marca";
import type { Email } from "../../../primitivas/contacto/email";
import type { RolDeEmpresa } from "../dominio/invitacion";
import type { Membresia, PersonaConUsuario } from "../dominio/membresia";
import type { IdentidadDb } from "./tablas";
import { deLaLista, aEmail } from "./repositorios-comunes";

/** Un miembro de la empresa (activo o no) con el email de su persona, para las listas de la pantalla. */
export type MiembroConEmail = Readonly<{ membresia: Membresia; email: Email }>;

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
