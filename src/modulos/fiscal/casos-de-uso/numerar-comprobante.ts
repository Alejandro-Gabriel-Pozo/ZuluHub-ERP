import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ResultadoDeAutorizacion } from "../dominio/comprobante-emitido";
import type { DependenciasDeNumeracion } from "./contrato";
import type { ErrorDeEmision } from "./emision-electronica";
import type { armarCerrarReservaDeNumero } from "./cerrar-reserva";
import type {
  EntradaDeReservarNumero,
  armarReservarNumeroDeComprobante,
  ErrorAlReservarNumero,
} from "./reservar-numero";

export type EntradaDeNumerarComprobante = EntradaDeReservarNumero;

export type SalidaDeNumerarComprobante = Readonly<{
  /** El número que se pidió autorizar. Solo cuenta si `resultado` es `AUTORIZADO`. */
  numero: bigint;
  resultado: ResultadoDeAutorizacion;
}>;

/**
 * La reserva ya existía de un intento anterior (que no terminó o quedó incierto): no se vuelve a
 * pedir la autorización, porque el servicio pudo haberla dado y repetir el pedido haría que el
 * servicio la rechace por secuencia y la serie se liberara mal. La resuelve la reconciliación.
 */
export type ReservaEnCurso = Readonly<{ codigo: "RESERVA_EN_CURSO"; numero: bigint }>;

/**
 * El servicio respondió pero el cierre no se pudo guardar: la serie sigue `EN_CURSO` y queda
 * recuperable por la reconciliación. Trae lo que respondió el servicio (el código de autorización
 * no se pierde) y por qué falló el cierre.
 */
export type CierreSinConfirmar = Readonly<{
  codigo: "CIERRE_SIN_CONFIRMAR";
  numero: bigint;
  resultado: ResultadoDeAutorizacion;
  causa: unknown;
}>;

export type ErrorAlNumerarComprobante =
  | ErrorAlReservarNumero
  | ReservaEnCurso
  | CierreSinConfirmar
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDeEmision
  | ErrorDePersistencia;

/**
 * Numerar un comprobante: reservar el número, pedir la autorización y cerrar la reserva con lo que
 * respondió el servicio (H7, §B.8). Cada paso es su propio caso de uso con su guard; lo que NO va
 * adentro de una transacción es el pedido al servicio (ADR-007):
 *
 *   1. `reservarNumeroDeComprobante` (transacción corta).
 *   2. `emision.autorizar` (fuera de toda transacción).
 *   3. `cerrarReservaDeNumero` (otra transacción).
 *
 * Si el proceso muere entre el 2 y el 3, o el cierre falla, la serie sigue `EN_CURSO` y la
 * reconciliación la resuelve (no hay hueco ni duplicado). Una excepción del adaptador tampoco se
 * traga: la reserva queda y se reconcilia.
 *
 * Solo quien CREÓ la reserva pide la autorización. Si la reserva ya era de esta solicitud
 * (`yaReservada`), un intento anterior la dejó a medias: devuelve `RESERVA_EN_CURSO` y espera a la
 * reconciliación. Así un doble clic no pide dos veces el mismo número al servicio.
 */
export function armarNumerarComprobante(
  { emision }: DependenciasDeNumeracion,
  reservar: ReturnType<typeof armarReservarNumeroDeComprobante>,
  cerrar: ReturnType<typeof armarCerrarReservaDeNumero>,
) {
  return async function numerarComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeNumerarComprobante,
  ): Promise<Resultado<SalidaDeNumerarComprobante, ErrorAlNumerarComprobante>> {
    const reserva = await reservar(contexto, entrada);
    if (!reserva.ok) return reserva;
    const { numero, puntoDeVenta, yaReservada } = reserva.valor;
    if (yaReservada) return err({ codigo: "RESERVA_EN_CURSO", numero });

    const resultado = await emision.autorizar({
      puntoDeVenta,
      tipo: entrada.tipo,
      numero,
      solicitud: entrada.solicitud,
    });

    const cierre = await cerrar(contexto, { ...entrada, numero, resultado });
    if (!cierre.ok) {
      return err({ codigo: "CIERRE_SIN_CONFIRMAR", numero, resultado, causa: cierre.error });
    }
    return ok({ numero, resultado });
  };
}
