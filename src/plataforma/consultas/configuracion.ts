import type { EstadoDeConstruccion } from "../../capacidades/modulos/catalogo";
import type { MotivoDeRechazo } from "../../capacidades/permisos/guard";
import type { ContextoDePlataforma } from "../../contexto/contexto";
import { ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../puertos/transacciones";
import { exigirAccionDePlataforma } from "./comun";
import type { DependenciasDeConsultasDePlataforma } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_PLATAFORMA as D } from "./declaraciones";

/** Un módulo del catálogo comercial, tal como lo ve soporte: qué es y qué acciones tiene. */
export type VistaDeModulo = Readonly<{
  clave: string;
  estado: EstadoDeConstruccion;
  obligatorio: boolean;
  requiere: readonly string[];
  usaSiExiste: readonly string[];
  /** Las acciones del módulo (solo sus nombres), ordenadas. */
  acciones: readonly string[];
}>;

export type VistaDeConfiguracion = Readonly<{ modulos: readonly VistaDeModulo[] }>;

export type ErrorAlVerConfiguracion = MotivoDeRechazo | ErrorDePersistencia;

/**
 * La configuración de la plataforma: el catálogo de módulos del código, ordenado por clave (§B.5.9,
 * nivel 1). `configuracion.ver`. No lee datos de ninguna empresa: no hay módulos activados por empresa
 * hasta el primer módulo vendible.
 */
export function armarVerConfiguracion({
  transacciones,
  reglas,
  catalogoDeEmpresa,
}: DependenciasDeConsultasDePlataforma) {
  return async function verConfiguracion(
    contexto: ContextoDePlataforma,
  ): Promise<Resultado<VistaDeConfiguracion, ErrorAlVerConfiguracion>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<VistaDeConfiguracion, MotivoDeRechazo>> => {
        const permiso = await exigirAccionDePlataforma(
          reglas,
          D.verConfiguracion.accion,
          tx.autorizacionDePlataforma,
          contexto,
        );
        if (!permiso.ok) return permiso;
        const modulos = Object.entries(catalogoDeEmpresa)
          .map(([clave, modulo]): VistaDeModulo => ({
            clave,
            estado: modulo.estado,
            obligatorio: modulo.obligatorio,
            requiere: modulo.requiere,
            usaSiExiste: modulo.usaSiExiste,
            acciones: Object.keys(modulo.acciones).sort(),
          }))
          .sort((a, b) => (a.clave < b.clave ? -1 : 1));
        return ok({ modulos });
      },
    );
  };
}
