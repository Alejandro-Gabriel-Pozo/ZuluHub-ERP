import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { TipoDePiso } from "../../../capacidades/roles/pisos";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeIdentidad } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/** Una acción del formulario de un rol: su id y el piso que la plataforma le fijó (`null`: libre de asignar). */
export type AccionParaElegir = Readonly<{ accion: string; piso: TipoDePiso | null }>;

/** Un módulo con sus acciones y si el plan de la empresa lo incluye (si no, sus casillas se muestran cerradas). */
export type ModuloParaElegir = Readonly<{
  modulo: string;
  enElPlan: boolean;
  acciones: readonly AccionParaElegir[];
}>;

export type ErrorAlListarAccionesParaElegir = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Lo que el gerente ve para armar un rol (H4b T6): todo el catálogo de acciones agrupado por módulo, con el piso de cada una y si el plan de la empresa incluye el módulo. Solo lectura, una transacción
 * (`read committed`); pide `roles.ver` dentro de ella. Es lo mismo que luego valida guardar (catálogo, plan y pisos), pero esto no decide nada: el servidor vuelve a validar al crear o editar.
 * Orden estable: módulos y acciones por id, para que dos lecturas sean comparables.
 */
export function armarAccionesParaElegir({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeIdentidad) {
  return async function accionesParaElegir(
    contexto: ContextoOperativo,
  ): Promise<Resultado<readonly ModuloParaElegir[], ErrorAlListarAccionesParaElegir>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<readonly ModuloParaElegir[], MotivoDeRechazo>> => {
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.accionesParaElegir.accion,
          () => tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const pisos = await tx.roles.pisos();
        const derechos = await tx.derechos.deLaEmpresa(contexto);
        const habilitados: ReadonlySet<string> = derechos.modulosHabilitados;
        return ok(
          Object.entries(reglas.catalogo)
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([modulo, definicion]) => ({
              modulo,
              enElPlan: habilitados.has(modulo),
              acciones: Object.keys(definicion.acciones)
                .sort()
                .map((accion) => ({ accion, piso: pisos[accion] ?? null })),
            })),
        );
      },
    );
  };
}
