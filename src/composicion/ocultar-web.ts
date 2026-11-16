import {
  errorDeCodigo,
  type ErrorPublico,
  type Respuesta,
} from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeCatalogo, ConsultasDeCatalogo } from "../modulos/catalogo/publico";
import { err } from "../primitivas/resultado/resultado";
import {
  aRespuesta,
  aRespuestaDeExcepcion,
  errorAPublico,
  type DependenciasDeRespuesta,
} from "./a-respuesta";
import { identificador } from "./entradas-de-facturacion";
import { leerElPedidoDeMostrar, leerElPedidoDeOcultar } from "./entradas-de-ocultar";
import { traducirErrorDeCatalogo } from "./errores-de-catalogo";

/**
 * Ocultar un producto de la web (A15; maqueta aprobada `productos.html`, tarjeta de visibilidad de la ficha): ver si el producto está oculto en el local y en toda la empresa, y ocultarlo o
 * volver a mostrarlo en cada alcance. Vive acá, y no en `apps/web`, para probarse con la base real sin levantar Next (igual que `ficha-de-producto-web.ts`).
 *
 * Reglas que cumple (cada una con su prueba en `test/integracion/ocultar-web.test.ts`):
 *  - **El permiso es del caso de uso y de la consulta.** Ver exige `vidrieras.ver`; ocultar o mostrar en un local, `vidrieras.marcar_disponibilidad` (los tres roles; el operador, solo en SUS
 *    locales); en toda la empresa, además `vidrieras.ocultar_en_empresa` (gerente y administrador; dueño, 22A) y alcance sobre todas las sucursales. Acá no se decide ningún permiso.
 *  - **El local lo pone el servidor.** El pedido no trae sucursal: `ocultarEnUnLocal` recibe la sucursal con la que la sesión trabaja. Sin sucursal, el alcance LOCAL cierra (nunca se asume «todas»).
 *  - **Repetir no duplica ni deshace.** El pedido fija un ESTADO (`oculto: true|false`), no alterna: el doble toque es una sola escritura y una sola entrada de auditoría (`yaEstaba`, caso de uso).
 *    Por eso el pedido no lleva clave de idempotencia ni versión: el caso de uso toma el producto con `FOR UPDATE`, así que dos pedidos a la vez se ponen en fila y el último estado pedido gana.
 *  - **Con existencia o conteo abierto, no oculta.** Lo decide el caso de uso (revierte la fila y la auditoría): sale con su texto propio aprobado el 12/11/2026.
 *  - **Nada de más sale.** Lista blanca: solo `local` y `empresa` (si está oculto), ni quién ni cuándo ni los demás productos.
 *  - **Todo resultado sale por el camino común** (`aRespuesta`, ADR-016, con `traducirErrorDeCatalogo`): un fallo inesperado sale sin detalle y con referencia.
 */

export type DependenciasDeOcultarWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeCatalogo, "ocultarProducto">;
  consultas: () => Pick<ConsultasDeCatalogo, "productosOcultos">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Si el producto está oculto en el local con el que se trabaja (`null` si no hay local) y en toda la empresa. */
export type VisibilidadParaLaPantalla = Readonly<{ local: boolean | null; empresa: boolean }>;

const GENERICO = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

/**
 * Dónde está oculto un producto. Con `sucursalId` mira ese local y la empresa; sin local mira solo lo de la empresa, y eso solo se le deja a quien tiene alcance sobre todas las
 * sucursales (la consulta lo decide). Es una LECTURA: no escribe ni audita. `productoId` es el de un producto que la página ya leyó de la empresa.
 */
