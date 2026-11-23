import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de la pantalla «Mesas» del salón (ADR-016; E7 §10): lo ÚNICO que sale hacia la pantalla cuando guardar una mesa no se puede por una regla del negocio.
 * Lista de permitidos: son los cuatro textos propios que el dueño aprobó el 09/11/2026 en `mesas.html` (fila «Errores del formulario» de «Textos nuevos»). Cualquier otro error del
 * módulo (versión vieja, mesa con cuenta, mesa que no existe, sucursal fuera de alcance…) sale con el genérico «Esta acción no está permitida» (`CATALOGO_ACCION_NO_PERMITIDA`,
 * ya aprobado en la misma maqueta; una regla, un lugar). Cómo se llega de un error del módulo a uno de estos lo decide `src/composicion/errores-de-salon.ts`.
 * Previene: que un error del salón salga como «inesperado» (con referencia, como un defecto) o que se invente un texto por cada regla del dominio.
 * Chequeo: `respuesta-de-salon.test.ts`.
 */
export const CLAVES_DE_ERRORES_DE_SALON = {
  SALON_NUMERO_DE_MESA_INVALIDO: "salon.texto.admin_escribi_un_numero_del_1_al_99",
  SALON_NUMERO_DE_MESA_EN_USO: "salon.texto.admin_ya_existe_una_mesa_con_ese_numero",
  SALON_MESA_FUERA_DEL_SALON: "salon.texto.admin_queda_fuera_del_salon",
  SALON_MESA_SUPERPUESTA: "salon.error.se_superpone_con_la_mesa",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeSalon = keyof typeof CLAVES_DE_ERRORES_DE_SALON;

/** Los parámetros que un código del salón lleva hacia la pantalla (los marcadores de su texto): el número de la mesa con la que se pisa. */
export const PARAMETROS_DE_SALON: Readonly<Partial<Record<CodigoDeSalon, readonly string[]>>> = {
  SALON_MESA_SUPERPUESTA: ["numero"],
};
