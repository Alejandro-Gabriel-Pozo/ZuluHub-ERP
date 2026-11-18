import "server-only";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { puedeLaAccion } from "./permisos-de-la-persona";

/**
 * Los botones de las comandas y de las impresiones (S-0r), uno por grupo de acciones: ¿la persona puede enviar a cocina, imprimir, reimprimir o administrar las impresoras? Cada una es la
 * oferta de SU acción (`comandas.enviar`, `impresiones.imprimir`, `impresiones.reimprimir`, `impresoras.editar`: Gerente y Administrador administran las
 * impresoras; el resto, los tres roles) que el servidor calcula con `ofertaDe`: con el módulo en desarrollo, en solo lectura o sin el rol, no. Si no se pudieron leer los permisos, `false` (cierra, no abre).
 * Ocultar no es autorizar: la acción vuelve a pasar por el guard. Es solo la ayuda que apaga el botón. Chequeo: `test/web/salon-acceso.test.ts`.
 */
export const puedeEnviarAComandas = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "comandas.enviar");
export const puedeImprimir = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "impresiones.imprimir");
export const puedeReimprimir = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "impresiones.reimprimir");
export const puedeAdministrarImpresoras = (contexto: ContextoOperativo): Promise<boolean> =>
  puedeLaAccion(contexto, "impresoras.editar");
