import type { EmpresaId, MarcaComercialId, TenantId } from "../primitivas/identificadores/marca";
import type { Resultado } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "./transacciones";

/**
 * Puertos de marcas (marcas y planes, §B.2 y §B.8). Dos, con dos conexiones distintas:
 *  - `ResolucionDeHost`: la puerta PÚBLICA (rol `zuluhub_publico`, sin sesión): a qué dueño y a qué marca
 *    pertenece un nombre de host.
 *  - `MarcasDeMail`: desde qué marca sale un mail; lo lee la aplicación (rol `zuluhub_app`), dentro de la
 *    transacción de su caso de uso.
 */

/** Qué se sirve en un host. La misma lista que `SUPERFICIES_DE_DOMINIO` (una prueba de tipos las iguala). */
export type SuperficieDeHost = "APP" | "CARTA" | "LANDING" | "CONSOLA";

/**
 * Lo único que la puerta pública sabe de un host servible: el host, qué superficie sirve, de quién es
 * (una marca, o una empresa si es un host dedicado) y por la puerta de qué marca se entra. Nada de
 * titular, motivo ni quién lo registró; nada de la empresa ni del tenant.
 */
export type HostResuelto = Readonly<{
  host: string;
  superficie: SuperficieDeHost;
  duenio:
    | Readonly<{ tipo: "MARCA"; marcaId: MarcaComercialId }>
    | Readonly<{ tipo: "EMPRESA"; empresaId: EmpresaId }>;
  marcaId: MarcaComercialId;
}>;

export interface ResolucionDeHost {
  /**
   * Resuelve `host` para la `superficie` que lo sirve. `ok(null)` es la respuesta NEUTRA y es la MISMA
   * para todo lo que no se puede servir, sin distinguir por qué (§B.2.1, sin oráculo): host que no
   * normaliza o desconocido, retirado o todavía sin verificar o activar, de otra superficie, de una
   * marca retirada o de una marca sin versión confirmada y vigente. Un error de la base NO se disfraza
   * de neutral: vuelve como `err` y quien llama decide (503, nunca la marca principal).
   *
   * El host llega como texto crudo (tal como lo manda el servidor web): se normaliza acá, así nadie lo
   * puede olvidar. Nunca devuelve la marca principal por omisión.
   */
  porHost(
    host: string,
    superficie: SuperficieDeHost,
  ): Promise<Resultado<HostResuelto | null, ErrorDePersistencia>>;
}

/** Desde qué marca sale un mail: el nombre que aparece en él y el origen (sin barra final) de sus enlaces. */
export type MarcaDeMailResuelta = Readonly<{ nombre: string; urlBase: string }>;

export interface MarcasDeMail {
  /**
   * La marca desde la que sale un mail del tenant: el nombre visible de la versión vigente de SU marca y
   * el host canónico de su aplicación. Solo la marca principal, mientras no tenga versión vigente y
   * host canónico, cae en el respaldo de las variables de entorno. `null`: la marca del tenant no se
   * puede nombrar (un producto sin versión vigente o sin host canónico): quien manda el mail NO lo manda
   * con la identidad de otra marca. Dentro de la transacción en curso; no se guarda nada entre llamadas.
   */
  delTenant(tenantId: TenantId, ahora: Date): Promise<MarcaDeMailResuelta | null>;
}
