import type { RepositorioDeListas, ValorDeLista } from "../../modulos/listas/publico";
import type { Dato } from "../../puertos/sin-secretos";
import {
  ejecutarCasoDePlataforma,
  type DependenciasDeCasoDePlataforma,
  type ErrorComunDeCasoDePlataforma,
  type PlantillaDeCasoDePlataforma,
  type TxDeCasoDePlataforma,
} from "./caso-de-plataforma";
import type { Resultado } from "../../primitivas/resultado/resultado";

/**
 * Lo común de los casos de uso y las consultas de plataforma sobre las listas del sistema (e3 §3.7, decisión 130): la transacción, las
 * dependencias y el recorte de datos que va a la auditoría. La lista de valores es GLOBAL (sin empresa): ningún caso deja constancia
 * en la auditoría de una empresa, solo en la de plataforma.
 */

/** Lo que recibe el trabajo de cada caso de listas: el repositorio y lo común de plataforma (guard, auditoría, idempotencia). */
export type TxDeListas = TxDeCasoDePlataforma & Readonly<{ listas: RepositorioDeListas }>;

export type DependenciasDeListas = DependenciasDeCasoDePlataforma<TxDeListas>;

/** Lo que todo caso de listas puede devolver además de lo propio. */
export type ErrorComunDeListas = ErrorComunDeCasoDePlataforma;

/** Ejecuta un caso de listas con la plantilla común (ver `caso-de-plataforma.ts` por el orden de los pasos). */
export function ejecutarCasoDeListas<S extends Dato, V, E>(
  dependencias: DependenciasDeListas,
  plantilla: PlantillaDeCasoDePlataforma<TxDeListas, S, V, E>,
): Promise<Resultado<S, E | ErrorComunDeListas>> {
  return ejecutarCasoDePlataforma<TxDeListas, S, V, E>(dependencias, plantilla);
}

/** El valor tal como queda en `antes` y `despues` de la auditoría de plataforma: sin id (va en `entidadId`) ni fechas (las fija la base). */
export const datosDelValorDeLista = (valor: ValorDeLista): Readonly<Record<string, Dato>> => ({
  lista: valor.lista,
  nombre: valor.nombre,
  activo: valor.activo,
  fija: valor.fija,
  version: valor.version,
});

/** La entidad con la que la auditoría de plataforma guarda todo cambio de una lista. */
export const ENTIDAD_VALOR_DE_LISTA = "valor_de_lista";
