import { exigirPerilla, type ErrorDePerilla } from "../../capacidades/planes/derechos";
import type { ClavePerilla } from "../../capacidades/planes/perillas";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import type {
  RepositorioDeEmpresas,
  RepositorioDeSucursales,
} from "../../modulos/empresas/publico";
import {
  TRABAJO_ENVIAR_INVITACION,
  claveDeEnvioDeInvitacion,
  nuevaInvitacion,
  type RepositorioDeInvitaciones,
} from "../../modulos/identidad/publico";
import type { LecturaDeMarcaParaElAlta } from "../../modulos/marcas/publico";
import type {
  AsignacionesDePlanDelAlta,
  LecturaDeVersionesDePlanParaElAlta,
  ModuloParaActivar,
  ModulosDeEmpresaDelAlta,
} from "../../modulos/planes/publico";
import type { RepositorioDeTenants } from "../../modulos/tenants/publico";
import type {
  EmpresaId,
  InvitacionId,
  MarcaComercialId,
  TenantId,
  VersionDePlanId,
} from "../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { AdminsDePlataforma } from "../../puertos/admins-de-plataforma";
import type { Auditoria } from "../../puertos/auditoria";
import type { LecturaDeDerechosDeUso } from "../../puertos/derechos-de-uso";
import type { TokenEmitido } from "../../puertos/tokens";
import type { Trabajos } from "../../puertos/trabajos";
import { comprobarAlta, type AltaValidada, type ErrorDeAlta } from "../dominio/alta";
import {
  decidirMarcaDelAlta,
  decidirModulosIniciales,
  decidirPlanElegido,
  decidirPlanPorDefecto,
  type ErrorDeMarcaDelAlta,
  type ErrorDePlanElegido,
  type MarcaDelAlta,
} from "../dominio/alta-con-marca";
import type { TxDeCasoDePlataforma } from "./caso-de-plataforma";

/**
 * El núcleo del alta de una empresa (H5 §B.5.1 más marcas y planes §B.10, tramos P5 y M6): todo lo que
 * hay que decidir y escribir para que una empresa nazca con su marca, su plan, sus módulos iniciales y la
 * invitación a su primer gerente. Corre DENTRO de la transacción de quien lo llama, que ya pasó el guard y
 * la clave de idempotencia: lo usan `altaDeEmpresa` (la consola, el script del primer administrador) y, más
 * adelante, `crearAltaDesdeSolicitud` (alta por solicitud, L4b). Un único lugar para la validación de
 * negocio, el orden de las escrituras y la auditoría.
 *
 * Todo o nada: cualquier error devuelto, o cualquier falla de la base, revierte la transacción del
 * llamador entera (tenant, plan, empresa, sucursal, módulos, invitación, trabajo y auditorías). El mail NO
 * sale acá: se encola (ADR-007) y lo envía el procesador de la cola cuando la transacción ya confirmó.
 */

/** Lo que el núcleo necesita de la transacción, además de lo que pide la plantilla de plataforma. */
export type TxDeAlta = TxDeCasoDePlataforma &
  Readonly<{
    admins: AdminsDePlataforma;
    tenants: RepositorioDeTenants;
    empresas: RepositorioDeEmpresas;
    sucursales: RepositorioDeSucursales;
    invitaciones: RepositorioDeInvitaciones;
    /** Encolar el mail del gerente: el envío real es del procesador, nunca de esta transacción. */
    trabajos: Trabajos;
    /** La auditoría de la EMPRESA (`auditoria_empresa`): el alta es lo primero que su historia cuenta. */
    auditoria: Auditoria;
    marcas: LecturaDeMarcaParaElAlta;
    versionesDePlan: LecturaDeVersionesDePlanParaElAlta;
    asignacionesDePlan: AsignacionesDePlanDelAlta;
    modulosDeEmpresa: ModulosDeEmpresaDelAlta;
    /** Los derechos del tenant, para el tope `empresas_por_tenant` y el techo de módulos del plan. */
    derechos: Pick<LecturaDeDerechosDeUso<string, ClavePerilla>, "delTenant">;
  }>;

/** El catálogo de módulos con el que se decide qué se activa (el real en producción; uno de prueba en las pruebas). */
export type CatalogoDeModulosDelAlta = Readonly<Record<string, ModuloParaActivar>>;

export type ParametrosDelNucleo = Readonly<{
  contexto: ContextoDePlataforma;
  catalogoDeModulos: CatalogoDeModulosDelAlta;
  /** La entrada ya validada en su forma (`validarAlta`). */
  alta: AltaValidada;
  /**
   * La invitación del gerente, emitida FUERA de la transacción (lleva azar): un reintento serializable
   * repite el trabajo con la misma id y el mismo hash.
   */
  invitacion: Pick<TokenEmitido, "invitacionId" | "tokenHash">;
}>;

/** Qué quedó creado. Es también lo que se repite ante una repetición de la clave. */
export type SalidaDelNucleo = Readonly<{
  tenantId: TenantId;
  empresaId: EmpresaId;
  invitacionId: InvitacionId;
}>;

