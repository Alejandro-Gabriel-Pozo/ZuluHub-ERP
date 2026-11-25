import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import {
  vendeLaClase,
  type GrupoDeFicha,
  type GrupoDeVistaPrevia,
} from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { armarElConjunto } from "./conjunto-de-opciones";
import { leerElPedidoDeCopia, leerElPedidoDeGrupo } from "./entradas-de-opciones";
import { identificador } from "./entradas-de-facturacion";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";
import type { Web } from "./web";

/**
 * Las opciones de un producto (A13, tramo Opciones; maqueta aprobada `productos.html`, solapa «Opciones»): ver los grupos con sus opciones y recargos, guardar un grupo (nuevo o
 * existente) y copiar los de otro producto. Vive acá, y no en `apps/web`, para probarse con la base real sin levantar Next (igual que la ficha y los precios).
 *
 * Alcance de este tramo: los grupos INCLUIDA y ADICIONAL. La variante (la medida) es del tramo de medidas, y lo que cada opción consume, del de consumo: acá ni se lee ni se toca.
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/opciones-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `productos.ver`; guardar y copiar, `opciones.editar` con alcance sobre todas las sucursales (la empresa entera): al
 *    guard dentro de su transacción. Acá no se decide ningún permiso. Con `catalogo` en desarrollo o sin el permiso sale el motivo del guard, sin dato alguno.
 *  - **La empresa y la persona las pone el servidor**; el pedido no las trae. Un producto o un grupo de otra empresa es indistinguible de uno que no existe: el genérico.
 *  - **Dos pestañas no se pisan.** El pedido lleva la versión de las opciones que la persona vio; con otra, el caso de uso rechaza sin escribir (y lo guardado ya es lo nuevo: la
 *    pantalla se vuelve a pedir). Dos guardados a la vez se serializan sobre el producto bloqueado: gana uno y el otro ve la versión cambiada.
 *  - **Repetir no duplica.** La clave del cambio la fija la página al armarse: es el id del grupo nuevo y de ella se derivan los de sus opciones, así el doble toque y el reintento
 *    mandan lo mismo y el caso de uso lo reconoce como «ya estaba» (sin escribir, sin auditar, sin versión nueva), aunque la versión sea vieja. La copia lleva su propia clave.
 *  - **Nada se borra.** Quitar una opción la desactiva; el caso de uso versiona cada cambio de nombre o de recargo y audita en la misma transacción.
 *  - **Nada de más sale.** Lista blanca campo por campo: solo grupos activos con opciones activas, sin precios de sucursal, consumo, factor ni quién cargó cada cosa.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeOpcionesWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCatalogo"]>,
    "editarOpciones" | "copiarOpciones"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeCatalogo"]>,
    "verProducto" | "productosParaCopiar" | "vistaPreviaDeCopiaDeOpciones"
  >;
  respuesta: DependenciasDeRespuesta;
  /** Un identificador nuevo (uuid) para la clave del cambio; entra como dato para poder probarlo. */
  nuevoId: () => string;
}>;

export type OpcionParaLaPantalla = Readonly<{ id: string; nombre: string; recargo: string }>;

export type GrupoParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  clase: "INCLUIDA" | "ADICIONAL" | "VARIANTE";
  /** Solo de la variante: si es la medida. */
  esTamano: boolean;
  esObligatorio: boolean;
  admiteVarias: boolean;
  seMuestraEnCarta: boolean;
  opciones: readonly OpcionParaLaPantalla[];
}>;

export type OpcionesParaLaPantalla = Readonly<{
  id: string;
  nombre: string;
  /** La versión del conjunto de opciones que se está viendo: la que el pedido de guardar o copiar devuelve. */
  versionDeOpciones: number;
  /** Los grupos activos de clase incluida o adicional, en el orden de la carta, con sus opciones activas. */
  grupos: readonly GrupoParaLaPantalla[];
  /** La variante activa (la medida), con sus opciones activas; `null` si el producto no tiene. */
  variante: GrupoParaLaPantalla | null;
  /** La clave del próximo cambio: una por pantalla armada. */
  claveDelCambio: string;
}>;

/** Un grupo para editar (`grupo`) o la hoja de uno nuevo (`grupo` nulo), con lo que hace falta para guardar. */
export type GrupoParaEditar = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  grupo: GrupoParaLaPantalla | null;
  claveDelCambio: string;
}>;

