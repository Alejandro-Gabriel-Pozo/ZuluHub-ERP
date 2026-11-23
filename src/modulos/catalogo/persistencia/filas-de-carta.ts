import type { Selectable } from "kysely";
import {
  sonPartesValidas,
  type PartesDeDireccion,
} from "../../../capacidades/activos/direccion-externa";
import { esCaraDeVidriera } from "../../../capacidades/experiencia/vidriera/caras";
import {
  esModeloDeVidriera,
  type ModeloDeVidriera,
} from "../../../capacidades/experiencia/vidriera/modelos";
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import type { CartaPublica, Disponibilidad, EstadoDeCarta } from "../dominio/carta-publica";
import { cartaPublicaId, productoId } from "../dominio/identificadores";
import type { TablasDeCarta } from "./esquema-de-carta";

/** Lo que la base guarda y el dominio no conoce (un estado fuera de la lista) es una falla, no un dato: nunca se autoriza a ciegas. */
function estadoDeCarta(texto: string): EstadoDeCarta {
  if (texto === "EN_LINEA" || texto === "FUERA_DE_LINEA") return texto;
  throw new RangeError(`estado de carta inválido en la base: ${texto}`);
}

/** Lo que la base guarda y el dominio no conoce (un modelo fuera de la lista) es una falla, no un dato. */
export function modeloDeCarta(texto: string): ModeloDeVidriera {
  if (esModeloDeVidriera(texto)) return texto;
  throw new RangeError(`modelo de carta inválido en la base: ${texto}`);
}

export function caraDeCarta(texto: string | null) {
  if (texto === null) return null;
  if (esCaraDeVidriera(texto)) return texto;
  throw new RangeError(`cara de carta inválida en la base: ${texto}`);
}

/** Las cinco partes juntas o ninguna (la base lo exige con `carta_publica_logo_ck`); si llegan mal, falla en vez de servir una imagen dudosa. */
export function logoDeCarta(
  f: Readonly<{
    logo_proveedor: string | null;
    logo_cuenta: string | null;
    logo_id_publico: string | null;
    logo_version: string | null;
    logo_extension: string | null;
  }>,
): PartesDeDireccion | null {
  const { logo_proveedor: p, logo_cuenta: c, logo_id_publico: i, logo_version: v } = f;
  const e = f.logo_extension;
  if (p === null && c === null && i === null && v === null && e === null) return null;
  const partes = { proveedor: p, cuenta: c, idPublico: i, version: v, extension: e };
  if (
    p === "CLOUDINARY" &&
    c !== null &&
    i !== null &&
    v !== null &&
    e !== null &&
    sonPartesValidas({ proveedor: p, cuenta: c, idPublico: i, version: v, extension: e })
  ) {
    return { proveedor: p, cuenta: c, idPublico: i, version: v, extension: e };
  }
  throw new RangeError(`logo de carta inválido en la base: ${JSON.stringify(partes)}`);
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
    mensajeDePortada: fila.mensaje_de_portada,
    estado: estadoDeCarta(fila.estado),
    modelo: modeloDeCarta(fila.modelo),
    cara: caraDeCarta(fila.cara),
    colorPropio: fila.color_propio,
    logo: logoDeCarta(fila),
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
