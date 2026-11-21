import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  destinosParaMover,
  puedeCrearBajo,
  type ArbolDeClasificacion,
} from "../primitivas/clasificacion/arbol";
import { err } from "../primitivas/resultado/resultado";
import { hoyEnArgentina } from "../primitivas/tiempo/fecha-civil-hasta-hoy";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import {
  leerElPedidoDeCambiarActivoDeNodo,
  leerElPedidoDeClasificarProducto,
  leerElPedidoDeCrearNodo,
  leerElPedidoDeMoverNodo,
  leerElPedidoDeRenombrarNodo,
} from "./entradas-de-clasificacion";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import type { Web } from "./web";

/**
 * La clasificación comercial de la web (A14; maqueta aprobada `clasificacion.html`, decisiones del dueño del 12/11, 13/11 y 15/11/2026): el árbol departamento → categoría (hasta 4 niveles:
 * ver, crear, renombrar, mover, desactivar y reactivar un nodo) y la clasificación de un producto en su ficha (ver la vigente y cambiarla). Vive acá, y no en `apps/web`, para probarse con
 * la base real sin levantar Next (igual que los precios de un producto).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/clasificacion-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `productos.ver` y escribir `productos.editar` (alcance de toda la empresa) al guard dentro de su transacción: acá no se
 *    decide ningún permiso. Con `catalogo` en desarrollo o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**; el pedido no las trae, ni la fecha desde la que rige un cambio (es «desde ahora», decisión del 13/11/2026).
 *  - **Nada se pisa ni se borra.** Renombrar y mover llevan la versión que la persona vio; con otra (alguien cambió antes) el caso de uso rechaza sin escribir. Clasificar un producto agrega un
 *    vínculo nuevo y el anterior queda en el historial. Dos pedidos a la vez los serializa el candado del árbol del caso de uso.
 *  - **Repetir no duplica.** El `id` del nodo nuevo y el del vínculo los fija la pantalla al abrir la hoja: el doble toque y el reintento mandan el mismo y el caso de uso devuelve lo ya hecho.
 *    Desactivar, reactivar, renombrar al mismo nombre y mover al mismo padre devuelven lo vigente sin escribir ni auditar.
 *  - **La pantalla no replica las reglas del árbol.** Lo que apaga (crear bajo un nodo que no admite hijos, destinos de un movimiento) lo calcula la MISMA primitiva (`arbol.ts`) que usan los
 *    casos de uso, una sola vez acá; el servidor igual vuelve a decidir al escribir.
 *  - **Un árbol dañado no se interpreta.** Un nodo sin nivel calculable (padre que falta, ciclo, más niveles que el tope) es un defecto: sale como inesperado, con referencia (nunca se inventa un nivel).
 *  - **Nada de más sale.** Lista blanca campo por campo: no salen quién cargó un vínculo, la auditoría ni los ids de vínculos anteriores.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeClasificacionWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCatalogo"]>,
    | "crearNodoDeClasificacion"
    | "renombrarNodoDeClasificacion"
    | "moverNodoDeClasificacion"
    | "desactivarNodoDeClasificacion"
    | "reactivarNodoDeClasificacion"
    | "clasificarProducto"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeCatalogo"]>,
    "listarClasificacion" | "verClasificacionDelProducto"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

/** Un nodo del árbol para la pantalla, con lo que la primitiva del árbol dice que se puede hacer con él. */
export type NodoParaLaPantalla = Readonly<{
  id: string;
  padreId: string | null;
  nombre: string;
  activo: boolean;
  /** La versión que ve la persona: la llevan renombrar y mover. */
  version: number;
  /** 1 = departamento; 2 a 4 = categoría. */
  nivel: number;
  /** Si se puede crear un nodo adentro (no si está desactivado o ya es del último nivel). */
  admiteHijos: boolean;
  /** Los ids que pueden ser su nuevo padre (vacío si no se mueve, como un departamento). */
  destinos: readonly string[];
}>;

