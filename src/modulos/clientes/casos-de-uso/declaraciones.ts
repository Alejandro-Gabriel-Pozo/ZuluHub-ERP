import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_PARTES = "test/integracion/clientes-partes.test.ts";
const ARCHIVO_DE_ROLES = "test/integracion/clientes-roles-y-vinculos.test.ts";

/**
 * Los casos de uso del directorio (E9 §3.1) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin duplicar (ADR-015 §4) y
 * la prueba que lo fija. El `satisfies` de `casos-de-uso.ts` exige que los casos de uso sean EXACTAMENTE los declarados.
 */
export const DECLARACIONES = {
  crearParte: {
    accion: "partes.crear",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_PARTES,
        it: "I9: repetir crearParte con la misma idempotencia deja una parte y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  editarParte: {
    accion: "partes.editar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_PARTES,
        it: "I10: repetir editarParte ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
  desactivarParte: {
    accion: "partes.desactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_PARTES,
        it: "I11: desactivar y reactivar dos veces es ok y la segunda no escribe ni audita",
      },
    },
  },
  reactivarParte: {
    accion: "partes.reactivar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_PARTES,
        it: "I11: desactivar y reactivar dos veces es ok y la segunda no escribe ni audita",
      },
    },
  },
  cambiarRolesDeParte: {
    accion: "partes.cambiar_roles",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_ROLES,
        it: "I12: pedir los roles que la parte ya tiene no escribe ni audita",
      },
    },
  },
  vincularContacto: {
    accion: "partes.vincular_contacto",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_ROLES,
        it: "I13: vincular dos veces el mismo contacto deja un vínculo y devuelve yaExistia",
      },
    },
  },
  desvincularContacto: {
    accion: "partes.desvincular_contacto",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_ROLES,
        it: "I13: desvincular dos veces es ok y la segunda no escribe ni audita",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
