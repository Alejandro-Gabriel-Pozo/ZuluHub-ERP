import type { CeldaDeOraculo } from "../../../primitivas/oraculo/celdas";
import type { EstadoDeTicket } from "./estados";

/**
 * LAS CELDAS del oráculo de ticket, cobranza y documento de ticket (ventas): lo que el sistema puede y no puede hacer. Es solo DATOS (sin
 * lógica): la lógica vive en `oraculo-de-ticket.ts`. Fuente: `Pedernal-docs/11-especificaciones/auditoria-de-reglas/oraculo-ticket-cobranza.md`
 * (propuesta de Arquitectura, 2026-11-14; bloques A, B y D), con las reglas `VF-R-nn` de `ventas-fiscal-piloto.md` y `R-07a/b/c` de
 * `cobro-en-partes.md`. Lo no decidido NO se inventa: va `PENDIENTE (tramo X)` o `enRevision`.
 * Cada celda con `hoy: COINCIDE` se ejecuta contra el caso de uso real (`test/integracion/oraculo-de-ticket-casos.test.ts`); la base se compara en
 * `ventas-migracion.test.ts` (transiciones) y `oraculo-de-ticket-base.test.ts`. Los nombres de error que todavía no existen (`CANTIDAD_EXCEDIDA`,
 * `CON_FACTURA_VIGENTE`…) los define el tramo que construye cada celda: acá solo figuran en el texto de `resultado`.
 * Justificación (CLAUDE.md «Justificar cada regla»): previene la regla sin clasificar que originó `documento_vigente_uk`; chequeo: las pruebas de
 * arriba y `test/arquitectura/oraculo-de-errores.test.ts` (todo código de error de ventas o fiscal figura en una celda o en la lista de permitidos).
 * Una prueba congela la tabla con una huella (`oraculo-de-ticket.test.ts`): cambiar una celda es una decisión que se ve en el diff, no un
 * retoque silencioso; y esa huella es lo que mata los mutantes de los literales.
 */

export type IdDeCeldaDeVentas =
  | "A-01"
  | "A-02"
  | "A-03"
  | "A-04"
  | "A-05"
  | "A-06"
  | "A-07"
  | "A-08"
  | "A-09"
  | "A-10"
  | "A-11"
  | "A-12"
  | "A-13"
  | "A-14"
  | "A-15"
  | "A-16"
  | "A-17"
  | "A-18"
  | "A-19"
  | "A-20"
  | "B-01"
  | "B-02"
  | "B-03"
  | "B-04"
  | "B-05"
  | "B-06"
  | "B-07"
  | "B-08"
  | "B-09"
  | "B-10"
  | "B-11"
  | "B-12"
  | "B-13"
  | "B-14"
  | "B-15"
  | "D-01"
  | "D-02"
  | "D-03"
  | "D-04"
  | "D-05"
  | "D-06"
  | "D-07"
  | "D-08"
  | "D-09";

export type CeldaDeVentas = CeldaDeOraculo<IdDeCeldaDeVentas, EstadoDeTicket>;

export const DEC_14_11 = "dueño 14/11 (decisiones-del-dueno-2026-11.md)";