export type OpcionesParaCopiar = Readonly<{
  id: string;
  nombre: string;
  versionDeOpciones: number;
  /** Los productos de los que se pueden copiar las opciones (activos, con opciones, distintos del destino). */
  candidatos: readonly Readonly<{ id: string; nombre: string }>[];
  /** El producto de origen que se está mirando: el pedido si es un candidato; si no, el primero; `null` si no hay candidatos. */
  origen: string | null;
  /** Lo que la copia traería de ese origen (la misma regla que la copia: `loQueSeCopia`); vacía si no hay origen. */
  vistaPrevia: readonly GrupoDeVistaPrevia[];
  claveDeLaCopia: string;
}>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const conError = (error: unknown, respuesta: DependenciasDeRespuesta): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), respuesta),
});

const sinNombre = (campo: string, respuesta: DependenciasDeRespuesta): Respuesta<never> => ({
  ok: false,
  error: errorAPublico({ codigo: "CATALOGO_FALTA_EL_NOMBRE", campo }, respuesta),
});

function deLaPantalla(g: GrupoDeFicha): GrupoParaLaPantalla | null {
  if (!g.activo) return null;
  return {
    id: g.id,
    nombre: g.nombre,
    clase: g.clase,
    esTamano: g.esTamano,
    esObligatorio: g.esObligatorio,
    admiteVarias: g.admiteVarias,
    seMuestraEnCarta: g.seMuestraEnCarta,
    opciones: [...g.opciones]
      .filter((o) => o.activa)
      .sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id))
      .map((o) => ({ id: o.id, nombre: o.nombre, recargo: o.recargo })),
  };
}

/** Los grupos de la pantalla en el orden de la carta (`orden`, y el id para desempatar). */
function gruposDeLaPantalla(grupos: readonly GrupoDeFicha[]): readonly GrupoParaLaPantalla[] {
  return [...grupos]
    .sort((a, b) => a.orden - b.orden || a.id.localeCompare(b.id))
    .flatMap((g) => (g.clase === "VARIANTE" ? [] : (deLaPantalla(g) ?? [])));
}

