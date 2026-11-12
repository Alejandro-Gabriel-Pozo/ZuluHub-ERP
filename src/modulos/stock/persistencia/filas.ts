import type { Selectable } from "kysely";
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import type { StockDb } from "./esquema";
import {
  claseDeMovimientoGuardada,
  estadoDeConteoGuardado,
  usoDeDepositoGuardado,
  type Articulo,
  type Conteo,
  type DiferenciaGuardada,
  type Deposito,
  type Movimiento,
  type RegistroGuardado,
  type RenglonGuardado,
} from "./modelo";

/** Un texto que no es un UUID no puede ser el id de nada: la base lo rechazaría por formato en lugar de decir «no existe». */
export const FORMA_DE_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const esUuid = (texto: string): boolean => FORMA_DE_UUID.test(texto);

export function aDeposito(fila: Selectable<StockDb["deposito"]>): Deposito {
  return {
    id: fila.id,
    empresaId: empresaId(fila.empresa_id),
    sucursalId: sucursalId(fila.sucursal_id),
    nombre: fila.nombre,
    nombreClave: fila.nombre_clave,
    uso: usoDeDepositoGuardado(fila.uso),
    deVenta: fila.de_venta,
    activo: fila.activo,
    version: fila.version,
  };
}

export function aArticulo(fila: Selectable<StockDb["articulo_de_stock"]>): Articulo {
  return {
    id: fila.id,
    productoId: fila.producto_id,
    unidadDeStockId: fila.unidad_de_stock_id,
    dimension: fila.dimension,
    activo: fila.activo,
    version: fila.version,
  };
}

export function aConteo(fila: Selectable<StockDb["conteo_fisico"]>): Conteo {
  return {
    id: fila.id,
    depositoId: fila.deposito_id,
    estado: estadoDeConteoGuardado(fila.estado),
    abiertoPor: personaId(fila.abierto_por),
    abiertoEn: fila.abierto_en,
    resueltoPor: fila.resuelto_por === null ? null : personaId(fila.resuelto_por),
    resueltoEn: fila.resuelto_en,
    motivo: fila.motivo,
    version: fila.version,
  };
}

export function aRegistroDeConteo(fila: Selectable<StockDb["conteo_registro"]>): RegistroGuardado {
  return {
    id: fila.id,
    conteoId: fila.conteo_id,
    articuloId: fila.articulo_id,
    cantidadContada: fila.cantidad_contada,
    existenciaAlRegistrar: fila.existencia_al_registrar,
    registradoPor: personaId(fila.registrado_por),
    registradoEn: fila.registrado_en,
    contadoEn: fila.contado_en,
    orden: Number(fila.orden),
  };
}

export function aDiferenciaDeConteo(
  fila: Selectable<StockDb["conteo_diferencia"]>,
): DiferenciaGuardada {
  return {
    conteoId: fila.conteo_id,
    articuloId: fila.articulo_id,
    registroId: fila.registro_id,
    contada: fila.contada,
    contadoEn: fila.contado_en,
    existenciaALaHora: fila.existencia_a_la_hora,
    diferenciaBruta: fila.diferencia_bruta,
    marcado: fila.marcado,
    diferenciaFinal: fila.diferencia_final,
    motivo: fila.motivo,
    detalle: fila.detalle,
    explicadaPor: personaId(fila.explicada_por),
    explicadaEn: fila.explicada_en,
  };
}

/** La cabecera sin `fecha_negocio` (es `date`: se lee con `::text` aparte, ver `esquema.ts`). */
export type FilaDeMovimiento = Omit<Selectable<StockDb["movimiento_de_stock"]>, "fecha_negocio"> &
  Readonly<{ fecha_negocio: string }>;

export function aMovimiento(fila: FilaDeMovimiento): Movimiento {
  return {
    id: fila.id,
    clase: claseDeMovimientoGuardada(fila.clase),
    motivo: fila.motivo,
    detalle: fila.detalle,
    origenTipo: fila.origen_tipo,
    origenId: fila.origen_id,
    depositoId: fila.deposito_id,
    accion: fila.accion,
    anulaA: fila.anula_a,
    conteoId: fila.conteo_id,
    clave: fila.clave_idempotencia,
    huella: fila.huella,
    hechoEn: fila.hecho_en,
    registradoEn: fila.registrado_en,
    fechaDeNegocio: fila.fecha_negocio,
    registradoPor: personaId(fila.registrado_por),
  };
}

export function aRenglon(
  fila: Pick<
    Selectable<StockDb["renglon_de_movimiento"]>,
    "numero" | "deposito_id" | "articulo_id" | "cantidad" | "composicion_id" | "confirmo_negativo"
  >,
): RenglonGuardado {
  return {
    numero: fila.numero,
    depositoId: fila.deposito_id,
    articuloId: fila.articulo_id,
    cantidad: fila.cantidad,
    composicionId: fila.composicion_id,
    confirmoNegativo: fila.confirmo_negativo,
  };
}
