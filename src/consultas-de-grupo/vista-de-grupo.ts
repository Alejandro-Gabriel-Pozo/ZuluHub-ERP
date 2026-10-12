import {
  estadoEfectivo,
  type EstadoDeEmpresa,
  type EstadoDeTenant,
  type EstadoEfectivo,
} from "../contexto/estados";
import type { EmpresaId, TenantId } from "../primitivas/identificadores/marca";

/**
 * La vista de grupo tal como la ve una pantalla (ADR-005, H6 §B.5): objetos planos, sin texto de marca
 * ni entidades del dominio. Muestra solo empresas y estados (etapa 1): el estado de cada empresa, y el
 * efectivo que lo combina con el de su tenant (con el tenant suspendido el propietario ve la lista y los
 * estados, no los datos operativos). El CUIT sale como texto, igual que el resto de las fronteras.
 */
export type EmpresaDeGrupo = Readonly<{
  id: EmpresaId;
  razonSocial: string;
  cuit: string;
  estado: EstadoDeEmpresa;
  estadoEfectivo: EstadoEfectivo;
}>;

export type VistaDeGrupo = Readonly<{
  tenant: Readonly<{ nombre: string; estado: EstadoDeTenant }>;
  empresas: readonly EmpresaDeGrupo[];
}>;

/** Lo que la vista necesita del tenant y de cada empresa; el tenant y la empresa reales lo cumplen. */
export type TenantParaLaVista = Readonly<{ id: TenantId; nombre: string; estado: EstadoDeTenant }>;

export type EmpresaParaLaVista = Readonly<{
  id: EmpresaId;
  tenantId: TenantId;
  razonSocial: string;
  cuit: string;
  estado: EstadoDeEmpresa;
}>;

/**
 * Arma la vista a partir del tenant y de sus empresas, en el orden en que llegan (la consulta las pide
 * ordenadas por razón social e id). Falla cerrado ante lo que la base ya no deja pasar: una empresa de
 * OTRO tenant en la lista es un defecto grave de aislamiento y se lanza `RangeError` en lugar de
 * mostrarla.
 */
export function armarVistaDeGrupo(
  tenant: TenantParaLaVista,
  empresas: readonly EmpresaParaLaVista[],
): VistaDeGrupo {
  return {
    tenant: { nombre: tenant.nombre, estado: tenant.estado },
    empresas: empresas.map((empresa) => {
      if (empresa.tenantId !== tenant.id) {
        throw new RangeError(`la empresa ${empresa.id} no es del tenant ${tenant.id}`);
      }
      return {
        id: empresa.id,
        razonSocial: empresa.razonSocial,
        cuit: empresa.cuit,
        estado: empresa.estado,
        estadoEfectivo: estadoEfectivo(tenant.estado, empresa.estado),
      };
    }),
  };
}
