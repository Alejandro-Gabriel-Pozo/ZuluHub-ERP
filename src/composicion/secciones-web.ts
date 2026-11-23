import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeCatalogo, ConsultasDeCatalogo } from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import { codificarLaPagina, leerLaPagina } from "./entradas-de-productos";
import {
  leerElPedidoDeCrearSeccion,
  leerElPedidoDeRenombrarSeccion,
  entradaDeReordenar,
  leerElPedidoDeMover,
  leerElPedidoDeUnaSeccion,
  ordenDeLaSeccionNueva,
} from "./entradas-de-secciones";

/**
 * La pantalla «Secciones de la carta» (A8, parte 1; maqueta aprobada `productos-secciones.html`): la lista con todas las secciones, la de una sección con sus productos, crear, renombrar,
 * desactivar, reactivar y reordenar. Agregar y quitar productos de una sección (parte 2) viven en `productos-de-seccion-web.ts`. Vive acá, y no en `apps/web`, para probarse con la base real sin levantar Next (igual que `ficha-de-producto-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/secciones-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `productos.ver` y cambiar `productos.editar` (con alcance sobre todas las sucursales) al guard dentro de su transacción:
 *    acá no se decide ningún permiso. Con `catalogo` en desarrollo (hoy) o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**: el pedido no las trae. Una sección de otra empresa es indistinguible de una que no existe: el genérico.
 *  - **Repetir no duplica.** Crear lleva la clave de creación que fijó la página (el `id` de la sección): la misma otra vez devuelve la sección ya creada, sin escribir ni auditar, aunque el
 *    orden que se calcule ahora sea otro (`ordenDeLaSeccionNueva`). Renombrar y reordenar con lo ya aplicado no escriben; desactivar y reactivar devuelven `yaEstaba`.
 *  - **Dos cambios a la vez no se pisan.** Renombrar y reordenar llevan la versión que la persona vio; con una vieja el caso de uso rechaza sin escribir (el genérico) y la pantalla recarga.
 *  - **Nada de más sale.** Lista blanca campo por campo: de una sección, su id, nombre, estado y versión; de un producto, su id y nombre. Ni el orden, ni la cantidad de productos, ni el resto.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia. Un nombre repetido sale con su
 *    texto aprobado «Ya existe una sección con ese nombre», atado al campo «nombre» (`SECCION_DUPLICADA`, traducido en `errores-de-catalogo.ts`).
 */

export type DependenciasDeSeccionesWeb = Readonly<{
  casosDeUso: () => Pick<
    CasosDeUsoDeCatalogo,
    | "crearSeccionDeCarta"
    | "editarSeccionDeCarta"
    | "desactivarSeccionDeCarta"
    | "reactivarSeccionDeCarta"
    | "reordenarSeccionesDeCarta"
  >;
  consultas: () => Pick<ConsultasDeCatalogo, "listarSeccionesParaGestionar" | "listarProductos">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Lo que necesitan las lecturas y la traducción de errores (también las usa `productos-de-seccion-web.ts`). */
export type DependenciasDeLecturaDeSecciones = Pick<
  DependenciasDeSeccionesWeb,
  "consultas" | "respuesta"
>;

export type SeccionParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  activa: boolean;
  version: number;
}>;

/** Todas las secciones de la empresa (activas y desactivadas) en el orden que da el servidor. */
export type SeccionesParaLaPantalla = Readonly<{ secciones: readonly SeccionParaLaPantalla[] }>;

/** Una sección con sus productos activos, en orden alfabético (una página de 50). */
export type UnaSeccionParaLaPantalla = Readonly<{
  seccion: SeccionParaLaPantalla;
  /** De cada producto, su id, su nombre y su versión (la que «Quitar» lleva). */
  productos: readonly Readonly<{ id: string; nombre: string; version: number }>[];
  /** La clave de la página que sigue (`despues` en la dirección); `null` en la última. */
  siguiente: string | null;
}>;

