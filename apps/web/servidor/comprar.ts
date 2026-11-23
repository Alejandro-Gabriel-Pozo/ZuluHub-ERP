import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  buscarLosProductosParaComprar,
  type DependenciasDeComprarWeb,
  type ProductosParaComprarEnLaPantalla,
} from "../../../src/composicion/comprar-web";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * «Nueva compra»: la lectura de los productos que se pueden comprar. Fina a propósito (ADR-015, punto 2): resuelve QUIÉN actúa (la empresa y la persona salen de la sesión, nunca del
 * pedido) y llama a `src/composicion/comprar-web.ts`. El permiso, qué se compra, el tope y el orden los decide el servidor dentro de su transacción; la pantalla no replica ninguna regla.
 */

const dependencias: DependenciasDeComprarWeb = {
  consultas: web.consultasDeCompras,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Los productos para comprar que coinciden con lo escrito (`texto`; vacío = todos hasta el tope). Se vuelve a validar en la composición. */
export function buscarProductosParaComprar(
  texto?: string,
): Promise<Respuesta<ProductosParaComprarEnLaPantalla>> {
  return conLaEmpresa((contexto) =>
    buscarLosProductosParaComprar(dependencias, contexto, texto === undefined ? {} : { texto }),
  );
}
