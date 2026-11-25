import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { entradaDeAnularCompra, entradaDeCorregirCompra } from "./entradas-de-correccion-de-compra";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * «Corregir» el precio de una línea y «Anular» una compra (Compras PR 10; maqueta `compra-corregir-anular.html`). Son ESCRITURAS: el permiso (`compras.corregir`, `recepciones.anular`), el alcance de sucursal,
 * la transacción, la auditoría y la repetición los resuelve el caso de uso (el servidor, no la pantalla); esta capa solo lee el pedido con lista de permitidos y traduce el resultado.
 *  - **Corregir** lleva la clave de la pantalla abierta (la misma clave y el mismo contenido repiten la misma corrección sin escribir ni auditar) y las correcciones que la persona vio de esa línea
 *    (dos pestañas que corrigen la misma línea: una gana, la otra recibe el genérico `CORRECCION_DESACTUALIZADA` y la ficha recarga). «Sin cambios» y toda otra regla del dominio salen como el genérico.
 *  - **Anular** repetida es `RECEPCION_YA_ANULADA` (el genérico, sin escribir): el estado de la recepción bajo bloqueo decide, así que dos anulaciones a la vez dejan una sola anulación y un solo espejo de stock.
 *    Una compra con pago vigente (`COMPROBANTE_YA_PAGADO`) o ya consumida (`COMPRA_CONSUMIDA`) también salen como el genérico; de la consumida se avisa aparte (`consumida`) para ofrecer «Corregir».
 * La empresa y quién actúa salen de la sesión, nunca del pedido. Nada de dinero ni de cantidades sale como `number`.
 */

export type DependenciasDeCorreccionDeCompraWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCompras"]>, "corregirCompra" | "anularCompra">;
  respuesta: DependenciasDeRespuesta;
}>;

export type CorreccionHechaParaLaPantalla = Readonly<{
  recepcionId: string;
  linea: number;
  /** El número de la corrección dentro de la línea (1, 2, …). */
  numero: number;
  /** `true` si la clave ya había hecho esta misma corrección (una repetición): no se volvió a escribir. */
  yaExistia: boolean;
}>;

export function corregirLaCompra(
  d: DependenciasDeCorreccionDeCompraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<CorreccionHechaParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeCorregirCompra,
    (entrada) => d.casosDeUso().corregirCompra(contexto, entrada),
    (hecha) => ({
      recepcionId: hecha.recepcionId,
      linea: hecha.linea,
      numero: hecha.numero,
      yaExistia: hecha.yaExistia,
    }),
  );
}

export type AnulacionParaLaPantalla = Readonly<{
  respuesta: Respuesta<Readonly<{ anulada: true }>>;
  /** `true` solo si la compra no se anuló porque lo que entró ya se consumió: la pantalla ofrece «Corregir» junto al genérico. */
  consumida: boolean;
}>;

export async function anularLaCompra(
  d: DependenciasDeCorreccionDeCompraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<AnulacionParaLaPantalla> {
  let consumida = false;
  const respuesta = await accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeAnularCompra,
    async (entrada) => {
      const resultado = await d.casosDeUso().anularCompra(contexto, entrada);
      if (!resultado.ok && resultado.error === "COMPRA_CONSUMIDA") consumida = true;
      return resultado;
    },
    () => ({ anulada: true as const }),
  );
  return { respuesta, consumida };
}
