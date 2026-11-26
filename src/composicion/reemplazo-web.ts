import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  entradaDeCambiarElComprobante,
  entradaDeDeshacerAntesDeCambiar,
  entradaDeDeshacerAntesDeReemplazar,
  entradaDeReemplazarFactura,
} from "./entradas-de-reemplazo";
import { accionDeCompras } from "./errores-de-compras";
import type { Web } from "./web";

/**
 * Las pantallas de «Reemplazar el comprobante» (NOTAS-2c-2): reemplazar una factura que llega sola (N3/N4) y cambiar el comprobante de una compra (N1/N2), con su lectura «Qué hay que deshacer antes». Cada una es una LECTURA
 * o un caso de uso del módulo, que ya trae su permiso, su alcance de sucursal, su idempotencia y su transacción (`reemplazarFactura`, `cambiarElComprobanteDeLaCompra`). Acá solo se arma el pedido:
 *  - **La empresa y la persona salen del contexto; el proveedor de la factura nueva es el de la original** (lo lee el servidor: el navegador no lo manda).
 *  - **El control de versión lo fija la lectura, no el formulario libre:** la página lee la factura vigente de la compra y la liga al envío; si otra persona la cambió antes, el servidor no escribe nada.
 *  - Todo sale campo por campo (lista de permitidos). Los errores de negocio salen como el genérico (`errores-de-compras.ts`): los frenos (pago, conciliaciones, notas) los muestra la lectura ANTES de enviar.
 * Previene: dos cambios simultáneos de la misma compra encadenados, un reemplazo repetido por doble toque o reintento, una factura nueva de otro proveedor o de otra empresa. Chequeo: `test/integracion/compras-reemplazo-web.test.ts`.
 */

export type DependenciasDeReemplazoWeb = Readonly<{
  consultas: () => Pick<
    ReturnType<Web["consultasDeCompras"]>,
    "queHayQueDeshacerAntes" | "queHayQueDeshacerAntesDeCambiarElComprobante"
  >;
  casosDeUso: () => Pick<
    ReturnType<Web["casosDeUsoDeCompras"]>,
    "reemplazarFactura" | "cambiarElComprobanteDeLaCompra"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

export type QueHayQueDeshacerParaLaPantalla = Readonly<{
  /** La factura vigente que mira la persona: con ella se envía el cambio (control de versión). */
  comprobanteId: string;
  anulada: boolean;
  /** En el orden en que se deshacen; vacío: se puede seguir ya. */
  frenos: readonly Readonly<{
    freno: "PAGO_VIGENTE" | "CONCILIACIONES_VIVAS" | "NOTAS_VIGENTES";
    pagoId?: string;
  }>[];
}>;

/** Una lectura que no encontró nada (la factura o la compra no existe, es de otra empresa o está fuera del alcance) es el mismo error que un rechazo: no se distingue. */
const hallada = <T, E>(
  lectura: Resultado<T | null, E>,
): Resultado<T, E | "COMPROBANTE_NO_ENCONTRADO"> =>
  !lectura.ok
    ? lectura
    : lectura.valor === null
      ? err("COMPROBANTE_NO_ENCONTRADO")
      : ok(lectura.valor);

const aLaPantalla = (l: QueHayQueDeshacerParaLaPantalla): QueHayQueDeshacerParaLaPantalla => ({
  comprobanteId: l.comprobanteId,
  anulada: l.anulada,
  frenos: l.frenos.map((f) => ({
    freno: f.freno,
    ...(f.pagoId === undefined ? {} : { pagoId: f.pagoId }),
  })),
});

/** Lo que hay que deshacer antes de reemplazar una factura (N3/N4); una que no existe, es de otra empresa o está fuera del alcance sale igual (el genérico). */
export function loQueHayQueDeshacerAntesDeReemplazar(
  d: DependenciasDeReemplazoWeb,
  contexto: ContextoOperativo,
  comprobanteId: string,
): Promise<Respuesta<QueHayQueDeshacerParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    { comprobanteId },
    entradaDeDeshacerAntesDeReemplazar,
    async (entrada) => hallada(await d.consultas().queHayQueDeshacerAntes(contexto, entrada)),
    aLaPantalla,
  );
}

/** Lo que hay que deshacer antes de cambiar el comprobante de una compra (N1/N2), con la factura vigente que se está mirando. */
export function loQueHayQueDeshacerAntesDeCambiar(
  d: DependenciasDeReemplazoWeb,
  contexto: ContextoOperativo,
  recepcionId: string,
): Promise<Respuesta<QueHayQueDeshacerParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    { recepcionId },
    entradaDeDeshacerAntesDeCambiar,
    async (entrada) =>
      hallada(await d.consultas().queHayQueDeshacerAntesDeCambiarElComprobante(contexto, entrada)),
    aLaPantalla,
  );
}

export type ComprobanteReemplazadoParaLaPantalla = Readonly<{
  comprobanteId: string;
  /** `true`: era el mismo reemplazo de un envío anterior (doble toque, reintento): no se escribió ni se auditó nada de nuevo. */
  yaExistia: boolean;
}>;

/**
 * «Reemplazar» una factura de la empresa (N3/N4): anula la original con el motivo y registra la nueva, del mismo proveedor, en una sola operación. El permiso, el alcance, los frenos (pago, conciliaciones, notas bajo
 * bloqueo), que la original no esté ya reemplazada y la idempotencia los decide el caso de uso adentro.
 */
export function reemplazarLaFactura(
  d: DependenciasDeReemplazoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ComprobanteReemplazadoParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeReemplazarFactura,
    (entrada) => d.casosDeUso().reemplazarFactura(contexto, entrada),
    (salida) => ({ comprobanteId: salida.comprobanteId, yaExistia: salida.yaExistia }),
  );
}

/** «Cambiar el comprobante de la compra» (N1/N2): la factura que llegó con la compra se anula con el motivo y se registra la nueva contra los mismos renglones recibidos; lo recibido y su costo no se tocan. */
export function cambiarElComprobanteDeLaCompra(
  d: DependenciasDeReemplazoWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<ComprobanteReemplazadoParaLaPantalla>> {
  return accionDeCompras(
    d.respuesta,
    crudo,
    entradaDeCambiarElComprobante,
    (entrada) => d.casosDeUso().cambiarElComprobanteDeLaCompra(contexto, entrada),
    (salida) => ({ comprobanteId: salida.comprobanteId, yaExistia: salida.yaExistia }),
  );
}
