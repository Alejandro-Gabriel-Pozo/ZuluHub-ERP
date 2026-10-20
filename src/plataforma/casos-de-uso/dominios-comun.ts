import type {
  DominioGuardado,
  ErrorDeDominioPorRestriccion,
  RepositorioDeDominios,
} from "../../modulos/marcas/publico";
import type { Resultado } from "../../primitivas/resultado/resultado";
import type { Dato } from "../../puertos/sin-secretos";
import {
  ejecutarCasoDePlataforma,
  type DependenciasDeCasoDePlataforma,
  type ErrorComunDeCasoDePlataforma,
  type PlantillaDeCasoDePlataforma,
  type TxDeCasoDePlataforma,
} from "./caso-de-plataforma";

/**
 * Lo común de los casos de uso de dominios de plataforma (M4a): la plantilla de «guard, forma de la
 * clave, idempotencia, trabajo, auditoría y registro de la clave» y los errores que comparten.
 */

/** Lo que recibe el trabajo de cada caso de dominios: el repositorio, el administrador, la auditoría y la idempotencia. */
export type TxDeDominios = TxDeCasoDePlataforma &
  Readonly<{
    dominios: RepositorioDeDominios;
  }>;

export type DependenciasDeDominios = DependenciasDeCasoDePlataforma<TxDeDominios>;

/** Lo que todo caso de dominios puede devolver además de lo propio. */
export type ErrorComunDeDominios = ErrorComunDeCasoDePlataforma;

/** Los motivos que la base puede devolver y el caso admite; el resto de las restricciones sale como error de persistencia. */
export type MotivoDeBase = ErrorDeDominioPorRestriccion;

export type PlantillaDeDominios<S extends Dato, V, E extends string> = PlantillaDeCasoDePlataforma<
  TxDeDominios,
  S,
  V,
  E
>;

/**
 * La plantilla de todo caso de dominios (M4a): la común de plataforma (`caso-de-plataforma.ts`) con la
 * transacción de dominios. El orden de los pasos y sus garantías están descritos allá.
 */
export function ejecutarCasoDeDominios<S extends Dato, V, E extends string>(
  dependencias: DependenciasDeDominios,
  plantilla: PlantillaDeDominios<S, V, E>,
): Promise<Resultado<S, E | ErrorComunDeDominios>> {
  return ejecutarCasoDePlataforma(dependencias, plantilla);
}

/** Los datos del dominio que quedan en la constancia: lo necesario para saber a qué host se refiere y en qué estado quedó. */
export function datosDeAuditoriaDeDominio(dominio: DominioGuardado): Record<string, Dato> {
  return {
    host: dominio.host,
    superficie: dominio.superficie,
    estado: dominio.estado,
    verificadoEn: dominio.verificadoEn === null ? null : dominio.verificadoEn.toISOString(),
    motivo: dominio.motivo,
  };
}