export type ArbolParaLaPantalla = Readonly<{ nodos: readonly NodoParaLaPantalla[] }>;

/** Un nodo de la clasificación de un producto: el camino vigente y lo que se ofrece al cambiarla (solo los activos). */
export type NodoParaElSelector = Readonly<{
  id: string;
  padreId: string | null;
  nombre: string;
}>;

export type ClasificacionDelProductoParaLaPantalla = Readonly<{
  productoId: string;
  /** Lo que rige hoy; `null` = nunca se clasificó («Sin elegir»). Un camino vacío es «Sin elegir» a propósito (se volvió a «Sin elegir»). */
  vigente: Readonly<{
    /** El día civil de Argentina (`AAAA-MM-DD`) desde el que rige. */
    desde: string;
    /** Del departamento hasta el nodo; `activo: false` si el nodo se desactivó después de asignarlo (el producto lo conserva). */
    camino: readonly Readonly<{ id: string; nombre: string; activo: boolean }>[];
  }> | null;
  /** Los nodos activos de la empresa, por nombre: los selectores encadenados de la hoja «Cambiar». */
  nodos: readonly NodoParaElSelector[];
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, d: DependenciasDeClasificacionWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), d.respuesta),
});

/** El día civil de Argentina de un instante. Un instante sin día civil representable es un defecto: sale como inesperado. */
function diaCivil(instante: Date): string {
  const dia = hoyEnArgentina(instante);
  if (!dia.ok) throw new Error("INSTANTE_SIN_DIA_CIVIL");
  return dia.valor;
}

