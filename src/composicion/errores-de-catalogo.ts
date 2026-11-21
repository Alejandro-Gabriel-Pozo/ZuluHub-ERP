import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import type { CodigoDeCatalogo } from "../capacidades/experiencia/respuesta-de-catalogo";

/**
 * De un error del catálogo al código público que sale a la pantalla (ADR-016; A1, T2a). Lista de permitidos: solo cinco errores del dominio tienen un texto propio, los que la
 * maqueta aprobada `productos.html` (fila «Errores» de «Textos nuevos», 09/11/2026) redacta para la ficha, y cada uno apunta al campo del formulario que lo causó. Cualquier OTRO
 * error de negocio del módulo (versión vieja, producto que no existe o desactivado, dato inválido, sección que no existe, código de barras repetido…) sale como el genérico
 * «Esta acción no está permitida» (dueño, 30/10/2026, interfaz sobria: genérico antes que uno por acción). Pasan SIN CAMBIOS: los motivos del guard y los demás códigos públicos,
 * los errores con forma de objeto sin nombre de negocio (la empresa que no opera, la base) y `ERROR_DE_LA_BASE_NO_TRADUCIDO`, que es un defecto y sale como inesperado, con referencia.
 * Previene: que un error del catálogo salga como un fallo inesperado, o que un defecto de la base se disfrace de «no permitido».
 * Clasificación (A14): suma «Primero desactivá lo que tiene adentro.». Precios (A1, T3): suma «Escribí un precio válido» y la frase aprobada del precio que otra persona cambió antes (lleva el importe vigente, el único dato que sale).
 * Precios (A1, T3): suma «Escribí un precio válido» y la frase aprobada del precio que otra persona cambió antes (lleva el importe vigente, el único dato que sale).
 * Ocultar (A15): suma los dos bloqueos con texto propio aprobado el 12/11/2026 (existencia y conteo abierto).
 * Opciones (A13): suma «Una opción incluida no lleva recargo» y reusa «Escribí un precio válido» para un recargo mal escrito.
 * Chequeo: `errores-de-catalogo.test.ts`.
 */

type ErrorConTexto = Readonly<{
  codigo: CodigoDeCatalogo;
  /** Sin campo: un aviso que no apunta a un campo del formulario (el de la clasificación, al desactivar un nodo con hijos activos). */
  campo?: string;
  parametros?: Readonly<Record<string, string>>;
}>;

/** Los errores del dominio con texto propio y el campo (del pedido) al que se asocian. */
const CON_TEXTO_PROPIO: Readonly<Record<string, ErrorConTexto>> = {
  PRODUCTO_DUPLICADO: { codigo: "CATALOGO_NOMBRE_REPETIDO", campo: "nombre" },
  CODIGO_DUPLICADO: { codigo: "CATALOGO_CODIGO_REPETIDO", campo: "codigo" },
  // Secciones de la carta: el texto es `sec.duplicada` de productos-secciones.html:333 (aprobado por el dueño el 12/11/2026).
  SECCION_DUPLICADA: { codigo: "CATALOGO_SECCION_REPETIDA", campo: "nombre" },
  CODIGO_DE_BARRAS_INVALIDO: {
    codigo: "CATALOGO_CODIGO_DE_BARRAS_INVALIDO",
    campo: "codigoDeBarras",
  },
  ALICUOTA_REQUERIDA: { codigo: "CATALOGO_ELEGI_LA_ALICUOTA", campo: "alicuota" },
  // Precios (A1, T3): el único otro texto propio es «Escribí un precio válido» (misma fila «Errores»).
  PRECIO_INVALIDO: { codigo: "CATALOGO_PRECIO_INVALIDO", campo: "precio" },
  // Clasificación comercial (A14): el único texto propio es «Primero desactivá lo que tiene adentro.» (DDD, línea 92); ciclo, tope, versión vieja, nombre inválido y lo demás: el genérico.
  TIENE_HIJOS_ACTIVOS: { codigo: "CATALOGO_PRIMERO_DESACTIVA" },
  // Ocultar (A15): los dos bloqueos con texto propio aprobado el 12/11/2026 (`productos.html:318`); no apuntan a un campo (la pantalla no tiene formulario).
  PRODUCTO_CON_EXISTENCIA: { codigo: "CATALOGO_PRODUCTO_CON_EXISTENCIA", campo: "ocultar" },
  PRODUCTO_CON_CONTEO_ABIERTO: { codigo: "CATALOGO_PRODUCTO_CON_CONTEO_ABIERTO", campo: "ocultar" },
  // Opciones (A13): el recargo es un importe, así que un recargo mal escrito usa el mismo texto aprobado («Escribí un precio válido»); «Una opción incluida no lleva recargo» es de la
  // misma fila «Errores» de `productos.html`. Los demás errores de las opciones (grupo repetido, versión vieja…) salen como el genérico.
  RECARGO_INVALIDO: { codigo: "CATALOGO_PRECIO_INVALIDO", campo: "recargo" },
  INCLUIDA_CON_RECARGO: { codigo: "CATALOGO_INCLUIDA_CON_RECARGO", campo: "recargo" },
};

/** Un defecto: la base devolvió una restricción que el módulo no sabe traducir. No es de negocio. */
const DEFECTO_DE_LA_BASE = "ERROR_DE_LA_BASE_NO_TRADUCIDO";

/** `{ error: "PRECIO_DESACTUALIZADO", vigente: { precioId, precio } }` con un precio vigente (no abierto): el único objeto del módulo cuyo dato sale hacia la pantalla. */
function esPrecioDesactualizado(
  error: unknown,
): error is Readonly<{ error: "PRECIO_DESACTUALIZADO"; vigente: Readonly<{ precio: string }> }> {
  if (typeof error !== "object" || error === null) return false;
  const { error: nombre, vigente } = error as { error?: unknown; vigente?: unknown };
  return (
    nombre === "PRECIO_DESACTUALIZADO" &&
    typeof vigente === "object" &&
    vigente !== null &&
    typeof (vigente as { precio?: unknown }).precio === "string"
  );
}

/** El error de un caso de uso o consulta del catálogo tal como lo entiende `aRespuesta`. */
export function traducirErrorDeCatalogo(error: unknown): unknown {
  if (typeof error === "string") {
    if (Object.hasOwn(CON_TEXTO_PROPIO, error)) return CON_TEXTO_PROPIO[error];
    if (Object.hasOwn(CODIGOS_PUBLICOS, error) || error === DEFECTO_DE_LA_BASE) return error;
    return { codigo: "CATALOGO_ACCION_NO_PERMITIDA" satisfies CodigoDeCatalogo };
  }
  // El precio que otra persona cambió antes: lleva lo vigente, y de eso sale SOLO el importe (nunca el id de la fila). Frase aprobada por el dueño el 12/11/2026. Un objeto sin importe
  // exacto no se arriesga: cae en el genérico de abajo.
  if (esPrecioDesactualizado(error)) {
    return {
      codigo: "CATALOGO_PRECIO_DESACTUALIZADO" satisfies CodigoDeCatalogo,
      campo: "precio",
      parametros: { importe: error.vigente.precio },
    };
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
