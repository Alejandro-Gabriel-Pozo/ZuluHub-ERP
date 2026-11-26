import { z } from "zod";
import type { Resultado } from "../primitivas/resultado/resultado";
import { datosDelCobro } from "./entradas-de-cobrar";
import { identificador, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de «Cobrar un ticket a cuenta» (CC-5 B2a): de lo que manda el navegador a la entrada del caso de uso de ventas. Misma regla que `entradas-de-cobrar.ts`: la empresa y la persona salen del
 * contexto del servidor, y NINGÚN importe viaja: el total lo pone el servidor (el del ejemplar vigente del ticket), así que no se puede cobrar de más ni de menos. Esquema estricto (lista de permitidos): una
 * clave que no declara (una sucursal, un importe, un cliente) rechaza el pedido entero. La clave de idempotencia y el ejemplar que vio quien cobra los genera la pantalla al abrir la hoja y los repite en cada
 * reintento. Acá solo se dice si el dato tiene la FORMA pedida; el contenido de los datos del cobro lo juzga caja, una sola vez, dentro de la transacción.
 */

const formaDeLaLectura = z.strictObject({
  clienteId: identificador,
  /** Un ticket en particular (el que se vio en la hoja); sin él, el cargo pendiente más antiguo del cliente. */
  ticketId: identificador.optional(),
});

export type EntradaWebDelTicketACobrar = Readonly<{
  clienteId: string;
  ticketId?: string | undefined;
}>;

export function entradaDelTicketACobrar(
  crudo: unknown,
): Resultado<EntradaWebDelTicketACobrar, ErrorDeEntrada> {
  return leer(formaDeLaLectura, crudo);
}

const formaDeCobrarACuenta = z.strictObject({
  claveIdempotencia: texto,
  ticketId: identificador,
  ejemplarId: identificador,
  cajaId: identificador,
  medioDePagoId: identificador,
  cuentaDeCobroId: identificador.nullable(),
  datos: datosDelCobro.optional(),
});

export type EntradaWebDeCobrarACuenta = Readonly<{
  claveIdempotencia: string;
  ticketId: string;
  ejemplarId: string;
  cajaId: string;
  medioDePagoId: string;
  cuentaDeCobroId: string | null;
  datos?:
    | Readonly<{
        cupon?: string | undefined;
        ultimos4?: string | undefined;
        marcaDeTarjetaId?: string | undefined;
        cuotas?: number | undefined;
        dni?: string | undefined;
      }>
    | undefined;
}>;

export function entradaDeCobrarACuenta(
  crudo: unknown,
): Resultado<EntradaWebDeCobrarACuenta, ErrorDeEntrada> {
  return leer(formaDeCobrarACuenta, crudo);
}
