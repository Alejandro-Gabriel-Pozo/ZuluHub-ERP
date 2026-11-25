import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  esClaseComprable,
  type CasosDeUsoDeCatalogo,
  type ConsultasDeCatalogo,
} from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import {
  leerElPedidoDeCambiarElEstado,
  leerElPedidoDeCrearPresentacion,
  leerElPedidoDeLasPresentaciones,
  leerElPedidoDeRenombrarPresentacion,
} from "./entradas-de-presentaciones";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";

/**
 * La solapa «Cómo se compra» de un producto (T0; maqueta `presentaciones.html`): la lista de sus presentaciones de compra, agregar una, renombrarla, desactivarla y reactivarla. Vive acá, y no en
 * `apps/web`, para probarse con la base real sin levantar Next (igual que `secciones-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/presentaciones-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `productos.ver` y cambiar `productos.editar` (con alcance sobre todas las sucursales) al guard dentro de su transacción: acá no
 *    se decide ningún permiso. Sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**: el pedido no las trae. Un producto o una presentación de otra empresa es indistinguible de uno que no existe: el genérico. Un producto
 *    que no se compra (la solapa no existe para él) también es el genérico.
 *  - **Repetir no duplica.** Agregar lo mismo otra vez devuelve la presentación ya creada (`yaExistia`), sin escribir ni auditar; renombrar o cambiar el estado a lo que ya está devuelve lo vigente.
 *  - **Dos cambios a la vez no se pisan.** Renombrar y cambiar el estado llevan la versión que la persona vio; con una vieja el caso de uso rechaza sin escribir (el genérico) y la pantalla recarga.
 *  - **Nada de más sale.** Lista blanca campo por campo: de una presentación, su id, nombre, cantidad, peso variable, estado y versión; del producto, su id, nombre, símbolo de la unidad y estado.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): una cantidad inválida sale con su texto aprobado atado al campo «cantidad»; cualquier otro rechazo
 *    (nombre repetido, versión vieja…) es el genérico «Esta acción no está permitida»; un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDePresentacionesWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeCatalogo, "crearPresentacion" | "editarPresentacion">;
  consultas: () => Pick<ConsultasDeCatalogo, "verPresentacionesDelProducto">;
  respuesta: DependenciasDeRespuesta;
}>;

export type PresentacionParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  /** Texto decimal de 4 decimales, en la unidad base del producto (con peso variable, el peso aproximado). */
  cantidad: string;
  dePesoVariable: boolean;
  activa: boolean;
  version: number;
}>;

/** El producto con todas sus presentaciones (activas y apagadas), por nombre. */
export type PresentacionesParaLaPantalla = Readonly<{
  producto: Readonly<{
    id: string;
    nombre: string;
    /** El símbolo de la unidad base («kg», «u»); `null` si el código guardado no figura en la lista. */
    unidadBase: string | null;
    activo: boolean;
  }>;
  presentaciones: readonly PresentacionParaLaPantalla[];
}>;

/** El genérico «Esta acción no está permitida». */
const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, d: DependenciasDePresentacionesWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), d.respuesta),
});

