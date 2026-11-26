import { z } from "zod";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { decimal, identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de «Cerrar con lo real» (cierre de una orden de producción): de lo que manda el navegador a lo que recibe la composición. Pura: sin servidor. La empresa, la persona, la sucursal, la unidad y
 * los productos de cada consumo NO se leen del pedido: los pone el servidor desde la orden. El consumo de cada ingrediente viaja por POSICIÓN (el orden de los renglones sellados al abrir): un campo en blanco es
 * «no se usó» (cero). Solo la FORMA se mira acá (texto decimal, fecha `AAAA-MM-DD`, hasta 500 renglones); que la cantidad obtenida sea mayor que cero, que el consumo quepa en cuatro decimales y si hace falta
 * vencimiento lo decide el caso de uso. `clave` es el UUID que fija la página al armar el formulario (la idempotencia del cierre); `confirmar` es «Producir igual» (solo `"1"`).
 * Previene: un id con forma inválida que llega a la base, un consumo de un producto que no es de la orden y un cierre repetido por el doble toque. Chequeo: `entradas-de-cierre-de-orden.test.ts`.
 */
const FECHA = /^\d{4}-\d{2}-\d{2}$/;
const MAXIMO_DE_RENGLONES = 500;

const formaDeCierre = z.object({
  ordenId: identificador,
  clave: identificador,
  obtenido: decimal,
  vence: z.union([z.literal(""), z.string().regex(FECHA)]).optional(),
  consumos: z.array(z.union([z.literal(""), decimal])).max(MAXIMO_DE_RENGLONES),
  confirmar: z.enum(["", "1"]).optional(),
});

export type EntradaWebDeCierreDeOrden = Readonly<{
  ordenId: string;
  clave: string;
  obtenido: string;
  /** `AAAA-MM-DD`, o `null` si no se cargó (lo exige un artículo con control de vencimiento: lo decide el caso de uso). */
  vence: string | null;
  /** Lo real de cada ingrediente, por posición; en blanco es cero. */
  consumos: readonly string[];
  /** La persona vio el aviso «va a quedar en negativo» y eligió «Producir igual» (solo sirve con el nivel AVISAR). */
  confirmar: boolean;
}>;

export function entradaDeCierreDeOrden(
  crudo: unknown,
): Resultado<EntradaWebDeCierreDeOrden, ErrorDeEntrada> {
  const forma = leer(formaDeCierre, crudo);
  if (!forma.ok) return forma;
  const f = forma.valor;
  return ok({
    ordenId: f.ordenId,
    clave: f.clave,
    obtenido: f.obtenido,
    vence: f.vence === undefined || f.vence === "" ? null : f.vence,
    consumos: f.consumos.map((c) => (c === "" ? "0" : c)),
    confirmar: f.confirmar === "1",
  });
}
