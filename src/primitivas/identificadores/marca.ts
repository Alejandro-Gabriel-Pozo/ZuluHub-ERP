/**
 * Identificadores con marca: un `EmpresaId` no se puede pasar donde se espera un `TenantId`.
 * La marca existe solo en el sistema de tipos; en ejecución son texto.
 */
export type Marca<T, Nombre extends string> = T & { readonly __marca: Nombre };

export type EmpresaId = Marca<string, "EmpresaId">;
export type TenantId = Marca<string, "TenantId">;
export type PersonaId = Marca<string, "PersonaId">;

/** Un identificador válido es texto no vacío, sin espacios en los extremos. */
export function esTextoDeIdentificador(valor: string): boolean {
  return valor.length > 0 && valor === valor.trim();
}

function crear<Id extends string>(nombre: string, valor: string): Id {
  if (!esTextoDeIdentificador(valor)) {
    throw new RangeError(`${nombre} inválido`);
  }
  return valor as Id;
}

export const empresaId = (valor: string): EmpresaId => crear<EmpresaId>("EmpresaId", valor);
export const tenantId = (valor: string): TenantId => crear<TenantId>("TenantId", valor);
export const personaId = (valor: string): PersonaId => crear<PersonaId>("PersonaId", valor);
export type SucursalId = Marca<string, "SucursalId">;
export const sucursalId = (valor: string): SucursalId => crear<SucursalId>("SucursalId", valor);
