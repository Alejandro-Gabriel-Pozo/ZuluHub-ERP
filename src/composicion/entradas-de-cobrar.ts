import { z } from "zod";
import type { Resultado } from "../primitivas/resultado/resultado";
import {
  decimal,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de las acciones de cobrar y anular del mostrador (K3 y K5): de lo que manda el navegador a la entrada de los casos de uso de ventas.
 * Misma regla que `entradas-de-facturar-tickets.ts`: la empresa y la persona salen del contexto del servidor y LA SUCURSAL la pone el servidor (la
 * elegida en el dispositivo, validada contra el alcance): ninguno de estos esquemas la declara, así que no se puede mandar. Lista de permitidos: el
 * esquema es estricto (una clave que no declara, p. ej. el departamento o un `numeroDeTarjeta`, rechaza el pedido entero). Acá solo se dice si el dato
 * tiene la FORMA pedida; el largo, el conjunto permitido y el negocio de cada dato (cupón, últimos 4, cuotas, DNI, motivo, importes) los decide el
 * dominio, una sola vez, dentro de la transacción: no se copia ningún límite. Los ids de la venta (cuenta, ejemplar, líneas) y la clave de
 * idempotencia los genera la pantalla al agregar la primera línea (e4 §3.7) y los reutiliza en cada reintento.
 */

const importe = z.strictObject({ moneda: texto, monto: decimal });

/** Los cinco datos opcionales de un cobro. Ausente es válido; el contenido lo juzga caja (`validarDatosDelCobro`). */
const datosDelCobro = z.strictObject({
  cupon: texto.optional(),
  ultimos4: texto.optional(),
  marcaDeTarjetaId: texto.optional(),
  cuotas: z.number().int().optional(),
  dni: texto.optional(),
});

const cobro = z.strictObject({
  medioDePagoId: identificador,
  cuentaDeCobroId: identificador.nullable(),
  importe,
  datos: datosDelCobro.optional(),
});

const linea = z.strictObject({
  lineaId: identificador,
  productoId: identificador,
  varianteId: identificador.optional(),
  opcionIds: z.array(identificador),
  cantidad: decimal,
  precioAbierto: decimal.optional(),
});

const formaDeCobrarLaVenta = z.strictObject({
  claveIdempotencia: texto,
  cuentaId: identificador,
  ejemplarId: identificador,
  lineas: z.array(linea),
  totalEsperado: importe,
  confirmaciones: z.array(texto).optional(),
  cajaId: identificador,
  cobros: z.array(cobro),
});

export type EntradaWebDeCobrarLaVenta = Readonly<{
  claveIdempotencia: string;
  cuentaId: string;
  ejemplarId: string;
  lineas: readonly Readonly<{
    lineaId: string;
    productoId: string;
    varianteId?: string | undefined;
    opcionIds: readonly string[];
    cantidad: string;
    precioAbierto?: string | undefined;
  }>[];
  totalEsperado: Readonly<{ moneda: string; monto: string }>;
  confirmaciones?: readonly string[] | undefined;
  cajaId: string;
  cobros: readonly Readonly<{
    medioDePagoId: string;
    cuentaDeCobroId: string | null;
    importe: Readonly<{ moneda: string; monto: string }>;
    datos?:
      | Readonly<{
          cupon?: string | undefined;
          ultimos4?: string | undefined;
          marcaDeTarjetaId?: string | undefined;
          cuotas?: number | undefined;
          dni?: string | undefined;
        }>
      | undefined;
  }>[];
}>;

export function entradaDeCobrarLaVenta(
  crudo: unknown,
): Resultado<EntradaWebDeCobrarLaVenta, ErrorDeEntrada> {
  return leer(formaDeCobrarLaVenta, crudo);
}

const formaDeAnular = z.strictObject({
  claveIdempotencia: texto,
  ticketId: identificador,
  /** El ejemplar vigente que vio quien anula (el `ejemplarId` del resultado del cobro). */
  ejemplarBaseId: identificador,
  /** El id del ejemplar de anulación: lo genera la pantalla y lo repite en cada reintento. */
  ejemplarNuevoId: identificador,
  motivo: texto,
});

export type EntradaWebDeAnularElTicket = Readonly<z.output<typeof formaDeAnular>>;

export function entradaDeAnularElTicket(
  crudo: unknown,
): Resultado<EntradaWebDeAnularElTicket, ErrorDeEntrada> {
  return leer(formaDeAnular, crudo);
}

/** Del navegador solo viaja el ticket: el ancho del papel (80 mm) y la sucursal los decide el servidor. */
const formaDelPapel = z.strictObject({ ticketId: identificador });

export function entradaDeDocumentoDelTicket(
  crudo: unknown,
): Resultado<Readonly<{ ticketId: string }>, ErrorDeEntrada> {
  return leer(formaDelPapel, crudo);
}

const formaDeOpciones = z.strictObject({ cajaId: identificador });

export function entradaDeOpcionesDeCobro(
  crudo: unknown,
): Resultado<Readonly<{ cajaId: string }>, ErrorDeEntrada> {
  return leer(formaDeOpciones, crudo);
}
