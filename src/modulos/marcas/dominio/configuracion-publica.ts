import { DEFINICION_VACIA, resolverDefinicion, validarNombreVisible } from "./definicion";
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
 *  - El host canónico lo lee el adaptador (el host canónico ACTIVO de la aplicación de la propia marca) y
 *    pasa tal cual: sin él, `null`.
 */

/** Lo que el rol público lee de una versión de marca (la base solo le muestra las confirmadas y empezadas). */
export type VersionPublicaDeMarca = Readonly<{
  numero: number;
  vigenteDesde: Date;
  nombreVisible: string | null;
  /** El `jsonb` tal como salió de la base: no se confía en su forma hasta validarlo. */
  tema: unknown;
}>;

export type ConfiguracionPublica = Readonly<{
  nombre: string;
  tema: Tema;
  hostCanonico: Host | null;
}>;

export type DatosParaLaConfiguracionPublica = Readonly<{
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
  return { nombre: nombre.valor, tema: temaDeLaCadena(vigentes), hostCanonico: datos.hostCanonico };
}
