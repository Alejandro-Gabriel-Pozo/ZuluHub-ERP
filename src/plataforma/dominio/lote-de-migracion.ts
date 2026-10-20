import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import { uuidDesdeTexto } from "./soporte/consulta";

/**
 * El lote de la migración de tenants a otra versión de plan (marcas y planes, §B.5.7, N2): lo puro de
 * armar el lote y la clave de idempotencia de cada tenant. Dominio puro: sin reloj, sin azar, sin base.
 *
 * Cada tenant del lote es UNA transacción con su propia clave `lote_<claveDeLote>_<tenantId>`: repetir el
 * lote con la misma clave rehace solo lo que falló y no duplica nada, porque lo que ya salió bien
 * encuentra su clave guardada.
 */

/** Cuántos tenants admite un lote (§B.11). */
export const LIMITE_DE_TENANTS_POR_LOTE = 200;

/**
 * La clave del lote: letras, dígitos y guion, de 1 a 64. Sin `_` a propósito: es el separador de la clave
 * de cada tenant, así dos lotes distintos nunca arman la misma clave. Con el prefijo, el separador y el
 * tenant (uuid de 36), el total es de 43 a 106 caracteres: siempre dentro de 16 a 128, que es lo que
 * acepta `idempotencia_plataforma_clave_ck` (una prueba de integración la inserta en la tabla real).
 */
const CLAVE_DE_LOTE = /^[A-Za-z0-9-]{1,64}$/;

/** Un tenant del lote tal como llega: el `numeroEsperado` es el de la última asignación que vio quien migra. */
export type TenantDelLoteAMigrar = Readonly<{ tenantId: string; numeroEsperado: number | null }>;

export type ErrorDeLote =
  | "CLAVE_DE_LOTE_INVALIDA"
  | "LOTE_VACIO"
  | "LOTE_DEMASIADO_GRANDE"
  | "ID_INVALIDO"
  | "TENANT_REPETIDO_EN_EL_LOTE";

/**
 * Valida el lote y devuelve a los tenants con el id normalizado (uuid en minúsculas), en el orden dado.
 * El primer problema, en este orden: la clave del lote, que no esté vacío, que no pase de
 * `LIMITE_DE_TENANTS_POR_LOTE`, que cada id sea un uuid y que ningún tenant figure dos veces (dos
 * renglones del mismo tenant armarían la misma clave con otro `numeroEsperado`).
 */
export function validarLote(
  claveDeLote: string,
  tenants: readonly TenantDelLoteAMigrar[],
): Resultado<readonly TenantDelLoteAMigrar[], ErrorDeLote> {
  if (!CLAVE_DE_LOTE.test(claveDeLote)) return err("CLAVE_DE_LOTE_INVALIDA");
  if (tenants.length < 1) return err("LOTE_VACIO");
  if (tenants.length > LIMITE_DE_TENANTS_POR_LOTE) return err("LOTE_DEMASIADO_GRANDE");
  const normalizados: TenantDelLoteAMigrar[] = [];
  const vistos = new Set<string>();
  for (const tenant of tenants) {
    const id = uuidDesdeTexto(tenant.tenantId);
    if (!id.ok) return id;
    if (vistos.has(id.valor)) return err("TENANT_REPETIDO_EN_EL_LOTE");
    vistos.add(id.valor);
    normalizados.push({ tenantId: id.valor, numeroEsperado: tenant.numeroEsperado });
  }
  return ok(normalizados);
}

/** La clave de idempotencia de UN tenant del lote: `lote_<claveDeLote>_<tenantId>`. */
export function claveDeIdempotenciaDelTenantDelLote(claveDeLote: string, tenantId: string): string {
  return `lote_${claveDeLote}_${tenantId}`;
}
