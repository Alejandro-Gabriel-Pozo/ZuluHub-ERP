import { z } from "zod";
import { ORDENES_DE_LA_LISTA, type OrdenDeLaLista } from "../modulos/cuenta_corriente/publico";
import {
  decimal,
  entero,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";
import type { Resultado } from "../primitivas/resultado/resultado";

/**
 * La frontera de las pantallas de la cuenta corriente de clientes (CC-5): de lo que trae el navegador a lo que reciben las consultas. Lista de permitidos: solo se toman los campos declarados;
 * la empresa y la persona NO se leen del pedido (las pone el servidor) y un campo de más es un pedido inválido (el genérico), no se ignora en silencio. Previene: un orden que no existe y
 * una ficha pedida con un id que no es de un cliente. Chequeo: `entradas-de-cuenta-corriente.test.ts`.
 */

const formaDeLaLista = z.strictObject({
  orden: z.enum(ORDENES_DE_LA_LISTA).optional(),
});

const formaDeLaFicha = z.strictObject({ parteId: identificador });

export type EntradaWebDeLaLista = Readonly<{ orden: OrdenDeLaLista }>;
export type EntradaWebDeLaFicha = Readonly<{ parteId: string }>;

/** La lista admite solo `orden`; sin él, por saldo (lo que la maqueta muestra al abrir). */
export function entradaDeLaLista(crudo: unknown): Resultado<EntradaWebDeLaLista, ErrorDeEntrada> {
  const r = leer(formaDeLaLista, crudo ?? {});
  return r.ok ? { ok: true, valor: { orden: r.valor.orden ?? "SALDO" } } : r;
}

export function entradaDeLaFicha(crudo: unknown): Resultado<EntradaWebDeLaFicha, ErrorDeEntrada> {
  return leer(formaDeLaFicha, crudo);
}

/**
 * Las escrituras de la ficha (CC-5, A2). Solo se toma lo que el esquema declara y un campo de más es el genérico. La empresa y la persona NO se leen del pedido. Esta capa dice si el dato tiene la
 * FORMA pedida (el identificador que genera la pantalla, un texto acotado, un entero, un decimal en texto, la versión que se vio); qué plazo, límite o motivo son válidos lo decide el dominio.
 */
const formaDeHabilitar = z.strictObject({
  id: identificador,
  parteId: identificador,
  plazoDias: entero,
  limite: decimal,
});
const formaDeCondiciones = z.strictObject({
  cuentaId: identificador,
  versionEsperada: entero,
  plazoDias: entero,
  limite: decimal,
});
const formaDeSuspender = z.strictObject({
  cuentaId: identificador,
  versionEsperada: entero,
  motivo: texto,
});
const formaDeReactivar = z.strictObject({
  cuentaId: identificador,
  versionEsperada: entero,
  motivo: texto,
});

export type EntradaWebDeHabilitar = Readonly<{
  id: string;
  parteId: string;
  plazoDias: number;
  limite: string;
}>;
export type EntradaWebDeCondiciones = Readonly<{
  cuentaId: string;
  versionEsperada: number;
  plazoDias: number;
  limite: string;
}>;
export type EntradaWebDeSuspender = Readonly<{
  cuentaId: string;
  versionEsperada: number;
  motivo: string;
}>;
export type EntradaWebDeReactivar = Readonly<{
  cuentaId: string;
  versionEsperada: number;
  motivo: string;
}>;

export const entradaDeHabilitar = (
  crudo: unknown,
): Resultado<EntradaWebDeHabilitar, ErrorDeEntrada> => leer(formaDeHabilitar, crudo);
export const entradaDeCondiciones = (
  crudo: unknown,
): Resultado<EntradaWebDeCondiciones, ErrorDeEntrada> => leer(formaDeCondiciones, crudo);
export const entradaDeSuspender = (
  crudo: unknown,
): Resultado<EntradaWebDeSuspender, ErrorDeEntrada> => leer(formaDeSuspender, crudo);
export const entradaDeReactivar = (
  crudo: unknown,
): Resultado<EntradaWebDeReactivar, ErrorDeEntrada> => leer(formaDeReactivar, crudo);

/**
 * El saldo de UN cliente al venderle a cuenta (CC-5, B1): el cliente elegido, dónde se vende (la cuenta de consumo de la mesa; sin ella, la sucursal con la que trabaja quien vende, que pone el servidor y no
 * viaja) y, si se quiere ver qué pasaría, el total de la venta (texto decimal). Un campo de más es el genérico. Qué es un total válido lo decide el dominio.
 */
const formaDelClienteParaVender = z.strictObject({
  clienteId: identificador,
  cuentaDeConsumoId: identificador.optional(),
  totalDeLaVenta: decimal.optional(),
});

export type EntradaWebDelClienteParaVender = Readonly<{
  clienteId: string;
  cuentaDeConsumoId?: string | undefined;
  totalDeLaVenta?: string | undefined;
}>;

export const entradaDelClienteParaVender = (
  crudo: unknown,
): Resultado<EntradaWebDelClienteParaVender, ErrorDeEntrada> =>
  leer(formaDelClienteParaVender, crudo);
