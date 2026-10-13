import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type {
  DesenlaceDeAutorizacion,
  ResultadoDeAutorizacion,
  TipoDeComprobante,
} from "../dominio/comprobante-emitido";
import type { PuntoDeVentaId, SolicitudId } from "../dominio/identificadores";
import { cerrarSerie, type ErrorDeNumeracion } from "../dominio/numeracion";
import { datosDeSerie, empresaOpera, entidadDeSerie } from "./comun";
import type { DependenciasDeNumeracion } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

export type EntradaDeCerrarReserva = Readonly<{
  puntoDeVentaId: PuntoDeVentaId;
  tipo: TipoDeComprobante;
  solicitud: SolicitudId;
  /** El número que devolvió la reserva. */
  numero: bigint;
  /** Cómo terminó la autorización en el servicio de emisión. */
  resultado: ResultadoDeAutorizacion;
}>;

export type SalidaDeCerrarReserva = Readonly<{
  desenlace: DesenlaceDeAutorizacion;
  numero: bigint;
  /** `true`: la reserva ya no estaba y nada había que cerrar (una repetición); no se escribió nada. */
  yaCerrada: boolean;
}>;

type ErrorPropioAlCerrar = "SERIE_NO_ENCONTRADA" | ErrorDeNumeracion;

export type ErrorAlCerrarReserva =
  ErrorPropioAlCerrar | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Lo que se audita del resultado de la autorización (el código de autorización no es un secreto). */
function datosDelResultado(resultado: ResultadoDeAutorizacion): Record<string, Dato> {
  switch (resultado.tipo) {
    case "AUTORIZADO":
      return { codigoDeAutorizacion: resultado.codigo, vence: resultado.vence };
    case "RECHAZADO":
      return { observaciones: [...resultado.observaciones] };
    case "INCIERTO":
      return {};
  }
}

/**
 * Cerrar la reserva con el resultado de la autorización (H7, §B.8). Contexto OPERATIVO con persona.
 * En una transacción serializable: el guard (`comprobantes.emitir`), la empresa opera y el dominio
 * decide (`cerrarSerie`):
 *
 *  - autorizado → `ultimoNumero` pasa a ser el número y la serie queda `LIBRE`;
 *  - rechazado → `LIBRE` sin avanzar (no hay hueco: ese número nunca se usó);
 *  - incierto → sigue `EN_CURSO` y NO se escribe nada (la reconciliación la resuelve).
 *
 * La auditoría (`NUMERO_DE_COMPROBANTE_AUTORIZADO` o `_RECHAZADO`) va en la misma transacción que el
 * cambio de la serie; con la facturación irá también el comprobante.
 *
 * Idempotente: cerrar dos veces lo mismo da el mismo éxito, sin avanzar dos veces. Si la serie ya no
 * tiene esta reserva (`yaCerrada`):
 *  - autorizado: es un éxito solo si el último número ya alcanzó a este (alguien lo cerró);
 *  - rechazado o incierto: no hay nada que liberar, salvo que el último número ya haya pasado por
 *    este (el servicio dijo que no y la serie dice que sí: `SOLICITUD_NO_VIGENTE`).
 * Un `numero` que no es el de la reserva es `NUMERO_INVALIDO` (un defecto de quien llama).
 */
export function armarCerrarReservaDeNumero({ transacciones, reglas }: DependenciasDeNumeracion) {
  return async function cerrarReservaDeNumero(
    contexto: ContextoOperativo,
    entrada: EntradaDeCerrarReserva,
  ): Promise<Resultado<SalidaDeCerrarReserva, ErrorAlCerrarReserva>> {
    const { empresaId } = contexto;
    const desenlace = entrada.resultado.tipo;
    return transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<SalidaDeCerrarReserva, ErrorPropioAlCerrar | MotivoDeRechazo | EmpresaNoOpera>
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.cerrarReservaDeNumero.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = await empresaOpera(tx, empresaId);
        if (!opera.ok) return opera;

        const serie = await tx.series.obtener(empresaId, entrada.puntoDeVentaId, entrada.tipo);
        if (serie === null) return err("SERIE_NO_ENCONTRADA");

        const laTiene = serie.estado === "EN_CURSO" && serie.solicitud === entrada.solicitud;
        if (!laTiene) {
          // Una repetición: la reserva ya se cerró (o se reconcilió).
          const alcanzado = serie.ultimoNumero >= entrada.numero;
          if (desenlace === "AUTORIZADO" ? !alcanzado : alcanzado) {
            return err("SOLICITUD_NO_VIGENTE");
          }
          return ok({ desenlace, numero: entrada.numero, yaCerrada: true });
        }
        if (serie.numeroEnCurso !== entrada.numero) return err("NUMERO_INVALIDO");

        const cierre = cerrarSerie(serie, entrada.solicitud, desenlace);
        if (!cierre.ok) return cierre;
        if (desenlace === "INCIERTO") {
          return ok({ desenlace, numero: entrada.numero, yaCerrada: false });
        }
        const guardada = await tx.series.guardar(cierre.valor.serie);
        if (guardada === null) throw new Error("la serie cambió dentro de la transacción");
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion:
            desenlace === "AUTORIZADO"
              ? "NUMERO_DE_COMPROBANTE_AUTORIZADO"
              : "NUMERO_DE_COMPROBANTE_RECHAZADO",
          entidad: "serie_comprobante",
          entidadId: entidadDeSerie(entrada.puntoDeVentaId, entrada.tipo),
          antes: datosDeSerie(serie),
          despues: {
            ...datosDeSerie(guardada),
            numero: entrada.numero.toString(),
            solicitud: entrada.solicitud,
            ...datosDelResultado(entrada.resultado),
          },
        });
        return ok({ desenlace, numero: entrada.numero, yaCerrada: false });
      },
    );
  };
}
