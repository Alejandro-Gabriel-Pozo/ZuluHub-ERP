import type { Kysely } from "kysely";
import { ROLES_DE_EMPRESA } from "../../../capacidades/permisos/roles";
import {
  empresaId,
  invitacionId,
  marcaComercialId,
  personaId,
  sucursalId,
  tenantId,
  type EmpresaId,
  type InvitacionId,
  type MarcaComercialId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { Email } from "../../../primitivas/contacto/email";
import type {
  EmpresaInvitada,
  EstadoGuardado,
  Invitacion,
  NuevaInvitacion,
  RolDeEmpresa,
  TipoDeInvitacion,
} from "../dominio/invitacion";
import type { IdentidadDb } from "./tablas";
import { deLaLista, aEmail, FORMA_DE_UUID } from "./repositorios-comunes";

const TIPOS: readonly TipoDeInvitacion[] = ["ALTA_GERENTE", "USUARIO"];
const ESTADOS: readonly EstadoGuardado[] = ["PENDIENTE", "ACEPTADA", "REVOCADA"];

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

export interface RepositorioDeInvitaciones {
  /** Por el hash del token (contexto de INVITACION). */
  obtenerPorHash(tokenHash: string): Promise<Invitacion | null>;
  obtenerPorId(id: InvitacionId): Promise<Invitacion | null>;
  /**
   * La marca comercial del tenant de la invitación con ese hash (`tenant.marca_id`), leída en la misma
   * transacción y con lo que el contexto de INVITACION ya ve (la invitación y su tenant). `null`: no se
   * ve ninguna invitación con ese hash (o no se ve su tenant); quien llama lo trata como «no existe».
   */
  marcaDelTenantDeLaInvitacion(tokenHash: string): Promise<MarcaComercialId | null>;
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

    async marcaDelTenantDeLaInvitacion(tokenHash) {
      const fila = await db
        .withTables<{ tenant: { id: string; marca_id: string } }>()
        .selectFrom("invitacion as i")
        .innerJoin("tenant as t", "t.id", "i.tenant_id")
        .select("t.marca_id")
        .where("i.token_hash", "=", tokenHash)
        .executeTakeFirst();
      return fila === undefined ? null : marcaComercialId(fila.marca_id);
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
