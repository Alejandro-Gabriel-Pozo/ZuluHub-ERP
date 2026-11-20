import "server-only";
/**
 * Parte dedicada de `modulos.ts` (archivo central, ver su encabezado): las ofertas de botones del módulo cierre: la pantalla «Cierre del día».
 */
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { AccionesDelCierre } from "../ui/plantillas/cierre/modelo-del-cierre";
import { permisosDeLaPersona } from "./permisos-de-la-persona";

/**
 * Qué botones de «Cierre del día» se ofrecen activos hoy: los que el SERVIDOR deja hacer según `permisosDelActor` (una lectura por pedido, el mismo cálculo que el guard): empezar el cierre
 * (`jornadas.iniciar_auditoria`), cancelarlo (`jornadas.cancelar_auditoria`), cerrar el día (`jornadas.cerrar`), corregir el medio de un cobro (`cobros.corregir_medio`) y declarar un total o dar el
 * «Conforme general» (`declaraciones_de_total.registrar`). Con un módulo en desarrollo o no activo la lista no trae sus acciones: todo apagado. Sin permisos leídos, todo apagado (ante la duda el sistema
 * cierra). Previene: ofrecer un botón que el guard va a rechazar. Es solo una ayuda: cada acción vuelve a pasar por el guard dentro de su transacción. Chequeo: `test/web/modulos-del-cierre.test.ts`.
 */
export async function accionesDelCierre(contexto: ContextoOperativo): Promise<AccionesDelCierre> {
  const permisos = await permisosDeLaPersona(contexto);
  const puede = (accion: ClaveAccion): boolean =>
    permisos !== null && permisos.acciones.includes(accion);
  return {
    empezar: puede("jornadas.iniciar_auditoria"),
    cancelar: puede("jornadas.cancelar_auditoria"),
    cerrar: puede("jornadas.cerrar"),
    corregirMedio: puede("cobros.corregir_medio"),
    declarar: puede("declaraciones_de_total.registrar"),
  };
}
