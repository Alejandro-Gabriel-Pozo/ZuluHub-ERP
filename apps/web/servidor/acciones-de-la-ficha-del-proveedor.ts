import "server-only";
/**
 * Las ofertas de botones de la ficha del proveedor de compras (Compras PR 4). Vive acá y no en `ofertas-de-compras.ts` para no pisarse con otro tramo de Compras; se puede mudar allí sin cambiar su forma.
 */
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { permisosDeLaPersona } from "./permisos-de-la-persona";

/**
 * Lo que la persona puede hacer en la ficha del proveedor; solo ayuda para ofrecer o esconder botones: cada acción vuelve a pasar por el guard dentro de su transacción. Quien edita (gerente y
 * administrador) ve «Agregar»/«Dejar de usar»/«Aprobar»/«Rechazar»; quien solo carga compras ve «Pedir». Sin permisos leídos, todo cerrado.
 */
export type AccionesDeLaFichaDelProveedor = Readonly<{
  editar: boolean;
  pedir: boolean;
}>;

export async function accionesDeLaFichaDelProveedor(
  contexto: ContextoOperativo,
): Promise<AccionesDeLaFichaDelProveedor> {
  const permisos = await permisosDeLaPersona(contexto);
  const puede = (accion: ClaveAccion): boolean =>
    permisos !== null && permisos.acciones.includes(accion);
  return {
    editar: puede("proveedores.editar_ficha"),
    // Quien edita no pide: agrega. Pedir es de quien no puede editar (la maqueta ofrece uno u otro según el rol).
    pedir: puede("proveedores.pedir_ficha") && !puede("proveedores.editar_ficha"),
  };
}
