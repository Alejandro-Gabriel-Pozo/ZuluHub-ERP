import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio del facturador (ADR-016): lo ÚNICO que sale hacia la pantalla cuando un caso de uso
 * o una consulta de fiscal no puede completarse. Cada uno tiene su texto en el catálogo (`error.<código en
 * minúsculas>`), en castellano neutro y en términos del negocio: ningún nombre de restricción, código técnico ni
 * mensaje de ARCA llega a una persona. Cómo se llega de un error del módulo a uno de estos lo decide
 * `src/composicion/errores-fiscales.ts` (con una tabla exhaustiva por tipo: un error nuevo sin traducir no compila).
 *
 * Previene: que un error de fiscal sin traducir se muestre crudo o se vuelva un genérico que esconde qué corregir.
 * Chequeo: `respuesta.test.ts` (todo código tiene su texto) y `errores-fiscales.test.ts` (todo error del módulo se
 * traduce). Los nombres evitan `clave`, `credencial`, `token` y `firma`: las claves del catálogo no pueden parecer
 * secretos por su nombre (`sin-secretos.ts`).
 */
export const CLAVES_DE_ERRORES_FISCALES = {
  FISCAL_DATOS_INVALIDOS: "error.fiscal_datos_invalidos",
  FISCAL_PEDIDO_SIN_IDENTIFICAR: "error.fiscal_pedido_sin_identificar",
  FISCAL_PEDIDO_REPETIDO: "error.fiscal_pedido_repetido",
  FISCAL_PUNTO_DE_VENTA_NO_ENCONTRADO: "error.fiscal_punto_de_venta_no_encontrado",
  FISCAL_PUNTO_DE_VENTA_INACTIVO: "error.fiscal_punto_de_venta_inactivo",
  FISCAL_EMISOR_INACTIVO: "error.fiscal_emisor_inactivo",
  FISCAL_SIN_DATOS_FISCALES: "error.fiscal_sin_datos_fiscales",
  FISCAL_SIN_CERTIFICADO: "error.fiscal_sin_certificado",
  FISCAL_COMPROBANTE_NO_ENCONTRADO: "error.fiscal_comprobante_no_encontrado",
  FISCAL_ASOCIADO_NO_AUTORIZADO: "error.fiscal_asociado_no_autorizado",
  FISCAL_ASOCIADO_DE_OTRO_EMISOR: "error.fiscal_asociado_de_otro_emisor",
  FISCAL_ASOCIADO_DE_OTRO_AMBIENTE: "error.fiscal_asociado_de_otro_ambiente",
  FISCAL_ASOCIADO_NO_ASOCIABLE: "error.fiscal_asociado_no_asociable",
  FISCAL_MOTIVO_INVALIDO: "error.fiscal_motivo_invalido",
  FISCAL_RECEPTOR_INVALIDO: "error.fiscal_receptor_invalido",
  FISCAL_RECEPTOR_INVALIDO_PARA_A: "error.fiscal_receptor_invalido_para_a",
  FISCAL_RECEPTOR_IGUAL_AL_EMISOR: "error.fiscal_receptor_igual_al_emisor",
  FISCAL_RECEPTOR_NO_CATEGORIZADO: "error.fiscal_receptor_no_categorizado",
  FISCAL_SIN_RENGLONES: "error.fiscal_sin_renglones",
  FISCAL_DEMASIADOS_RENGLONES: "error.fiscal_demasiados_renglones",
  FISCAL_RENGLON_INVALIDO: "error.fiscal_renglon_invalido",
  FISCAL_ALICUOTA_EN_LETRA_C: "error.fiscal_alicuota_en_letra_c",
  FISCAL_FALTA_ALICUOTA: "error.fiscal_falta_alicuota",
  FISCAL_MODO_DE_PRECIO_INVALIDO_PARA_C: "error.fiscal_modo_de_precio_invalido_para_c",
  FISCAL_FECHAS_DE_SERVICIO_INVALIDAS: "error.fiscal_fechas_de_servicio_invalidas",
  FISCAL_TOTAL_FUERA_DE_RANGO: "error.fiscal_total_fuera_de_rango",
  FISCAL_COMPROBANTE_YA_ENVIADO: "error.fiscal_comprobante_ya_enviado",
  FISCAL_ESTADO_NO_DESCARTABLE: "error.fiscal_estado_no_descartable",
  FISCAL_VERSION_DESACTUALIZADA: "error.fiscal_version_desactualizada",
  FISCAL_SERIE_BLOQUEADA: "error.fiscal_serie_bloqueada",
  FISCAL_ESTADO_NO_REINTENTABLE: "error.fiscal_estado_no_reintentable",
  FISCAL_SERIE_NO_ENCONTRADA: "error.fiscal_serie_no_encontrada",
  FISCAL_SERIE_NO_BLOQUEADA: "error.fiscal_serie_no_bloqueada",
  FISCAL_ULTIMO_DISTINTO_DEL_DE_ARCA: "error.fiscal_ultimo_distinto_del_de_arca",
  FISCAL_DESFASE_HACIA_ATRAS: "error.fiscal_desfase_hacia_atras",
  FISCAL_ARCA_NO_DISPONIBLE: "error.fiscal_arca_no_disponible",
  FISCAL_ARCA_CERTIFICADO_NO_SIRVE: "error.fiscal_arca_certificado_no_sirve",
  FISCAL_ARCA_SERVICIO_NO_AUTORIZADO: "error.fiscal_arca_servicio_no_autorizado",
  FISCAL_ARCA_ACCESO_EN_CURSO: "error.fiscal_arca_acceso_en_curso",
  FISCAL_SERIE_EN_CURSO: "error.fiscal_serie_en_curso",
  FISCAL_AMBIENTE_NO_VUELVE: "error.fiscal_ambiente_no_vuelve",
  FISCAL_YA_EMITIO_EN_PRODUCCION: "error.fiscal_ya_emitio_en_produccion",
  FISCAL_FILTRO_INVALIDO: "error.fiscal_filtro_invalido",
  FISCAL_SUCURSAL_NO_ELEGIDA: "error.fiscal_sucursal_no_elegida",
  FISCAL_SUCURSAL_FUERA_DE_ALCANCE: "error.fiscal_sucursal_fuera_de_alcance",
  FISCAL_SUCURSAL_CERRADA: "error.fiscal_sucursal_cerrada",
  FISCAL_CONFIGURACION_DATOS_INVALIDOS: "error.fiscal_configuracion_datos_invalidos",
  FISCAL_PUNTO_DE_VENTA_DUPLICADO: "error.fiscal_punto_de_venta_duplicado",
  FISCAL_PUNTO_DE_VENTA_NUMERO_INMUTABLE: "error.fiscal_punto_de_venta_numero_inmutable",
  FISCAL_PUNTO_DE_VENTA_SIN_DOMICILIO: "error.fiscal_punto_de_venta_sin_domicilio",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoFiscal = keyof typeof CLAVES_DE_ERRORES_FISCALES;
