import type { Selectable } from "kysely";
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import type { CartaPublica, Disponibilidad, EstadoDeCarta } from "../dominio/carta-publica";
import { cartaPublicaId, productoId } from "../dominio/identificadores";
import type { TablasDeCarta } from "./esquema-de-carta";

/** Lo que la base guarda y el dominio no conoce (un estado fuera de la lista) es una falla, no un dato: nunca se autoriza a ciegas. */
function estadoDeCarta(texto: string): EstadoDeCarta {
  if (texto === "EN_LINEA" || texto === "FUERA_DE_LINEA") return texto;
  throw new RangeError(`estado de carta inválido en la base: ${texto}`);
}

export function aCartaPublica(fila: Selectable<TablasDeCarta["carta_publica"]>): CartaPublica {
  return {
    id: cartaPublicaId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    sucursalId: sucursalId(fila.sucursal_id),
    codigo: fila.codigo,
    nombre: fila.nombre,
    rubro: fila.rubro,
    lugar: fila.lugar,
    estado: estadoDeCarta(fila.estado),
    version: fila.version,
  };
}

export function aDisponibilidad(
  fila: Selectable<TablasDeCarta["disponibilidad_de_producto"]>,
): Disponibilidad {
  return {
    empresaId: empresaId(fila.empresa_id),
    productoId: productoId(fila.producto_id),
    sucursalId: fila.sucursal_id === null ? null : sucursalId(fila.sucursal_id),
    oculto: fila.oculto,
    actualizadoPor: fila.actualizado_por === null ? null : personaId(fila.actualizado_por),
    actualizadoEn: fila.actualizado_en,
    version: fila.version,
  };
}
