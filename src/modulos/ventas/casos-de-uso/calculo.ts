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
