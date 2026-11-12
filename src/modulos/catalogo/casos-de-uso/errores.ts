import type { ErrorDePresentacion } from "../dominio/presentaciones";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeCotizacion } from "../dominio/cotizar";
import type { ErrorDeFicha } from "../dominio/producto";
import type { ErrorDeFormaDeVenta } from "../dominio/forma-de-venta";
import type { ErrorDeOpciones } from "../dominio/opciones";

/**
 * Los errores con nombre de los comandos del catálogo (E2 mínimo §3.5). Cada comando devuelve un subconjunto; el contrato público de cada
 * uno es el que documenta su caso de uso. Los de la base (restricciones) se traducen con `ERRORES_DE_CATALOGO_POR_RESTRICCION`.
 */
export type ErrorDeCatalogo =
  | ErrorDeFicha
  | ErrorDeFormaDeVenta
  | ErrorDeOpciones
  | ErrorDeCotizacion
  | ErrorDeAlcance
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia
  | "IDENTIFICADOR_INVALIDO"
  | "ID_REUTILIZADO"
  | "CLASE_INVALIDA"
  | "UNIDAD_INVALIDA"
  | "FORMA_DE_VENTA_INVALIDA"
  | "FORMA_DE_VENTA_NO_SOPORTADA"
  | "PRODUCTO_DUPLICADO"
  | "CODIGO_DUPLICADO"
  | "CODIGO_DE_BARRAS_DUPLICADO"
  | "VERSION_DESACTUALIZADA"
  | "OPCIONES_DESACTUALIZADAS"
  | "NOMBRE_DE_SECCION_INVALIDO"
  | "SECCION_DUPLICADA"
  | "ORDEN_INVALIDO"
  | "CARTA_DE_LA_SUCURSAL_YA_EXISTE"
  | "CODIGO_DE_CARTA_REPETIDO"
  | "CODIGO_DE_CARTA_INVALIDO"
  | "NOMBRE_DE_CARTA_INVALIDO"
  | "RUBRO_DE_CARTA_INVALIDO"
  | "LUGAR_DE_CARTA_INVALIDO"
  | "OPCION_INVALIDA"
  | "PRECIO_INVALIDO"
  | "RECARGO_DE_EMPRESA_SE_EDITA_EN_OPCIONES"
  | "PRECIO_DE_PRODUCTO_CON_VARIANTE"
  | "COPIA_A_SI_MISMO"
  | "NADA_PARA_COPIAR"
  | "GRUPO_NO_ENCONTRADO"
  | "GRUPO_DE_VARIANTE_SIN_CONSUMO"
  | "INSUMO_NO_ENCONTRADO"
  | "INSUMO_NO_ADMITIDO"
  | "INSUMO_ES_EL_MISMO_PRODUCTO"
  | "CONSUMO_REPETIDO"
  | "CANTIDAD_INVALIDA"
  | "ESCALA_SIN_TAMANO"
  | "ERROR_DE_LA_BASE_NO_TRADUCIDO"
  | "PRODUCTO_NO_COMPRABLE"
  | "PRESENTACION_NO_ENCONTRADA"
  | "PRESENTACION_REPETIDA"
  | ErrorDePresentacion
  | Readonly<{
      error: "PRECIO_DESACTUALIZADO";
      /** Lo que rige ahora en el mismo alcance (null si no hay ninguna fila). */
      vigente: Readonly<{ precioId: string; precio: string | null }> | null;
    }>;
