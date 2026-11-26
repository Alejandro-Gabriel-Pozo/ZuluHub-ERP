import { z } from "zod";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  decimal,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de los movimientos de stock a mano (Entrada, Salida, Transferir, Ajustar, Anular): de lo que manda el navegador a lo que recibe la composición. Solo la FORMA: la cantidad, el costo, el motivo
 * y el detalle los valida el servidor. La empresa, la persona y la sucursal no se leen del pedido; el artículo viaja como id (su producto y su unidad los resuelve el servidor, nunca el navegador).
 * Un costo o un detalle en blanco es «ausente».
 */

const enBlanco = (v: string | undefined): string | undefined =>
  v === undefined || v.trim() === "" ? undefined : v;

const formaDeMovimiento = z.object({
  clave: identificador,
  depositoId: identificador,
  articuloId: identificador,
  cantidad: decimal,
  motivo: texto,
  costoUnitario: decimal.optional(),
  detalle: texto.optional(),
});
export type EntradaWebDeMovimiento = Readonly<{
  clave: string;
  depositoId: string;
  articuloId: string;
  cantidad: string;
  motivo: string;
  costoUnitario: string | undefined;
  detalle: string | undefined;
}>;
export function entradaDeMovimiento(
  crudo: unknown,
): Resultado<EntradaWebDeMovimiento, ErrorDeEntrada> {
  const f = leer(formaDeMovimiento, crudo);
  return f.ok
    ? ok({
        ...f.valor,
        costoUnitario: enBlanco(f.valor.costoUnitario),
        detalle: enBlanco(f.valor.detalle),
      })
    : f;
}

const formaDeTransferencia = z.object({
  clave: identificador,
  origenId: identificador,
  destinoId: identificador,
  articuloId: identificador,
  cantidad: decimal,
});
export type EntradaWebDeTransferencia = z.output<typeof formaDeTransferencia>;
export const entradaDeTransferencia = (crudo: unknown) => leer(formaDeTransferencia, crudo);

const formaDeAjuste = z.object({
  clave: identificador,
  depositoId: identificador,
  articuloId: identificador,
  sentido: z.enum(["SUMA", "RESTA"]),
  cantidad: decimal,
  detalle: texto.optional(),
});
export type EntradaWebDeAjuste = Readonly<{
  clave: string;
  depositoId: string;
  articuloId: string;
  sentido: "SUMA" | "RESTA";
  cantidad: string;
  detalle: string | undefined;
}>;
export function entradaDeAjuste(crudo: unknown): Resultado<EntradaWebDeAjuste, ErrorDeEntrada> {
  const f = leer(formaDeAjuste, crudo);
  return f.ok ? ok({ ...f.valor, detalle: enBlanco(f.valor.detalle) }) : f;
}

const formaDeAnulacion = z.object({
  clave: identificador,
  movimientoId: identificador,
  detalle: texto.optional(),
});
export type EntradaWebDeAnulacion = Readonly<{
  clave: string;
  movimientoId: string;
  detalle: string | undefined;
}>;
export function entradaDeAnulacion(
  crudo: unknown,
): Resultado<EntradaWebDeAnulacion, ErrorDeEntrada> {
  const f = leer(formaDeAnulacion, crudo);
  return f.ok ? ok({ ...f.valor, detalle: enBlanco(f.valor.detalle) }) : f;
}
