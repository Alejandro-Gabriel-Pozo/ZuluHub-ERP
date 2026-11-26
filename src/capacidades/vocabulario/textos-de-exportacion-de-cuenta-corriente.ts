import type { FuenteDeTexto, UsoDeTexto } from "./uso-y-fuente-de-texto";

/**
 * Los textos de la exportación de la cuenta corriente a Excel (prefijo `exportacion_de_cuenta_corriente.`, CC-5 D; dueño, 26/11/2026: «usen textos de la exportación de Compras»): solo los diez que
 * no tenían texto aprobado (encabezados de antigüedad, sus cuatro tramos, «Sí», «No», «Vigente» y «Cobranza»). El orquestador los aceptó por la delegación de la fila 173 en `DEC-CCL-007`
 * (etiquetas simples, sin dinero, permisos ni fiscal). Todo lo demás de la hoja reutiliza claves que ya existían (`fiscal.pantalla.rotulo_cliente`, `fiscal.pantalla.documento_cuit`,
 * `compras.control.vence`, `cuenta_corriente.movimiento.*`, `ventas.cobro.importe`, `fiscal.pantalla.config_cartel_pendiente`, `caja.estado.anulado`, `caja.medios.tipo.*`): no se repite ninguno.
 */
const FUENTE: FuenteDeTexto = { decision: "DEC-CCL-007" };
const DE_LA_EXPORTACION: UsoDeTexto = {
  como: "FUNCION",
  archivo: "src/composicion/cuenta-corriente-exportacion-textos.ts",
  nombre: "rotulosDeLaExportacionDeCuentaCorriente",
};
const texto = <T extends string>(porDefecto: T) =>
  ({ porDefecto, usos: [DE_LA_EXPORTACION] as const, fuente: FUENTE }) as const;

export const TEXTOS_DE_EXPORTACION_DE_CUENTA_CORRIENTE = {
  "exportacion_de_cuenta_corriente.antiguedad_en_dias": texto("Antigüedad (días)"),
  "exportacion_de_cuenta_corriente.tramo_de_antiguedad": texto("Tramo de antigüedad"),
  "exportacion_de_cuenta_corriente.tramo_0_a_30": texto("0 a 30 días"),
  "exportacion_de_cuenta_corriente.tramo_31_a_60": texto("31 a 60 días"),
  "exportacion_de_cuenta_corriente.tramo_61_a_90": texto("61 a 90 días"),
  "exportacion_de_cuenta_corriente.tramo_mas_de_90": texto("Más de 90 días"),
  "exportacion_de_cuenta_corriente.si": texto("Sí"),
  "exportacion_de_cuenta_corriente.no": texto("No"),
  "exportacion_de_cuenta_corriente.vigente": texto("Vigente"),
  "exportacion_de_cuenta_corriente.cobranza": texto("Cobranza"),
} as const;
