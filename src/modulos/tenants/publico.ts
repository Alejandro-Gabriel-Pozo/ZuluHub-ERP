/** Entrada pública del módulo de tenants (ADR-001). */
export {
  nombreDeTenantValido,
  reactivar,
  suspender,
  type CambioDeEstadoDeTenant,
  type ErrorDeTenant,
  type Tenant,
} from "./dominio/tenant";
export {
  COLUMNAS_DE_TENANT,
  ERRORES_DE_TENANT_POR_RESTRICCION,
  crearRepositorioDeTenants,
  type ErrorDeRepositorioDeTenants,
  type RepositorioDeTenants,
  type TenantsDb,
} from "./persistencia/repositorio-tenants";
