import { z } from "zod";
import { USOS_DE_DEPOSITO } from "../modulos/stock/publico";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, texto, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de «Depósitos» (stock): de lo que manda el navegador a lo que recibe el caso de uso. Solo se toma lo que el esquema declara: la empresa, la persona y la sucursal NO
 * se leen del pedido (las pone el servidor). Esta capa dice si el dato tiene la FORMA pedida (el identificador que genera la pantalla, un texto acotado, un uso de la lista cerrada,
 * un sí o no, la versión que se vio); qué es un nombre válido y si «de venta» corresponde a ese uso lo decide el dominio de stock, dentro de la transacción. «De venta» ausente es `false`.
 */

const formaDeAlta = z.object({
  id: identificador,
  nombre: texto,
  uso: z.enum(USOS_DE_DEPOSITO),
  deVenta: z.boolean().optional(),
});

export type EntradaWebDeAltaDeDeposito = Readonly<{
  id: string;
  nombre: string;
  uso: (typeof USOS_DE_DEPOSITO)[number];
  deVenta: boolean;
}>;

export function entradaDeAltaDeDeposito(
  crudo: unknown,
): Resultado<EntradaWebDeAltaDeDeposito, ErrorDeEntrada> {
  const forma = leer(formaDeAlta, crudo);
  return forma.ok
    ? ok({
        id: forma.valor.id,
        nombre: forma.valor.nombre,
        uso: forma.valor.uso,
        deVenta: forma.valor.deVenta ?? false,
      })
    : forma;
}

const formaDeEdicion = z.object({
  depositoId: identificador,
  nombre: texto,
  deVenta: z.boolean().optional(),
  versionEsperada: entero,
});

export type EntradaWebDeEdicionDeDeposito = Readonly<{
  depositoId: string;
  nombre: string;
  deVenta: boolean;
  versionEsperada: number;
}>;

/** Editar: el depósito, su nombre, si es «de venta» (ausente es `false`) y la versión que vio la persona. El uso no se lee: no cambia. */
export function entradaDeEdicionDeDeposito(
  crudo: unknown,
): Resultado<EntradaWebDeEdicionDeDeposito, ErrorDeEntrada> {
  const forma = leer(formaDeEdicion, crudo);
  return forma.ok
    ? ok({
        depositoId: forma.valor.depositoId,
        nombre: forma.valor.nombre,
        deVenta: forma.valor.deVenta ?? false,
        versionEsperada: forma.valor.versionEsperada,
      })
    : forma;
}

const formaDeCambioDeEstado = z.object({ depositoId: identificador });

/** Desactivar y reactivar: solo el depósito (el sentido lo fija la acción, no el pedido). */
export function entradaDeCambioDeEstadoDeDeposito(
  crudo: unknown,
): Resultado<Readonly<{ depositoId: string }>, ErrorDeEntrada> {
  const forma = leer(formaDeCambioDeEstado, crudo);
  return forma.ok ? ok({ depositoId: forma.valor.depositoId }) : forma;
}
