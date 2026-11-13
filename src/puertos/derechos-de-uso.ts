import type { ContextoDePlataforma, ContextoOperativo } from "../contexto/contexto";
import type { ClaveModulo } from "../capacidades/modulos/catalogo";
import type { DerechosDeUso } from "../capacidades/planes/derechos";
import type { ClavePerilla } from "../capacidades/planes/perillas";
import type { EmpresaId, TenantId } from "../primitivas/identificadores/marca";

/**
 * Puerto ÚNICO de lectura de derechos de uso (marcas y planes, §B.5.3, corrección 13): lo que una empresa
 * puede usar ahora, calculado con `derechosDeUso` a partir del plan vigente, los ajustes vigentes y los
 * catálogos. Se lee dentro de la transacción en curso (el adaptador está atado a su conexión, como la
 * carga de autorización): nada se guarda entre llamadas ni entre transacciones, así un cambio de plan
 * rige en la acción siguiente y una acción ve un plan o el otro, nunca una mezcla (§B.5.4).
 *
 * Los dos genéricos son los catálogos: por defecto, los reales; las pruebas pasan los suyos.
 */
export interface LecturaDeDerechosDeUso<
  M extends string = ClaveModulo,
  P extends string = ClavePerilla,
> {
  /**
   * Los derechos de la empresa del contexto (con `empresaId` y `tenantId` cargados), con el `ahora` del
   * contexto. El tenant y los ajustes salen de la base bajo la RLS de la aplicación: pedir los de una
   * empresa que no es la del contexto firmado lanza `RangeError` (no se ve; es un defecto, no un error
   * de negocio).
   */
  deLaEmpresa(contexto: ContextoOperativo): Promise<DerechosDeUso<M, P>>;
  /**
   * Los derechos del tenant (con `empresaId` nulo: solo ajustes de todo el tenant), para la plataforma.
   * `null` si la plataforma no ve el tenant (no existe): no se inventan derechos de un tenant inexistente.
   */
  delTenant(contexto: ContextoDePlataforma, tenant: TenantId): Promise<DerechosDeUso<M, P> | null>;
  /**
   * Los derechos de UNA empresa vistos desde la plataforma (M5): los del tenant más los ajustes de esa
   * empresa. Es lo que ve la consulta `derechosDeUsoDeEmpresa` y lo que mira `ajustarPerilla` antes de
   * ajustar una perilla de empresa; el mismo cálculo (`derechosDeUso`) que ve la propia empresa. `null` si
   * la plataforma no ve la empresa (no existe).
   */
  deLaEmpresaParaLaPlataforma(
    contexto: ContextoDePlataforma,
    empresa: EmpresaId,
  ): Promise<DerechosDeUso<M, P> | null>;
}
