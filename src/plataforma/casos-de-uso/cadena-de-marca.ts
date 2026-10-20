import {
  resolverDefinicion,
  versionVigente,
  type DefinicionDeMarca,
  type MarcaGuardada,
  type PlanPorDefecto,
} from "../../modulos/marcas/publico";
import type { PlanGuardado, VersionPublicadaDePlan } from "../../modulos/planes/publico";
import type { PlanId } from "../../primitivas/identificadores/marca";
import type { TxDeMarcasYPlanes } from "./marcas-y-planes-comun";

/**
 * Cómo se lee la herencia de una marca (M5), en UN solo lugar para quien la CONFIRMA y quien la MIRA: la
 * consola ve exactamente la cadena que valida `confirmarVersionDeMarca`, así «lo que ves es lo que se valida».
 *
 * Matiz con el alta (M6): `LecturaDeMarcaParaElAlta` arma su propia cadena en SQL y la CORTA ante un
 * ancestro retirado (la herencia no pasa por él); ésta no la corta: sube por `marca_padre_id` hasta
 * `ANCESTROS_QUE_HEREDAN` eslabones, esté retirado o no. Una marca con un padre retirado puede, entonces,
 * confirmar una versión que hereda de él y no ser elegible en el alta por otro motivo. Hoy ninguna
 * operación retira una marca (no hay caso de uso), así que no se manifiesta; si llegara a haberlo, hay que
 * decidir cuál de las dos cadenas manda y unificarlas.
 */

/** Lo que de la marca hace falta para leer la cadena: sus marcas y sus versiones. */
export type TxDeLaCadena = Pick<TxDeMarcasYPlanes, "marcas">;

/** Lo que hace falta para leer el plan por defecto. */
export type TxDelPlanPorDefecto = Pick<TxDeMarcasYPlanes, "planes">;

/** Cuántos ancestros mira la herencia: el padre y el abuelo (la base admite dos niveles bajo la principal). */
const ANCESTROS_QUE_HEREDAN = 2;

/** Un ancestro de la marca con lo que dice hoy: su definición VIGENTE, o `null` si todavía no tiene versión vigente. */
export type AncestroConDefinicion = Readonly<{
  marca: MarcaGuardada;
  definicion: DefinicionDeMarca | null;
}>;

/**
 * El padre y el abuelo de la marca, en ese orden, cada uno con su definición VIGENTE a `ahora`. Se leen
 * dentro de la transacción: una confirmación del padre y la de la hija a la vez quedan en algún orden
 * serial. Se corta al llegar a una marca sin padre (o cuyo padre ya no existe).
 */
export async function ancestrosConDefinicion(
  tx: TxDeLaCadena,
  marca: MarcaGuardada,
  ahora: Date,
): Promise<AncestroConDefinicion[]> {
  const ancestros: AncestroConDefinicion[] = [];
  let actual = marca;
  while (actual.marcaPadreId !== null && ancestros.length < ANCESTROS_QUE_HEREDAN) {
    const padre = await tx.marcas.obtener(actual.marcaPadreId);
    if (padre === null) break;
    const vigente = versionVigente(await tx.marcas.confirmadasDe(padre.id), ahora);
    ancestros.push({ marca: padre, definicion: vigente === null ? null : vigente.definicion });
    actual = padre;
  }
  return ancestros;
}

/**
 * Las definiciones VIGENTES del padre y del abuelo de la marca, en ese orden (`null`: ese ancestro no
 * tiene versión vigente todavía). Es lo que recibe `decidirConfirmacionDeMarca` como `ancestros`.
 */
export async function ancestrosDe(
  tx: TxDeLaCadena,
  marca: MarcaGuardada,
  ahora: Date,
): Promise<(DefinicionDeMarca | null)[]> {
  return (await ancestrosConDefinicion(tx, marca, ahora)).map((a) => a.definicion);
}

/** Un plan por defecto con lo que se sabe de él: el plan y su última versión publicada (`null` si no publicó ninguna). */
export type PlanConSuUltimaVersion = Readonly<{
  plan: PlanGuardado;
  ultimaPublicada: VersionPublicadaDePlan | null;
}>;

/** El plan con su última versión publicada; `null` si el plan no existe. */
export async function planConSuUltimaVersion(
  tx: TxDelPlanPorDefecto,
  id: PlanId,
): Promise<PlanConSuUltimaVersion | null> {
  const plan = await tx.planes.obtenerPlan(id);
  if (plan === null) return null;
  const ultimaPublicada = (await tx.planes.publicadasDe(plan.id)).at(-1) ?? null;
  return { plan, ultimaPublicada };
}

/**
 * El plan por defecto al que apunta la definición resuelta, con lo que la confirmación necesita de él: si
 * está retirado y los módulos que incluye su última versión publicada (el techo de lo que puede traer una
 * empresa nueva). `null` si la definición no apunta a ninguno (la confirmación dirá que está incompleta).
 */
export async function planPorDefectoDe(
  tx: TxDelPlanPorDefecto,
  borrador: DefinicionDeMarca,
  ancestros: readonly (DefinicionDeMarca | null)[],
): Promise<PlanPorDefecto | null> {
  const resuelta = resolverDefinicion([borrador, ...ancestros]);
  if (resuelta.planPorDefectoId === null) return null;
  const leido = await planConSuUltimaVersion(tx, resuelta.planPorDefectoId);
  return leido === null ? null : comoPlanPorDefecto(leido);
}

/**
 * El plan leído, tal como lo necesita `decidirConfirmacionDeMarca`: si está retirado y el techo de módulos
 * de su última versión publicada (`[]` si no publicó ninguna). Una sola conversión para la confirmación y para
 * quien la prevé.
 */
export const comoPlanPorDefecto = (leido: PlanConSuUltimaVersion): PlanPorDefecto => ({
  id: leido.plan.id,
  retirado: leido.plan.estado === "RETIRADO",
  modulos: leido.ultimaPublicada === null ? [] : leido.ultimaPublicada.modulos,
});
