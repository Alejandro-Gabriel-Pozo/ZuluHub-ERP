import { z } from "zod";
import { ORDENES_DE_LA_LISTA, type OrdenDeLaLista } from "../modulos/cuenta_corriente/publico";
import { identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";
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
