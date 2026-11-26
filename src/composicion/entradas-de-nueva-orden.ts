import { z } from "zod";
import { ok, type Resultado } from "../primitivas/resultado/resultado";
import { decimal, identificador, leer, type ErrorDeEntrada } from "./entradas-de-facturacion";

/**
 * La frontera de «Abrir orden» (nueva orden de producción): de lo que manda el navegador a lo que recibe la composición. Pura: sin servidor. La empresa, la persona, la sucursal, el depósito y la unidad NO
 * se leen del pedido (los pone el servidor); el producto viaja como id y se valida contra lo que el servidor ofrece. Solo la FORMA de la cantidad (texto decimal) se mira acá; que sea mayor que cero
 * y entre en cuatro decimales lo decide el caso de uso. `clave` es el UUID que fija la página al armar el formulario (la idempotencia del alta); `confirmar` es «Producir igual» (solo `"1"`).
 * Previene: un id con forma inválida que llega al `::uuid` de la base y una cantidad que se cuela como número. Chequeo: `entradas-de-nueva-orden.test.ts`.
 */
const formaDeNuevaOrden = z.object({
  clave: identificador,
  productoId: identificador,
  cantidad: decimal,
  confirmar: z.enum(["", "1"]).optional(),
});

export type EntradaWebDeNuevaOrden = Readonly<{
  clave: string;
  productoId: string;
  cantidad: string;
  /** La persona vio el aviso «va a quedar en negativo» y eligió «Producir igual» (solo sirve con el nivel AVISAR). */
  confirmar: boolean;
}>;

export function entradaDeNuevaOrden(
  crudo: unknown,
): Resultado<EntradaWebDeNuevaOrden, ErrorDeEntrada> {
  const forma = leer(formaDeNuevaOrden, crudo);
  return forma.ok ? ok({ ...forma.valor, confirmar: forma.valor.confirmar === "1" }) : forma;
}
