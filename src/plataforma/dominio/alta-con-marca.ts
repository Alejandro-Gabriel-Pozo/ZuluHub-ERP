import { resolverDefinicion, type DatosDeMarcaParaElAlta } from "../../modulos/marcas/publico";
import {
  decidirActivacion,
  type ModuloParaActivar,
  type VersionDePlanAsignable,
} from "../../modulos/planes/publico";
import type { PlanId, VersionDePlanId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * Con qué nace una empresa dada de alta (marcas y planes §B.10, tramo M6): lo que decide la MARCA por la
 * que entra (módulos iniciales y plan por defecto), el PLAN que se le asigna al tenant nuevo y los
 * MÓDULOS que quedan activados. Dominio puro: decide con lo que el caso de uso leyó dentro de la
 * transacción; sin reloj, sin azar, sin guard y sin puertos.
 */

export type ErrorDeMarcaDelAlta =
  "MARCA_NO_ENCONTRADA" | "MARCA_RETIRADA" | "MARCA_SIN_DEFINICION" | "MARCA_SIN_DOMINIO";

/** Lo que la marca aporta al alta, con la herencia de sus ancestros aplicada. */
export type MarcaDelAlta = Readonly<{
  /** Los módulos que la marca propone al nacer una empresa (`[]`: solo administración). */
  modulosIniciales: readonly string[];
  /** El plan por defecto de la marca, o `null` si ninguna versión de la cadena lo define. */
  planPorDefectoId: PlanId | null;
}>;

/**
 * ¿Se puede dar de alta una empresa por la puerta de esa marca? Orden de los errores:
 *  - `MARCA_NO_ENCONTRADA`: no existe (o no se ve);
 *  - `MARCA_RETIRADA`: una marca retirada no recibe tenants nuevos ni empresas nuevas;
 *  - `MARCA_SIN_DEFINICION`: la PROPIA marca no tiene una versión vigente con nombre (un producto no hereda el
 *    nombre: sin él no hay con qué nombrar el mail ni la pantalla). Sin versión no hay módulos iniciales
 *    ni plan por defecto que valgan;
 *  - `MARCA_SIN_DOMINIO`: una marca que no es la principal y no tiene un host canónico ACTIVO de la
 *    aplicación: el enlace de la invitación del gerente no tendría adónde apuntar, y el mail NO sale con la
 *    identidad de otra marca (§B.10). Solo la principal puede apoyarse en el respaldo de las variables.
 */
export function decidirMarcaDelAlta(
  datos: DatosDeMarcaParaElAlta | null,
): Resultado<MarcaDelAlta, ErrorDeMarcaDelAlta> {
  if (datos === null) return err("MARCA_NO_ENCONTRADA");
  if (datos.estado === "RETIRADA") return err("MARCA_RETIRADA");
  const propia = datos.cadena[0];
  if (propia === undefined || propia === null || propia.nombreVisible === null) {
    return err("MARCA_SIN_DEFINICION");
  }
  if (!datos.esPrincipal && datos.hostCanonico === null) return err("MARCA_SIN_DOMINIO");
  const resuelta = resolverDefinicion(datos.cadena);
  return ok({
    modulosIniciales: resuelta.modulosIniciales ?? [],
    planPorDefectoId: resuelta.planPorDefectoId,
  });
}

export type ErrorDePlanElegido =
  "VERSION_DE_PLAN_NO_ENCONTRADA" | "VERSION_DE_PLAN_NO_PUBLICADA" | "PLAN_RETIRADO";

/**
 * La versión de plan que el administrador eligió para el tenant nuevo. Orden de los errores: no existe,
 * no está publicada (un borrador no se asigna) y su plan está retirado (no se le asignan tenants nuevos).
 * Planes es global de la fábrica: no hace falta que sea «de la marca».
 */
export function decidirPlanElegido(
  version: VersionDePlanAsignable | null,
): Resultado<VersionDePlanId, ErrorDePlanElegido> {
  if (version === null) return err("VERSION_DE_PLAN_NO_ENCONTRADA");
  if (!version.publicada) return err("VERSION_DE_PLAN_NO_PUBLICADA");
  if (version.planRetirado) return err("PLAN_RETIRADO");
  return ok(version.versionDePlanId);
}

/**
 * La versión de plan por defecto de la marca: la última publicada de su plan por defecto. Sin plan por
 * defecto, sin versión publicada o con el plan retirado, la marca no puede dar de alta un tenant solo
 * (`MARCA_SIN_PLAN_POR_DEFECTO`): hay que elegir una versión a mano o arreglar la marca.
 */
export function decidirPlanPorDefecto(
  version: VersionDePlanAsignable | null,
): Resultado<VersionDePlanId, "MARCA_SIN_PLAN_POR_DEFECTO"> {
  if (version === null || !version.publicada || version.planRetirado) {
    return err("MARCA_SIN_PLAN_POR_DEFECTO");
  }
  return ok(version.versionDePlanId);
}

/** Un módulo inicial que NO se activó, y por qué (el código de `decidirActivacion`). */
export type ModuloOmitido = Readonly<{ modulo: string; motivo: string }>;

export type ModulosInicialesDecididos = Readonly<{
  /** En el orden en que pueden activarse (cada uno después de los que requiere). */
  activar: readonly string[];
  omitidos: readonly ModuloOmitido[];
}>;

/**
 * Los módulos que quedan activados al nacer la empresa: los iniciales de la marca que el plan incluye
 * (`habilitados`, el techo: obligatorios más los del plan), con las MISMAS reglas que la activación manual
 * (`decidirActivacion`): del catálogo, disponibles, no obligatorios, dentro del techo y con sus `requiere`
 * activos. Lo que no cumple se OMITE con su motivo, no frena el alta (el plan manda sobre la propuesta de la
 * marca). El orden en que la marca los lista no importa: un módulo cuyo requerido viene después se activa
 * cuando el requerido ya está. Repetidos: cuenta una vez.
 */
export function decidirModulosIniciales(
  catalogo: Readonly<Record<string, ModuloParaActivar>>,
  iniciales: readonly string[],
  habilitados: readonly string[],
): ModulosInicialesDecididos {
  const activados: string[] = [];
  let pendientes = [...new Set(iniciales)];
  for (;;) {
    const rechazos: ModuloOmitido[] = [];
    let siguiente: string | null = null;
    for (const modulo of pendientes) {
      const decision = decidirActivacion({ catalogo, modulo, activados, habilitados });
      if (decision.ok) {
        siguiente = modulo;
        break;
      }
      rechazos.push({ modulo, motivo: decision.error.codigo });
    }
    if (siguiente === null) return { activar: activados, omitidos: rechazos };
    activados.push(siguiente);
    pendientes = pendientes.filter((modulo) => modulo !== siguiente);
  }
}
