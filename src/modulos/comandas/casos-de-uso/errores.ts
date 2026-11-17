import type { ErrorDeVentas } from "../../ventas/publico";
import type { ErrorDeCantidadParaPapel } from "../dominio/documento";

/**
 * Los errores con nombre de los comandos de comandas (E7 §3.5). Se suman a los de ventas (las anulaciones y copias de líneas son de ventas). Los de la
 * base (restricciones) se traducen con `ERRORES_DE_COMANDAS_POR_RESTRICCION`.
 */
export type ErrorDeComandas =
  | ErrorDeVentas
  | ErrorDeCantidadParaPapel
  | "NADA_PARA_ENVIAR"
  | "NADA_QUE_PEDIR"
  | "LINEA_YA_ENVIADA"
  | "LINEA_NO_ENVIADA"
  | "LINEA_NO_VIGENTE"
  | "ROTULO_INVALIDO"
  | "ENVIO_NO_ENCONTRADO"
  | "ENVIO_ID_EN_USO"
  | "AVISO_ID_EN_USO"
  | "SALIDA_INVALIDA"
  | "NOMBRE_DE_IMPRESORA_INVALIDO"
  | "NOMBRE_DE_IMPRESORA_EN_USO"
  | "PAPEL_INVALIDO"
  | "USO_INVALIDO"
  | "DOCUMENTO_INVALIDO"
  | "DOCUMENTO_NO_ENCONTRADO"
  | "IMPRESORA_NO_ENCONTRADA"
  | "IMPRESORA_ID_EN_USO"
  | "IMPRESORA_NO_SIRVE"
  | "VERSION_DESACTUALIZADA"
  | "TRABAJO_NO_ENCONTRADO"
  | "TRABAJO_ID_EN_USO"
  | "RESULTADO_INVALIDO"
  | "RESULTADO_YA_DECLARADO"
  | "INTENTO_NO_PEDIDO"
  | "ENTRADA_VACIA";
