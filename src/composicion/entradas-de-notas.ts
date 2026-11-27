import { z } from "zod";
import { ALICUOTAS_DE_COMPRA } from "../modulos/compras/publico";
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
 * La frontera de las pantallas de notas del proveedor (NOTAS-2c-1): de lo que trae el navegador a lo que reciben los casos de uso y las consultas. Lista de permitidos en todas: solo se toman los campos declarados;
 * la empresa, la persona y el PROVEEDOR no se leen del pedido (el proveedor lo lee el servidor de la factura que la nota corrige).
 *
 *  - **Cargar una nota** lleva la clave del envío (un UUID que genera la pantalla por intento: es la idempotencia), la factura que corrige (viene de la ruta) y la nota: tipo (los seis de nota, de la clase
 *    que pide la pantalla), punto de venta, número, fecha, importes por alícuota y total según la nota. Importes como TEXTO decimal, nunca `number`. Que el tipo sea de la clase, que las cuentas cierren y que no
 *    pase el tope lo decide el servidor.
 *  - **Anular una nota** lleva solo el motivo: la nota y su clase las liga la página con `.bind`.
 *  - **Las notas de una factura** llevan solo el id (un UUID).
 * Previene: dinero como `number`, una nota con el proveedor o la empresa que dijo el navegador, campos que nadie declaró. Chequeo: `entradas-de-notas.test.ts`.
 */

const TIPOS_DE_NOTA = [
  "NOTA_CREDITO_A",
  "NOTA_CREDITO_B",
  "NOTA_CREDITO_C",
  "NOTA_DEBITO_A",
  "NOTA_DEBITO_B",
  "NOTA_DEBITO_C",
] as const;
export type TipoDeNotaWeb = (typeof TIPOS_DE_NOTA)[number];

const formaDeImporte = z.strictObject({
  /** Una nota A lleva la alícuota de cada importe; una B o C no discrimina IVA y va sin ella (`null`): lo decide el servidor por el tipo. */
  alicuota: z.enum(ALICUOTAS_DE_COMPRA).nullable(),
  neto: decimal,
});

const formaDeNota = z.strictObject({
  tipo: z.enum(TIPOS_DE_NOTA),
  puntoDeVenta: entero,
  numero: entero,
  fecha: texto,
  importes: z.array(formaDeImporte).min(1).max(20),
  totalSegunNota: decimal,
});

const formaDeRegistrar = z.strictObject({
  clave: identificador,
  facturaId: identificador,
  nota: formaDeNota,
});

export type EntradaWebDeRegistrarNota = Readonly<{
  clave: string;
  facturaId: string;
  nota: Readonly<{
    tipo: TipoDeNotaWeb;
    puntoDeVenta: number;
    numero: number;
    fecha: string;
    importes: readonly Readonly<{ alicuota: string | null; neto: string }>[];
    totalSegunNota: string;
  }>;
}>;

export function entradaDeRegistrarNota(
  crudo: unknown,
): Resultado<EntradaWebDeRegistrarNota, ErrorDeEntrada> {
  return leer(formaDeRegistrar, crudo);
}

const formaDeAnular = z.strictObject({ notaId: identificador, motivo: texto });

export type EntradaWebDeAnularNota = Readonly<{ notaId: string; motivo: string }>;

/** Anular una nota: el id (que liga la página) y el motivo que escribe la persona; la clase la decide quien llama (crédito o débito), no el navegador. */
export function entradaDeAnularNota(
  crudo: unknown,
): Resultado<EntradaWebDeAnularNota, ErrorDeEntrada> {
  return leer(formaDeAnular, crudo);
}

const formaDeLasNotas = z.strictObject({ facturaId: identificador });

/** Las notas de una factura: solo el id (un UUID). */
export function entradaDeNotasDeLaFactura(
  crudo: unknown,
): Resultado<Readonly<{ facturaId: string }>, ErrorDeEntrada> {
  return leer(formaDeLasNotas, crudo);
}
