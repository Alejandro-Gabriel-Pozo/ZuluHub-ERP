import { z } from "zod";
import { TIPOS_DE_COMPROBANTE_DE_PROVEEDOR } from "../modulos/compras/publico";
import type { Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de la ficha del proveedor de compras (Compras PR 4): de lo que manda el navegador a lo que reciben las consultas y los casos de uso. Lista de permitidos: de cada pedido solo se toman los
 * campos declarados (el proveedor o el pedido por su id, el número del punto de venta, el tipo de comprobante, la decisión); cualquier otra clave (`empresaId`, `sucursalId`, …) vuelve el pedido inválido
 * (el genérico). La empresa y quién actúa los pone el servidor. El tipo se elige entre los nueve del dominio (la lista se IMPORTA de compras); que el número del punto de venta esté en rango lo decide
 * el servidor (`esPuntoDeVentaValido`): acá solo se pide que sea un entero. Previene: un tipo o una decisión inventados, y un `empresaId` que el navegador manda de más. Chequeo: `entradas-de-ficha-de-proveedor.test.ts`.
 */

export type EntradaWebDeProveedor = Readonly<{ parteId: string }>;
export type EntradaWebDePuntoDeVenta = Readonly<{ parteId: string; numero: number }>;
export type EntradaWebDeComprobante = Readonly<{ parteId: string; tipo: string }>;
export type EntradaWebDeResolverPedido = Readonly<{
  pedidoId: string;
  decision: "APROBAR" | "RECHAZAR";
}>;

const FORMA_DEL_PROVEEDOR = z.strictObject({ parteId: identificador });
const FORMA_DEL_PUNTO_DE_VENTA = z.strictObject({ parteId: identificador, numero: entero });
const FORMA_DEL_COMPROBANTE = z.strictObject({
  parteId: identificador,
  tipo: z.enum(TIPOS_DE_COMPROBANTE_DE_PROVEEDOR),
});
const FORMA_DE_RESOLVER = z.strictObject({
  pedidoId: identificador,
  decision: z.enum(["APROBAR", "RECHAZAR"]),
});

export const entradaDeProveedor = (
  crudo: unknown,
): Resultado<EntradaWebDeProveedor, ErrorDeEntrada> => leer(FORMA_DEL_PROVEEDOR, crudo);
export const entradaDePuntoDeVenta = (
  crudo: unknown,
): Resultado<EntradaWebDePuntoDeVenta, ErrorDeEntrada> => leer(FORMA_DEL_PUNTO_DE_VENTA, crudo);
export const entradaDeComprobante = (
  crudo: unknown,
): Resultado<EntradaWebDeComprobante, ErrorDeEntrada> => leer(FORMA_DEL_COMPROBANTE, crudo);
export const entradaDeResolverPedido = (
  crudo: unknown,
): Resultado<EntradaWebDeResolverPedido, ErrorDeEntrada> => leer(FORMA_DE_RESOLVER, crudo);