export type ErrorDelNucleo =
  | ErrorDeAlta
  | ErrorDeMarcaDelAlta
  | ErrorDePlanElegido
  | "MARCA_SIN_PLAN_POR_DEFECTO"
  /**
   * El tope `empresas_por_tenant` del plan: `LIMITE_DEL_PLAN` con el límite y cuántas empresas tiene ya el
   * tenant. (`FUNCION_NO_INCLUIDA` es del tipo de la perilla y no puede salir de un límite.)
   */
  | ErrorDePerilla;

/** El nombre de la sucursal con la que nace toda empresa; después se renombra (caso 0, §8). */
export const NOMBRE_DE_LA_PRIMERA_SUCURSAL = "Casa central";

/** El motivo (obligatorio) de la primera asignación de plan de un tenant. */
export const MOTIVO_DE_LA_ASIGNACION_DE_ALTA = "Alta del tenant";

/** Dónde nace la empresa, con todo lo que hay que saber ya decidido. */
type Destino =
  | Readonly<{ tipo: "EXISTENTE"; tenantId: TenantId; marcaId: MarcaComercialId }>
  | Readonly<{
      tipo: "NUEVO";
      nombre: string;
      marcaId: MarcaComercialId;
      versionDePlanId: VersionDePlanId;
    }>;

/**
 * El plan de un tenant nuevo: la versión elegida o, si no se eligió, la última publicada del plan por
 * defecto de la marca. Lo usa también `marcasParaElAlta` (sin elegir plan) para decir, sin escribir, si la
 * marca sirve: la consola y el alta deciden con ESTA misma función.
 */
export function versionDePlanDelTenantNuevo(
  tx: Pick<TxDeAlta, "versionesDePlan">,
  elegida: null,
  marca: MarcaDelAlta,
): Promise<Resultado<VersionDePlanId, "MARCA_SIN_PLAN_POR_DEFECTO">>;
export function versionDePlanDelTenantNuevo(
  tx: Pick<TxDeAlta, "versionesDePlan">,
  elegida: VersionDePlanId | null,
  marca: MarcaDelAlta,
): Promise<Resultado<VersionDePlanId, ErrorDePlanElegido | "MARCA_SIN_PLAN_POR_DEFECTO">>;
export async function versionDePlanDelTenantNuevo(
  tx: Pick<TxDeAlta, "versionesDePlan">,
  elegida: VersionDePlanId | null,
  marca: MarcaDelAlta,
): Promise<Resultado<VersionDePlanId, ErrorDePlanElegido | "MARCA_SIN_PLAN_POR_DEFECTO">> {
  if (elegida !== null) return decidirPlanElegido(await tx.versionesDePlan.versionDePlan(elegida));
  return decidirPlanPorDefecto(
    marca.planPorDefectoId === null
      ? null
      : await tx.versionesDePlan.ultimaPublicadaDelPlan(marca.planPorDefectoId),
  );
}

