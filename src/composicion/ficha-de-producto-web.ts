import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { ALICUOTAS_DEL_PRODUCTO } from "../modulos/fiscal/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import {
  CLASES_QUE_SE_VENDEN,
  entradaDeEditarProducto,
  leerElPedidoDeLaFicha,
} from "./entradas-de-ficha-de-producto";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import type { Web } from "./web";

/**
 * La ficha de datos de un producto (A1, T2a; maqueta aprobada `productos.html`, solapa «Datos»): ver y guardar nombre, nombre de cocina, código, código de barras, alícuota de
 * IVA y sección de la carta. La clase y la unidad se ven pero no se cambian (`editarProducto` no las acepta). Vive acá, y no en `apps/web`, para probarse con la base real sin
 * levantar Next (igual que `medios-de-pago-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/ficha-de-producto-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `productos.ver` y guardar `productos.editar` (con alcance sobre todas las sucursales) al guard dentro de su
 *    transacción: acá no se decide ningún permiso. Con `catalogo` en desarrollo (hoy) o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**: el pedido no las trae. Un producto de otra empresa es indistinguible de uno que no existe: el genérico.
 *  - **Dos guardados a la vez no se pisan.** El pedido lleva la versión que la pantalla vio; con una vieja el caso de uso rechaza sin escribir (el genérico).
 *  - **Repetir no duplica.** Guardar lo que ya está guardado devuelve lo vigente sin escribir ni auditar (regla `SIN_CAMBIOS` del caso de uso), aunque la versión sea vieja: por eso el
 *    pedido no lleva clave de idempotencia y el doble toque es una sola escritura.
 *  - **Lo que esta pantalla no edita no se pierde.** La descripción y todo campo que el pedido no trae se toman de lo guardado, leído por el servidor (`entradas-de-ficha-de-producto.ts`).
 *  - **Nada de más sale.** Lista blanca campo por campo: no salen la versión de las opciones, el estado, el precio ni la descripción.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeFichaDeProductoWeb = Readonly<{
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeCatalogo"]>, "editarProducto">;
  consultas: () => Pick<
    ReturnType<Web["consultasDeCatalogo"]>,
    "verProducto" | "listarSeccionesDeCarta"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

/** La ficha para la pantalla. `alicuotas` y `secciones` son lo que se ofrece; `unidadBaseId` es el código de la unidad (no se cambia). */
export type FichaParaLaPantalla = Readonly<{
  id: string;
  version: number;
  nombre: string;
  claseDeUso: string;
  unidadBaseId: string;
  /** Si la clase lleva nombre de cocina, alícuota y sección. */
  seVende: boolean;
  nombreDeCocina: string | null;
  codigo: string | null;
  codigoDeBarras: string | null;
  alicuota: string | null;
  seccionDeCartaId: string | null;
  /** Las alícuotas que ofrece el producto, en el orden en que se muestran (una sola fuente: el módulo fiscal). */
  alicuotas: readonly string[];
  secciones: readonly Readonly<{ id: string; nombre: string }>[];
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

/** Los datos de un producto de la empresa, con las secciones de la carta que se pueden elegir. Es una LECTURA: no escribe ni audita. */
export async function verLaFichaDeProducto(
  d: DependenciasDeFichaDeProductoWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<FichaParaLaPantalla>> {
  // Lo que no tiene la forma de un id no puede ser el de ningún producto: no se consulta.
  if (!identificador.safeParse(productoId).success) return { ok: false, error: GENERICO };
  try {
    const ficha = await d.consultas().verProducto(contexto, { productoId });
    if (!ficha.ok) return conError(ficha.error, d);
    if (ficha.valor === null) return { ok: false, error: GENERICO };
    const secciones = await d.consultas().listarSeccionesDeCarta(contexto);
    if (!secciones.ok) return conError(secciones.error, d);
    const p = ficha.valor.producto;
    return {
      ok: true,
      dato: {
        id: p.id,
        version: p.version,
        nombre: p.nombre,
        claseDeUso: p.claseDeUso,
        unidadBaseId: p.unidadBaseId,
        seVende: CLASES_QUE_SE_VENDEN.includes(p.claseDeUso),
        nombreDeCocina: p.nombreDeCocina,
        codigo: p.codigo,
        codigoDeBarras: p.codigoDeBarras,
        alicuota: p.alicuota,
        seccionDeCartaId: p.seccionDeCartaId,
        alicuotas: ALICUOTAS_DEL_PRODUCTO,
        secciones: secciones.valor.map((s) => ({ id: s.id, nombre: s.nombre })),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Guarda los datos de un producto; devuelve su id y la versión vigente. Ver las reglas arriba. */
export async function guardarLaFichaDeProducto(
  d: DependenciasDeFichaDeProductoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ productoId: string; version: number }>>> {
  const pedido = leerElPedidoDeLaFicha(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  // El nombre vacío tiene su texto aprobado («Falta el nombre»); cualquier otro nombre inválido es del dominio.
  if (pedido.valor.nombre.trim() === "") {
    return {
      ok: false,
      error: errorAPublico({ codigo: "CATALOGO_FALTA_EL_NOMBRE", campo: "nombre" }, d.respuesta),
    };
  }
  try {
    const leida = await d
      .consultas()
      .verProducto(contexto, { productoId: pedido.valor.productoId });
    if (!leida.ok) return conError(leida.error, d);
    if (leida.valor === null) return { ok: false, error: GENERICO };
    const producto = leida.valor.producto;
    const editado = await d
      .casosDeUso()
      .editarProducto(contexto, entradaDeEditarProducto(pedido.valor, producto));
    return aRespuesta(
      editado.ok ? editado : err(traducirErrorDeCatalogo(editado.error)),
      d.respuesta,
      (salida) => ({ productoId: producto.id, version: salida.version }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

const conError = (error: unknown, d: DependenciasDeFichaDeProductoWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), d.respuesta),
});
