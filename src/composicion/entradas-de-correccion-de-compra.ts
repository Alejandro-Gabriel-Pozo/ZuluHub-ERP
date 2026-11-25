import { z } from "zod";
import type { Resultado } from "../primitivas/resultado/resultado";
import {
  decimal,
  entero,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de «Corregir» y «Anular» una compra (Compras PR 10): de lo que manda el navegador a lo que reciben `corregirCompra` y `anularCompra`. Lista de permitidos: solo se toman los campos
 * declarados; cualquier otro (`empresaId`, `sucursalId`, `cantidad`, `pesoReal`, …) hace inválido el pedido (el genérico): la empresa y quién actúa los pone el servidor, y corregir la cantidad o el peso
 * real NO se acepta desde esta pantalla (primera versión: solo el precio de una línea que ya lo tiene). El precio y el motivo viajan como TEXTO (ADR-006: el precio es texto decimal, nunca `number`);
 * que sean válidos (mayor que cero, hasta 6 decimales, el motivo de 1 a 500 con una letra) lo decide el servidor al correr el caso de uso, con la misma regla de siempre. Chequeo: `entradas-de-correccion-de-compra.test.ts`.
 */

export type EntradaWebDeCorregirCompra = Readonly<{
  clave: string;
  recepcionId: string;
  linea: number;
  correccionesVistas: number;
  precio: string;
  motivo: string;
}>;

const FORMA_DE_CORREGIR = z.strictObject({
  clave: identificador,
  recepcionId: identificador,
  linea: entero,
  correccionesVistas: entero,
  precio: decimal,
  motivo: texto,
});

export function entradaDeCorregirCompra(
  crudo: unknown,
): Resultado<EntradaWebDeCorregirCompra, ErrorDeEntrada> {
  return leer(FORMA_DE_CORREGIR, crudo);
}

export type EntradaWebDeAnularCompra = Readonly<{ recepcionId: string; motivo: string }>;

const FORMA_DE_ANULAR = z.strictObject({ recepcionId: identificador, motivo: texto });

export function entradaDeAnularCompra(
  crudo: unknown,
): Resultado<EntradaWebDeAnularCompra, ErrorDeEntrada> {
  return leer(FORMA_DE_ANULAR, crudo);
}
