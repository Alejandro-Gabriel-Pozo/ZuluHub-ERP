import { randomUUID } from "node:crypto";
import type pg from "pg";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { vencimientoDeTraspaso } from "../../src/modulos/identidad/publico";
import {
  personaId,
  sucursalId,
  type EmpresaId,
  type PersonaId,
  type SucursalId,
} from "../../src/primitivas/identificadores/marca";
import {
  AHORA_DE_PRUEBA,
  comoEmpresa,
  crearEmpresaActiva,
  type EmpresaDePrueba,
  type TxDePrueba,
} from "./entorno";
import type { TransaccionesDePostgres } from "../../src/adaptadores/postgres/transacciones";
import {
  crearAsignacionDeBase,
  crearMembresiaDeBase,
  crearPersonaDeBase,
  sucursalDe,
  type RolDePrueba,
} from "./fixtures-identidad";

/**
 * Escenarios y miradas comunes de las pruebas de H6 T4 y T3b (traspaso de gerencia y asignación de
 * sucursales). Todo se arma con el cliente del DUEÑO de la base (evade RLS): sirve para dejar listo el
 * escenario y para mirar; lo que se prueba después se hace con los casos de uso, los roles limitados
 * y el contexto firmado.
 */

export const ahora = AHORA_DE_PRUEBA;
const DIA = 86_400_000;
export const en = (dias: number) => new Date(ahora.getTime() + dias * DIA);

export type Fila = Record<string, unknown>;

export type Escenario = EmpresaDePrueba &
  Readonly<{
    empresaId: EmpresaId;
    /** La sucursal que trae la empresa de prueba ("Casa central"). */
    sucursal: SucursalId;
    gerente: PersonaId;
    gerenteEmail: string;
    ctx: ContextoOperativo;
  }>;

export type Miembro = Readonly<{ id: PersonaId; email: string; ctx: ContextoOperativo }>;

