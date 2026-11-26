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
  /** Carta real T9: el producto está oculto en la sucursal del depósito: no recibe existencia ni se cuenta (primero se vuelve a mostrar). */
  | "PRODUCTO_OCULTO"
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
  /** La carga inicial sobre un depósito que ya tiene existencia: es un AVISO (nada se escribió); confirmar con `confirmaExistenciaPrevia` la registra igual (P-8). */
  | Readonly<{ error: "YA_HAY_EXISTENCIA" }>
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
  | "COMPONENTE_ES_INSUMO"
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
  // STK-E2a: lotes en una entrada de un artículo que no se controla por lote, y un lote que ya existe con otra fecha de vencimiento o de elaboración.
  | "LOTES_SIN_CONTROL"
  | "LOTE_CON_OTRA_FECHA"
  | "SALDO_DE_LOTE_INSUFICIENTE"
  | "SIN_CAMBIOS"
  /** Darle stock propio a un plato con cuentas abiertas que lo tienen cambia lo que descuentan al cerrarse: hace falta que la persona lo vea y lo confirme (PRO-D1). `cuentas` es cuántas son. */
  | Readonly<{ error: "CUENTAS_ABIERTAS_REQUIEREN_CONFIRMACION"; cuentas: number }>
  | Readonly<{
      error: "FUNCION_NO_INCLUIDA";
      perilla:
        | "composiciones_con_perdida"
        | "subcomposiciones"
        | "lotes"
        | "calidad_de_lote"
        | "produccion";
    }>;
