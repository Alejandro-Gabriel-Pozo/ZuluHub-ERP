import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import {
  decidirAltaConNombreOcupado,
  nombreDeSucursalValido,
  type ErrorDeSucursal,
} from "../dominio/sucursal";
import { cargarEstadosDeLaEmpresa } from "./comun";
import type { DependenciasDeEmpresas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";
import { traducirErrores } from "./traducir";

export type EntradaDeCrearSucursal = Readonly<{ nombre: string }>;

export type SalidaDeCrearSucursal = Readonly<{
  sucursalId: SucursalId;
  /** `true`: ya había una sucursal activa con ese nombre; no se escribió nada. */
  yaExistia: boolean;
}>;

type ErrorPropioAlCrearSucursal = Extract<
  ErrorDeSucursal,
  "NOMBRE_DE_SUCURSAL_INVALIDO" | "SUCURSAL_INACTIVA_CON_ESE_NOMBRE"
>;

export type ErrorAlCrearSucursal =
  ErrorPropioAlCrearSucursal | MotivoDeRechazo | EmpresaNoOpera | ErrorDePersistencia;

/** Errores de restricciones que forman parte del contrato de este caso de uso. */
const RESTRICCIONES_ADMITIDAS = ["NOMBRE_DE_SUCURSAL_INVALIDO"] as const;

/**
 * Crear una sucursal en la empresa del contexto (H6, §B.1). Contexto OPERATIVO con persona. En una
 * transacción serializable: el guard (`sucursales.crear`), la empresa opera, el nombre es válido y
 * entonces `INSERT ... ON CONFLICT DO NOTHING`:
 *
 *  - se insertó → auditoría `SUCURSAL_CREADA` en la misma transacción;
 *  - ya había una activa con ese nombre (sin distinguir mayúsculas) → se devuelve esa
 *    (`yaExistia: true`) sin escribir: un doble clic o un reintento deja una sola sucursal;
 *  - ya había una desactivada con ese nombre → `SUCURSAL_INACTIVA_CON_ESE_NOMBRE` (se la reactiva).
 *
 * Dos altas simultáneas del mismo nombre: la que espera ve la otra al reintentar (serializable) y
 * devuelve `yaExistia`. El id lo genera la base.
 */
export function armarCrearSucursal({ transacciones, reglas }: DependenciasDeEmpresas) {
  return async function crearSucursal(
    contexto: ContextoOperativo,
    entrada: EntradaDeCrearSucursal,
  ): Promise<Resultado<SalidaDeCrearSucursal, ErrorAlCrearSucursal>> {
    const { empresaId } = contexto;
    const resultado = await transacciones.ejecutar(
      { contexto },
      async (
        tx,
      ): Promise<
        Resultado<
          SalidaDeCrearSucursal,
          ErrorPropioAlCrearSucursal | MotivoDeRechazo | EmpresaNoOpera
        >
      > => {
        const permiso = await exigirAccion(reglas, DECLARACIONES.crearSucursal.accion, () =>
          tx.autorizacion.delActor(contexto),
        );
        if (!permiso.ok) return permiso;
        const opera = comprobarQueOpera(empresaId, await cargarEstadosDeLaEmpresa(tx, empresaId));
        if (!opera.ok) return opera;
        const nombre = nombreDeSucursalValido(entrada.nombre);
        if (!nombre.ok) return nombre;

        const alta = await tx.sucursales.crearSiNoExiste(empresaId, nombre.valor);
        if (!alta.creada) {
          const decision = decidirAltaConNombreOcupado(alta.sucursal);
          if (!decision.ok) return decision;
          return ok({ sucursalId: alta.sucursal.id, yaExistia: true });
        }
        await tx.auditoria.registrar({
          empresaId,
          actorPersonaId: contexto.personaId,
          accion: "SUCURSAL_CREADA",
          entidad: "sucursal",
          entidadId: alta.sucursal.id,
          despues: { nombre: alta.sucursal.nombre, activa: true },
        });
        return ok({ sucursalId: alta.sucursal.id, yaExistia: false });
      },
    );
    return traducirErrores(resultado, RESTRICCIONES_ADMITIDAS);
  };
}
