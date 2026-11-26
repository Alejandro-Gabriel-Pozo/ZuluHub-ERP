import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  comoArticulo,
  comoCorregir,
  comoReasignar,
  type EntradaDeArticulo,
} from "./entradas-de-lotes";
import { accionDeStock } from "./errores-de-stock";
import type { Web } from "./web";

/**
 * Las acciones de escritura de la pestaña «Lotes» (STK-E1; FP-STK-13 y FP-STK-16): controlar por lote, dejar de controlar, corregir la fecha de vencimiento y reasignar entre lotes. Reglas de esta capa:
 *  - **El artículo se elige entre los controlados y su producto sale del servidor**, nunca del navegador; uno que no está en la lista, un lote ajeno o un depósito que no es de la sucursal elegida salen como el genérico,
 *    indistinguibles de lo que no existe. La sucursal la pone el servidor.
 *  - **Controlar** fija el modo `LOTE_Y_VENCIMIENTO` sin calidad (FP-STK-13): la persona no elige el modo. La perilla `lotes` del plan, el permiso (`lotes.controlar`) y el alcance los decide el caso de uso en su
 *    transacción; repetirlo devuelve lo ya hecho (`yaExistia`) sin escribir ni auditar, y dos a la vez sobre el mismo artículo se serializan.
 *  - **Corregir** manda la VERSIÓN del lote que se vio: si otra persona lo corrigió antes (`LOTE_DESACTUALIZADO`) no se pisa y la pantalla recarga. Las mismas fechas que ya tiene es una repetición (sin cambios, sin auditar).
 *    El detalle (por qué se corrige) es obligatorio y queda en la auditoría con el antes y el después.
 *  - **Reasignar** mueve existencia entre dos lotes EXISTENTES del mismo artículo y depósito; no toca el libro ni el saldo del artículo, ni mueve valor (el costo es del artículo, no del lote). La clave la genera la página:
 *    el mismo clic repetido es una sola reasignación y la misma clave con otro contenido se rechaza. La cantidad es texto decimal exacto, mayor que cero y, salvo en «Sin asignar», no pasa del saldo del lote.
 */

export type DependenciasDeLotesEscrituraWeb = Readonly<{
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeStock"]>,
    "controlarLote" | "dejarDeControlarLote" | "corregirLote" | "reasignarLote"
  >;
  consultas: () => Pick<
    ReturnType<Web["consultasDeStock"]>,
    "articulosControlados" | "listarDepositos"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

async function productoDe(
  d: DependenciasDeLotesEscrituraWeb,
  contexto: ContextoOperativo,
  articuloId: string,
) {
  const articulos = await d.consultas().articulosControlados(contexto);
  if (!articulos.ok) return articulos;
  const articulo = articulos.valor.find((a) => a.articuloId === articuloId);
  return articulo === undefined ? err("ARTICULO_NO_CONTROLADO" as const) : ok(articulo.productoId);
}

/** Controla por lote el artículo elegido, con vencimiento obligatorio y sin calidad. */
export function controlarElLoteDelArticulo(
  d: DependenciasDeLotesEscrituraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeStock<
    EntradaDeArticulo,
    Readonly<{ yaExistia: boolean }>,
    Readonly<{ yaExistia: boolean }>
  >(
    d.respuesta,
    crudo,
    comoArticulo,
    async (e) => {
      const producto = await productoDe(d, contexto, e.articuloId);
      if (!producto.ok) return producto;
      const hecho = await d.casosDeUso().controlarLote(contexto, {
        productoId: producto.valor,
        modo: "LOTE_Y_VENCIMIENTO",
        conCalidad: false,
      });
      return hecho.ok ? ok({ yaExistia: hecho.valor.yaExistia }) : hecho;
    },
    (s) => s,
  );
}

/** Deja de controlar por lote el artículo elegido. */
export function dejarDeControlarElLoteDelArticulo(
  d: DependenciasDeLotesEscrituraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaEstaba: boolean }>>> {
  return accionDeStock<
    EntradaDeArticulo,
    Readonly<{ yaEstaba: boolean }>,
    Readonly<{ yaEstaba: boolean }>
  >(
    d.respuesta,
    crudo,
    comoArticulo,
    async (e) => {
      const producto = await productoDe(d, contexto, e.articuloId);
      if (!producto.ok) return producto;
      const hecho = await d.casosDeUso().dejarDeControlarLote(contexto, {
        productoId: producto.valor,
      });
      return hecho.ok ? ok({ yaEstaba: hecho.valor.yaEstaba }) : hecho;
    },
    (s) => s,
  );
}

/** Corrige la fecha de vencimiento de un lote con la versión que se vio y el motivo. */
export function corregirElLote(
  d: DependenciasDeLotesEscrituraWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ version: number }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    comoCorregir,
    (e) =>
      d.casosDeUso().corregirLote(contexto, {
        loteId: e.loteId,
        versionEsperada: e.version,
        fechaDeVencimiento: e.vence,
        detalle: e.detalle,
      }),
    (s) => ({ version: s.version }),
  );
}

/** Reasigna existencia de un lote a otro del mismo artículo y depósito (de la sucursal elegida). */
export function reasignarEntreLotes(
  d: DependenciasDeLotesEscrituraWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<Readonly<{ yaExistia: boolean }>>> {
  return accionDeStock(
    d.respuesta,
    crudo,
    comoReasignar,
    async (e) => {
      const depositos = await d.consultas().listarDepositos(contexto, { sucursalId });
      if (!depositos.ok) return depositos;
      if (!depositos.valor.some((x) => x.id === e.depositoId && x.activo)) {
        return err("DEPOSITO_NO_ENCONTRADO" as const);
      }
      const producto = await productoDe(d, contexto, e.articuloId);
      if (!producto.ok) return producto;
      return d.casosDeUso().reasignarLote(contexto, {
        clave: e.clave,
        depositoId: e.depositoId,
        productoId: producto.valor,
        loteOrigenId: e.loteOrigenId,
        loteDestinoId: e.loteDestinoId,
        cantidad: e.cantidad,
        motivo: e.detalle,
      });
    },
    (s) => ({ yaExistia: s.yaExistia }),
  );
}

/** Los depósitos activos de la sucursal elegida, para elegir dónde se reasigna (con sus nombres: la lectura de lotes solo trae sus ids). */
export function depositosParaReasignar(
  d: DependenciasDeLotesEscrituraWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
): Promise<Respuesta<readonly Readonly<{ id: string; nombre: string }>[]>> {
  return accionDeStock(
    d.respuesta,
    {},
    () => ok({}),
    async () => d.consultas().listarDepositos(contexto, { sucursalId }),
    (lista) => lista.filter((x) => x.activo).map((x) => ({ id: x.id, nombre: x.nombre })),
  );
}