export function crearApoyoDeTraspaso(
  entorno: TransaccionesDePostgres<TxDePrueba>,
  dueno: pg.Client,
) {
  const filas = async <T extends Fila = Fila>(texto: string, parametros: unknown[] = []) =>
    (await dueno.query<T>(texto, parametros)).rows;
  const contar = async (texto: string, parametros: unknown[] = []) =>
    Number((await filas<{ n: string }>(texto, parametros))[0]?.["n"]);

  /** Una empresa activa con su sucursal y su gerente (miembro activo). */
  const escenario = async (tenant?: EmpresaDePrueba["tenant"]): Promise<Escenario> => {
    const e = await crearEmpresaActiva(entorno, tenant === undefined ? {} : { tenant });
    const sucursal = sucursalId(await sucursalDe(dueno, e.empresa));
    const g = await crearPersonaDeBase(dueno);
    await crearMembresiaDeBase(dueno, e.empresa, g.id, "GERENTE");
    const gerente = personaId(g.id);
    return {
      ...e,
      empresaId: e.empresa,
      sucursal,
      gerente,
      gerenteEmail: g.email,
      ctx: comoEmpresa(e.empresa, gerente),
    };
  };

  /** Un miembro más de la empresa (creado por el dueño de la base). */
  const miembro = async (
    e: Escenario,
    rol: RolDePrueba,
    activo = true,
    email?: string,
  ): Promise<Miembro> => {
    const p = await crearPersonaDeBase(dueno, email);
    await crearMembresiaDeBase(dueno, e.empresa, p.id, rol, activo);
    return { id: personaId(p.id), email: p.email, ctx: comoEmpresa(e.empresa, personaId(p.id)) };
  };

  /** Una sucursal más de la empresa, creada por el dueño de la base. */
  const sucursalExtra = async (e: Escenario, nombre: string): Promise<SucursalId> => {
    const { rows } = await dueno.query<{ id: string }>(
      "insert into sucursal (empresa_id, nombre) values ($1, $2) returning id",
      [e.empresa, nombre],
    );
    return sucursalId(rows[0]?.id as string);
  };
  const desactivarSucursalDeBase = (id: string) =>
    dueno.query("update sucursal set activa = false where id = $1", [id]);
  const asignarDeBase = (e: Escenario, persona: PersonaId, sucursal: SucursalId, activa = true) =>
    crearAsignacionDeBase(dueno, e.empresa, persona, sucursal, activa);

  /**
   * Un traspaso en curso propuesto por el gerente, armado por el dueño de la base. Por defecto nace
   * en `ahora` y vence en 7 días (lo que haría el caso de uso); `propuestoEn` y `venceEn` permiten
   * armar uno vencido o a punto de vencer.
   */
  const proponerDeBase = async (
    e: Escenario,
    entrante: PersonaId,
    fechas: { propuestoEn?: Date; venceEn?: Date } = {},
  ): Promise<string> => {
    const propuestoEn = fechas.propuestoEn ?? ahora;
    const { rows } = await dueno.query<{ id: string }>(
      `insert into traspaso_gerencia (empresa_id, origen, propuesto_por, saliente_persona_id,
                                      entrante_persona_id, propuesto_en, vence_en)
       values ($1, 'GERENTE', $2, $2, $3, $4, $5) returning id`,
      [
        e.empresa,
        e.gerente,
        entrante,
        propuestoEn,
        fechas.venceEn ?? vencimientoDeTraspaso(propuestoEn),
      ],
    );
    return rows[0]?.id as string;
  };

  /** Un traspaso de la plataforma (origen PLATAFORMA: sin saliente hasta que se acepta). */
  const proponerDePlataformaDeBase = async (e: Escenario, entrante: PersonaId): Promise<string> => {
    const { rows } = await dueno.query<{ id: string }>(
      `insert into traspaso_gerencia (empresa_id, origen, entrante_persona_id, propuesto_en, vence_en)
       values ($1, 'PLATAFORMA', $2, $3, $4) returning id`,
      [e.empresa, entrante, ahora, vencimientoDeTraspaso(ahora)],
    );
    return rows[0]?.id as string;
  };

  // ---- lo que se mira en la base ---------------------------------------------------------------

  const auditoria = (empresa: string, accion?: string) =>
    filas(
      `select accion, actor_persona_id, entidad, entidad_id, antes, despues from auditoria_empresa
       where empresa_id = $1 and ($2::text is null or accion = $2) order by id`,
      [empresa, accion ?? null],
    );
  const trabajos = (empresa: string) =>
    filas(
      "select tipo, datos, clave_idempotencia from trabajo where empresa_id = $1 order by clave_idempotencia",
      [empresa],
    );
  const traspaso = async (id: string) =>
    (await filas("select * from traspaso_gerencia where id = $1", [id]))[0];
  const traspasosDe = (empresa: string) =>
    filas("select * from traspaso_gerencia where empresa_id = $1 order by propuesto_en, id", [
      empresa,
    ]);
  const membresia = async (empresa: string, persona: string) =>
    (
      await filas<{ rol: string; activo: boolean; version: number }>(
        "select rol, activo, version from membresia where empresa_id = $1 and persona_id = $2",
        [empresa, persona],
      )
    )[0];
  const gerentesActivos = async (empresa: string) =>
    (
      await filas<{ persona_id: string }>(
        "select persona_id from membresia where empresa_id = $1 and rol = 'GERENTE' and activo order by persona_id",
        [empresa],
      )
    ).map((f) => f.persona_id);
  /** Las sucursales con asignación ACTIVA de la persona (sin mirar si la sucursal está activa), ordenadas. */
  const asignadas = async (empresa: string, persona: string): Promise<string[]> =>
    (
      await filas<{ sucursal_id: string }>(
        "select sucursal_id from asignacion_sucursal where empresa_id = $1 and persona_id = $2 and activa order by sucursal_id",
        [empresa, persona],
      )
    ).map((f) => f.sucursal_id);

  /** Todo lo que pueden tocar estos casos de uso, para las empresas indicadas: la "foto" de la base. */
  const foto = async (empresas: string[]) =>
    JSON.stringify({
      membresias: await filas(
        "select * from membresia where empresa_id = any($1) order by empresa_id, persona_id",
        [empresas],
      ),
      asignaciones: await filas(
        "select * from asignacion_sucursal where empresa_id = any($1) order by empresa_id, persona_id, sucursal_id",
        [empresas],
      ),
      sucursales: await filas("select * from sucursal where empresa_id = any($1) order by id", [
        empresas,
      ]),
      traspasos: await filas(
        "select * from traspaso_gerencia where empresa_id = any($1) order by id",
        [empresas],
      ),
      invitaciones: await filas(
        `select i.* from invitacion i where i.id in (select invitacion_id from invitacion_empresa where empresa_id = any($1))
         order by i.id`,
        [empresas],
      ),
      auditoria: await filas(
        "select id, empresa_id, accion from auditoria_empresa where empresa_id = any($1) order by id",
        [empresas],
      ),
      trabajos: await filas(
        "select id, empresa_id, tipo, estado from trabajo where empresa_id = any($1) order by id",
        [empresas],
      ),
    });

  const suspenderEmpresa = (empresa: string) =>
    dueno.query("update empresa set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [
      empresa,
    ]);
  const suspenderTenant = (tenant: string) =>
    dueno.query("update tenant set estado = 'SUSPENDED', motivo_estado = 'prueba' where id = $1", [
      tenant,
    ]);
  const suspenderPersona = (persona: string) =>
    dueno.query("update persona set activo_global = false where id = $1", [persona]);

  /** Una persona que no es miembro de la empresa (ni de ninguna). */
  const personaSuelta = async (): Promise<PersonaId> =>
    personaId((await crearPersonaDeBase(dueno)).id);
  const uuidAlAzar = () => randomUUID();

  return {
    filas,
    contar,
    escenario,
    miembro,
    sucursalExtra,
    desactivarSucursalDeBase,
    asignarDeBase,
    proponerDeBase,
    proponerDePlataformaDeBase,
    auditoria,
    trabajos,
    traspaso,
    traspasosDe,
    membresia,
    gerentesActivos,
    asignadas,
    foto,
    suspenderEmpresa,
    suspenderTenant,
    suspenderPersona,
    personaSuelta,
    uuidAlAzar,
  };
}