/** El árbol completo de la empresa, activos y desactivados. Es una LECTURA: no escribe ni audita. */
export async function verElArbolDeClasificacion(
  d: DependenciasDeClasificacionWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<ArbolParaLaPantalla>> {
  try {
    const lista = await d.consultas().listarClasificacion(contexto);
    if (!lista.ok) return conError(lista.error, d);
    // Un nodo sin nivel (árbol dañado) es un defecto, no un dato: se dice como inesperado y no se dibuja un árbol a medias.
    if (lista.valor.some((n) => n.nivel < 1))
      throw new Error("ARBOL_DE_CLASIFICACION_INCONSISTENTE");
    const arbol: ArbolDeClasificacion = new Map(
      lista.valor.map((n) => [n.id, { id: n.id, padreId: n.padreId, activo: n.activo }]),
    );
    return {
      ok: true,
      dato: {
        nodos: lista.valor.map((n) => ({
          id: n.id,
          padreId: n.padreId,
          nombre: n.nombre,
          activo: n.activo,
          version: n.version,
          nivel: n.nivel,
          admiteHijos: puedeCrearBajo(arbol, n.id).ok,
          destinos: [...destinosParaMover(arbol, n.id)].sort(),
        })),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** La clasificación vigente de un producto de la empresa y los nodos que se pueden elegir. Es una LECTURA: no escribe ni audita. */
export async function verLaClasificacionDeUnProducto(
  d: DependenciasDeClasificacionWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<ClasificacionDelProductoParaLaPantalla>> {
  // Lo que no tiene la forma de un id no puede ser el de ningún producto: no se consulta.
  if (!identificador.safeParse(productoId).success) return { ok: false, error: GENERICO };
  try {
    const ficha = await d.consultas().verClasificacionDelProducto(contexto, { productoId });
    if (!ficha.ok) return conError(ficha.error, d);
    // Un producto de otra empresa es indistinguible de uno que no existe: el genérico.
    if (ficha.valor === null) return { ok: false, error: GENERICO };
    const lista = await d.consultas().listarClasificacion(contexto);
    if (!lista.ok) return conError(lista.error, d);
    const activos = new Map(lista.valor.map((n) => [n.id, n.activo]));
    const { vigente } = ficha.valor;
    return {
      ok: true,
      dato: {
        productoId,
        vigente:
          vigente === null
            ? null
            : {
                desde: diaCivil(vigente.desde),
                camino: vigente.camino.map((c) => ({
                  id: c.id,
                  nombre: c.nombre,
                  activo: activos.get(c.id) ?? false,
                })),
              },
        nodos: lista.valor
          .filter((n) => n.activo)
          .map((n) => ({ id: n.id, padreId: n.padreId, nombre: n.nombre })),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Crea un nodo (`padreId: null` = un departamento); devuelve su id. Repetir con el mismo `id` devuelve el ya creado. */
export async function crearUnNodoDeClasificacion(
  d: DependenciasDeClasificacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ nodoId: string }>>> {
  const pedido = leerElPedidoDeCrearNodo(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const creado = await d.casosDeUso().crearNodoDeClasificacion(contexto, pedido.valor);
    return aRespuesta(
      creado.ok ? creado : err(traducirErrorDeCatalogo(creado.error)),
      d.respuesta,
      (salida) => ({ nodoId: salida.nodoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Renombra un nodo con la versión que se vio; devuelve su id. */
export async function renombrarUnNodoDeClasificacion(
  d: DependenciasDeClasificacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ nodoId: string }>>> {
  const pedido = leerElPedidoDeRenombrarNodo(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const hecho = await d.casosDeUso().renombrarNodoDeClasificacion(contexto, pedido.valor);
    return aRespuesta(
      hecho.ok ? hecho : err(traducirErrorDeCatalogo(hecho.error)),
      d.respuesta,
      () => ({ nodoId: pedido.valor.nodoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Mueve un nodo (con todo lo que tiene adentro) bajo otro padre, con la versión que se vio; devuelve su id. */
export async function moverUnNodoDeClasificacion(
  d: DependenciasDeClasificacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ nodoId: string }>>> {
  const pedido = leerElPedidoDeMoverNodo(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const hecho = await d.casosDeUso().moverNodoDeClasificacion(contexto, pedido.valor);
    return aRespuesta(
      hecho.ok ? hecho : err(traducirErrorDeCatalogo(hecho.error)),
      d.respuesta,
      () => ({ nodoId: pedido.valor.nodoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Desactiva un nodo (no con hijos activos: el aviso aprobado). Repetir devuelve lo vigente. */
export async function desactivarUnNodoDeClasificacion(
  d: DependenciasDeClasificacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ nodoId: string }>>> {
  const pedido = leerElPedidoDeCambiarActivoDeNodo(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const hecho = await d.casosDeUso().desactivarNodoDeClasificacion(contexto, pedido.valor);
    return aRespuesta(
      hecho.ok ? hecho : err(traducirErrorDeCatalogo(hecho.error)),
      d.respuesta,
      () => ({ nodoId: pedido.valor.nodoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Reactiva un nodo (no si su padre está desactivado). Repetir devuelve lo vigente. */
export async function reactivarUnNodoDeClasificacion(
  d: DependenciasDeClasificacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ nodoId: string }>>> {
  const pedido = leerElPedidoDeCambiarActivoDeNodo(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const hecho = await d.casosDeUso().reactivarNodoDeClasificacion(contexto, pedido.valor);
    return aRespuesta(
      hecho.ok ? hecho : err(traducirErrorDeCatalogo(hecho.error)),
      d.respuesta,
      () => ({ nodoId: pedido.valor.nodoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Cambia la clasificación de un producto (`nodoId: null` = «Sin elegir»): rige desde ahora. Repetir con el mismo `id` devuelve el vínculo ya guardado. */
export async function clasificarUnProducto(
  d: DependenciasDeClasificacionWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ productoId: string }>>> {
  const pedido = leerElPedidoDeClasificarProducto(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  try {
    const hecho = await d.casosDeUso().clasificarProducto(contexto, pedido.valor);
    return aRespuesta(
      hecho.ok ? hecho : err(traducirErrorDeCatalogo(hecho.error)),
      d.respuesta,
      () => ({ productoId: pedido.valor.productoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
