import type { ClaveAccion } from "../modulos/catalogo";
import type { IdDeDato } from "./registro";

export type PasoDeCamino = Readonly<{
  id: string;
  /** El nombre de cada campo del pedido que este paso pide y el dato del registro que completa. */
  campos: Readonly<Record<string, IdDeDato>>;
}>;

export type DefinicionDeCamino = Readonly<{
  /** Qué hace la persona con la pantalla. */
  funcion: string;
  /** Las pantallas (archivos desde la raíz) donde se recorre el camino. */
  pantallas: readonly [string, ...string[]];
  pasos: readonly [PasoDeCamino, ...PasoDeCamino[]];
  /** Lo que la acción recibe sin que ningún paso lo pida (por ejemplo, una letra que se calcula): cubre lo que la acción exige. */
  deriva: readonly IdDeDato[];
  accion: Readonly<{
    clave: ClaveAccion;
    /** Los datos sin los cuales la acción no se puede ejecutar. */
    requiere: readonly IdDeDato[];
    /** Los datos opcionales que la acción acepta. */
    admite: readonly IdDeDato[];
  }>;
  /** Los `campo` que el servidor puede devolver en un error de esta acción (nombres de campo del pedido). */
  camposDeError: readonly string[];
}>;
