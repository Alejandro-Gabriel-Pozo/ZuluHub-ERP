import type { EstadoDeEmpresa } from "../../contexto/estados";
import type { ClaveAccion, ClaveModulo } from "../modulos/catalogo";
import type { ClaveAccionDePlataforma } from "../permisos/plataforma";

/** La forma de una entrada del registro de datos (ver `registro.ts`): vive aparte para que cada módulo declare sus datos en su propio archivo sin importar el registro (sin ciclos). */
export type Proposito = Readonly<{
  /** Para qué existe: una pantalla o un caso de uso reales. */
  para: string;
  /** Documento verificable (archivo y sección) donde el dueño o el diseño lo pidió. */
  fuente: string;
}>;

type BaseDeDato = Readonly<{
  /** Ruta de la primitiva (la «ficha del dato»), desde la raíz del repositorio. */
  ficha: string;
  propositos: readonly [Proposito, ...Proposito[]];
  /** Archivos de pantalla (desde la raíz) que pueden pedir este dato. Uno que lo pide y no figura acá falla; uno que figura y no lo pide también. */
  consumidores: readonly [string, ...string[]];
}>;

/** Un dato de la web de las empresas: lo piden archivos de `apps/web`, lo pone una acción de empresa y existe en un módulo. */
export type DatoDeEmpresa = BaseDeDato &
  Readonly<{
    ambito?: "EMPRESA";
    /** Acciones de permiso que habilitan a ponerlo. */
    ponerPor: readonly [ClaveAccion, ...ClaveAccion[]];
    requiere: Readonly<{
      modulo: ClaveModulo;
      estadoDeEmpresa: readonly [EstadoDeEmpresa, ...EstadoDeEmpresa[]];
    }>;
  }>;

/**
 * Un dato de la consola de plataforma: lo piden archivos de `apps/plataforma` y lo pone una acción de plataforma (roles `ADMIN`/`SOPORTE` ya existentes). No tiene módulo ni estado de empresa.
 * Previene: un campo de la consola sin dato registrado (que obligaba a «pendiente», deuda que solo baja y que un archivo nuevo no puede abrir) y un dato de empresa pedido desde la consola o al revés
 * (`test/arquitectura/campos-con-dato.test.ts`, con violación inyectada).
 */
export type DatoDeConsola = BaseDeDato &
  Readonly<{
    ambito: "PLATAFORMA";
    ponerPor: readonly [ClaveAccionDePlataforma, ...ClaveAccionDePlataforma[]];
  }>;

export type DefinicionDeDato = DatoDeEmpresa | DatoDeConsola;
