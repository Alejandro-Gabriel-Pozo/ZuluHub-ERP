import type { EmpresaId, MarcaComercialId, TenantId } from "../primitivas/identificadores/marca";
import type { Resultado } from "../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "./transacciones";

/**
 * Puertos de marcas (marcas y planes, §B.2 y §B.8). Tres, con dos conexiones distintas:
 *  - `ResolucionDeHost`: la puerta PÚBLICA (rol `zuluhub_publico`, sin sesión): a qué dueño y a qué marca
 *    pertenece un nombre de host.
 *  - `ConfiguracionPublicaDeHost`: la misma puerta pública: cómo se pinta la marca de un host (nombre,
 *    tema, aspecto y host canónico), sin ningún identificador interno.
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

/** Los cuatro colores permitidos (`TOKENS_DE_TEMA` de `modulos/marcas`; una prueba de tipos los iguala). */
export type TokenDeTemaPublico = "primary" | "on-primary" | "secondary" | "accent";

/** Los cinco tokens del aspecto con sus valores (`LISTAS_DE_ASPECTO` de `modulos/marcas`; una prueba de tipos los iguala). */
export type AspectoPublico = Readonly<{
  estilo: "CLARO_CON_BORDES" | "MODERNO" | "CLASICO" | "LUDICO";
  superficie: "NEUTRA" | "CALIDA" | "FRIA";
  esquinas: "RECTA" | "SUAVE" | "REDONDEADA";
  titulos: "SANS" | "SERIF";
  ingreso: "DIVIDIDO" | "CENTRADO" | "CON_IMAGEN";
}>;

/**
 * Lo único que la puerta pública pinta de una marca ANTES de que alguien inicie sesión (§B.2.3):
 *  - `nombre`: el nombre visible de la versión vigente de la propia marca;
 *  - `tema`: SOLO los tokens definidos, cada uno `#rrggbb` en minúsculas, ya validados y con la herencia
 *    de las marcas ancestras aplicada; los que falten los pone la puerta con sus colores neutros;
 *  - `aspecto`: los cinco datos de lista cerrada (estilo, superficie, esquinas, títulos, ingreso), SIEMPRE
 *    completos: la herencia de las ancestras ya aplicada y, donde nadie define, el defecto;
 *  - `hostCanonico`: el host canónico ACTIVO de la aplicación de la marca (normalizado, sin esquema ni
 *    puerto), o `null` si todavía no tiene.
 * Nada de ids (marca, empresa ni tenant), ni estados, ni versiones, ni quién lo cargó.
 */
export type ConfiguracionPublicaDeMarca = Readonly<{
  nombre: string;
  tema: Readonly<Partial<Record<TokenDeTemaPublico, string>>>;
  aspecto: AspectoPublico;
  hostCanonico: string | null;
}>;

export interface ConfiguracionPublicaDeHost {
  /**
   * La configuración pública de la marca de `host` en esa `superficie`, bajo EXACTAMENTE el mismo
   * criterio de `ResolucionDeHost.porHost` (dominio ACTIVO, marca ACTIVA con versión confirmada y
   * vigente). `ok(null)` es la respuesta NEUTRA y es la MISMA para todo lo que no se puede servir, sin
   * distinguir por qué (sin oráculo). Un error de la base vuelve como `err`, nunca disfrazado de neutral.
   * El host llega crudo y se normaliza acá. Sin caché: eso es de la puerta web (≤ 60 s, también el `null`).
   */
  porHost(
    host: string,
    superficie: SuperficieDeHost,
  ): Promise<Resultado<ConfiguracionPublicaDeMarca | null, ErrorDePersistencia>>;
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
