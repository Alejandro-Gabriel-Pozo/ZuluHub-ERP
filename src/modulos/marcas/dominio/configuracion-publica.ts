import { completarAspecto, validarAspecto, type Aspecto, type AspectoCompleto } from "./aspecto";
import { DEFINICION_VACIA, resolverDefinicion, validarNombreVisible } from "./definicion";
import type { MarcaComercialId } from "../../../primitivas/identificadores/marca";
import type { Host } from "./host";
import { validarTema, type Tema } from "./tema";
import { versionVigente } from "./vigencia";

/**
 * Configuración pública de una marca (marcas y planes, §B.2.3 y §B.2.5): lo único que la puerta pinta
 * de ella ANTES de que alguien inicie sesión. Dominio puro: decide con lo que el adaptador leyó con el
 * rol público, sin tocar datos, entorno ni reloj (la hora entra como dato).
 *
 * Reglas, todas pensadas para que una marca nunca se vea con la identidad de otra:
 *  - El nombre es el de la versión vigente de la PROPIA marca. No hereda: un producto define su nombre
 *    (como pide la confirmación) y, sin uno que se pueda mostrar, no se puede nombrar y no se sirve.
 *  - El tema hereda token por token por la cadena `[marca, padre, abuelo]` (la misma `resolverDefinicion`
 *    de la confirmación: una sola definición de la herencia). Pero si ALGÚN eslabón trae un tema que no
 *    es válido (clave fuera de la lista cerrada, valor que no es `#rrggbb`, o algo que no es un objeto),
 *    el tema es el NEUTRO (vacío, un objeto nuevo en cada llamada): lo que falta lo pintan los colores neutros de la puerta, nunca los de
 *    otra marca ni un valor sin validar. La base ya lo impide (`tema_valido`); esto es la segunda barrera.
 *  - El aspecto (cinco datos de lista cerrada, `aspecto.ts`) hereda igual, token por token y por la misma
 *    `resolverDefinicion`, y sale SIEMPRE completo: lo que ningún eslabón define toma el defecto. Si ALGÚN
 *    eslabón trae un aspecto inválido, es el aspecto por defecto entero (el neutro): nunca un valor sin
 *    validar. La base ya lo impide (`aspecto_valido`); esto es la segunda barrera. Es independiente del
 *    tema: un aspecto inválido no toca los colores ni al revés.
 *  - El host canónico lo lee el adaptador (el host canónico ACTIVO de la aplicación de la propia marca) y
 *    pasa tal cual: sin él, `null`.
 *  - El `marcaId` es el de la marca que resolvió el host (la PRIMERA de la cadena), nunca el de un padre
 *    ni el de un abuelo: el adaptador lo lee con el host y pasa tal cual. Lo usa la puerta web para
 *    descartar la configuración si no coincide con la marca que resolvió el host en la lectura anterior
 *    (el dominio pudo reasignarse entre las dos lecturas).
 */

/** Lo que el rol público lee de una versión de marca (la base solo le muestra las confirmadas y empezadas). */
export type VersionPublicaDeMarca = Readonly<{
  numero: number;
  vigenteDesde: Date;
  nombreVisible: string | null;
  /** El `jsonb` tal como salió de la base: no se confía en su forma hasta validarlo. */
  tema: unknown;
  /** Ídem: el `jsonb` del aspecto, sin confiar en su forma. */
  aspecto: unknown;
}>;

export type ConfiguracionPublica = Readonly<{
  /** La marca de este host (no la de un ancestro de la cadena). */
  marcaId: MarcaComercialId;
  nombre: string;
  tema: Tema;
  /** Los cinco tokens, con la herencia y los defectos aplicados. */
  aspecto: AspectoCompleto;
  hostCanonico: Host | null;
}>;

export type DatosParaLaConfiguracionPublica = Readonly<{
  /** La marca que resolvió el host: la dueña de la primera posición de `cadena`. */
  marcaId: MarcaComercialId;
  /** Las versiones visibles de cada marca de la cadena: la marca primero, después su padre y su abuelo. */
  cadena: readonly (readonly VersionPublicaDeMarca[])[];
  hostCanonico: Host | null;
  ahora: Date;
}>;

/** El tema de la base si es un objeto con solo claves y colores permitidos; si no, `null`. */
function temaValido(valor: unknown): Tema | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return null;
  const tema = validarTema(valor as Readonly<Record<string, unknown>>);
  return tema.ok ? tema.valor : null;
}

/** La herencia del tema por la cadena, o el neutro si algún eslabón trae uno inválido. */
function temaDeLaCadena(vigentes: readonly (VersionPublicaDeMarca | null)[]): Tema {
  const leidos = vigentes
    .filter((version) => version !== null)
    .map((version) => temaValido(version.tema));
  const validos = leidos.filter((tema) => tema !== null);
  if (validos.length < leidos.length) return {};
  return resolverDefinicion(validos.map((tema) => ({ ...DEFINICION_VACIA, tema }))).tema;
}

/** El aspecto de la base si es un objeto con solo claves y valores de las listas cerradas; si no, `null`. */
function aspectoValido(valor: unknown): Aspecto | null {
  if (typeof valor !== "object" || valor === null || Array.isArray(valor)) return null;
  const aspecto = validarAspecto(valor as Readonly<Record<string, unknown>>);
  return aspecto.ok ? aspecto.valor : null;
}

/** La herencia del aspecto por la cadena, o el defecto si algún eslabón trae uno inválido. */
function aspectoDeLaCadena(vigentes: readonly (VersionPublicaDeMarca | null)[]): AspectoCompleto {
  const leidos = vigentes
    .filter((version) => version !== null)
    .map((version) => aspectoValido(version.aspecto));
  const validos = leidos.filter((aspecto) => aspecto !== null);
  if (validos.length < leidos.length) return completarAspecto({});
  return completarAspecto(
    resolverDefinicion(validos.map((aspecto) => ({ ...DEFINICION_VACIA, aspecto }))).aspecto,
  );
}

/**
 * La configuración pública de la marca a `ahora`, o `null` si no se puede servir: la propia marca no
 * tiene versión vigente, o su vigente no trae un nombre que se pueda mostrar (la puerta responde la
 * página neutra, igual que para un host desconocido).
 */
export function decidirConfiguracionPublica(
  datos: DatosParaLaConfiguracionPublica,
): ConfiguracionPublica | null {
  const vigentes = datos.cadena.map((versiones) => versionVigente(versiones, datos.ahora));
  const propia = vigentes[0] ?? null;
  if (propia === null || propia.nombreVisible === null) return null;
  const nombre = validarNombreVisible(propia.nombreVisible);
  if (!nombre.ok) return null;
  return {
    marcaId: datos.marcaId,
    nombre: nombre.valor,
    tema: temaDeLaCadena(vigentes),
    aspecto: aspectoDeLaCadena(vigentes),
    hostCanonico: datos.hostCanonico,
  };
}
