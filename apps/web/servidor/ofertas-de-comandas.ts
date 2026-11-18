import "server-only";
/**
 * FICHA
 * QUÉ ES: Las ofertas de botones del módulo comandas: enviar a cocina, imprimir, reimprimir y administrar impresoras.
 * QUÉ NO ES: No lleva la lógica de otro módulo: cada módulo tiene su ofertas-de-MODULO.ts, y las lecturas de permisos pasan por permisos-de-la-persona.ts.
 * QUÉ EXPORTA: puedeEnviarAComandas, puedeImprimir, puedeReimprimir, puedeAdministrarImpresoras.
 * QUÉ IMPORTA: permisos-de-la-persona.ts. Lo consumen las páginas, por modulos.ts.
 * Previene: que el archivo común de ofertas vuelva a ser el punto donde chocan todos los PR de pantallas y que una pantalla lea los permisos dos veces por pedido. Chequeo: test/arquitectura/ofertas-por-modulo.test.ts.
 */
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
