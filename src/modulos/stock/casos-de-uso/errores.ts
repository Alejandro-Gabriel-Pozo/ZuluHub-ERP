import type { ClaveDeControl } from "../../../capacidades/controles/catalogo";
import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";

/** El control que mira una salida (declarado en `capacidades/controles`, D-E5-4): el tipo falla si alguien lo quita del catálogo. */
export type ControlDeStock = Extract<ClaveDeControl, "stock.existencia_negativa">;

/** Un saldo que quedaría negativo: lo que informan los errores del control (E5 §3.2, `registrarSalida`). */
export type DetalleDeNegativo = Readonly<{
  productoId: string;
  depositoId: string;
  /** Texto decimal exacto, negativo. */
  existenciaResultante: string;
}>;

/**
 * Los errores con nombre de los comandos de stock (E5 §3.2): lista cerrada de TODO el módulo; cada comando devuelve un subconjunto y su
 * contrato público es el que documenta su caso de uso. Los de la base (restricciones) se traducen con `ERRORES_DE_STOCK_POR_RESTRICCION`.
 * Los de movimientos, conteos y composiciones ya figuran para que esos tramos no toquen este archivo salvo que necesiten uno nuevo.
 */
export type ErrorDeStock =
  | ErrorDeAlcance
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia
  | "IDENTIFICADOR_INVALIDO"
  | "ID_REUTILIZADO"
  | "CLAVE_REUTILIZADA"
  // depósitos
  | "NOMBRE_INVALIDO"
  | "NOMBRE_DUPLICADO"
  | "USO_INVALIDO"
  | "USO_NO_VENDIBLE"
  | "SUCURSAL_NO_ENCONTRADA"
  | "SUCURSAL_INACTIVA"
  | "YA_HAY_DEPOSITO_DE_VENTA"
  | "ES_EL_DE_VENTA"
  | "DEPOSITO_NO_ENCONTRADO"
  | "DEPOSITO_DESACTUALIZADO"
  | "DEPOSITO_CON_EXISTENCIA"
  | "DEPOSITO_CON_CONTEO_ABIERTO"
  // artículos
  | "PRODUCTO_NO_ENCONTRADO"
  | "PRODUCTO_INACTIVO"
  | "CLASE_NO_CONTROLABLE"
  | "ARTICULO_EN_COMPOSICION_ACTIVA"
  // movimientos
  | "DEPOSITO_INACTIVO"
  | "DEPOSITO_DE_DESTINO_NO_ENCONTRADO"
  | "ARTICULO_NO_CONTROLADO"
  | "CANTIDAD_INVALIDA"
  | "CONVERSION_NO_EXACTA"
  | "DIMENSION_DISTINTA"
  | "MOTIVO_NO_PERMITIDO"
  | "COSTO_INVALIDO"
  | "FECHA_PASADA_NO_ADMITIDA"
  | "FECHA_FUTURA_NO_ADMITIDA"
  | "RENGLONES_INVALIDOS"
  | "RENGLON_REPETIDO"
  | "TRANSFERENCIA_AL_MISMO_DEPOSITO"
  | "DETALLE_REQUERIDO"
  | "MOVIMIENTO_NO_ENCONTRADO"
  | "MOVIMIENTO_YA_ANULADO"
  | "MOVIMIENTO_NO_ANULABLE"
  | Readonly<{
      error: "CONTROL_REQUIERE_CONFIRMACION";
      control: ControlDeStock;
      detalle: readonly DetalleDeNegativo[];
    }>
  | Readonly<{
      error: "CONTROL_BLOQUEA";
      control: ControlDeStock;
      detalle: readonly DetalleDeNegativo[];
    }>
  // conteos
  | "CONTEO_NO_ENCONTRADO"
  | "CONTEO_EN_CURSO"
  | "CONTEO_CERRADO"
  | "CONTEO_CANCELADO"
  | "CONTEO_SIN_REGISTROS"
  | "MOTIVO_REQUERIDO"
  // conteo con hora (0042): la ventana de la hora del conteo y la explicación de lo que queda de diferencia
  | "HORA_FUERA_DE_VENTANA"
  | "HORA_ANTERIOR_AL_ULTIMO_CONTEO"
  | "MOTIVO_NO_CORRESPONDE"
  | "MOVIMIENTO_NO_EXPLICA"
  | "EXPLICACION_SUPERA_LA_DIFERENCIA"
  | "REVISION_DESACTUALIZADA"
  // puertos de venta (E5-T7): lo que la explosión de una línea vendida rechaza
  | "OPCION_CON_CONSUMO_EN_VENTA_POR_PESO"
  | "VERSION_DE_OPCION_NO_ENCONTRADA"
  // composiciones
  | "COMPOSICION_VACIA"
  | "COMPONENTE_REPETIDO"
  | "COMPONENTE_NO_CONTROLADO"
  | "COMPOSICION_DESACTUALIZADA"
  | "RINDE_INVALIDO"
  | "SIN_COMPOSICION"
  // E6: recetas dentro de recetas, lotes y calidad
  | "RECETA_DEMASIADO_ANIDADA"
  | "CICLO_EN_LA_RECETA"
  | "COMPUESTO_NO_ES_ELABORADO"
  | "PRODUCTO_NO_LLEVA_RECETA"
  | "PERDIDA_INVALIDA"
  | "VENCIMIENTO_REQUERIDO"
  | "VENCIMIENTO_PASADO"
  | "LOTE_NO_ENCONTRADO"
  | "LOTE_SIN_CALIDAD"
  | "LOTE_DESACTUALIZADO"
  | "LOTE_SIN_ASIGNAR"
  | "SALDO_DE_LOTE_INSUFICIENTE"
  | "SIN_CAMBIOS"
  | Readonly<{
      error: "FUNCION_NO_INCLUIDA";
      perilla:
        | "composiciones_con_perdida"
        | "subcomposiciones"
        | "lotes"
        | "calidad_de_lote"
        | "produccion";
    }>;
