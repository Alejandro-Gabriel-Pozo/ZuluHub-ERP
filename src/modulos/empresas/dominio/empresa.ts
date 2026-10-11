import type { EstadoDeEmpresa } from "../../../contexto/estados";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import type { EmpresaId, TenantId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Empresa: la frontera de aislamiento. `tenantId` es solo un identificador: la empresa no conoce
 * al tenant ni lo importa (R3). El CUIT es único entre empresas no canceladas y no lo edita el
 * gerente.
 */
export type Empresa = Readonly<{
  id: EmpresaId;
  tenantId: TenantId;
  cuit: Cuit;
  razonSocial: string;
  estado: EstadoDeEmpresa;
  motivoEstado: string | null;
  zonaHoraria: string;
  version: number;
}>;

export type ErrorDeEmpresa =
  "RAZON_SOCIAL_INVALIDA" | "MOTIVO_OBLIGATORIO" | "TRANSICION_NO_PERMITIDA";

export type CambioDeEstadoDeEmpresa = Readonly<{
  estado: EstadoDeEmpresa;
  motivoEstado: string | null;
}>;

/**
 * Transiciones permitidas (diseno-inicial §6.1). La base impone la misma tabla con un disparador;
 * un test compara ambas.
 */
export const TRANSICIONES_DE_EMPRESA: Readonly<
  Record<EstadoDeEmpresa, readonly EstadoDeEmpresa[]>
> = {
  PROVISIONING: ["ACTIVE", "CANCELLED"],
  ACTIVE: ["SUSPENDED", "DELETING"],
  SUSPENDED: ["ACTIVE", "DELETING"],
  CANCELLED: [],
  DELETING: [],
};

const REQUIEREN_MOTIVO: readonly EstadoDeEmpresa[] = ["SUSPENDED", "CANCELLED"];

export function razonSocialValida(texto: string): Resultado<string, ErrorDeEmpresa> {
  const limpia = texto.trim();
  return limpia === "" ? err("RAZON_SOCIAL_INVALIDA") : ok(limpia);
}

export function cambiarEstado(
  empresa: Empresa,
  nuevo: EstadoDeEmpresa,
  motivo: string | null,
): Resultado<CambioDeEstadoDeEmpresa, ErrorDeEmpresa> {
  if (!TRANSICIONES_DE_EMPRESA[empresa.estado].includes(nuevo)) {
    return err("TRANSICION_NO_PERMITIDA");
  }
  if (!REQUIEREN_MOTIVO.includes(nuevo)) return ok({ estado: nuevo, motivoEstado: null });
  const limpio = motivo?.trim() ?? "";
  return limpio === "" ? err("MOTIVO_OBLIGATORIO") : ok({ estado: nuevo, motivoEstado: limpio });
}
