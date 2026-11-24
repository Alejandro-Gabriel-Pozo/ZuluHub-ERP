import "server-only";
/**
 * Parte dedicada de `modulos.ts` (archivo central, ver su encabezado): las ofertas de botones de «Compras».
 */
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import {
  SIN_ACCIONES_DE_LA_COMPRA,
  type AccionesDeLaCompraParaLaPantalla,
} from "../ui/plantillas/compras/ficha/modelo-de-ficha-de-compra";
import { permisosDeLaPersona } from "./permisos-de-la-persona";

/**
 * Lo que la persona puede hacer sobre una compra (Compras PR 10): corregir el precio de una línea (`compras.corregir`) y anularla (`recepciones.anular`), de gerente y administrador. Solo ayuda para
 * ofrecer o esconder botones: cada acción vuelve a pasar por el guard dentro de su transacción. Sin permisos leídos, todo cerrado (denegar por defecto).
 */
export async function accionesDeLaCompra(
  contexto: ContextoOperativo,
): Promise<AccionesDeLaCompraParaLaPantalla> {
  const permisos = await permisosDeLaPersona(contexto);
  if (permisos === null) return SIN_ACCIONES_DE_LA_COMPRA;
  const puede = (accion: ClaveAccion): boolean => permisos.acciones.includes(accion);
  return { corregir: puede("compras.corregir"), anular: puede("recepciones.anular") };
}