/** El genérico «Esta acción no está permitida» (también lo usa `productos-de-seccion-web.ts`). */
export const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

export const conError = (
  error: unknown,
  d: DependenciasDeLecturaDeSecciones,
): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), d.respuesta),
});

const faltaElNombre = (d: DependenciasDeSeccionesWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico({ codigo: "CATALOGO_FALTA_EL_NOMBRE", campo: "nombre" }, d.respuesta),
});

/** Todas las secciones de la empresa. Es una LECTURA: no escribe ni audita. */
export async function verLasSecciones(
  d: DependenciasDeSeccionesWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<SeccionesParaLaPantalla>> {
  try {
    const lista = await d.consultas().listarSeccionesParaGestionar(contexto);
    if (!lista.ok) return conError(lista.error, d);
    return {
      ok: true,
      dato: {
        secciones: lista.valor.map((s) => ({
          id: s.id,
          nombre: s.nombre,
          activa: s.activa,
          version: s.version,
        })),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Una sección de la empresa por su `id`. Un `id` que no tiene forma de id, o que no es de una sección de la empresa, es el genérico (el mismo para ambos casos). */
export async function buscarLaSeccion(
  d: DependenciasDeLecturaDeSecciones,
  contexto: ContextoOperativo,
  seccionId: string,
): Promise<Respuesta<SeccionParaLaPantalla>> {
  const pedido = leerElPedidoDeUnaSeccion({ seccionId });
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const lista = await d.consultas().listarSeccionesParaGestionar(contexto);
  if (!lista.ok) return conError(lista.error, d);
  const seccion = lista.valor.find((s) => s.id === pedido.valor.seccionId);
  if (seccion === undefined) return { ok: false, error: GENERICO };
  return {
    ok: true,
    dato: {
      id: seccion.id,
      nombre: seccion.nombre,
      activa: seccion.activa,
      version: seccion.version,
    },
  };
}

/** Una sección de la empresa, sin sus productos (para renombrarla). Es una LECTURA: no escribe ni audita. */
export async function verLaSeccion(
  d: DependenciasDeSeccionesWeb,
  contexto: ContextoOperativo,
  seccionId: string,
): Promise<Respuesta<SeccionParaLaPantalla>> {
  try {
    return await buscarLaSeccion(d, contexto, seccionId);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Una sección de la empresa con sus productos activos (S2: los desactivados no están en la carta), una página de 50 por nombre. Una página de la dirección que la consulta no pudo dar muestra
 * una lista vacía (nunca se ensancha el filtro); `""` es la primera. Es una LECTURA: no escribe ni audita.
 */
export async function verUnaSeccion(
  d: DependenciasDeSeccionesWeb,
  contexto: ContextoOperativo,
  entrada: Readonly<{ seccionId: string; despues: string }>,
): Promise<Respuesta<UnaSeccionParaLaPantalla>> {
  const pagina = entrada.despues === "" ? undefined : leerLaPagina(entrada.despues);
  try {
    const seccion = await buscarLaSeccion(d, contexto, entrada.seccionId);
    if (!seccion.ok) return seccion;
    if (pagina === null) {
      return { ok: true, dato: { seccion: seccion.dato, productos: [], siguiente: null } };
    }
    const productos = await d.consultas().listarProductos(contexto, {
      seccionId: seccion.dato.id,
      activo: true,
      ...(pagina === undefined ? {} : { despuesDe: pagina }),
    });
    if (!productos.ok) return conError(productos.error, d);
    return {
      ok: true,
      dato: {
        seccion: seccion.dato,
        productos: productos.valor.productos.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          version: p.version,
        })),
        siguiente:
          productos.valor.siguiente === null ? null : codificarLaPagina(productos.valor.siguiente),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Crea una sección; devuelve su id y si ya existía (la misma clave de creación otra vez). Ver las reglas arriba. */
export async function crearLaSeccion(
  d: DependenciasDeSeccionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ seccionId: string; yaExistia: boolean }>>> {
  const pedido = leerElPedidoDeCrearSeccion(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  // El nombre vacío tiene su texto aprobado («Falta el nombre»); cualquier otro nombre inválido es del dominio.
  if (pedido.valor.nombre.trim() === "") return faltaElNombre(d);
  try {
    const lista = await d.consultas().listarSeccionesParaGestionar(contexto);
    if (!lista.ok) return conError(lista.error, d);
    const creada = await d.casosDeUso().crearSeccionDeCarta(contexto, {
      id: pedido.valor.claveDeCreacion,
      nombre: pedido.valor.nombre,
      orden: ordenDeLaSeccionNueva(lista.valor, pedido.valor.claveDeCreacion),
    });
    return aRespuesta(
      creada.ok ? creada : err(traducirErrorDeCatalogo(creada.error)),
      d.respuesta,
      (salida) => ({ seccionId: salida.seccionId, yaExistia: salida.yaExistia }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Renombra una sección con la versión que la persona vio. El caso de uso pide también el `orden`: se toma del que tiene hoy (leído por el servidor), así renombrar no cambia el orden;
 * si alguien la movió después de que la persona la vio, su versión ya no coincide y el caso de uso rechaza sin escribir.
 */
export async function renombrarLaSeccion(
  d: DependenciasDeSeccionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ seccionId: string; version: number }>>> {
  const pedido = leerElPedidoDeRenombrarSeccion(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  if (pedido.valor.nombre.trim() === "") return faltaElNombre(d);
  try {
    const lista = await d.consultas().listarSeccionesParaGestionar(contexto);
    if (!lista.ok) return conError(lista.error, d);
    const actual = lista.valor.find((s) => s.id === pedido.valor.seccionId);
    if (actual === undefined) return { ok: false, error: GENERICO };
    const editada = await d.casosDeUso().editarSeccionDeCarta(contexto, {
      seccionId: pedido.valor.seccionId,
      versionEsperada: pedido.valor.versionEsperada,
      nombre: pedido.valor.nombre,
      orden: actual.orden,
    });
    return aRespuesta(
      editada.ok ? editada : err(traducirErrorDeCatalogo(editada.error)),
      d.respuesta,
      (salida) => ({ seccionId: actual.id, version: salida.version }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Desactiva (`activa: false`) o reactiva (`activa: true`) una sección; repetirlo es éxito sin escribir. No toca los productos. */
export async function cambiarElEstadoDeLaSeccion(
  d: DependenciasDeSeccionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
  activa: boolean,
): Promise<Respuesta<Readonly<{ seccionId: string }>>> {
  const pedido = leerElPedidoDeUnaSeccion(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const { seccionId } = pedido.valor;
  try {
    const cambio = activa
      ? await d.casosDeUso().reactivarSeccionDeCarta(contexto, { seccionId })
      : await d.casosDeUso().desactivarSeccionDeCarta(contexto, { seccionId });
    return aRespuesta(
      cambio.ok ? cambio : err(traducirErrorDeCatalogo(cambio.error)),
      d.respuesta,
      () => ({ seccionId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Un toque de flecha: reordena TODAS las secciones activas (todo o nada). El pedido trae las activas como la persona las vio, con su versión, la que tocó y hacia dónde; el orden nuevo sale de
 * eso (`entradaDeReordenar`) y el caso de uso lo compara con lo vigente: lo ya aplicado no escribe y una versión vieja rechaza.
 */
export async function moverUnaSeccion(
  d: DependenciasDeSeccionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ movidas: number }>>> {
  const pedido = leerElPedidoDeMover(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const entrada = entradaDeReordenar(pedido.valor);
  if (entrada === null) return { ok: false, error: GENERICO };
  try {
    const movidas = await d.casosDeUso().reordenarSeccionesDeCarta(contexto, entrada);
    return aRespuesta(
      movidas.ok ? movidas : err(traducirErrorDeCatalogo(movidas.error)),
      d.respuesta,
      (salida) => ({ movidas: salida.movidas }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