export async function verLaVisibilidadDelProducto(
  d: DependenciasDeOcultarWeb,
  contexto: ContextoOperativo,
  productoId: string,
  sucursalId: string | null,
): Promise<Respuesta<VisibilidadParaLaPantalla>> {
  if (!identificador.safeParse(productoId).success) return { ok: false, error: GENERICO };
  try {
    const ocultos = await d
      .consultas()
      .productosOcultos(contexto, sucursalId === null ? {} : { sucursalId });
    if (!ocultos.ok) return conError(ocultos.error, d);
    const delProducto = ocultos.valor.filter((o) => o.productoId === productoId);
    return {
      ok: true,
      dato: {
        local: sucursalId === null ? null : delProducto.some((o) => o.sucursalId === sucursalId),
        empresa: delProducto.some((o) => o.sucursalId === null),
      },
    };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Lo que devuelve ocultar o mostrar: si no cambió nada (ya estaba) y si la empresa sigue ocultándolo al mostrarlo en un local. */
export type ResultadoDeOcultar = Readonly<{
  productoId: string;
  yaEstaba: boolean;
  sigueOcultoPorLaEmpresa: boolean;
}>;

/**
 * Oculta o vuelve a mostrar un producto en el local `sucursalId` (alcance LOCAL) o en toda la empresa (alcance EMPRESA). Ver las reglas arriba. `sucursalId` lo pone el servidor desde la
 * sesión; con alcance EMPRESA no se usa.
 */
export async function ocultarOMostrarUnProducto(
  d: DependenciasDeOcultarWeb,
  contexto: ContextoOperativo,
  sucursalId: string | null,
  crudo: unknown,
): Promise<Respuesta<ResultadoDeOcultar>> {
  const pedido = leerElPedidoDeOcultar(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const { productoId, alcance, oculto } = pedido.valor;
  // El alcance LOCAL sin local (nada elegido) cierra: nunca se lo toma por «toda la empresa».
  const destino =
    alcance === "EMPRESA"
      ? ({ tipo: "EMPRESA" } as const)
      : sucursalId === null
        ? null
        : ({ tipo: "SUCURSAL", sucursalId } as const);
  if (destino === null) return { ok: false, error: GENERICO };
  try {
    const hecho = await d
      .casosDeUso()
      .ocultarProducto(contexto, { productoId, alcance: destino, oculto });
    return aRespuesta(
      hecho.ok ? hecho : err(traducirErrorDeCatalogo(hecho.error)),
      d.respuesta,
      (salida) => ({
        productoId,
        yaEstaba: salida.yaEstaba,
        sigueOcultoPorLaEmpresa: salida.sigueOcultoPor === "EMPRESA",
      }),
    );
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Un producto oculto para la lista de ocultos: dónde lo está (en el local con el que se trabaja y/o en toda la empresa). Lista blanca: nada de quién ni cuándo. */
export type ProductoOcultoParaLaPantalla = Readonly<{
  productoId: string;
  nombre: string;
  local: boolean;
  empresa: boolean;
}>;

/**
 * La lista de productos ocultos (C2) en el local `sucursalId` y en toda la empresa. Sin local (nada elegido) lista solo lo oculto en toda la empresa, nunca lo de «todos los locales»: no se
 * asume «todas» (y la consulta sin local solo la responde a quien tiene alcance total). Es una LECTURA. Orden: por nombre y, a igual nombre, por id.
 */
export async function verLosProductosOcultos(
  d: DependenciasDeOcultarWeb,
  contexto: ContextoOperativo,
  sucursalId: string | null,
): Promise<Respuesta<readonly ProductoOcultoParaLaPantalla[]>> {
  try {
    const ocultos = await d
      .consultas()
      .productosOcultos(contexto, sucursalId === null ? {} : { sucursalId });
    if (!ocultos.ok) return conError(ocultos.error, d);
    const porProducto = new Map<string, { nombre: string; local: boolean; empresa: boolean }>();
    for (const o of ocultos.valor) {
      const esEmpresa = o.sucursalId === null;
      if (!esEmpresa && o.sucursalId !== sucursalId) continue;
      const previo = porProducto.get(o.productoId) ?? {
        nombre: o.nombre,
        local: false,
        empresa: false,
      };
      porProducto.set(o.productoId, {
        nombre: o.nombre,
        local: previo.local || !esEmpresa,
        empresa: previo.empresa || esEmpresa,
      });
    }
    const lista = [...porProducto].map(([productoId, v]) => ({ productoId, ...v }));
    lista.sort((a, b) =>
      a.nombre === b.nombre
        ? a.productoId.localeCompare(b.productoId)
        : a.nombre.localeCompare(b.nombre, "es"),
    );
    return { ok: true, dato: lista };
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

/** Lo que devuelve volver a mostrar varios: cuántos productos se volvieron a mostrar (los que ya estaban visibles no cuentan). */
export type ResultadoDeMostrar = Readonly<{ productoIds: readonly string[]; mostrados: number }>;

/**
 * «Volver a mostrar» uno o varios productos (C2): en cada producto, los alcances donde HOY está oculto, que lee el servidor (el pedido trae solo los ids). Reusa `ocultarProducto`, así que cada
 * escritura es su propia transacción con su permiso, su `FOR UPDATE` y su auditoría. SUPUESTO (DEC-0545): una transacción por producto y alcance, no una sola para todo; los productos son
 * independientes (uno que falla no deshace a los otros) y un producto oculto en el local Y en la empresa son dos escrituras, no una (el caso de uso fija un alcance por llamada). Todas fijan un
 * ESTADO: si algo falla a medias, repetir el pedido termina lo que falta sin duplicar nada. Revertirlo cuesta un caso de uso nuevo (`mostrarProducto`) que haga ambos alcances en una transacción.
 * Se procesa en orden, uno por vez: nunca dos transacciones del mismo pedido a la vez (sin riesgo de bloqueo cruzado). Si alguno falla, devuelve el primer error al final y los demás igual
 * quedaron hechos.
 */
export async function volverAMostrarProductos(
  d: DependenciasDeOcultarWeb,
  contexto: ContextoOperativo,
  sucursalId: string | null,
  crudo: unknown,
): Promise<Respuesta<ResultadoDeMostrar>> {
  const pedido = leerElPedidoDeMostrar(crudo);
  if (!pedido.ok) return { ok: false, error: GENERICO };
  const ocultos = await verLosProductosOcultos(d, contexto, sucursalId);
  if (!ocultos.ok) return ocultos;
  const hoy = new Map(ocultos.dato.map((o) => [o.productoId, o]));
  let primerError: ErrorPublico | null = null;
  let mostrados = 0;
  for (const productoId of pedido.valor.productoIds) {
    const oculto = hoy.get(productoId);
    if (oculto === undefined) continue;
    const alcances = [
      ...(oculto.local && sucursalId !== null ? [{ tipo: "SUCURSAL", sucursalId } as const] : []),
      ...(oculto.empresa ? [{ tipo: "EMPRESA" } as const] : []),
    ];
    let completo = true;
    for (const destino of alcances) {
      try {
        const hecho = await d
          .casosDeUso()
          .ocultarProducto(contexto, { productoId, alcance: destino, oculto: false });
        const r = aRespuesta(
          hecho.ok ? hecho : err(traducirErrorDeCatalogo(hecho.error)),
          d.respuesta,
          () => null,
        );
        if (!r.ok) {
          primerError ??= r.error;
          completo = false;
        }
      } catch (excepcion) {
        const falla = aRespuestaDeExcepcion(excepcion, d.respuesta);
        if (!falla.ok) primerError ??= falla.error;
        completo = false;
      }
    }
    if (completo && alcances.length > 0) mostrados += 1;
  }
  return primerError === null
    ? { ok: true, dato: { productoIds: pedido.valor.productoIds, mostrados } }
    : { ok: false, error: primerError };
}

const conError = (error: unknown, d: DependenciasDeOcultarWeb): Respuesta<never> => ({
  ok: false,
  error: errorAPublico(traducirErrorDeCatalogo(error), d.respuesta),
});