/** Las presentaciones de un producto de la empresa. Un `id` sin forma de id, de otra empresa, inexistente o de algo que no se compra es el genérico (el mismo para todos). LECTURA: no escribe ni audita. */
export async function verLasPresentaciones(
  d: DependenciasDePresentacionesWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<PresentacionesParaLaPantalla>> {
  const pedido = leerElPedidoDeLasPresentaciones({ productoId });
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const lectura = await d.consultas().verPresentacionesDelProducto(contexto, pedido.valor);
    if (!lectura.ok) return conError(lectura.error, d);
    const vista = lectura.valor;
    if (vista === null || !esClaseComprable(vista.claseDeUso)) {
      return { ok: false, error: GENERICO };
    }
    return {
      ok: true,
      dato: {
        producto: {
          id: vista.productoId,
          nombre: vista.nombre,
          unidadBase: vista.unidadBase?.simbolo ?? null,
          activo: vista.activo,
        },
        presentaciones: vista.presentaciones.map((p) => ({
          id: p.id,
          nombre: p.nombre,
          cantidad: p.cantidad,
          dePesoVariable: p.dePesoVariable,
          activa: p.activa,
          version: p.version,
        })),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Agrega una presentación; devuelve su id y si ya existía (la misma otra vez). Ver las reglas arriba. */
export async function crearLaPresentacion(
  d: DependenciasDePresentacionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ presentacionId: string; yaExistia: boolean }>>> {
  const pedido = leerElPedidoDeCrearPresentacion(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const creada = await d.casosDeUso().crearPresentacion(contexto, {
      productoId: pedido.valor.productoId,
      nombre: pedido.valor.nombre,
      cantidad: pedido.valor.cantidad,
      dePesoVariable: pedido.valor.pesoVariable,
    });
    return aRespuesta(
      creada.ok ? creada : err(traducirErrorDeCatalogo(creada.error)),
      d.respuesta,
      (salida) => ({ presentacionId: salida.presentacion.id, yaExistia: salida.yaExistia }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/**
 * Busca la presentación entre las del producto (una sola lectura, con el permiso de ver): el estado y el nombre que se conservan salen de lo vigente que lee el servidor, nunca del navegador.
 * `null` si no es de ese producto de la empresa.
 */
async function laVigente(
  d: DependenciasDePresentacionesWeb,
  contexto: ContextoOperativo,
  productoId: string,
  presentacionId: string,
): Promise<Respuesta<PresentacionParaLaPantalla>> {
  const lectura = await verLasPresentaciones(d, contexto, productoId);
  if (!lectura.ok) return lectura;
  const actual = lectura.dato.presentaciones.find((p) => p.id === presentacionId);
  return actual === undefined ? { ok: false, error: GENERICO } : { ok: true, dato: actual };
}

/** Una presentación de un producto de la empresa (para editarla). Una que no es de ese producto es el genérico. LECTURA. */
export async function verLaPresentacion(
  d: DependenciasDePresentacionesWeb,
  contexto: ContextoOperativo,
  productoId: string,
  presentacionId: string,
): Promise<
  Respuesta<
    Readonly<{
      producto: PresentacionesParaLaPantalla["producto"];
      presentacion: PresentacionParaLaPantalla;
    }>
  >
> {
  const lectura = await verLasPresentaciones(d, contexto, productoId);
  if (!lectura.ok) return lectura;
  const presentacion = lectura.dato.presentaciones.find((p) => p.id === presentacionId);
  if (presentacion === undefined) return { ok: false, error: GENERICO };
  return { ok: true, dato: { producto: lectura.dato.producto, presentacion } };
}

/** Renombra una presentación con la versión que la persona vio; conserva su estado (el vigente). La cantidad no cambia: otra cantidad es otra presentación. */
export async function renombrarLaPresentacion(
  d: DependenciasDePresentacionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ presentacionId: string; version: number }>>> {
  const pedido = leerElPedidoDeRenombrarPresentacion(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const actual = await laVigente(
      d,
      contexto,
      pedido.valor.productoId,
      pedido.valor.presentacionId,
    );
    if (!actual.ok) return actual;
    const editada = await d.casosDeUso().editarPresentacion(contexto, {
      presentacionId: pedido.valor.presentacionId,
      nombre: pedido.valor.nombre,
      activa: actual.dato.activa,
      versionEsperada: pedido.valor.versionEsperada,
    });
    return aRespuesta(
      editada.ok ? editada : err(traducirErrorDeCatalogo(editada.error)),
      d.respuesta,
      (salida) => ({ presentacionId: salida.id, version: salida.version }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Desactiva (`activa: false`) o reactiva (`activa: true`) una presentación con la versión que la persona vio; conserva su nombre (el vigente). Repetirlo es éxito sin escribir. */
export async function cambiarElEstadoDeLaPresentacion(
  d: DependenciasDePresentacionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
  activa: boolean,
): Promise<Respuesta<Readonly<{ presentacionId: string; version: number }>>> {
  const pedido = leerElPedidoDeCambiarElEstado(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const actual = await laVigente(
      d,
      contexto,
      pedido.valor.productoId,
      pedido.valor.presentacionId,
    );
    if (!actual.ok) return actual;
    const editada = await d.casosDeUso().editarPresentacion(contexto, {
      presentacionId: pedido.valor.presentacionId,
      nombre: actual.dato.nombre,
      activa,
      versionEsperada: pedido.valor.versionEsperada,
    });
    return aRespuesta(
      editada.ok ? editada : err(traducirErrorDeCatalogo(editada.error)),
      d.respuesta,
      (salida) => ({ presentacionId: salida.id, version: salida.version }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
