import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de negocio del directorio de clientes y proveedores (ADR-016): lo ÚNICO que sale hacia la pantalla cuando un caso de uso del directorio no puede
 * completarse por una regla del negocio. Ocho con texto propio, los que la maqueta aprobada `directorio.html` (fila «Errores», 09/11/2026) redacta; todo lo demás que el dominio rechaza
 * sale como el genérico «Esta acción no está permitida» (dueño, 30/10/2026, interfaz sobria). Cómo se llega de
 * un error del módulo a uno de estos lo decide `src/composicion/errores-de-clientes.ts` (tabla exhaustiva por tipo).
 *
 * Previene: que un error del directorio sin traducir se muestre crudo o se vuelva un genérico que esconde qué corregir. Chequeo: `respuesta.test.ts` (todo código tiene su texto) y
 * `errores-de-clientes.test.ts` (todo error del módulo se traduce).
 */
export const CLAVES_DE_ERRORES_DE_CLIENTES = {
  CLIENTES_FALTA_EL_NOMBRE: "clientes.error.falta_el_nombre",
  CLIENTES_CUIT_INVALIDO: "clientes.error.cuit_invalido",
  CLIENTES_DNI_INVALIDO: "clientes.error.dni_invalido",
  CLIENTES_EMPRESA_SOLO_CUIT: "clientes.error.empresa_solo_cuit_o_extranjero",
  CLIENTES_DOCUMENTO_REPETIDO: "clientes.error.documento_ya_registrado",
  CLIENTES_DOCUMENTO_DE_DESACTIVADA: "clientes.error.parte_inactiva_con_ese_documento",
  CLIENTES_EMAIL_INVALIDO: "clientes.error.email_invalido",
  CLIENTES_TELEFONO_INVALIDO: "clientes.error.telefono_invalido",
  CLIENTES_ACCION_NO_PERMITIDA: "clientes.error.sin_permiso",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeClientes = keyof typeof CLAVES_DE_ERRORES_DE_CLIENTES;
