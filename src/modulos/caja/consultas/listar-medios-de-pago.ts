import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { exigirPermisoDeConsulta } from "./comun";
import type { DependenciasDeConsultasDeCaja } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

export type EntradaDeListarMediosDePago = Readonly<{
  /** Por defecto, solo los activos. La pantalla de configuración los pide todos para poder reactivar. */
  incluirInactivos?: boolean;
}>;

export type MedioDeLista = Readonly<{
  id: string;
  tipo: string;
  /** `null`: sin nombre propio; la pantalla usa el vocabulario del tipo. */
  nombre: string | null;
  activo: boolean;
  /** Qué datos opcionales pide al cobrar (decisión 129). */
  datos: Readonly<{
    cupon: boolean;
    ultimos4: boolean;
    marca: boolean;
    cuotas: boolean;
    dni: boolean;
  }>;
  version: number;
}>;

export type MediosDePagoDeLaEmpresa = Readonly<{ medios: readonly MedioDeLista[] }>;

export type ErrorAlListarMediosDePago = MotivoDeRechazo | ErrorDePersistencia;

/**
 * Los medios de pago de la empresa (e3 §3.10). Pide `cajas.ver` al guard dentro de su transacción (`read committed`, solo lectura). Los
 * medios son de la empresa, no de una sucursal: no hay alcance que validar. Ordenados por tipo y nombre.
 */
export function armarListarMediosDePago({ transacciones, reglas }: DependenciasDeConsultasDeCaja) {
  return async function listarMediosDePago(
    contexto: ContextoOperativo,
    entrada: EntradaDeListarMediosDePago = {},
  ): Promise<Resultado<MediosDePagoDeLaEmpresa, ErrorAlListarMediosDePago>> {
    return transacciones.ejecutar(
      { contexto, aislamiento: "read committed", soloLectura: true },
      async (tx): Promise<Resultado<MediosDePagoDeLaEmpresa, MotivoDeRechazo>> => {
        const permiso = await exigirPermisoDeConsulta(
          tx,
          contexto,
          reglas,
          DECLARACIONES_DE_CONSULTAS.listarMediosDePago.accion,
        );
        if (!permiso.ok) return permiso;
        const medios = await tx.mediosDePago.listar(contexto.empresaId, {
          incluirInactivos: entrada.incluirInactivos === true,
        });
        return ok({
          medios: medios.map((medio) => ({
            id: medio.id,
            tipo: medio.tipo,
            nombre: medio.nombre,
            activo: medio.activo,
            datos: { ...medio.pide },
            version: medio.version,
          })),
        });
      },
    );
  };
}
