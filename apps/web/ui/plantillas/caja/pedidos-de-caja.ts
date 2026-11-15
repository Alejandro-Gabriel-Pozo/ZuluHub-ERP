import type { EstadoDelConteo, FilaDeMedio } from "./modelo-de-conteo-de-caja";

/**
 * Los pedidos de las acciones de la pantalla «Caja» del mostrador: de lo que se escribió en pantalla a lo que declara la frontera del servidor (`entradas-de-sesion-de-caja.ts`). Puros: sin React.
 * Solo viaja lo que la frontera lee: la empresa, la persona y la sucursal no van (las pone el servidor). El dinero viaja como TEXTO decimal sin signo; el sentido de un ajuste es una elección
 * cerrada, no un signo. Cada acción que escribe lleva la clave de idempotencia del intento (`useEnvioConClave`): repetirla no duplica. La pantalla no valida el negocio: el servidor decide.
 */

export type SentidoDeMovimiento = "INGRESO" | "EGRESO";
export type SentidoDeAjuste = "SOBRA" | "FALTA";

export const armarElPedidoDeApertura = (
  claveDeIdempotencia: string,
  cajaId: string,
  fondoInicial: string,
) => ({ claveDeIdempotencia, cajaId, fondoInicial });

export const armarElPedidoDeMovimiento = (
  claveDeIdempotencia: string,
  sesionId: string,
  sentido: SentidoDeMovimiento,
  importe: string,
  motivo: string,
) => ({ claveDeIdempotencia, sesionId, sentido, importe, motivo });

export const armarElPedidoDeAjuste = (
  claveDeIdempotencia: string,
  sesionId: string,
  medio: Readonly<{ medioDePagoId: string; cuentaDeCobroId: string | null }>,
  sentido: SentidoDeAjuste,
  importe: string,
  motivo: string,
) => ({
  claveDeIdempotencia,
  sesionId,
  medioDePagoId: medio.medioDePagoId,
  cuentaDeCobroId: medio.cuentaDeCobroId,
  sentido,
  importe,
  motivo,
});

export const armarElPedidoDeAnulacion = (
  claveDeIdempotencia: string,
  movimientoId: string,
  motivo: string,
) => ({ claveDeIdempotencia, movimientoId, motivo });

export const armarElPedidoDeSesion = (sesionId: string) => ({ sesionId });

/**
 * El pedido de «Cerrar caja». El efectivo va por billetes (solo las denominaciones con cantidad escrita) y monedas; sin nada escrito en el efectivo va `conteo: null` y el servidor
 * responde (el efectivo se cuenta siempre). De los demás medios van los que tienen total declarado (y no «conforme»); `conformeGeneral` dice que cada línea sin total declarado quedó
 * «conforme» (por su botón o por «Conforme general»): si alguna no quedó ni declarada ni conforme va `false` y el servidor lo rechaza.
 */
export function armarElPedidoDeCierre(
  sesionId: string,
  denominaciones: readonly number[],
  filas: readonly FilaDeMedio[],
  estado: EstadoDelConteo,
  observacion: string,
) {
  const billetes = denominaciones
    .filter((d) => (estado.billetes[String(d)] ?? "") !== "")
    .map((d) => ({ denominacion: d, cantidad: Number(estado.billetes[String(d)]) }));
  const declaradas = filas.filter(
    (f) => estado.conformes[f.clave] !== true && (estado.contados[f.clave] ?? "") !== "",
  );
  const sinDeclarar = filas.filter((f) => !declaradas.includes(f));
  return {
    sesionId,
    conteo:
      billetes.length === 0 && estado.monedas === "" ? null : { billetes, monedas: estado.monedas },
    otros: declaradas.map((f) => ({
      medioDePagoId: f.medioDePagoId,
      cuentaDeCobroId: f.cuentaDeCobroId,
      contado: estado.contados[f.clave] ?? "",
    })),
    conformeGeneral:
      sinDeclarar.length > 0 && sinDeclarar.every((f) => estado.conformes[f.clave] === true),
    observacion,
  };
}
