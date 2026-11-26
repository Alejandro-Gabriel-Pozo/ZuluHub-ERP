import { z } from "zod";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  decimal,
  entero,
  identificador,
  leer,
  texto,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/** Las formas del pedido de las acciones de lotes de la web (STK-E1): solo la FORMA; el permiso, el alcance, las reglas y la existencia de cada id los resuelve `lotes-escritura-web.ts` y el caso de uso. */

const formaDeArticulo = z.object({ articuloId: identificador }).strict();
const formaDeCorregir = z
  .object({
    loteId: identificador,
    version: entero,
    vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    detalle: texto,
  })
  .strict();
const formaDeReasignar = z
  .object({
    clave: identificador,
    articuloId: identificador,
    depositoId: identificador,
    loteOrigenId: identificador,
    loteDestinoId: identificador,
    cantidad: decimal,
    detalle: texto,
  })
  .strict();

export type EntradaDeArticulo = Readonly<{ articuloId: string }>;
export type EntradaDeCorregirLoteWeb = Readonly<{
  loteId: string;
  version: number;
  vence: string;
  detalle: string;
}>;
export type EntradaDeReasignarLoteWeb = Readonly<{
  clave: string;
  articuloId: string;
  depositoId: string;
  loteOrigenId: string;
  loteDestinoId: string;
  cantidad: string;
  detalle: string;
}>;

export const comoArticulo = (c: unknown): Resultado<EntradaDeArticulo, ErrorDeEntrada> => {
  const f = leer(formaDeArticulo, c);
  return f.ok ? ok({ articuloId: f.valor.articuloId }) : f;
};
export const comoCorregir = (c: unknown): Resultado<EntradaDeCorregirLoteWeb, ErrorDeEntrada> => {
  const f = leer(formaDeCorregir, c);
  return f.ok ? ok(f.valor) : f;
};
export const comoReasignar = (c: unknown): Resultado<EntradaDeReasignarLoteWeb, ErrorDeEntrada> => {
  const f = leer(formaDeReasignar, c);
  return f.ok ? ok(f.valor) : f;
};
