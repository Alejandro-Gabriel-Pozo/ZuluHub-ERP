import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  clasificarUnProducto,
  crearUnNodoDeClasificacion,
  desactivarUnNodoDeClasificacion,
  moverUnNodoDeClasificacion,
  reactivarUnNodoDeClasificacion,
  renombrarUnNodoDeClasificacion,
  verElArbolDeClasificacion,
  verLaClasificacionDeUnProducto,
  type ArbolParaLaPantalla,
  type ClasificacionDelProductoParaLaPantalla,
  type DependenciasDeClasificacionWeb,
} from "../../../src/composicion/clasificacion-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { dependenciasDeSesion } from "./sesion";

/**
 * La clasificación comercial (A14): las lecturas del árbol y de la clasificación de un producto, y las acciones de crear, renombrar, mover, desactivar y reactivar un nodo y de cambiar la clasificación
 * de un producto. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN y DÓNDE actúa (`conLaEmpresa`: sesión, origen propio y empresa elegida, nunca los que diga el navegador) y llaman a
 * `src/composicion/clasificacion-web.ts`, donde se prueba el resto. El permiso (`productos.ver` / `productos.editar`) y la validez de cada dato los decide el servidor, dentro de la transacción: la
 * pantalla no valida nada. Los pedidos llegan sin tipo y se leen en la composición (lista de permitidos); lo que traigan de más se descarta. La clave de cada alta y de cada cambio de un producto
 * la fija la pantalla al abrir la hoja: repetir el pedido no duplica.
 */

const dependencias: DependenciasDeClasificacionWeb = {
  casosDeUso: web.casosDeUsoDeCatalogo,
  consultas: web.consultasDeCatalogo,
  respuesta: dependenciasDeSesion.respuesta,
};

/** El árbol de la empresa, con el contexto que ya resolvió la página. */
export function cargarElArbolDeClasificacion(
  contexto: ContextoOperativo,
): Promise<Respuesta<ArbolParaLaPantalla>> {
  return verElArbolDeClasificacion(dependencias, contexto);
}

/** La clasificación vigente de un producto y los nodos que se pueden elegir, con el contexto que ya resolvió la página. */
export function cargarLaClasificacionDelProducto(
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<ClasificacionDelProductoParaLaPantalla>> {
  return verLaClasificacionDeUnProducto(dependencias, contexto, productoId);
}

export function crearElNodoDeClasificacion(entrada: unknown) {
  return conLaEmpresa((contexto) => crearUnNodoDeClasificacion(dependencias, contexto, entrada));
}

export function renombrarElNodoDeClasificacion(entrada: unknown) {
  return conLaEmpresa((contexto) =>
    renombrarUnNodoDeClasificacion(dependencias, contexto, entrada),
  );
}

export function moverElNodoDeClasificacion(entrada: unknown) {
  return conLaEmpresa((contexto) => moverUnNodoDeClasificacion(dependencias, contexto, entrada));
}

export function desactivarElNodoDeClasificacion(entrada: unknown) {
  return conLaEmpresa((contexto) =>
    desactivarUnNodoDeClasificacion(dependencias, contexto, entrada),
  );
}

export function reactivarElNodoDeClasificacion(entrada: unknown) {
  return conLaEmpresa((contexto) =>
    reactivarUnNodoDeClasificacion(dependencias, contexto, entrada),
  );
}

export function clasificarElProducto(entrada: unknown) {
  return conLaEmpresa((contexto) => clasificarUnProducto(dependencias, contexto, entrada));
}
