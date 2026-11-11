import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeClientes } from "../../clientes/publico";
import type { ErrorDeStock } from "../../stock/publico";
import type { ErrorDeComprobante } from "../dominio/comprobante";
import type { ErrorDeFactura } from "../dominio/factura";
import type { ErrorDeCorreccion } from "../dominio/correccion";
import type { ErrorDePago, ErrorDeSalidaDeCaja } from "../dominio/pago";
import type { ErrorDeLinea } from "../dominio/calcular-linea";

/**
 * Los errores con nombre de los comandos de compras (E9 §3.2 a §3.6): lista cerrada de TODO el módulo; cada comando devuelve un subconjunto y su contrato
 * público es el que documenta su caso de uso. Los de la base (restricciones) se traducen con `ERRORES_DE_COMPRAS_POR_RESTRICCION`, y una prueba exige que
 * cada código de ese mapa figure acá. Los de stock y del directorio pasan tal cual (el llamador ve el motivo original).
 */
export const CODIGOS_DE_ERROR_DE_COMPRAS = [
  "IDENTIFICADOR_INVALIDO",
  "CLAVE_REUTILIZADA",
  "VERSION_DESACTUALIZADA",
  "CURSOR_INVALIDO",
  "PROVEEDOR_NO_ENCONTRADO",
  "SUCURSAL_NO_ENCONTRADA",
  "DEPOSITO_NO_ENCONTRADO",
  "DEPOSITO_A_ELEGIR",
  "PRODUCTO_NO_ENCONTRADO",
  "PRODUCTO_NO_COMPRABLE",
  "PRESENTACION_NO_ENCONTRADA",
  "RENGLONES_INVALIDOS",
  "PUNTO_DE_VENTA_INVALIDO",
  "PUNTO_DE_VENTA_NO_DECLARADO",
  "FACTURA_NO_CORRESPONDE_AL_NIVEL",
  "FACTURA_REQUERIDA",
  "COMPRA_SIMPLE_NO_LLEVA_FACTURA",
  "TIPO_DE_COMPROBANTE_INVALIDO",
  "NUMERO_DE_COMPROBANTE_INVALIDO",
  "FECHA_INVALIDA",
  "CUIT_REQUERIDO_EN_PRIMERA_FACTURA",
  "PROVEEDOR_CON_OTRO_DOCUMENTO",
  "MONEDA_NO_SOPORTADA",
  "PEDIDO_NO_ENCONTRADO",
  "PEDIDO_YA_RESUELTO",
  "PEDIDO_YA_PENDIENTE",
  "NIVEL_INVALIDO",
  "RECEPCION_NO_ENCONTRADA",
  "RECEPCION_YA_ANULADA",
  "COMPRA_CONSUMIDA",
  "MOTIVO_REQUERIDO",
  "COMPROBANTE_NO_ENCONTRADO",
  "COMPROBANTE_ANULADO",
  "COMPROBANTE_NO_PAGABLE",
  "MEDIO_INVALIDO",
  "SALIDA_DE_CAJA_INVALIDA",
  "SALIDA_DE_CAJA_SOLO_EN_EFECTIVO",
  "CAJA_NO_ENCONTRADA",
  "CAJA_INACTIVA",
  "CAJA_DE_OTRA_SUCURSAL",
  "SIN_SESION_ABIERTA",
  "CAJA_EN_CIERRE",
  "JORNADA_DE_CAJA_NO_ABIERTA",
  "EGRESO_DE_CAJA_RECHAZADO",
  "EGRESO_DE_CAJA_NO_ANULABLE",
  "LINEA_SIN_PRECIO",
  "SIN_CAMBIOS",
  "PAGO_NO_ENCONTRADO",
  "PAGO_YA_ANULADO",
  "CONCILIACION_YA_ANULADA",
  "CANTIDAD_ASIGNADA_EXCEDE_LO_RECIBIDO",
  "CANTIDAD_ASIGNADA_EXCEDE_LO_FACTURADO",
] as const;
export type CodigoDeErrorDeCompras = (typeof CODIGOS_DE_ERROR_DE_COMPRAS)[number];

export type ErrorDeCompras =
  | ErrorDeAlcance
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia
  | CodigoDeErrorDeCompras
  | ErrorDeLinea
  | ErrorDeComprobante
  | ErrorDeFactura
  | ErrorDePago
  | ErrorDeSalidaDeCaja
  | ErrorDeCorreccion
  | ErrorDeStock
  | ErrorDeClientes
  /** El remito ya está cargado: `recepcionId` es la ganadora (`null` solo si lo dijo la base, que no sabe con quién choca). */
  | Readonly<{ error: "REMITO_YA_REGISTRADO"; recepcionId: string | null }>
  | Readonly<{ error: "COMPROBANTE_YA_REGISTRADO"; comprobanteId: string | null }>
  | Readonly<{ error: "COMPROBANTE_YA_PAGADO"; pagoId: string | null }>
  | Readonly<{ error: "FUNCION_NO_INCLUIDA"; perilla: string }>;