/** Las opciones de un producto de la empresa. Es una LECTURA: no escribe ni audita. */
export async function verLasOpcionesDeUnProducto(
  d: DependenciasDeOpcionesWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<OpcionesParaLaPantalla>> {
  // Lo que no tiene la forma de un id no puede ser el de ningún producto: no se consulta.
  if (!identificador.safeParse(productoId).success) return { ok: false, error: GENERICO };
  try {
    const ficha = await d.consultas().verProducto(contexto, { productoId });
    if (!ficha.ok) return conError(ficha.error, d.respuesta);
    if (ficha.valor === null) return { ok: false, error: GENERICO };
    const { producto, grupos } = ficha.valor;
    const variante = grupos.find((g) => g.clase === "VARIANTE" && g.activo);
    // Una clase que no se vende no tiene solapa de opciones (maqueta): sale como un producto que no está.
    if (!vendeLaClase(producto.claseDeUso)) return { ok: false, error: GENERICO };
    return {
      ok: true,
      dato: {
        id: producto.id,
        nombre: producto.nombre,
        versionDeOpciones: producto.versionDeOpciones,
        grupos: gruposDeLaPantalla(grupos),
        variante: variante === undefined ? null : deLaPantalla(variante),
        claveDelCambio: d.nuevoId(),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Un grupo de un producto para editarlo, o la hoja de uno nuevo (`grupoId` nulo). Un grupo que no existe, está desactivado o es la variante sale como el genérico. */
export async function verUnGrupoDeOpciones(
  d: DependenciasDeOpcionesWeb,
  contexto: ContextoOperativo,
  productoId: string,
  grupoId: string | null,
): Promise<Respuesta<GrupoParaEditar>> {
  if (grupoId !== null && !identificador.safeParse(grupoId).success)
    return { ok: false, error: GENERICO };
  const leidas = await verLasOpcionesDeUnProducto(d, contexto, productoId);
  if (!leidas.ok) return leidas;
  const grupo =
    grupoId === null ? null : (leidas.dato.grupos.find((g) => g.id === grupoId) ?? null);
  if (grupoId !== null && grupo === null) return { ok: false, error: GENERICO };
  const { id, nombre, versionDeOpciones, claveDelCambio } = leidas.dato;
  return { ok: true, dato: { id, nombre, versionDeOpciones, grupo, claveDelCambio } };
}

/** La variante (la medida) del producto para editarla, o la hoja de una nueva si no tiene (`grupo` nulo). */
export async function verLaVariante(
  d: DependenciasDeOpcionesWeb,
  contexto: ContextoOperativo,
  productoId: string,
): Promise<Respuesta<GrupoParaEditar>> {
  const leidas = await verLasOpcionesDeUnProducto(d, contexto, productoId);
  if (!leidas.ok) return leidas;
  const { id, nombre, versionDeOpciones, claveDelCambio, variante } = leidas.dato;
  return { ok: true, dato: { id, nombre, versionDeOpciones, grupo: variante, claveDelCambio } };
}

/**
 * Los productos de los que se pueden copiar las opciones al producto de la pantalla, y la vista previa de lo que traería el origen elegido. `origenPedido` viene de la dirección (`?copiar=`):
 * solo se lo reconoce si es uno de los candidatos que devolvió el servidor; cualquier otro valor cae en el primero (lista de permitidos). Una lectura: no escribe ni audita.
 */
export async function verLasOpcionesParaCopiar(
  d: DependenciasDeOpcionesWeb,
  contexto: ContextoOperativo,
  productoId: string,
  origenPedido: string | null,
): Promise<Respuesta<OpcionesParaCopiar>> {
  const leidas = await verLasOpcionesDeUnProducto(d, contexto, productoId);
  if (!leidas.ok) return leidas;
  try {
    const candidatos = await d.consultas().productosParaCopiar(contexto, {
      productoDestinoId: leidas.dato.id,
    });
    if (!candidatos.ok) return conError(candidatos.error, d.respuesta);
    const lista = candidatos.valor.map((p) => ({ id: p.id, nombre: p.nombre }));
    const origen = (lista.find((p) => p.id === origenPedido) ?? lista[0])?.id ?? null;
    let vistaPrevia: readonly GrupoDeVistaPrevia[] = [];
    if (origen !== null) {
      const previa = await d.consultas().vistaPreviaDeCopiaDeOpciones(contexto, {
        productoOrigenId: origen,
        productoDestinoId: leidas.dato.id,
      });
      if (!previa.ok) return conError(previa.error, d.respuesta);
      vistaPrevia = previa.valor;
    }
    return {
      ok: true,
      dato: {
        id: leidas.dato.id,
        nombre: leidas.dato.nombre,
        versionDeOpciones: leidas.dato.versionDeOpciones,
        candidatos: lista,
        origen,
        vistaPrevia,
        claveDeLaCopia: leidas.dato.claveDelCambio,
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Guarda un grupo (nuevo o existente) con sus opciones; devuelve el id del producto. Ver las reglas arriba. */
export async function guardarUnGrupoDeOpciones(
  d: DependenciasDeOpcionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ productoId: string }>>> {
  const leido = leerElPedidoDeGrupo(crudo);
  if (!leido.ok) return { ok: false, error: GENERICO };
  const pedido = leido.valor;
  // El nombre vacío del grupo tiene su texto aprobado («Falta el nombre»); cualquier otro nombre inválido es del dominio. Las filas de opciones sin nombre ya no llegan: se descartaron al leerlas.
  if (pedido.nombre.trim() === "") return sinNombre("nombre", d.respuesta);
  try {
    const ficha = await d.consultas().verProducto(contexto, { productoId: pedido.productoId });
    if (!ficha.ok) return conError(ficha.error, d.respuesta);
    if (ficha.valor === null) return { ok: false, error: GENERICO };
    const armado = armarElConjunto(ficha.valor.grupos, pedido);
    if (armado === "GRUPO_NO_EDITABLE") return { ok: false, error: GENERICO };
    const editado = await d.casosDeUso().editarOpciones(contexto, {
      productoId: pedido.productoId,
      versionDeOpcionesEsperada: pedido.versionDeOpciones,
      grupos: armado.grupos,
    });
    return aRespuesta(
      editado.ok ? editado : err(traducirErrorDeCatalogo(editado.error)),
      d.respuesta,
      () => ({ productoId: pedido.productoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Copia los grupos de otro producto al de la pantalla; devuelve el id del producto. La clave de la copia hace que repetirla no copie dos veces. */
export async function copiarLasOpcionesDeOtroProducto(
  d: DependenciasDeOpcionesWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ productoId: string }>>> {
  const leido = leerElPedidoDeCopia(crudo);
  if (!leido.ok) return { ok: false, error: GENERICO };
  const pedido = leido.valor;
  try {
    const copiado = await d.casosDeUso().copiarOpciones(contexto, {
      copiaId: pedido.claveDelCambio,
      productoOrigenId: pedido.productoOrigenId,
      productoDestinoId: pedido.productoDestinoId,
      versionDeOpcionesEsperada: pedido.versionDeOpciones,
    });
    return aRespuesta(
      copiado.ok ? copiado : err(traducirErrorDeCatalogo(copiado.error)),
      d.respuesta,
      () => ({ productoId: pedido.productoDestinoId }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}
