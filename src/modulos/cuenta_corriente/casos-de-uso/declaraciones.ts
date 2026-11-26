import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_PRUEBAS = "test/integracion/cuenta-corriente-casos-de-uso.test.ts";
const ARCHIVO_DE_PRUEBAS_DEL_CARGO = "test/integracion/ventas-cargo-a-cuenta.test.ts";

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
  // CC-2: lo que ventas usa dentro de la transacción del cierre y de la anulación del ticket (no abren transacción propia: corren en la del llamador, que ya autorizó con su guard).
  cargarVentaEnTx: {
    accion: "cuenta_corriente.cargar_a_cuenta",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS_DEL_CARGO,
        it: "idempotencia: el cierre repetido (mismo ticket) no duplica el cargo ni la auditoría",
      },
    },
  },
  aprobarExcesoEnTx: {
    accion: "cuenta_corriente.aprobar_exceso",
    repeticion: {
      regla: "NO_APLICA",
      motivo:
        "No escribe: decide si quien actúa puede aprobar; la constancia la escribe el cargo, y solo si el asiento es nuevo (repetir el cargo no repite la aprobación).",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS_DEL_CARGO,
        it: "límite: el saldo IGUAL al límite pasa; un centavo más pide aprobación, que solo vale con motivo y con `aprobar_exceso`, y queda auditada",
      },
    },
  },
  anularCargoDeVentaEnTx: {
    sinGuard:
      "Es el espejo del cargo y corre dentro de la anulación del ticket, que ya exigió `tickets.corregir`: anular un ticket a cuenta sin anular su cargo dejaría una deuda sin venta.",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS_DEL_CARGO,
        it: "anular el ticket anula el cargo en la misma transacción (el saldo vuelve a cero) y repetir la anulación no duplica el espejo",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
