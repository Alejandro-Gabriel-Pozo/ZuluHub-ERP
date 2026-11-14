import type { CeldaDeOraculo } from "../../../primitivas/oraculo/celdas";
import type { EstadoDeComprobanteArca } from "./estados-de-comprobante";

/**
 * LAS CELDAS del oráculo de factura y nota de crédito (fiscal): lo que el sistema puede y no puede hacer con un comprobante ya emitido. Es solo
 * DATOS; la lógica vive en `oraculo-de-comprobante.ts`. Fuente: el documento del oráculo (`11-especificaciones/auditoria-de-reglas/`, repo de docs)
 * (propuesta de Arquitectura, 2026-11-14; bloque C), con las reglas `VF-R-nn` de `ventas-fiscal-piloto.md` y las decisiones D-11 y D-83 del dueño.
 * Cada celda con `hoy: COINCIDE` se ejecuta contra el caso de uso real (la prueba de integración del oráculo de ventas y
 * `oraculo-de-comprobante.test.ts`); los estados se comparan con la base en `facturacion-estados.test.ts` («los 42 pares»).
 * Hallazgo de documento (no de código): la celda C-04 del documento nombra «otro emisor, ambiente, receptor o letra»; el código rechaza otra
 * EMPRESA, otro emisor y otro ambiente, y el receptor y la letra se COPIAN del asociado (no hay cómo que difieran). Acá figuran los tres códigos
 * reales.
 * Justificación (CLAUDE.md «Justificar cada regla»): ver el archivo de datos del oráculo de ventas. La tabla se congela con una huella en la prueba.
 */

export type IdDeCeldaDeComprobante =
  "C-01" | "C-02" | "C-03" | "C-04" | "C-05" | "C-06" | "C-07" | "C-08" | "C-09" | "C-10";

export type CeldaDeComprobante = CeldaDeOraculo<IdDeCeldaDeComprobante, EstadoDeComprobanteArca>;

export const CELDAS_DE_COMPROBANTE: readonly CeldaDeComprobante[] = [
  {
    id: "C-01",
    accion: "Acreditar (nota de crédito)",
    partida: "Factura AUTORIZADA e importe <= lo facturado",
    permitido: true,
    errores: [],
    resultado:
      "Se emite la nota; el descuento de pendientes se limita a lo facturado del renglón (T6)",
    regla: "R-27, R-28",
    decision: "dec. 14/11 (Q1)",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "C-02",
    accion: "Acreditar (nota de crédito)",
    partida: "Factura AUTORIZADA e importe mayor que lo facturado",
    permitido: true,
    errores: [],
    resultado: "Se emite sin tope ni aviso (ARCA observa 10237)",
    regla: "D-11, D-83",
    decision: "dueño 28/10 y 3/11; re-confirmada 14/11",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "C-03",
    accion: "Acreditar",
    partida: "Factura que no está AUTORIZADA",
    permitido: false,
    errores: ["ASOCIADO_NO_AUTORIZADO"],
    resultado: "Se rechaza",
    regla: "R-26",
    decision: "ARCA (H7 §B.3.5)",
    quien: "base+codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "C-04",
    accion: "Acreditar",
    partida: "Factura de otra empresa, otro emisor u otro ambiente",
    permitido: false,
    errores: ["ASOCIADO_DE_OTRA_EMPRESA", "ASOCIADO_DE_OTRO_EMISOR", "ASOCIADO_DE_OTRO_AMBIENTE"],
    resultado: "Se rechaza (el receptor y la letra se copian del asociado: no pueden diferir)",
    regla: "R-26",
    decision: "ARCA (H7 §B.3.5)",
    quien: "base+codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "C-05",
    accion: "Acreditar",
    partida: "Sobre otra nota de crédito",
    permitido: false,
    errores: ["ASOCIADO_NO_ASOCIABLE"],
    resultado: "Se rechaza",
    regla: "R-26",
    decision: "ARCA (H7 §B.3.5)",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "C-06",
    accion: "Nota de crédito total",
    partida: "Suma de notas AUTORIZADAS >= total de esa factura",
    permitido: true,
    errores: [],
    resultado:
      "La factura deja de valer (ACREDITADO_TOTAL) y sus renglones vuelven a pendientes (el descuento por renglón es T6)",
    regla: "R-27",
    decision: "dec. 174",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "C-07",
    accion: "Nota de crédito parcial",
    partida: "Suma de notas AUTORIZADAS < total",
    permitido: true,
    errores: [],
    resultado:
      "La factura sigue vigente y devuelve a pendientes solo lo acreditado (hoy no devuelve nada)",
    regla: "R-27",
    decision: "dec. 175; supuesto 14/11",
    quien: "codigo",
    hoy: "DIFIERE",
    pendiente: "T6",
  },
  {
    id: "C-08",
    accion: "Reemitir",
    partida: "Tras una nota de crédito total de la factura",
    permitido: true,
    errores: [],
    resultado: "Se factura de nuevo, a otro receptor (origen de reemisión)",
    regla: "R-21",
    decision: "emisión desde ventas, paso 4 (reemisión tras nota total)",
    quien: "codigo",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "C-09",
    accion: "Cualquier cambio de una factura AUTORIZADA",
    partida: "Contenido, número o CAE",
    permitido: false,
    errores: [],
    resultado: "Nunca: el comprobante autorizado no cambia (no sale de AUTORIZADO)",
    regla: "INV-FAC-1",
    decision: "ARCA; H7 §B.2",
    quien: "base",
    hoy: "COINCIDE",
    pendiente: null,
  },
  {
    id: "C-10",
    accion: "Emitir",
    partida:
      "Dos facturas con la misma identidad (origen, emisor, clase) no rechazadas ni descartadas",
    permitido: false,
    errores: [],
    resultado: "La segunda es la misma: yaExistia / CLAVE_REUTILIZADA",
    regla: "R-21",
    decision: "reglas de oro del dueño",
    quien: "base",
    hoy: "COINCIDE",
    pendiente: null,
  },
];
