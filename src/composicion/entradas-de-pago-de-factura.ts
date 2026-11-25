import { z } from "zod";
import { MEDIOS_DE_PAGO } from "../modulos/compras/publico";
import type { Resultado } from "../primitivas/resultado/resultado";
import { identificador, leer, texto, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de «Declarar pago» y de anular un pago (Compras PR 8): de lo que manda el navegador a lo que reciben `declararPago` y `anularPago`. Lista de permitidos: solo se toman los campos declarados;
 * cualquier otro (`importe`, `empresaId`, `sucursalId`, …) hace inválido el pedido (el genérico). EL IMPORTE NO ES UN CAMPO: lo copia el servidor del total de la factura (un pago por factura, por el total, sin
 * parciales). El medio es de la lista cerrada de compras (la misma de la caja: `MEDIOS_DE_PAGO`, una regla, un lugar); la fecha y el motivo viajan como texto y los valida el servidor al correr el caso
 * de uso (fecha real y no futura según el «hoy» de Argentina; motivo de 1 a 500 caracteres). Con el medio efectivo viaja la caja de la que sale la plata y el motivo del egreso; con otro medio no
 * viajan (si llegan, el servidor rechaza). La clave de la pantalla abierta es la idempotencia del pago: el mismo envío repetido es el mismo pago. Chequeo: `entradas-de-pago-de-factura.test.ts`.
 */

export type EntradaWebDeDeclararPago = Readonly<{
  clave: string;
  comprobanteId: string;
  fechaDePago: string;
  medio: (typeof MEDIOS_DE_PAGO)[number];
  salidaDeCaja?: Readonly<{ cajaId: string; motivo: string }>;
}>;

const FORMA_DE_DECLARAR = z.strictObject({
  clave: identificador,
  comprobanteId: identificador,
  fechaDePago: texto,
  medio: z.enum(MEDIOS_DE_PAGO),
  cajaId: identificador.nullish(),
  motivo: texto.nullish(),
});

export function entradaDeDeclararPago(
  crudo: unknown,
): Resultado<EntradaWebDeDeclararPago, ErrorDeEntrada> {
  const leida = leer(FORMA_DE_DECLARAR, crudo);
  if (!leida.ok) return leida;
  const { cajaId, motivo, ...resto } = leida.valor;
  // Caja y motivo van juntos o ninguno: una caja sin motivo (o al revés) llega al servidor como una salida mal formada y se rechaza allá.
  return {
    ok: true,
    valor: {
      ...resto,
      ...(cajaId == null && motivo == null
        ? {}
        : { salidaDeCaja: { cajaId: cajaId ?? "", motivo: motivo ?? "" } }),
    },
  };
}

export type EntradaWebDeAnularPago = Readonly<{ pagoId: string; motivo: string }>;

const FORMA_DE_ANULAR = z.strictObject({ pagoId: identificador, motivo: texto });

export function entradaDeAnularPago(
  crudo: unknown,
): Resultado<EntradaWebDeAnularPago, ErrorDeEntrada> {
  return leer(FORMA_DE_ANULAR, crudo);
}
