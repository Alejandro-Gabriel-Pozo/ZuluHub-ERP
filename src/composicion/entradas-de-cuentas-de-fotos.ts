import { z } from "zod";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import { entero, identificador, leer, texto } from "./entradas-de-facturacion";

/**
 * La entrada de la pantalla «Conectá tu cuenta de fotos»: de lo que mandan los formularios a lo que aceptan los casos de uso de las cuentas de imagen declaradas (0102). Pura: sin base ni servidor.
 *
 * Lista de permitidos: de cada pedido solo se leen las claves que declara su esquema (`z.object` descarta el resto): NO se puede mandar la empresa, la persona, el proveedor ni el estado. El proveedor
 * lo fija el servidor (solo hay uno, `CLOUDINARY`); la empresa y la persona las pone la sesión. Esta capa dice si el dato tiene la FORMA pedida; qué es una cuenta o un motivo válido lo decide el
 * dominio (la forma de la cuenta vive una vez, en `direccion-externa.ts`; el largo del motivo, en su primitiva).
 *
 * Dos pedidos:
 *  - **Declarar.** Lleva la clave de idempotencia del gesto (la fija la página al abrirse: la misma clave dos veces es una sola cuenta) y la cuenta como la escribió la persona.
 *  - **Retirar.** Lleva la cuenta (su id), la versión que la persona vio y el motivo. Previene: retirar una cuenta que otra persona ya cambió, y retirar sin motivo.
 * Lo que no tiene esa forma es `PEDIDO_INVALIDO`. Chequeo: `entradas-de-cuentas-de-fotos.test.ts`.
 */

const FORMA_DE_DECLARAR = z.object({
  claveDeIdempotencia: identificador,
  cuenta: texto,
});
const FORMA_DE_RETIRAR = z.object({
  id: identificador,
  versionEsperada: entero,
  motivo: texto,
});

export type PedidoDeDeclararLaCuentaDeFotos = z.output<typeof FORMA_DE_DECLARAR>;
export type PedidoDeRetirarLaCuentaDeFotos = z.output<typeof FORMA_DE_RETIRAR>;

type Pedido<T> = Resultado<T, "PEDIDO_INVALIDO">;

function leido<T>(esquema: z.ZodType<T>, crudo: unknown): Pedido<T> {
  const forma = leer(esquema, crudo);
  return forma.ok ? forma : err("PEDIDO_INVALIDO");
}

export const leerElPedidoDeDeclararLaCuentaDeFotos = (
  crudo: unknown,
): Pedido<PedidoDeDeclararLaCuentaDeFotos> => leido(FORMA_DE_DECLARAR, crudo);
export const leerElPedidoDeRetirarLaCuentaDeFotos = (
  crudo: unknown,
): Pedido<PedidoDeRetirarLaCuentaDeFotos> => leido(FORMA_DE_RETIRAR, crudo);
