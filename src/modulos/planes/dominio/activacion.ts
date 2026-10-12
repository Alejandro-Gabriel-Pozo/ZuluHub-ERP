import { clavesDe, esClaveDe, estadoDeModulos } from "../../../capacidades/modulos/activos";
import type { DefinicionDeModulo } from "../../../capacidades/modulos/catalogo";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Activación de módulos por empresa (marcas y planes, §B.6 y G.5). Solo la plataforma activa y
 * desactiva (decisión D-M1). Nada se borra; activar o desactivar dos veces no escribe ni audita
 * (repetir no es un error). Dominio puro: los tres datos entran leídos en la misma transacción.
 */

export type ModuloParaActivar = Pick<DefinicionDeModulo, "estado" | "obligatorio" | "requiere">;

export type PedidoDeActivacion<M extends string> = Readonly<{
  catalogo: Readonly<Record<M, ModuloParaActivar>>;
  modulo: string;
  /** Los módulos que la empresa tiene activados (la tabla; los obligatorios no figuran). */
  activados: readonly string[];
  /** El techo del plan: los módulos que su versión incluye. */
  habilitados: readonly string[];
}>;

export type ErrorDeActivacion =
  | Readonly<{ codigo: "MODULO_DESCONOCIDO" | "MODULO_OBLIGATORIO" | "MODULO_EN_DESARROLLO" }>
  | Readonly<{ codigo: "MODULO_FUERA_DEL_PLAN" }>
  | Readonly<{ codigo: "REQUIERE_INACTIVO"; modulo: string }>;

export type ErrorDeDesactivacion =
  | Readonly<{ codigo: "MODULO_DESCONOCIDO" | "MODULO_OBLIGATORIO" }>
  | Readonly<{ codigo: "ES_REQUERIDO_POR"; modulo: string }>;

/**
 * ¿Se puede activar el módulo? Orden de los errores: desconocido, obligatorio (no se guarda: siempre
 * está), en desarrollo, y — salvo que ya esté activado, que da `yaEstabaActivo` sin escribir — fuera
 * del techo del plan y `requiere` inactivo. Un `requiere` está activo si es obligatorio o está
 * activado y dentro del techo (no si quedó en solo lectura). El techo se mira SOLO al activar: bajar
 * de plan no desactiva nada (queda en solo lectura).
 */
export function decidirActivacion<M extends string>(
  pedido: PedidoDeActivacion<M>,
): Resultado<Readonly<{ yaEstabaActivo: boolean }>, ErrorDeActivacion> {
  const { catalogo, modulo } = pedido;
  if (!esClaveDe(catalogo, modulo)) return err({ codigo: "MODULO_DESCONOCIDO" });
  const definicion = catalogo[modulo];
  if (definicion.obligatorio) return err({ codigo: "MODULO_OBLIGATORIO" });
  if (definicion.estado !== "disponible") return err({ codigo: "MODULO_EN_DESARROLLO" });
  if (pedido.activados.includes(modulo)) return ok({ yaEstabaActivo: true });
  if (!pedido.habilitados.includes(modulo)) return err({ codigo: "MODULO_FUERA_DEL_PLAN" });
  const { modulosActivos } = estadoDeModulos(catalogo, pedido.activados, pedido.habilitados);
  const inactivo = definicion.requiere.find((requerido) => !modulosActivos.has(requerido as M));
  if (inactivo !== undefined) return err({ codigo: "REQUIERE_INACTIVO", modulo: inactivo });
  return ok({ yaEstabaActivo: false });
}

/**
 * ¿Se puede desactivar el módulo? Orden: desconocido, obligatorio, y — si no está activado, que da
 * `yaEstabaInactivo` sin escribir — `ES_REQUERIDO_POR` el primer módulo activado (en el orden del
 * catálogo) que lo requiere. Cuenta todo módulo activado, también el que quedó en solo lectura:
 * conserva datos que dependen de este.
 */
export function decidirDesactivacion<M extends string>(
  pedido: Omit<PedidoDeActivacion<M>, "habilitados">,
): Resultado<Readonly<{ yaEstabaInactivo: boolean }>, ErrorDeDesactivacion> {
  const { catalogo, modulo } = pedido;
  if (!esClaveDe(catalogo, modulo)) return err({ codigo: "MODULO_DESCONOCIDO" });
  if (catalogo[modulo].obligatorio) return err({ codigo: "MODULO_OBLIGATORIO" });
  if (!pedido.activados.includes(modulo)) return ok({ yaEstabaInactivo: true });
  const dependiente = clavesDe(catalogo).find(
    (otro) => pedido.activados.includes(otro) && catalogo[otro].requiere.includes(modulo),
  );
  if (dependiente !== undefined) return err({ codigo: "ES_REQUERIDO_POR", modulo: dependiente });
  return ok({ yaEstabaInactivo: false });
}
