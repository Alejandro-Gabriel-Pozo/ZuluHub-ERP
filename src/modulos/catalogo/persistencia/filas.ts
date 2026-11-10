import type { Selectable } from "kysely";
import { empresaId, sucursalId } from "../../../primitivas/identificadores/marca";
import type { ClaseDeUso } from "../dominio/clases";
import {
  grupoDeEleccionesId,
  opcionId,
  precioDeVentaId,
  productoId,
  seccionDeCartaId,
  versionDeOpcionId,
} from "../dominio/identificadores";
import type { ClaseDeGrupo, FilaDePrecio, Grupo, Opcion, Producto } from "../dominio/modelo";
import type { CatalogoDb } from "./esquema";

/** Un texto que no es un UUID no puede ser el id de nada: la base lo rechazaría por formato en lugar de decir «no existe». */
export const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Lo que la base guarda y el dominio no conoce (una clase fuera de la lista) es una falla, no un dato: nunca se autoriza a ciegas. */
function claseDeUso(texto: string): ClaseDeUso {
  switch (texto) {
    case "MATERIA_PRIMA":
    case "INSUMO":
    case "REVENTA":
    case "ELABORADO":
    case "VENDIBLE":
      return texto;
    default:
      throw new RangeError(`clase de uso inválida en la base: ${texto}`);
  }
}

function claseDeGrupo(texto: string): ClaseDeGrupo {
  if (texto === "VARIANTE" || texto === "INCLUIDA" || texto === "ADICIONAL") return texto;
  throw new RangeError(`clase de grupo inválida en la base: ${texto}`);
}

export function aProducto(fila: Selectable<CatalogoDb["producto"]>): Producto {
  return {
    id: productoId(fila.id),
    empresaId: empresaId(fila.empresa_id),
    nombre: fila.nombre,
    nombreDeCocina: fila.nombre_de_cocina,
    descripcionEnCarta: fila.descripcion_en_carta,
    codigo: fila.codigo,
    codigoDeBarras: fila.codigo_de_barras,
    claseDeUso: claseDeUso(fila.clase_de_uso),
    unidadBaseId: fila.unidad_base_id,
    unidadDeVentaId: fila.unidad_de_venta_id,
    pasoMinimo: fila.paso_minimo,
    alicuota: fila.alicuota_iva,
    faltaCompletar: fila.falta_completar,
    seVende: fila.se_vende,
    seccionDeCartaId:
      fila.seccion_de_carta_id === null ? null : seccionDeCartaId(fila.seccion_de_carta_id),
    activo: fila.activo,
    versionDeOpciones: fila.version_de_opciones,
    version: fila.version,
  };
}

export function aGrupo(fila: Selectable<CatalogoDb["grupo_de_elecciones"]>): Grupo {
  return {
    id: grupoDeEleccionesId(fila.id),
    productoId: productoId(fila.producto_id),
    clase: claseDeGrupo(fila.clase),
    esTamano: fila.es_tamano,
    nombre: fila.nombre,
    esObligatorio: fila.es_obligatorio,
    admiteVarias: fila.admite_varias,
    seMuestraEnCarta: fila.se_muestra_en_carta,
    orden: fila.orden,
    activo: fila.activo,
  };
}

/** La opción con los datos de su versión vigente (la de mayor número). */
export type FilaDeOpcionVigente = Readonly<{
  id: string;
  grupo_id: string;
  orden: number;
  activa: boolean;
  version_id: string;
  numero: number;
  nombre: string;
  recargo: string;
  factor_de_tamano: string;
}>;

export function aOpcion(fila: FilaDeOpcionVigente): Opcion {
  return {
    id: opcionId(fila.id),
    grupoId: grupoDeEleccionesId(fila.grupo_id),
    orden: fila.orden,
    activa: fila.activa,
    versionId: versionDeOpcionId(fila.version_id),
    numero: fila.numero,
    nombre: fila.nombre,
    recargo: fila.recargo,
    factorDeTamano: fila.factor_de_tamano,
  };
}

export function aFilaDePrecio(fila: Selectable<CatalogoDb["precio_de_venta"]>): FilaDePrecio {
  return {
    id: precioDeVentaId(fila.id),
    productoId: productoId(fila.producto_id),
    opcionId: fila.opcion_id === null ? null : opcionId(fila.opcion_id),
    sucursalId: fila.sucursal_id === null ? null : sucursalId(fila.sucursal_id),
    precio: fila.precio,
    unidadId: fila.unidad_id,
    pasoMinimo: fila.paso_minimo,
    vigenteDesde: fila.vigente_desde,
  };
}
