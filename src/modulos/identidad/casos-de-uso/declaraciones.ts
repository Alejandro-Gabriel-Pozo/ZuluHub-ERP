import type {
  DeclaracionDeCaso,
  DeclaracionDeCasoDeUso,
} from "../../../capacidades/permisos/declaracion";

export type { DeclaracionDeCaso };

/**
 * Cada caso de uso declara QUÉ acción del catálogo exige (cruce X1 de ADR-003), o por qué no pasa por
 * el guard. Un caso de uso sin declaración no compila (`casos-de-uso.ts` exige que las claves de
 * acá sean exactamente los casos de uso); una acción que no existe en el catálogo tampoco.
 */

export const DECLARACIONES = {
  invitarUsuario: {
    accion: "usuarios.invitar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/identidad-casos-de-uso.test.ts",
        it: "con una pendiente vigente devuelve esa, sea cual sea el rol pedido, y no escribe (D2)",
      },
    },
  },
  reenviarInvitacion: {
    accion: "usuarios.reenviar_invitacion",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/identidad-casos-de-uso.test.ts",
        it: "reenviar dos veces la misma de origen devuelve la misma reemplazante y no escribe de nuevo (D3)",
      },
    },
  },
  apagarMembresia: {
    accion: "usuarios.apagar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/identidad-casos-de-uso.test.ts",
        it: "apagar dos veces: ok la segunda y no escribe ni audita de nuevo (D4)",
      },
    },
  },
  revocarInvitacion: {
    accion: "usuarios.revocar_invitacion",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/usuarios-admin-casos-de-uso.test.ts",
        it: "idempotente: revocar dos veces es ok, y la segunda no escribe ni audita",
      },
    },
  },
  asignarSucursales: {
    accion: "usuarios.asignar_sucursales",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: "test/integracion/asignar-sucursales-casos-de-uso.test.ts",
        it: "idempotente: pedir el mismo conjunto (en otro orden, con repetidos) no escribe ni audita",
      },
    },
  },
  proponerTraspaso: {
    accion: "gerencia.proponer_traspaso",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/traspaso-casos-de-uso.test.ts",
        it: "idempotente: proponer dos veces al mismo entrante devuelve el mismo id, sin escribir, auditar ni avisar de nuevo",
      },
    },
  },
  cancelarTraspaso: {
    accion: "gerencia.cancelar_traspaso",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/traspaso-casos-de-uso.test.ts",
        it: "idempotente: cancelar dos veces, o sin propuesta, es ok y no escribe ni audita",
      },
    },
  },
  aceptarTraspaso: {
    accion: "gerencia.aceptar_traspaso",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/traspaso-casos-de-uso.test.ts",
        it: "idempotente: aceptar dos veces es ok y la segunda no escribe, no audita ni avisa de nuevo",
      },
    },
  },
  rechazarTraspaso: {
    accion: "gerencia.rechazar_traspaso",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/traspaso-casos-de-uso.test.ts",
        it: "idempotente: rechazar dos veces es ok y la segunda no escribe, no audita ni avisa",
      },
    },
  },
  aceptarInvitacion: {
    sinGuard:
      "El invitado todavía no es miembro: autorizan el hash del token (contexto INVITACION), la RLS y el email de la invitación",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: "test/integracion/identidad-casos-de-uso.test.ts",
        it: "repetir una aceptación ya hecha por la misma persona devuelve ok sin escribir (D1)",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
