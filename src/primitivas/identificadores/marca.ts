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
export type InvitacionId = Marca<string, "InvitacionId">;
export const invitacionId = (valor: string): InvitacionId =>
  crear<InvitacionId>("InvitacionId", valor);
/** Traspaso de gerencia (H6): la propuesta de pasar la gerencia a otro miembro. */
export type TraspasoId = Marca<string, "TraspasoId">;
export const traspasoId = (valor: string): TraspasoId => crear<TraspasoId>("TraspasoId", valor);
/** Administrador de plataforma: identidad propia, distinta de `Persona` (diseno-inicial §5). */
export type AdminPlataformaId = Marca<string, "AdminPlataformaId">;
export const adminPlataformaId = (valor: string): AdminPlataformaId =>
  crear<AdminPlataformaId>("AdminPlataformaId", valor);
/**
 * Marca comercial (puerta de entrada y nombre comercial: la principal o un producto). No es el tipo
 * `Marca<T, Nombre>` de arriba: ese marca identificadores; esta es una entidad de negocio (marcas y
 * planes, §A.4 #1).
 */
export type MarcaComercialId = Marca<string, "MarcaComercialId">;
export const marcaComercialId = (valor: string): MarcaComercialId =>
  crear<MarcaComercialId>("MarcaComercialId", valor);
/** Dominio de marca: un nombre de host por el que se entra a una marca. */
export type DominioId = Marca<string, "DominioId">;
export const dominioId = (valor: string): DominioId => crear<DominioId>("DominioId", valor);
export type PlanId = Marca<string, "PlanId">;
export const planId = (valor: string): PlanId => crear<PlanId>("PlanId", valor);
/** Una versión congelada de un plan (la que se asigna a un tenant). */
export type VersionDePlanId = Marca<string, "VersionDePlanId">;
export const versionDePlanId = (valor: string): VersionDePlanId =>
  crear<VersionDePlanId>("VersionDePlanId", valor);
/** Un uuid canónico (minúsculas): la base lo compara como `uuid` y los claims firmados lo llevan como texto. */
const UUID_CANONICO = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const esUuidCanonico = (valor: string): boolean => UUID_CANONICO.test(valor);
/**
 * Usuario autenticado: el `user.id` de la librería de autenticación (`generateId: "uuid"`). Es una
 * identidad DISTINTA de `Persona`: la persona pertenece al negocio y el usuario al ingreso; el vínculo
 * se fija al aceptar una invitación (web-armazon §4.6). Por eso es uuid canónico en minúsculas, la forma
 * que firma el contexto (claim `s`) y que compara la base: otro texto no se deja crear.
 */
export type UsuarioAuthId = Marca<string, "UsuarioAuthId">;
export const usuarioAuthId = (valor: string): UsuarioAuthId => {
  if (!esUuidCanonico(valor)) throw new RangeError("UsuarioAuthId inválido");
  return valor as UsuarioAuthId;
};
