import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { ALICUOTAS_DEL_PRODUCTO } from "../modulos/fiscal/publico";
import { CLASES_DE_USO, vendeLaClase } from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import { UNIDADES } from "../primitivas/unidades/unidades";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { entradaDeCrearProducto, leerElPedidoDeAlta } from "./entradas-de-alta-de-producto";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import type { Web } from "./web";

/**
 * El alta de un producto (A1, T6; maqueta aprobada `productos.html`, «Nuevo producto»): lo que la pantalla ofrece y crear el producto. Vive acá, y no en `apps/web`, para probarse
 * con la base real sin levantar Next (igual que `ficha-de-producto-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/alta-de-producto-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Crear exige `productos.crear` (con alcance sobre todas las sucursales) al guard dentro de su transacción y las secciones
 *    que se ofrecen, `productos.ver`: acá no se decide ningún permiso. Con `catalogo` en desarrollo (hoy) o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**: el pedido no las trae. Una sección de otra empresa no se ve: «no permitido».
 *  - **Repetir no duplica.** El pedido lleva la clave de creación que fijó la página (el `id` del producto): el mismo pedido otra vez devuelve el producto ya creado, sin escribir ni
 *    auditar; la misma clave con otro contenido, o dos altas a la vez con el mismo nombre, dan una sola alta y el resto el rechazo.
 *  - **Un nombre, código o código de barras repetido no crea nada** (también contra los desactivados): sale con el texto aprobado del campo que lo causó.
 *  - **Es el alta completa**: pide la alícuota si el producto se vende y no queda en «Falta completar». La rápida (solo nombre, clase y unidad) es de la compra y la receta, y no está acá.
 *  - **Nada de más sale.** Lo ofrecido sale por lista blanca campo por campo.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeAltaDeProductoWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCatalogo"]>, "crearProducto">;
  consultas: () => Pick<ReturnType<Web["consultasDeCatalogo"]>, "listarSeccionesDeCarta">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Lo que el formulario del alta ofrece. Una sola fuente por lista: las clases, las unidades y las alícuotas, de sus módulos; las secciones, de la consulta. */
export type OpcionesDelAlta = Readonly<{
  /** Cada clase, con si lleva nombre de cocina, alícuota y sección. */
  clases: readonly Readonly<{ valor: string; seVende: boolean }>[];
  /** Los códigos de las unidades (los nombres que se ven son del vocabulario). */
  unidades: readonly string[];
  alicuotas: readonly string[];
  secciones: readonly Readonly<{ id: string; nombre: string }>[];
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

/** Lo que se ofrece al crear un producto de la empresa. Es una LECTURA: no escribe ni audita. */
export async function verLasOpcionesDelAlta(
  d: DependenciasDeAltaDeProductoWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<OpcionesDelAlta>> {
  try {
    const secciones = await d.consultas().listarSeccionesDeCarta(contexto);
    if (!secciones.ok) return conError(secciones.error, d);
    return {
      ok: true,
      dato: {
        clases: CLASES_DE_USO.map((valor) => ({
          valor,
          seVende: vendeLaClase(valor),
        })),
        unidades: Object.keys(UNIDADES),
        alicuotas: ALICUOTAS_DEL_PRODUCTO,
        secciones: secciones.valor.map((s) => ({ id: s.id, nombre: s.nombre })),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Crea un producto; devuelve su id y si ya existía (la misma clave de creación otra vez). Ver las reglas arriba. */
export async function crearElProducto(
  d: DependenciasDeAltaDeProductoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ productoId: string; yaExistia: boolean }>>> {
  const pedido = leerElPedidoDeAlta(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  // El nombre vacío tiene su texto aprobado («Falta el nombre»); cualquier otro nombre inválido es del dominio.
  if (pedido.valor.nombre.trim() === "") {
    return {
      ok: false,
      error: errorAPublico({ codigo: "CATALOGO_FALTA_EL_NOMBRE", campo: "nombre" }, d.respuesta),
    };
  }
  try {
    const creado = await d
      .casosDeUso()
      .crearProducto(contexto, entradaDeCrearProducto(pedido.valor));
    return aRespuesta(
      creado.ok ? creado : err(traducirErrorDeCatalogo(creado.error)),
      d.respuesta,
      (salida) => ({ productoId: salida.productoId, yaExistia: salida.yaExistia }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

const conError = (error: unknown, d: DependenciasDeAltaDeProductoWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), d.respuesta),
});
