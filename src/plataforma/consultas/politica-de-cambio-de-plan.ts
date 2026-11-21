import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import type { PoliticaGuardada } from "../../modulos/planes/publico";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDeMarcasYPlanes } from "./contrato-de-marcas-y-planes";
import { DECLARACIONES_DE_CONSULTAS_DE_MARCAS_Y_PLANES as D } from "./declaraciones-de-marcas-y-planes";
import { LECTURA } from "./lectura-de-planes";

export type PoliticaDeCambioDePlanVista = Readonly<{
  /** La que rige hoy (la de mayor versión). */
  vigente: PoliticaGuardada;
  /** Todas, por versión descendente (la vigente primero). */
  historial: readonly PoliticaGuardada[];
}>;

export type ErrorAlVerPoliticaDeCambioDePlan = MotivoDeRechazo | ErrorDePersistencia;

/** La política de cambio de plan vigente y su historial (H-14a). `planes.ver`, solo lectura. */
export function armarVerPoliticaDeCambioDePlan({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeMarcasYPlanes) {
  return async function verPoliticaDeCambioDePlan(
    contexto: ContextoDePlataforma,
  ): Promise<Resultado<PoliticaDeCambioDePlanVista, ErrorAlVerPoliticaDeCambioDePlan>> {
    return transacciones.ejecutar(
      { contexto, ...LECTURA },
      async (
        tx,
      ): Promise<Resultado<PoliticaDeCambioDePlanVista, ErrorAlVerPoliticaDeCambioDePlan>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.verPoliticaDeCambioDePlan.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const historial = [...(await tx.planes.politicasDeCambio())].reverse();
        const [vigente] = historial;
        // La migración 0089 carga la versión 1: sin política la base está rota, no es un caso de negocio.
        if (vigente === undefined)
          throw new RangeError("no hay política de cambio de plan cargada");
        return ok({ vigente, historial });
      },
    );
  };
}
