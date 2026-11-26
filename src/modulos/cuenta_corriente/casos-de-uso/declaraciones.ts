import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_PRUEBAS = "test/integracion/cuenta-corriente-casos-de-uso.test.ts";

/**
 * Los casos de uso de la ficha de cuenta corriente (CC-1; brief PR-CC-1 §1) y la acción que cada uno exige al guard (cruce X1 de ADR-003), con cómo se repite sin
 * duplicar (ADR-015 §4) y la prueba que lo fija. Habilitar lleva clave de idempotencia (crea una ficha); suspender y reactivar son idempotentes por estado
 * (`YA_ESTABA`) y cambiar plazo y límite por `SIN_CAMBIOS`; los tres con control de versión. El `satisfies` de `casos-de-uso.ts` exige que sean EXACTAMENTE los declarados.
 */
export const DECLARACIONES = {
  habilitarCuentaDelCliente: {
    accion: "cuenta_corriente.administrar",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS,
        it: "habilitar dos veces con la misma clave deja una ficha y una auditoría y devuelve yaExistia; con otro contenido, CLAVE_REUTILIZADA",
      },
    },
  },
  suspenderCuentaDelCliente: {
    accion: "cuenta_corriente.administrar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS,
        it: "suspender dos veces: la segunda devuelve yaEstaba y no escribe ni audita",
      },
    },
  },
  reactivarCuentaDelCliente: {
    accion: "cuenta_corriente.administrar",
    repeticion: {
      regla: "YA_ESTABA",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS,
        it: "reactivar dos veces: la segunda devuelve yaEstaba y no escribe ni audita",
      },
    },
  },
  cambiarCondicionesDeLaCuenta: {
    accion: "cuenta_corriente.administrar",
    repeticion: {
      regla: "SIN_CAMBIOS",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS,
        it: "repetir el cambio de condiciones ya aplicado devuelve lo vigente aunque la versión esperada sea vieja, sin escribir ni auditar",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
