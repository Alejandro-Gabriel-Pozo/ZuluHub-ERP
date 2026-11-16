import "server-only";
import { errorDeCodigo, type Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import type { ClaveAccion } from "../../../src/capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { sucursalDelPedido } from "./sucursal-elegida";
import { permisosDeLaPersona } from "./modulos";

/**
 * Lo que comparten las pantallas de Stock en el servidor (Depósitos, Existencias, Movimientos y Conteo): con qué sucursal se trabaja y qué botones se ofrecen. Fino a propósito
 * (ADR-015, punto 2): no decide ninguna regla; el permiso, el alcance de la sucursal y el estado del módulo los decide el servidor dentro de cada transacción.
 */

const SIN_SUCURSAL = { ok: false, error: errorDeCodigo("STOCK_ACCION_NO_PERMITIDA") } as const;

/**
 * La sucursal con la que trabaja la persona: la elegida en este dispositivo (cookie validada contra las que puede elegir, `sucursalDelPedido`), nunca la que diga el navegador. Sin
 * ninguna, el genérico: no se asume «todas». El caso de uso la vuelve a validar contra el alcance de la persona.
 */
export async function laSucursalDeStock(contexto: ContextoOperativo): Promise<Respuesta<string>> {
  const sucursal = await sucursalDelPedido(contexto);
  if (!sucursal.ok) return sucursal;
  return sucursal.dato.efectiva === "" ? SIN_SUCURSAL : { ok: true, dato: sucursal.dato.efectiva };
}

/**
 * ¿Se ofrece este botón hoy? Sí solo si `permisosDelActor` (una lectura por pedido, el mismo cálculo que el guard) trae la acción. Con el módulo `stock` en desarrollo o no activo esa
 * lista no la trae; sin permisos leídos, no se ofrece nada (ante la duda el sistema cierra). Es solo una ayuda: apagar un botón no es autorizar, cada acción vuelve a pasar por el guard.
 */
export async function puedeEnStock(
  contexto: ContextoOperativo,
  accion: ClaveAccion,
): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && permisos.acciones.includes(accion);
}
