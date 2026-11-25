import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import type { FacturaCotizada } from "./modelo-de-factura";

/** Dos ayudas chicas de `PantallaDeNuevaCompra` (que no pase del tope de líneas por archivo). */

/** Sin cuentas de factura (la empresa compra «Sin factura»): nunca se llama, porque no hay nada que cotizar. */
export const sinCotizarFactura = (): Promise<Respuesta<FacturaCotizada>> =>
  Promise.reject(new Error("la factura no se cotiza en «Sin factura»"));

export const irAPorDefecto = (ruta: string): void => {
  window.location.assign(ruta);
};
