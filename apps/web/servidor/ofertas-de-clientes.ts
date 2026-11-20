import "server-only";
/**
 * Parte dedicada de `modulos.ts` (archivo central, ver su encabezado): Las ofertas de botones de «Clientes y proveedores».
 */
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { permisosDeLaPersona } from "./permisos-de-la-persona";

/** Lo que la persona puede hacer en «Clientes y proveedores»; solo ayuda para ofrecer o apagar botones: cada acción vuelve a pasar por el guard. Sin permisos leídos, todo apagado. */
export type AccionesDelDirectorio = Readonly<{
  crear: boolean;
  editar: boolean;
  desactivar: boolean;
  reactivar: boolean;
  contactos: boolean;
}>;

export async function accionesDelDirectorio(
  contexto: ContextoOperativo,
): Promise<AccionesDelDirectorio> {
  const permisos = await permisosDeLaPersona(contexto);
  const puede = (accion: ClaveAccion): boolean =>
    permisos !== null && permisos.acciones.includes(accion);
  return {
    crear: puede("partes.crear"),
    // Editar guarda datos y roles juntos: hacen falta las dos.
    editar: puede("partes.editar") && puede("partes.cambiar_roles"),
    desactivar: puede("partes.desactivar"),
    reactivar: puede("partes.reactivar"),
    contactos: puede("partes.vincular_contacto") && puede("partes.desvincular_contacto"),
  };
}