export async function crearAltaEnTransaccion(
  tx: TxDeAlta,
  parametros: ParametrosDelNucleo,
): Promise<Resultado<SalidaDelNucleo, ErrorDelNucleo>> {
  const { contexto, catalogoDeModulos, alta, invitacion } = parametros;
  const { ahora } = contexto;

  // --- Lecturas y decisiones: ninguna escritura hasta saber todo lo que se puede saber. ---
  const emailEsDeAdminDePlataforma = await tx.admins.esEmailDeAdminActivo(alta.emailGerente);
  const tenantExistente =
    alta.tenant.tipo === "EXISTENTE" ? await tx.tenants.obtener(alta.tenant.tenantId) : null;
  const comprobacion = comprobarAlta(alta, { emailEsDeAdminDePlataforma, tenant: tenantExistente });
  if (!comprobacion.ok) return comprobacion;

  // La marca: la elegida para el tenant nuevo, o la del tenant que ya existe.
  const marcaId =
    alta.tenant.tipo === "NUEVO"
      ? alta.tenant.marcaId
      : await tx.tenants.marcaDe(alta.tenant.tenantId);
  if (marcaId === null) {
    throw new Error("el tenant existente no tiene marca: la base exige una en todo tenant");
  }
  const marca = decidirMarcaDelAlta(await tx.marcas.delAlta(marcaId, ahora));
  if (!marca.ok) return marca;

  let destino: Destino;
  if (alta.tenant.tipo === "EXISTENTE") {
    destino = { tipo: "EXISTENTE", tenantId: alta.tenant.tenantId, marcaId };
  } else {
    const version = await versionDePlanDelTenantNuevo(tx, alta.tenant.versionDePlanId, marca.valor);
    if (!version.ok) return version;
    destino = {
      tipo: "NUEVO",
      nombre: alta.tenant.nombre,
      marcaId,
      versionDePlanId: version.valor,
    };
  }

  // --- Escrituras, en orden. ---
  // El tenant nuevo y su plan van primero: el tope y el techo de módulos salen del plan.
  let tenantId: TenantId;
  if (destino.tipo === "NUEVO") {
    tenantId = (await tx.tenants.crear(destino.nombre, destino.marcaId)).id;
    await tx.asignacionesDePlan.asignarEnElAlta({
      tenantId,
      versionDePlanId: destino.versionDePlanId,
      vigenteDesde: ahora,
      motivo: MOTIVO_DE_LA_ASIGNACION_DE_ALTA,
    });
  } else {
    tenantId = destino.tenantId;
  }

  // El tope de empresas del tenant (perilla `empresas_por_tenant`). Se cuenta dentro de esta transacción
  // SERIALIZABLE: dos altas simultáneas que lo superarían no pasan las dos (una se reintenta y ve a la
  // otra). Una empresa cancelada ya no ocupa lugar: un alta vencida no deja al tenant sin poder repetirla.
  const derechos = await tx.derechos.delTenant(contexto, tenantId);
  if (derechos === null) {
    throw new Error("el tenant existe en esta transacción pero sus derechos no se pueden leer");
  }
  const enUso = (await tx.empresas.listarDelTenant(tenantId)).filter(
    (e) => e.estado !== "CANCELLED",
  ).length;
  const tope = exigirPerilla(derechos, "empresas_por_tenant", {}, enUso);
  if (!tope.ok) return tope;

  const empresa = await tx.empresas.crear({
    tenantId,
    cuit: alta.cuit,
    razonSocial: alta.razonSocial,
    zonaHoraria: alta.zonaHoraria,
  });
  await tx.sucursales.sembrar(empresa.id, NOMBRE_DE_LA_PRIMERA_SUCURSAL);

  // Los módulos iniciales: los de la marca que el plan incluye, con las reglas de la activación manual.
  const modulos = decidirModulosIniciales(catalogoDeModulos, marca.valor.modulosIniciales, [
    ...derechos.modulosHabilitados,
  ]);
  await tx.modulosDeEmpresa.activar(empresa.id, modulos.activar);

  // La invitación al primer gerente y el trabajo que la envía.
  const nueva = nuevaInvitacion(
    {
      id: invitacion.invitacionId,
      tokenHash: invitacion.tokenHash,
      tenantId,
      tipo: "ALTA_GERENTE",
      email: alta.emailGerente,
      empresas: [{ empresaId: empresa.id, rol: "GERENTE", sucursales: [] }],
      emitidaPor: null,
    },
    ahora,
  );
  if (!nueva.ok) throw new Error(`el alta armó una invitación inválida: ${nueva.error}`);
  await tx.invitaciones.crear(nueva.valor);
  await tx.trabajos.encolar({
    empresaId: empresa.id,
    tipo: TRABAJO_ENVIAR_INVITACION,
    datos: { invitacionId: invitacion.invitacionId },
    claveDeIdempotencia: claveDeEnvioDeInvitacion(invitacion.invitacionId),
  });

  // --- Constancias. La de la empresa cuenta su historia (sin actor: el responsable queda en plataforma). ---
  const versionDePlanId = destino.tipo === "NUEVO" ? destino.versionDePlanId : null;
  await tx.auditoria.registrar({
    empresaId: empresa.id,
    actorPersonaId: null,
    accion: "EMPRESA_ALTA",
    entidad: "empresa",
    entidadId: empresa.id,
    despues: { tenantId, marcaId, estado: empresa.estado },
  });
  if (versionDePlanId !== null) {
    await tx.auditoria.registrar({
      empresaId: empresa.id,
      actorPersonaId: null,
      accion: "PLAN_ASIGNADO",
      entidad: "tenant",
      entidadId: tenantId,
      despues: { versionDePlanId, origen: "ALTA" },
    });
  }
  for (const modulo of modulos.activar) {
    await tx.auditoria.registrar({
      empresaId: empresa.id,
      actorPersonaId: null,
      accion: "MODULO_ACTIVADO",
      entidad: "modulo",
      entidadId: modulo,
      despues: { origen: "ALTA" },
    });
  }

  // Las de plataforma: quién (el actor del contexto) dio de alta qué, con qué marca, plan y módulos. Sin
  // el token ni el hash de la invitación.
  if (destino.tipo === "NUEVO") {
    await tx.auditoriaDePlataforma.registrar({
      accion: "TENANT_ALTA",
      entidad: "tenant",
      entidadId: tenantId,
      antes: null,
      despues: { nombre: destino.nombre, marcaId, versionDePlanId: destino.versionDePlanId },
    });
  }
  await tx.auditoriaDePlataforma.registrar({
    accion: "EMPRESA_ALTA",
    entidad: "empresa",
    entidadId: empresa.id,
    antes: null,
    despues: {
      tenantId,
      cuit: alta.cuit,
      razonSocial: alta.razonSocial,
      zonaHoraria: alta.zonaHoraria,
      moneda: alta.moneda,
      emailGerente: alta.emailGerente,
      invitacionId: invitacion.invitacionId,
      marcaId,
      versionDePlanId,
      modulosActivados: [...modulos.activar],
      modulosOmitidos: modulos.omitidos.map((m) => ({ modulo: m.modulo, motivo: m.motivo })),
    },
  });

  return ok({ tenantId, empresaId: empresa.id, invitacionId: invitacion.invitacionId });
}
