import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeCatalogo, ConsultasDeCatalogo } from "../modulos/catalogo/publico";
import { aRespuestaDeExcepcion, errorAPublico, type DependenciasDeRespuesta } from "./a-respuesta";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import { codificarLaPagina, leerLaPagina } from "./entradas-de-productos";
import {
  leerElPedidoDeTocarProducto,
  leerLaBusquedaDeCandidatos,
  versionVistaDelProducto,
} from "./entradas-de-secciones";
import { GENERICO, buscarLaSeccion, conError, type SeccionParaLaPantalla } from "./secciones-web";

/**
 * Agregar y quitar productos de una sección de la carta (A8, parte 2; maqueta aprobada `productos-secciones.html`): los candidatos de «Agregar producto» y las dos acciones. Vive acá, y no en
 * `secciones-web.ts`, para que cada archivo se mantenga chico; comparte con él el genérico, la lectura de una sección y la traducción de errores. Contra la base real:
 * `test/integracion/secciones-web.test.ts`.
 *
 * Reglas que cumple (cada una con su prueba):
 *  - **Agregar y quitar son `editarProducto` con la versión que la persona vio** (parte 2): la sección del producto es un campo de su ficha, y esa edición es parcial (no toca nada más). Con una
 *    versión vieja el caso de uso rechaza sin escribir (el genérico) y la pantalla recarga; repetir lo ya aplicado (agregar a la misma sección, quitar lo ya quitado) es éxito sin escribir.
 *    Lo que sale de un error es SIEMPRE el genérico o el motivo del guard: los textos propios de la ficha del producto («Elegí la alícuota», nombre repetido…) no tienen campo en esta pantalla.
 *  - **Los candidatos son lo que se vende** (clases VENDIBLE y REVENTA, activos; los insumos no aparecen, maqueta línea 490), sin los que ya están en la sección, con su sección actual al lado. Uno
 *    que falta completar se ve pero no se puede elegir. Una búsqueda inválida o una página que la consulta no pudo dar es una lista vacía (nunca se ensancha el filtro).
 */

export type DependenciasDeProductosDeSeccionWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeCatalogo, "editarProducto">;
  consultas: () => Pick<ConsultasDeCatalogo, "listarSeccionesParaGestionar" | "listarProductos">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Un producto que se puede agregar a la sección: su sección de hoy (`null` si no tiene) y si falta completarlo (no se puede elegir). */
export type CandidatoParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  version: number;
  faltaCompletar: boolean;
  seccion: string | null;
}>;

/** Una sección con una página de los productos que se le pueden agregar. */
export type CandidatosParaLaPantalla = Readonly<{
  seccion: SeccionParaLaPantalla;
  candidatos: readonly CandidatoParaLaPantalla[];
  /** La clave de la página que sigue; `null` en la última. */
  siguiente: string | null;
}>;

/**
 * El error de una acción sobre un PRODUCTO (agregar o quitar): el motivo del guard pasa tal cual; todo lo demás, el genérico. Los errores con texto propio de la ficha del producto
 * (`ALICUOTA_REQUERIDA` por una carrera, `PRODUCTO_DUPLICADO`…) apuntan a un campo que esta pantalla no tiene.
 */
function enUnProducto(error: unknown, d: DependenciasDeProductosDeSeccionWeb): Respuesta<never> {
  const traducido = traducirErrorDeCatalogo(error);
  // Solo pasan los motivos del guard y los defectos (textos); cualquier objeto (error con texto propio o de forma desconocida) es el genérico: cierra ante la duda.
  return {
    ok: false,
    error: typeof traducido === "string" ? errorAPublico(traducido, d.respuesta) : GENERICO,
  };
}

/**
 * Una página de los productos que se le pueden agregar a la sección: activos, de las clases que se venden (VENDIBLE y REVENTA), por nombre, filtrados por el texto buscado, sin los que ya están
 * en la sección. Una página puede quedar con menos de 50 (o vacía) y aun así traer `siguiente`: los de la sección se descartan después de la consulta. Es una LECTURA: no escribe ni audita.
 */
export async function verLosCandidatos(
  d: DependenciasDeProductosDeSeccionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<CandidatosParaLaPantalla>> {
  const pedido = leerLaBusquedaDeCandidatos(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const seccion = await buscarLaSeccion(d, contexto, pedido.valor.seccionId);
    if (!seccion.ok) return seccion;
    const { consulta } = pedido.valor;
    const pagina =
      consulta === null || consulta.despues === "" ? undefined : leerLaPagina(consulta.despues);
    if (consulta === null || pagina === null) {
      return { ok: true, dato: { seccion: seccion.dato, candidatos: [], siguiente: null } };
    }
    const productos = await d.consultas().listarProductos(contexto, {
      claseDeUso: ["VENDIBLE", "REVENTA"],
      activo: true,
      ...(consulta.texto === undefined ? {} : { texto: consulta.texto }),
      ...(pagina === undefined ? {} : { despuesDe: pagina }),
    });
    if (!productos.ok) return conError(productos.error, d);
    return {
      ok: true,
      dato: {
        seccion: seccion.dato,
        candidatos: productos.valor.productos
          .filter((p) => p.seccion?.id !== seccion.dato.id)
          .map((p) => ({
            id: p.id,
            nombre: p.nombre,
            version: p.version,
            faltaCompletar: p.estado === "FALTA_COMPLETAR",
            seccion: p.seccion === null ? null : p.seccion.nombre,
          })),
        siguiente:
          productos.valor.siguiente === null ? null : codificarLaPagina(productos.valor.siguiente),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Pone un producto en una sección (aunque ya estuviera en otra: un producto está en una sola) o lo saca (`seccionId` es `null`), con la versión del producto que la persona vio. La sección y
 * el producto que se tocó salen del pedido; la versión, de lo que la persona vio (`versionVistaDelProducto`). Ver las reglas arriba.
 */
async function cambiarLaSeccionDelProducto(
  d: DependenciasDeProductosDeSeccionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
  poner: boolean,
): Promise<Respuesta<Readonly<{ productoId: string; version: number }>>> {
  const pedido = leerElPedidoDeTocarProducto(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const visto = versionVistaDelProducto(pedido.valor);
  if (visto === null) return { ok: false, error: GENERICO };
  try {
    const editado = await d.casosDeUso().editarProducto(contexto, {
      productoId: visto.productoId,
      versionEsperada: visto.versionEsperada,
      seccionDeCartaId: poner ? pedido.valor.seccionId : null,
    });
    return editado.ok
      ? { ok: true, dato: { productoId: visto.productoId, version: editado.valor.version } }
      : enUnProducto(editado.error, d);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** «Agregar» un producto a la sección (parte 2). */
export const agregarElProducto = (
  d: DependenciasDeProductosDeSeccionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
) => cambiarLaSeccionDelProducto(d, contexto, crudo, true);

/** «Quitar» un producto de la sección (parte 2): queda sin sección; no se desactiva ni se borra. */
export const quitarElProducto = (
  d: DependenciasDeProductosDeSeccionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
) => cambiarLaSeccionDelProducto(d, contexto, crudo, false);
