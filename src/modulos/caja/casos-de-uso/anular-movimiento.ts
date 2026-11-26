import type { ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { ErrorDeAnulacion } from "../dominio/anulacion";
import { decidirPorHuella } from "../dominio/huella";
import {
  exigirClave,
  huellaDeAnulacion,
  type ErrorDeClave,
} from "../dominio/idempotencia-de-operacion";
import { motivoObligatorio } from "../dominio/texto";
import {
  exigirAlcance,
  prepararCaso,
  repetirSiOtroGano,
  UNICAS_DE_LA_ANULACION,
  REINTENTOS_EN_LA_SESION_DE_CAJA,
} from "./comun";
import { anularMovimientoEnTx } from "./anular-movimiento-en-tx";
import type { DependenciasDeCaja } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeAnularMovimientoDeCaja = Readonly<{
  /** La genera la pantalla al abrir el diálogo: repetir el pedido (doble clic, reintento de red) no anula dos veces. */
  claveDeIdempotencia: string;
  movimientoId: string;
  motivo: string;
}>;

export type SalidaDeAnularMovimientoDeCaja = Readonly<{
  anulacionId: string;
  /** `true`: ya se había anulado con esta clave; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropio =
  | ErrorDeClave
  | ErrorDeAnulacion
  | "CLAVE_REUTILIZADA"
  | "MOVIMIENTO_NO_ENCONTRADO"
  | "MOVIMIENTO_CON_DEVOLUCION";

export type ErrorAlAnularMovimientoDeCaja =
  ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso (red de seguridad: antes decide el dominio). */
const RESTRICCIONES_ADMITIDAS = [
  "CLAVE_DE_IDEMPOTENCIA_INVALIDA",
  "MOTIVO_INVALIDO",
  "MOVIMIENTO_YA_ANULADO",
] as const;

/**
 * Anular un movimiento de caja con un registro nuevo (e3 §3.2): el espejo exacto (mismo medio, misma cuenta, importe opuesto) con motivo
 * obligatorio; el original queda intacto. Contexto OPERATIVO con persona, en una transacción serializable, con el orden fijo: guard
 * (`movimientos_caja.anular`, permitido en solo lectura), la empresa opera, el movimiento (con alcance sobre la sucursal de su sesión),
 * validación (clave y motivo), idempotencia (la clave, ANTES de mirar el estado: repetir la anulación devuelve lo hecho) y las reglas del
 * dominio: solo ingreso, egreso o ajuste de una sesión `ABIERTA`, una sola vez (`MOVIMIENTO_YA_ANULADO`: dos anulaciones a la vez dejan una),
 * nunca un cobro (`MOVIMIENTO_CON_ORIGEN`) ni el egreso de una devolución (`MOVIMIENTO_CON_DEVOLUCION`: se anula con `anularDevolucion`). El operador anula SOLO lo que cargó él (se compara `registrado_por` con la persona del contexto
 * firmado, nunca con un dato de la pantalla); gerente y administrador, cualquiera (`movimientos_caja.anular_de_otros`). La anulación y su
 * auditoría `MOVIMIENTO_ANULADO` van en la misma transacción.
 */
export function armarAnularMovimientoDeCaja({ transacciones, reglas }: DependenciasDeCaja) {
  return async function anularMovimientoDeCaja(
    contexto: ContextoOperativo,
    entrada: EntradaDeAnularMovimientoDeCaja,
  ): Promise<Resultado<SalidaDeAnularMovimientoDeCaja, ErrorAlAnularMovimientoDeCaja>> {
    const { empresaId, ahora } = contexto;
    const ejecutar = () =>
      transacciones.ejecutar(
        { contexto, reintentos: REINTENTOS_EN_LA_SESION_DE_CAJA },
        async (
          tx,
        ): Promise<
          Resultado<
            SalidaDeAnularMovimientoDeCaja,
            ErrorPropio | MotivoDeRechazo | EmpresaNoOpera | ErrorDeAlcance
          >
        > => {
          const previo = await prepararCaso(
            tx,
            contexto,
            reglas,
            DECLARACIONES.anularMovimientoDeCaja.accion,
          );
          if (!previo.ok) return previo;
          const original = await tx.movimientos.obtener(empresaId, entrada.movimientoId);
          if (original === null) return err("MOVIMIENTO_NO_ENCONTRADO");
          const alcance = await exigirAlcance(tx, contexto, original.sucursalId);
          if (!alcance.ok) return alcance;
          const clave = exigirClave(entrada.claveDeIdempotencia);
          if (!clave.ok) return clave;
          const motivo = motivoObligatorio(entrada.motivo);
          if (!motivo.ok) return motivo;

          // El egreso de una devolución se anula SOLO anulando la devolución (`anularDevolucion`, con `devoluciones.registrar`): si no, quien tiene
          // `movimientos_caja.anular_de_otros` se saltearía ese permiso y dejaría el pedido a medias. Falla cerrado, antes de mirar la repetición.
          if (
            (await tx.movimientosDeDinero.delMovimiento(empresaId, original.id))?.devuelveOrigen
          ) {
            return err("MOVIMIENTO_CON_DEVOLUCION");
          }
          const huella = huellaDeAnulacion({ movimientoId: original.id, motivo: motivo.valor });
          const previa = await tx.movimientos.obtenerPorClave(empresaId, clave.valor);
          const repeticion = decidirPorHuella(previa?.huella ?? null, huella);
          if (repeticion === "CLAVE_REUTILIZADA") return err("CLAVE_REUTILIZADA");
          if (previa !== null) return ok({ anulacionId: previa.id, yaExistia: true });

          const puedeAnularDeOtros = (
            await exigirAccion(reglas, "movimientos_caja.anular_de_otros", () =>
              tx.autorizacion.delActor(contexto),
            )
          ).ok;
          const anulada = await anularMovimientoEnTx(tx, contexto, previo.valor.persona, {
            original,
            claveDeIdempotencia: clave.valor,
            huella,
            motivo: motivo.valor,
            puedeAnularDeOtros,
          });
          if (!anulada.ok) return anulada;
          const { anulacionId } = anulada.valor;
          return ok({ anulacionId, yaExistia: false });
        },
      );
    const resultado = await repetirSiOtroGano(ejecutar, UNICAS_DE_LA_ANULACION);
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
