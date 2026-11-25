import type { ClaveDeTexto } from "../vocabulario/catalogo";

/**
 * Los códigos públicos de la pantalla «Usuarios» de Cuenta (ADR-016). En la lista y la ficha de solo lectura (tramo U1) hay UN solo código (el tramo U2 suma dos, los de invitar; «El email no es válido» es el código de Clientes, sin copia): todo lo que el servidor
 * rechaza (sin permiso, módulo sin activar, persona de otra empresa o inexistente) sale como el genérico «Esta acción no está permitida» (dueño, 30/10/2026, interfaz
 * sobria; 23/11/2026, maqueta `usuarios.html`, estados «Sin permiso» y «Acción no permitida»), sin decir cuál de las causas fue: una persona de otra empresa es indistinguible
 * de una que no existe. Los tramos que escriben (invitar, desactivar, sucursales) suman acá los suyos. Cómo se llega de un error del servidor a este código lo decide
 * `src/composicion/errores-de-usuarios.ts`.
 *
 * Previene: que un motivo del guard con su texto propio («No tenés permiso para hacer esto») o un error del módulo sin traducir se muestre crudo, y que la respuesta
 * distinga una persona ajena de una inexistente. Chequeo: `respuesta.test.ts` (todo código tiene su texto) y `errores-de-usuarios.test.ts` (todo error de las consultas se traduce).
 */
export const CLAVES_DE_ERRORES_DE_USUARIOS = {
  USUARIOS_NO_PERMITIDO: "usuarios.error.accion_no_permitida",
  // Invitar (tramo U2): los únicos dos rechazos con texto propio de este módulo, porque a quien invita le importa saber cuál fue (plan §4). El resto sigue siendo el genérico.
  USUARIOS_YA_ES_MIEMBRO: "usuarios.error.ya_es_miembro",
  USUARIOS_YA_HABIA_INVITACION: "usuarios.invitar.ya_habia",
} as const satisfies Record<string, ClaveDeTexto>;

export type CodigoDeUsuarios = keyof typeof CLAVES_DE_ERRORES_DE_USUARIOS;