export const CELDAS_DE_VENTAS_A: readonly CeldaDeVentas[] = [
  // ---- Bloque A: el ticket nace, se cobra, se anula ------------------------------------------------------------------------------
  {
    id: "A-01",
    accion: "Cerrar la cuenta",
    partida: "Cuenta ABIERTA con líneas vigentes",
    permitido: true,
    errores: [],
    resultado: "Nace el ticket EMITIDO (o CORTESIA si el total es 0)",
    regla: "INV-TKT-1, INV-TKT-2",
    decision: "dec. 146",
    quien: "base+codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "A-02",
    accion: "Cerrar la cuenta",
    partida: "Cuenta ABIERTA sin líneas",
    permitido: false,
    errores: ["CUENTA_SIN_LINEAS"],
    resultado: "Se rechaza",
    regla: "INV-TKT-1",
    decision: "dec. 146",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "A-03",
    accion: "Cerrar la cuenta",
    partida: "Cuenta ANULADA",
    permitido: false,
    errores: ["CUENTA_ANULADA"],
    resultado: "Se rechaza",
    regla: "TRANSICIONES_DE_CUENTA",
    decision: "E4 §3.3",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "A-04",
    accion: "Cerrar la cuenta",
    partida: "Dos veces con la misma clave",
    permitido: true,
    errores: [],
    resultado: "Se cierra una sola vez y devuelve lo hecho (yaExistia)",
    regla: "idempotencia (regla de oro)",
    decision: "reglas de oro del dueño",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "A-05",
    accion: "Cobrar",
    partida:
      "Ticket EMITIDO con saldo > 0, perilla cobrar_en_partes encendida e importe a cobrar <= saldo",
    permitido: true,
    errores: [],
    resultado: "Cobro parcial o total; saldado => COBRADO",
    regla: "R-07a, R-07b, R-07c",
    decision: `${DEC_14_11} (P1 a P3)`,
    quien: "base+codigo",
    hoy: "DIFIERE",
    pendiente: "C2",
    transiciones: [{ de: "EMITIDO", a: "COBRADO" }],
  },
  {
    id: "A-06",
    accion: "Cobrar",
    partida: "Ticket EMITIDO e importe a cobrar > saldo",
    permitido: false,
    errores: [],
    resultado: "COBRO_EXCEDE_EL_SALDO (nombre a definir por el tramo)",
    regla: "R-07c",
    decision: `${DEC_14_11} (P1 a P3)`,
    quien: "base",
    hoy: "NO_EXISTE",
    pendiente: "C1 y C2",
  },
  {
    id: "A-07",
    accion: "Cobrar",
    partida: "Ticket EMITIDO y total de los medios distinto del importe a cobrar",
    permitido: false,
    errores: ["COBRO_NO_CUADRA"],
    resultado: "Se rechaza con falta o sobra (hoy contra el total del ticket)",
    regla: "R-07b",
    decision: `${DEC_14_11} (P1 a P3)`,
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "A-08",
    accion: "Cobrar",
    partida: "Ticket COBRADO",
    permitido: false,
    errores: ["TICKET_YA_COBRADO"],
    resultado: "Se rechaza",
    regla: "R-10",
    decision: "decisión 62",
    quien: "base+codigo",
    hoy: "COINCIDE",
    pendiente: null,
    transiciones: [{ de: "COBRADO", a: "COBRADO" }],
  },
  {
    id: "A-09",
    accion: "Cobrar",
    partida: "Ticket CORTESIA",
    permitido: false,
    errores: ["TICKET_NO_COBRABLE"],
    resultado: "Se rechaza",
    regla: "R-11",
    decision: "E4 VENTA_A_CERO",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
    transiciones: [{ de: "CORTESIA", a: "COBRADO" }],
  },
  {
    id: "A-10",
    accion: "Cobrar",
    partida: "Ticket ANULADO",
    permitido: false,
    errores: ["TICKET_ANULADO"],
    resultado: "Se rechaza",
    regla: "R-09",
    decision: "decisión 62",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
    transiciones: [{ de: "ANULADO", a: "COBRADO" }],
  },
  {
    id: "A-11",
    accion: "Cobrar",
    partida: "Ejemplar distinto del vigente",
    permitido: false,
    errores: ["EJEMPLAR_DESACTUALIZADO"],
    resultado: "Se rechaza",
    regla: "R-06",
    decision: "E4 §3.6",
    quien: "base+codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "A-12",
    accion: "Cobrar",
    partida: "Sin sesión de caja abierta, o caja en cierre",
    permitido: false,
    errores: ["SIN_SESION_ABIERTA", "CAJA_EN_CIERRE"],
    resultado: "Se rechaza",
    regla: "sesión de caja (módulo caja)",
    decision: "E3",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "A-13",
    accion: "Anular ticket",
    partida: "EMITIDO, COBRADO o CORTESIA, sin factura vigente y con la jornada abierta",
    permitido: true,
    errores: [],
    resultado: "Pasa a ANULADO (no devuelve dinero)",
    regla: "R-09",
    decision: "dec. 152; F2 de ventas-correcciones-de-ticket.md",
    quien: "base+codigo",
    hoy: "COINCIDE",
    pendiente: null,
    transiciones: [
      { de: "EMITIDO", a: "ANULADO" },
      { de: "COBRADO", a: "ANULADO" },
      { de: "CORTESIA", a: "ANULADO" },
    ],
  },
  {
    id: "A-14",
    accion: "Anular ticket",
    partida: "EMITIDO o COBRADO con factura vigente",
    permitido: false,
    errores: [],
    resultado: "TICKET_CON_COMPROBANTE_VIGENTE: no hasta acreditar (hoy lo permite: defecto)",
    regla: "R-32",
    decision: `${DEC_14_11} (P6, Q-B)`,
    quien: "codigo",
    hoy: "DIFIERE",
    pendiente: "T0",
  },
  {
    id: "A-15",
    accion: "Anular ticket",
    partida: "Ticket ANULADO",
    permitido: false,
    errores: ["TICKET_ANULADO"],
    resultado: "Se rechaza",
    regla: "R-09",
    decision: "decisión 62",
    quien: "base",
    hoy: "COINCIDE",
    pendiente: null,
    transiciones: [{ de: "ANULADO", a: "ANULADO" }],
  },
  {
    id: "A-16",
    accion: "Anular ticket",
    partida: "Jornada cerrada",
    permitido: false,
    errores: ["JORNADA_CERRADA"],
    resultado: "Se rechaza",
    regla: "jornada",
    decision: "decisión 170",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "A-17",
    accion: "Corregir ticket (nivel 1, solo bajar)",
    partida: "Lo no facturado, por encima de lo cobrado",
    permitido: true,
    errores: [],
    resultado: "Ejemplar nuevo (DISEÑADO, no construido)",
    regla: "ventas-correcciones-de-ticket.md P2, P6",
    decision: "DISEÑADO",
    quien: "codigo",
    hoy: "NO_EXISTE",
    pendiente: "corrección de ticket",
  },
  {
    id: "A-18",
    accion: "Corregir ticket",
    partida: "Lo ya facturado",
    permitido: false,
    errores: [],
    resultado: "No hasta acreditar esa factura (CON_FACTURA_VIGENTE, nombre a definir)",
    regla: "P6",
    decision: "DISEÑADO",
    quien: "codigo",
    hoy: "NO_EXISTE",
    pendiente: "corrección de ticket",
  },
  {
    id: "A-19",
    accion: "Corregir ticket",
    partida: "Bajar el total por debajo de lo ya cobrado",
    permitido: false,
    errores: [],
    resultado:
      "No (SUPUESTO, DEC-0390: la devolución queda fuera del sistema, dec. 152); error a definir",
    regla: "migraciones-que-aflojan-la-base.md §6, riesgo 1",
    decision: "SUPUESTO (DEC-0390) sin decisión del dueño",
    quien: "codigo",
    hoy: "NO_EXISTE",
    pendiente: "corrección de ticket",
  },
  {
    id: "A-20",
    accion: "Corregir ticket",
    partida: "Ticket ANULADO",
    permitido: false,
    errores: [],
    resultado: "Un ticket anulado no se corrige: el ejemplar vigente no se mueve",
    regla: "R-09",
    decision: "decisión 62",
    quien: "base",
    hoy: "COINCIDE",
    pendiente: null,
  },
];
