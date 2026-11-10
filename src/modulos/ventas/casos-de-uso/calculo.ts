import { cantidadDesdeTexto } from "../../../primitivas/cantidad/cantidad";
import { importeAJson, type ImporteJson } from "../../../primitivas/dinero/importe";
import { precioUnitarioDesdeTexto } from "../../../primitivas/dinero/precio-unitario";
import { calcularTicket, type TicketCalculado } from "../dominio/calcular-ticket";
import type { Linea } from "../persistencia/repositorio-de-cuentas";

/** Las líneas VIGENTES de la cuenta, con precio y cantidad como valores exactos: lo que entra a `calcularTicket`. Un valor que no se lee es un dato roto y se frena. */
export function calcularLasLineas(lineas: readonly Linea[]): TicketCalculado {
  return calcularTicket(
    lineas
      .filter((l) => l.estado === "VIGENTE")
      .map((l) => ({
        id: l.id,
        precioUnitario: precioUnitarioDesdeTexto(l.precioUnitario),
        cantidad: cantidadDesdeTexto(l.cantidad),
      })),
  );
}

/** Importe de la frontera: texto decimal con moneda. */
export const aJson = (calculado: TicketCalculado): ImporteJson => importeAJson(calculado.total);

/**
 * El puente de las consultas hacia las reglas de ventas (ADR-005: una consulta no importa el dominio de su módulo; las reglas viven en los
 * casos de uso). Re-exporta, sin copiar, el rótulo del ticket (decisión 177), la marca de identificador y la forma de uuid, para que
 * `numeroDeCorreccion` y la forma de un id sean UNA sola regla.
 */
export { numeroDeCorreccion } from "../dominio/rotulo";
/** La unidad que se factura de un renglón (`null` para la unidad base): una sola regla, la de `dominio/factura-de-ticket.ts`. */
export { unidadDelRenglon } from "../dominio/factura-de-ticket";
export { cuentaId, esUuid } from "../dominio/identificadores";
