import type { EstadoDeEmpresa } from "../../contexto/estados";
import type { ClaveAccion, ClaveModulo } from "../modulos/catalogo";

/** La forma de una entrada del registro de datos (ver `registro.ts`): vive aparte para que cada módulo declare sus datos en su propio archivo sin importar el registro (sin ciclos). */
export type Proposito = Readonly<{
  /** Para qué existe: una pantalla o un caso de uso reales. */
  para: string;
  /** Documento verificable (archivo y sección) donde el dueño o el diseño lo pidió. */
  fuente: string;
}>;

export type DefinicionDeDato = Readonly<{
  /** Ruta de la primitiva (la «ficha del dato»), desde la raíz del repositorio. */
  ficha: string;
  propositos: readonly [Proposito, ...Proposito[]];
  /** Archivos de pantalla (desde la raíz) que pueden pedir este dato. Uno que lo pide y no figura acá falla; uno que figura y no lo pide también. */
  consumidores: readonly [string, ...string[]];
  /** Acciones de permiso que habilitan a ponerlo. */
  ponerPor: readonly [ClaveAccion, ...ClaveAccion[]];
  requiere: Readonly<{
    modulo: ClaveModulo;
    estadoDeEmpresa: readonly [EstadoDeEmpresa, ...EstadoDeEmpresa[]];
  }>;
}>;
