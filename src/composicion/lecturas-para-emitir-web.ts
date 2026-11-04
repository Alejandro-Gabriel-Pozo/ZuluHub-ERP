import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { Ambiente, PuntoDeVentaId } from "../modulos/fiscal/publico";
import type { SucursalId } from "../primitivas/identificadores/marca";
import { ok } from "../primitivas/resultado/resultado";
import { accionDeWeb } from "./accion-de-web";
import type { DependenciasDeFacturacionWeb } from "./facturacion-web";

/**
 * Las dos lecturas que la pantalla de Emitir una factura (8B) necesita antes de emitir, para quien puede emitir
 * (`comprobantes.emitir_manual`, D-86): si la empresa discrimina IVA y los puntos de venta activos de la sucursal. Viven aparte de
 * `facturacion-web.ts` (que ya está en el tope de tamaño) y siguen sus mismas reglas: el `contexto` lo resuelve el servidor, la
 * consulta exige SU acción al guard dentro de su transacción (acá no se decide ningún permiso), y todo sale por `aRespuestaFiscal`
 * con una lista blanca campo por campo: lo que se agregue después a la consulta no sale a la pantalla sin decidirlo acá.
 */

/** Si el comprobante lleva alícuota por renglón (`true`) o no (`false`, letra C). Ningún otro dato fiscal. */
export type DiscriminaIvaParaLaPantalla = Readonly<{ discriminaIva: boolean }>;

export function discriminaIvaAlEmitir(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
): Promise<Respuesta<DiscriminaIvaParaLaPantalla>> {
  return accionDeWeb(
    d.respuesta,
    null,
    () => ok(null),
    () => d.consultas().discriminaIvaAlEmitir(contexto),
    (r) => ({ discriminaIva: r.discriminaIva }),
  );
}

/**
 * Un punto de venta para elegir al emitir: el identificador que pide la emisión, el número (el formato de 5 dígitos lo pone la
 * pantalla) y el ambiente (`HOMOLOGACION` es el de pruebas, D-87).
 */
export type PuntoDeVentaParaEmitirEnLaPantalla = Readonly<{
  id: PuntoDeVentaId;
  numero: number;
  ambiente: Ambiente;
}>;

export type PuntosDeVentaParaEmitirEnLaPantalla = Readonly<{
  items: readonly PuntoDeVentaParaEmitirEnLaPantalla[];
}>;

/**
 * Los puntos de venta ACTIVOS de UNA sucursal de la empresa, para elegir con cuál emitir (`comprobantes.emitir_manual`, D-6 y D-86),
 * de menor a mayor número. La sucursal se resuelve con la MISMA regla que el listado y por el servidor: `sucursalElegida` NO sale del
 * pedido del navegador (la toma el servidor de su sesión, o es `null` si la persona todavía no eligió) y la consulta la verifica
 * contra el alcance de la persona, dentro de su transacción, antes de leer nada: una ajena, de otra empresa o mal formada es
 * `FISCAL_SUCURSAL_FUERA_DE_ALCANCE` y no devuelve ningún punto de venta. Sin elegir y con varias a elegir,
 * `FISCAL_SUCURSAL_NO_ELEGIDA`. Una sucursal cerrada no emite (D-50): lista vacía.
 */
export function listarPuntosDeVentaParaEmitir(
  d: DependenciasDeFacturacionWeb,
  contexto: ContextoOperativo,
  sucursalElegida: SucursalId | null,
): Promise<Respuesta<PuntosDeVentaParaEmitirEnLaPantalla>> {
  return accionDeWeb(
    d.respuesta,
    null,
    () => ok({ sucursalElegida }),
    (entrada) => d.consultas().listarPuntosDeVentaParaEmitir(contexto, entrada),
    (puntos) => ({
      items: puntos.items.map((punto) => ({
        id: punto.id,
        numero: punto.numero,
        ambiente: punto.ambiente,
      })),
    }),
  );
}
