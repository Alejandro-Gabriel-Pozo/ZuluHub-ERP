import type { ContextoOperativo } from "../../../contexto/contexto";
import type { Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { estadoDeCajasParaCobrar } from "../cobrar/estado-de-cajas";
import type { ErrorAlConsultarCajasParaCobrar, EstadoDeCajasParaCobrar } from "../cobrar/contrato";
import {
  alcanceParaMirar,
  exigirPermisoDeConsulta,
  sucursalElegida,
  type ErrorDeConsulta,
} from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeEstadoDeLaCaja = Readonly<{ sucursalId: string }>;

export type ErrorAlConsultarElEstadoDeLaCaja =
  ErrorDeConsulta | ErrorAlConsultarCajasParaCobrar | ErrorDePersistencia;

/**
 * El estado de la caja de la sucursal para la pantalla «Caja»: por cada caja activa, si no tiene sesión, está abierta o en cierre (con su sesión y su jornada y si
 * esa jornada ya venció), y la jornada de hoy de la sucursal con su estado. Es la misma lectura que usa ventas antes de cobrar (`estadoDeCajasParaCobrar`: una
 * regla, un lugar), pero acá con el guard de caja (`cajas.ver`) y el alcance de sucursal de caja: la sucursal ajena o ninguna elegida nunca se asume «todas». SOLO
 * LEE, `read committed`.
 */
export function armarEstadoDeLaCaja({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function estadoDeLaCaja(
    contexto: ContextoOperativo,
    entrada: EntradaDeEstadoDeLaCaja,
  ): Promise<Resultado<EstadoDeCajasParaCobrar, ErrorAlConsultarElEstadoDeLaCaja>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (
        tx,
      ): Promise<
        Resultado<EstadoDeCajasParaCobrar, ErrorDeConsulta | ErrorAlConsultarCajasParaCobrar>
      > => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.estadoDeLaCaja.accion,
        );
        if (!permiso.ok) return permiso;
        const sucursal = sucursalElegida(await alcanceParaMirar(tx, contexto), entrada.sucursalId);
        if (!sucursal.ok) return sucursal;
        return estadoDeCajasParaCobrar(tx, contexto, sucursal.valor);
      },
    );
  };
}
