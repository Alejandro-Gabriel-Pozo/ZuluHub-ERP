import type { DeclaracionDeCasoDeUso } from "../../../capacidades/permisos/declaracion";

const ARCHIVO_DE_PRUEBAS = "test/integracion/cuenta-corriente-casos-de-uso.test.ts";
const ARCHIVO_DE_PRUEBAS_DE_LA_EXPORTACION =
  "test/integracion/cuenta-corriente-estado-y-exportacion.test.ts";
const ARCHIVO_DE_PRUEBAS_DEL_CARGO = "test/integracion/ventas-cargo-a-cuenta.test.ts";
const ARCHIVO_DE_PRUEBAS_DE_LA_COBRANZA = "test/integracion/ventas-cobranza-a-cuenta.test.ts";

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
  cobrarVentaEnTx: {
    sinGuard:
      "Corre dentro del cobro del ticket, que ya exigió `tickets.cobrar`: la cobranza es el mismo hecho que el cobro de caja y no tiene permiso propio (suspender al cliente no impide cobrarle).",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS_DE_LA_COBRANZA,
        it: "idempotencia: cobrar dos veces el mismo ticket a cuenta deja una cobranza, un asiento y una imputación",
      },
    },
  },
  anularCobranzaDeVentaEnTx: {
    sinGuard:
      "Es el espejo de la cobranza y corre dentro de la anulación del ticket, que ya exigió `tickets.corregir`: anular un ticket cobrado a cuenta sin anular su cobranza dejaría un cobro sin venta.",
    repeticion: {
      regla: "CLAVE_DE_IDEMPOTENCIA",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS_DE_LA_COBRANZA,
        it: "anular un ticket cobrado a cuenta anula primero la cobranza y después el cargo (saldo en cero) y repetir la anulación no duplica nada",
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
  // CC-4: lee y deja su registro de auditoría; no cambia nada del libro. Sin acción nueva: `cuenta_corriente.ver` (hoy gerente y administrador).
  exportarCuentaCorriente: {
    accion: "cuenta_corriente.ver",
    repeticion: {
      regla: "NO_APLICA",
      motivo:
        "Es una lectura: repetirla devuelve lo mismo y no cambia el libro ni las fichas; cada exportación deja su propio registro de auditoría (quién, cuándo, a qué día y cuántas filas, sin los datos).",
      prueba: {
        archivo: ARCHIVO_DE_PRUEBAS_DE_LA_EXPORTACION,
        it: "exportar dos veces da las mismas filas, deja dos registros de auditoría sin los datos y no cambia el libro",
      },
    },
  },
} as const satisfies Record<string, DeclaracionDeCasoDeUso>;
