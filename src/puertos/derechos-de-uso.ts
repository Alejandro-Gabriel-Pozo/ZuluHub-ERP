import type { ContextoDePlataforma, ContextoOperativo } from "../contexto/contexto";
import type { ClaveModulo } from "../capacidades/modulos/catalogo";
import type { DerechosDeUso } from "../capacidades/planes/derechos";
import type { ClavePerilla } from "../capacidades/planes/perillas";
import type { ValorEfectivo } from "../capacidades/planes/valores";
import type { EmpresaId, MarcaComercialId, TenantId } from "../primitivas/identificadores/marca";

/**
 * Lo que la puerta pública de la carta por QR puede saber de una carta (marcas y planes, §B.2.5): solo
 * si el módulo de la carta está activo para la empresa dueña del enlace y el valor de `vidriera_por_qr`.
 * Nada del plan, de los ajustes ni de sus motivos llega a la respuesta pública.
 */
export type DerechosDeVidrieraPublica = Readonly<{
  moduloVidriera: "ACTIVO" | "SOLO_LECTURA" | "NO_ACTIVO";
  vidrieraPorQr: ValorEfectivo;
}>;

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
  /**
   * Derechos SIN sesión, para la carta por QR pública. FALLA CERRADO: devuelve siempre `null` («carta no
   * disponible», la misma respuesta que para un código inexistente) hasta que exista el módulo de
   * catálogo con el enlace de carta, porque este método tiene que leer los derechos «alcanzables desde el
   * enlace `EN_LINEA` con ese código exacto» (§B.2.5) y ese enlace es de catálogo (migración 0009). Sin
   * él no hay forma de acotar la lectura a una sola empresa, así que no se lee nada. Queda por construir y
   * probar: aislamiento entre empresas, enumeración de códigos y baja de plan.
   *
   * Recibe la MARCA por cuya puerta (host) llega el enlace, además del código: cuando se implemente, un
   * código de una empresa cuyo tenant es de otra marca responde lo mismo que un código inexistente
   * (`null`, sin distinguir), como en el resto de las puertas (marcas y planes, §B.2.4). Está en la
   * firma desde ahora para que nadie tenga que cambiarla (y a todos sus llamadores) después.
   */
  deLaVidrieraPublica(
    marcaId: MarcaComercialId,
    codigo: string,
  ): Promise<DerechosDeVidrieraPublica | null>;
}
