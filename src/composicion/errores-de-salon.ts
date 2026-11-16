import { CODIGOS_PUBLICOS } from "../capacidades/experiencia/respuesta";
import type { CodigoDeSalon } from "../capacidades/experiencia/respuesta-de-salon";

/**
 * De un error del salón al código público que sale a la pantalla «Mesas» (ADR-016). Lista de permitidos: solo cuatro errores del dominio tienen un texto propio, los que la maqueta
 * aprobada `mesas.html` (fila «Errores del formulario» de «Textos nuevos», 09/11/2026) redacta: el número fuera de 1 a 99, el número repetido, la mesa que queda fuera del salón y la
 * que se superpone con otra (con el número de esa mesa). Cualquier OTRO error de negocio del módulo (versión vieja, mesa que no existe, con cuenta abierta, forma o tamaño inexistentes,
 * sucursal fuera de alcance, y también dos altas que se pisaron a la vez: no se sabe con qué mesa) sale como el genérico «Esta acción no está permitida» (dueño, 30/10/2026,
 * interfaz sobria). Pasan SIN CAMBIOS: los motivos del guard y los demás códigos públicos y `ERROR_DE_LA_BASE_NO_TRADUCIDO`, que es un defecto y sale como inesperado, con referencia.
 * Previene: que un error del salón salga como un fallo inesperado, o que un defecto de la base se disfrace de «no permitido». Chequeo: `errores-de-salon.test.ts`.
 */

const CON_TEXTO_PROPIO: Readonly<Record<string, CodigoDeSalon>> = {
  NUMERO_DE_MESA_INVALIDO: "SALON_NUMERO_DE_MESA_INVALIDO",
  NUMERO_DE_MESA_EN_USO: "SALON_NUMERO_DE_MESA_EN_USO",
  MESA_FUERA_DEL_SALON: "SALON_MESA_FUERA_DEL_SALON",
};

const DEFECTO_DE_LA_BASE = "ERROR_DE_LA_BASE_NO_TRADUCIDO";
const GENERICO = { codigo: "CATALOGO_ACCION_NO_PERMITIDA" } as const;

export function traducirErrorDeSalon(error: unknown): unknown {
  if (typeof error === "string") {
    if (Object.hasOwn(CON_TEXTO_PROPIO, error)) return { codigo: CON_TEXTO_PROPIO[error] };
    if (Object.hasOwn(CODIGOS_PUBLICOS, error) || error === DEFECTO_DE_LA_BASE) return error;
    return GENERICO;
  }
  if (typeof error === "object" && error !== null) {
    const { error: nombre, numeros } = error as { error?: unknown; numeros?: unknown };
    if (nombre === "MESA_SUPERPUESTA") {
      const primera = Array.isArray(numeros) ? (numeros as unknown[])[0] : undefined;
      return typeof primera === "number" && Number.isSafeInteger(primera) && primera > 0
        ? {
            codigo: "SALON_MESA_SUPERPUESTA" satisfies CodigoDeSalon,
            parametros: { numero: String(primera) },
          }
        : GENERICO;
    }
    // Un error de negocio con nombre y forma de objeto: también el genérico. La base trae `tipo`, no `error`.
    if (typeof nombre === "string") return GENERICO;
  }
  return error;
}
