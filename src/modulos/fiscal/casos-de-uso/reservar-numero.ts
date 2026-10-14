import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { OPCIONES_DE_NUMERACION } from "../dominio/numeracion";
import type { DependenciasDeNumeracion } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import type { ErrorDeEmision } from "./emision-electronica";
import {
  reservarEnTx,
  type EntradaDeReservarNumero,
  type ErrorPropioAlReservar,
  type PasoDeReserva,
  type SalidaDeReservarNumero,
} from "./numeracion-en-tx";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";

export type { EntradaDeReservarNumero, SalidaDeReservarNumero };

export type ErrorAlReservarNumero =
  ErrorPropioAlReservar | MotivoDeRechazo | EmpresaNoOpera | ErrorDeEmision | ErrorDePersistencia;

/**
 * Reservar el próximo número de una serie para una solicitud (H7, §B.8). Contexto OPERATIVO con
 * persona. En UNA transacción serializable y corta: el guard (`comprobantes.emitir`) y, ya con el
 * permiso, el cuerpo común de la numeración (`reservarEnTx`: la empresa opera, el punto de venta es
 * del ambiente pedido y el dominio reserva, con su auditoría en la misma transacción).
 *
 * Dos reservas simultáneas de la misma serie no pueden ganar las dos: SERIALIZABLE (y la versión de
 * la fila) hace que una repita y encuentre a la otra. Los números salen de la serie, nunca del reloj
 * ni del azar: sin huecos ni duplicados.
 *
 * La serie de un (punto de venta, tipo, ambiente) nace con el último número que informa el servicio de
 * emisión. Esa pregunta es un efecto externo y va FUERA de la transacción (ADR-007): la primera
 * transacción descubre que falta, se pregunta, y una segunda crea la serie (`crear` es idempotente
 * y no pisa una existente) y reserva. Una repetición posterior ya no pregunta.
 *
 * Límite conocido: sin la tabla de comprobantes (la trae la facturación) no queda registro de las
 * solicitudes ya cerradas. Repetir esta reserva DESPUÉS de cerrada reservaría un número nuevo: quien
 * orquesta (la facturación, con la unicidad de su origen) no debe llamarla para una solicitud ya
 * validada.
 */
export function armarReservarNumeroDeComprobante({
  transacciones,
  reglas,
  emision,
  opciones = OPCIONES_DE_NUMERACION,
}: DependenciasDeNumeracion) {
  return async function reservarNumeroDeComprobante(
    contexto: ContextoOperativo,
    entrada: EntradaDeReservarNumero,
  ): Promise<Resultado<SalidaDeReservarNumero, ErrorAlReservarNumero>> {
    const intentar = (ultimoDelServicio: bigint | null) =>
      transacciones.ejecutar(
        { contexto },
        async (
          tx,
        ): Promise<
          Resultado<PasoDeReserva, ErrorPropioAlReservar | MotivoDeRechazo | EmpresaNoOpera>
        > => {
          const permiso = await exigirAccion(
            reglas,
            DECLARACIONES.reservarNumeroDeComprobante.accion,
            () => tx.autorizacion.delActor(contexto),
          );
          if (!permiso.ok) return permiso;
          return reservarEnTx(tx, contexto, entrada, ultimoDelServicio, opciones);
        },
      );

    const primero = await intentar(null);
    if (!primero.ok) return primero;
    if (primero.valor.tipo === "RESERVADO") return ok(primero.valor.salida);

    // La serie no existe: se pregunta al servicio FUERA de la transacción (ADR-007).
    const ultimo = await emision.ultimoAutorizado(primero.valor.puntoDeVenta, entrada.tipo);
    if (!ultimo.ok) return ultimo;

    const segundo = await intentar(ultimo.valor);
    if (!segundo.ok) return segundo;
    if (segundo.valor.tipo !== "RESERVADO") {
      throw new Error("la serie sigue sin existir después de crearla");
    }
    return ok(segundo.valor.salida);
  };
}
