import type { MotivoDeRechazo } from "../../src/capacidades/permisos/guard";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import type {
  CasosDeUsoDeNumeracion,
  EmisionElectronica,
  EntradaDeReservarNumero,
  ErrorAlReservarNumero,
  ResultadoDeAutorizacionArca,
  SolicitudDeAutorizacion,
} from "../../src/modulos/fiscal/publico";
import { err, ok, type Resultado } from "../../src/primitivas/resultado/resultado";
import { solicitudDeAutorizacion } from "./emision-falsa";

/**
 * Reservar, pedir la autorización y cerrar con una PERSONA: lo que hacía el caso de uso
 * `numerarComprobante` de T6, que se retiró (H7 facturación §B.2.3, punto 5). Con la facturación el
 * orden lo lleva el trabajo de validación (sin persona, sobre el comprobante); acá queda solo para
 * que las pruebas de la numeración ejerciten el recorrido completo con el adaptador falso: los dos
 * casos de uso con guard (`reservarNumeroDeComprobante`, `cerrarReservaDeNumero`) y, entre los dos y
 * FUERA de toda transacción, el pedido a ARCA.
 *
 * Solo quien CREÓ la reserva pide la autorización. Si la reserva ya era de esta solicitud
 * (`yaReservada`), un intento anterior la dejó a medias: devuelve `RESERVA_EN_CURSO` y espera a la
 * reconciliación, para que un doble clic no pida dos veces el mismo número.
 */

type ReservaEnCurso = Readonly<{ codigo: "RESERVA_EN_CURSO"; numero: bigint }>;

/** El servicio respondió pero el cierre no se pudo guardar: la serie sigue `EN_CURSO`, recuperable. */
type CierreSinConfirmar = Readonly<{
  codigo: "CIERRE_SIN_CONFIRMAR";
  numero: bigint;
  resultado: ResultadoDeAutorizacionArca;
  causa: unknown;
}>;

export type ErrorAlNumerar =
  ErrorAlReservarNumero | ReservaEnCurso | CierreSinConfirmar | MotivoDeRechazo;

export type SalidaDeNumerar = Readonly<{ numero: bigint; resultado: ResultadoDeAutorizacionArca }>;

export function armarNumerarParaPruebas(
  casos: Pick<CasosDeUsoDeNumeracion, "reservarNumeroDeComprobante" | "cerrarReservaDeNumero">,
  emision: EmisionElectronica,
  /** El pedido completo para ARCA; por defecto, una factura B a consumidor final. */
  pedido: (
    base: Pick<SolicitudDeAutorizacion, "puntoDeVenta" | "tipo" | "numero" | "solicitud">,
  ) => SolicitudDeAutorizacion = solicitudDeAutorizacion,
) {
  return async function numerar(
    contexto: ContextoOperativo,
    entrada: EntradaDeReservarNumero,
  ): Promise<Resultado<SalidaDeNumerar, ErrorAlNumerar>> {
    const reserva = await casos.reservarNumeroDeComprobante(contexto, entrada);
    if (!reserva.ok) return reserva;
    const { numero, puntoDeVenta, yaReservada } = reserva.valor;
    if (yaReservada) return err({ codigo: "RESERVA_EN_CURSO", numero });

    const resultado = await emision.autorizar(
      pedido({ puntoDeVenta, tipo: entrada.tipo, numero, solicitud: entrada.solicitud }),
    );

    const cierre = await casos.cerrarReservaDeNumero(contexto, { ...entrada, numero, resultado });
    if (!cierre.ok) {
      return err({ codigo: "CIERRE_SIN_CONFIRMAR", numero, resultado, causa: cierre.error });
    }
    return ok({ numero, resultado });
  };
}
