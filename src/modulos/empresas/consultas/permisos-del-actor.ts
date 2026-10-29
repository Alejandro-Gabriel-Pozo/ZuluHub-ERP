import { accionesPermitidas, exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import { estadoDeModulos } from "../../../capacidades/modulos/activos";
import type { ClaveAccion, ClaveModulo } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import type { DependenciasDeConsultasDeEmpresas } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * Lo que la persona puede hacer HOY en su empresa, calculado por el servidor para que una pantalla (la barra del facturador) muestre u
 * oculte. Son CLAVES, no textos. Ocultar un botón nunca es una autorización: cada caso de uso y cada consulta vuelve a pasar por el guard.
 */
export type PermisosDelActor = Readonly<{
  /** Las acciones que el guard deja hacer ahora (rol y módulo activo), ordenadas. Ej.: `comprobantes.ver`. */
  acciones: readonly ClaveAccion[];
  /** Los módulos de la empresa: los que operan sin restricción y los que quedaron en solo lectura por una baja de plan (ordenados). */
  modulos: Readonly<{ activos: readonly ClaveModulo[]; enSoloLectura: readonly ClaveModulo[] }>;
}>;

export type ErrorAlPedirLosPermisosDelActor = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Los permisos efectivos de quien consulta, en la empresa del contexto (H6 §B.5, «permisosDelActor»). A diferencia de mirar solo la
 * matriz de roles (`tablaDePermisos`), una acción figura únicamente si el guard la dejaría pasar: el rol la incluye Y su módulo está
 * activo para la empresa (lo que un módulo en desarrollo, sin activar o fuera del plan no cumple). Los tres roles la pueden pedir:
 * pide `permisos.ver_propios` al guard dentro de su transacción (`read committed`, solo lectura) y carga al actor UNA vez, sin caché.
 * Sin membresía activa en la empresa del contexto (ni la persona suspendida) no devuelve nada: `SIN_PERMISO`.
 */
export function armarPermisosDelActor({
  transacciones,
  reglas,
}: DependenciasDeConsultasDeEmpresas) {
  return async function permisosDelActor(
    contexto: ContextoOperativo,
  ): Promise<Resultado<PermisosDelActor, ErrorAlPedirLosPermisosDelActor>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<PermisosDelActor, MotivoDeRechazo>> => {
        const actor = await tx.autorizacion.delActor(contexto);
        const permiso = await exigirAccion(
          reglas,
          DECLARACIONES_DE_CONSULTAS.permisosDelActor.accion,
          () => Promise.resolve(actor),
        );
        if (!permiso.ok) return permiso;
        const modulos = estadoDeModulos(
          reglas.catalogo,
          actor.modulosActivados,
          actor.modulosHabilitados,
        );
        return ok({
          acciones: accionesPermitidas(reglas, actor),
          modulos: {
            activos: [...modulos.modulosActivos].sort(),
            enSoloLectura: [...modulos.modulosEnSoloLectura].sort(),
          },
        });
      },
    );
  };
}
