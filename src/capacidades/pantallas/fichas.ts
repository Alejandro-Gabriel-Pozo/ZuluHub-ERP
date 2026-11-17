import type { FichaDePantalla } from "./tipos-de-fichas";

export type {
  BotonDeFicha,
  EntradaDeMenuDeFicha,
  EstadoDeLaFicha,
  EstadoDePantalla,
  FichaDePantalla,
  HaceUnBoton,
  ModalDeFicha,
} from "./tipos-de-fichas";
export { ESTADOS_DE_PANTALLA } from "./tipos-de-fichas";

/**
 * Las fichas de pantalla declaradas (decisión del dueño, fila 174 de `decisiones-del-dueno-2026-11.md`). Hoy VACÍO a propósito: este
 * tramo solo define los tipos. Cada pantalla suma su ficha en `fichas-de-<módulo>.ts` cuando la construye o la migra.
 */
export const FICHAS = {} as const satisfies Readonly<Record<string, FichaDePantalla>>;

export type IdDeFicha = keyof typeof FICHAS;
