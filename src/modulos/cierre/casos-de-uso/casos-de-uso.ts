import { armarCancelarAuditoria } from "./cancelar-auditoria";
import { armarCerrarJornada } from "./cerrar-jornada";
import { exigirAportesDeModulosDistintos } from "../comun";
import type { DependenciasDeCierre } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import { armarIniciarAuditoria } from "./iniciar-auditoria";

/**
 * Los casos de uso del cierre del día, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que
 * declara `DECLARACIONES` (qué acción exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso,
 * no compila. Lanza si dos aportes registrados son del mismo módulo (error de armado, no de negocio).
 */
export function crearCasosDeUsoDeCierre<TAportes = unknown>(
  dependencias: DependenciasDeCierre<TAportes>,
) {
  exigirAportesDeModulosDistintos(dependencias.aportes);
  return {
    iniciarAuditoria: armarIniciarAuditoria(dependencias),
    cancelarAuditoria: armarCancelarAuditoria(dependencias),
    cerrarJornada: armarCerrarJornada(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCierre = ReturnType<typeof crearCasosDeUsoDeCierre>;
