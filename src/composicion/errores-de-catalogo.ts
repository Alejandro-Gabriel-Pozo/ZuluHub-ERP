import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import type { CodigoDeCatalogo } from "../capacidades/experiencia/respuesta-de-catalogo";

/**
 * De un error del catálogo al código público que sale a la pantalla (ADR-016; A1, T2a). Lista de permitidos: solo cinco errores del dominio tienen un texto propio, los que la
 * maqueta aprobada `productos.html` (fila «Errores» de «Textos nuevos», 09/11/2026) redacta para la ficha, y cada uno apunta al campo del formulario que lo causó. Cualquier OTRO
 * error de negocio del módulo (versión vieja, producto que no existe o desactivado, dato inválido, sección que no existe, código de barras repetido…) sale como el genérico
 * «Esta acción no está permitida» (dueño, 30/10/2026, interfaz sobria: genérico antes que uno por acción). Pasan SIN CAMBIOS: los motivos del guard y los demás códigos públicos,
 * los errores con forma de objeto sin nombre de negocio (la empresa que no opera, la base) y `ERROR_DE_LA_BASE_NO_TRADUCIDO`, que es un defecto y sale como inesperado, con referencia.
 * Previene: que un error del catálogo salga como un fallo inesperado, o que un defecto de la base se disfrace de «no permitido».
 * Chequeo: `errores-de-catalogo.test.ts`.
 */

type ErrorConTexto = Readonly<{ codigo: CodigoDeCatalogo; campo: string }>;

/** Los errores del dominio con texto propio y el campo (del pedido) al que se asocian. */
const CON_TEXTO_PROPIO: Readonly<Record<string, ErrorConTexto>> = {
  PRODUCTO_DUPLICADO: { codigo: "CATALOGO_NOMBRE_REPETIDO", campo: "nombre" },
  CODIGO_DUPLICADO: { codigo: "CATALOGO_CODIGO_REPETIDO", campo: "codigo" },
  CODIGO_DE_BARRAS_INVALIDO: {
    codigo: "CATALOGO_CODIGO_DE_BARRAS_INVALIDO",
    campo: "codigoDeBarras",
  },
  ALICUOTA_REQUERIDA: { codigo: "CATALOGO_ELEGI_LA_ALICUOTA", campo: "alicuota" },
};

/** Un defecto: la base devolvió una restricción que el módulo no sabe traducir. No es de negocio. */
const DEFECTO_DE_LA_BASE = "ERROR_DE_LA_BASE_NO_TRADUCIDO";

/** El error de un caso de uso o consulta del catálogo tal como lo entiende `aRespuesta`. */
export function traducirErrorDeCatalogo(error: unknown): unknown {
  if (typeof error === "string") {
    if (Object.hasOwn(CON_TEXTO_PROPIO, error)) return CON_TEXTO_PROPIO[error];
    if (Object.hasOwn(CODIGOS_PUBLICOS, error) || error === DEFECTO_DE_LA_BASE) return error;
    return { codigo: "CATALOGO_ACCION_NO_PERMITIDA" satisfies CodigoDeCatalogo };
  }
  // Un error de negocio con nombre y forma de objeto (`{ error: "CAMPO_NO_ADMITIDO_POR_LA_CLASE", campo }`): también el genérico. La base trae `tipo`, no `error`.
  if (
    typeof error === "object" &&
    error !== null &&
    typeof (error as { error?: unknown }).error === "string"
  ) {
    return { codigo: "CATALOGO_ACCION_NO_PERMITIDA" satisfies CodigoDeCatalogo };
  }
  return error;
}
