import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import {
  CATALOGO_DE_TEXTOS,
  LARGO_MAXIMO_DE_TEXTO,
  type ClaveDeTexto,
  type DefinicionDeTexto,
} from "./catalogo";
import { validarTextoVisible, type MotivoDeTextoInvalido } from "./texto-visible";

/**
 * Vocabulario de una marca (marcas y planes, §B.4): los reemplazos de la redacción, por clave de texto.
 * Es el dato GUARDADO: puede traer claves que el catálogo ya no tiene (huérfanas). El que se usa para
 * pintar es `DiccionarioResuelto`, que solo trae claves y textos válidos.
 */
export type Vocabulario = Readonly<Record<string, string>>;

/** Lo que se usa para pintar: claves del catálogo con un texto ya validado. Lo que falta, lo da el catálogo. */
export type DiccionarioResuelto = Readonly<Partial<Record<ClaveDeTexto, string>>>;

/** Un catálogo cualquiera de textos; el real es `CATALOGO_DE_TEXTOS`. Las pruebas pasan otros. */
export type CatalogoDeTextos = Readonly<Record<string, DefinicionDeTexto>>;

/**
 * El campo que nombra el texto se llama `texto`, nunca `clave`: la auditoría rechaza todo campo cuyo
 * nombre parezca un secreto (`exigirSinSecretos`) y `clave` lo parece (marcas y planes, §A.4 #2).
 */
export type ErrorDeVocabulario =
  | Readonly<{ codigo: "CLAVE_DE_TEXTO_DESCONOCIDA"; texto: string }>
  | Readonly<{ codigo: "TEXTO_INVALIDO"; texto: string; motivo: MotivoDeTextoInvalido }>
  | Readonly<{ codigo: "MARCADORES_DISTINTOS"; texto: string }>;

/** Un marcador es `{nombre}`: letra y alfanuméricos. Cualquier otra llave es texto común. */
const MARCADOR = /\{([A-Za-z][A-Za-z0-9]*)\}/g;

/** Los nombres distintos de los marcadores de un texto, sin llaves. */
export function marcadoresDe(texto: string): ReadonlySet<string> {
  return new Set([...texto.matchAll(MARCADOR)].map((coincidencia) => coincidencia[1] as string));
}

const mismosMarcadores = (a: ReadonlySet<string>, b: ReadonlySet<string>): boolean =>
  a.size === b.size && [...a].every((marcador) => b.has(marcador));

/**
 * Valida UN reemplazo contra la definición de su clave y lo devuelve en forma canónica: texto visible
 * válido de 1 al máximo de la clave (80 si no declara otro) y exactamente los mismos marcadores que el
 * texto por defecto (repetirlos o cambiarlos de lugar no importa; sumar o quitar uno, sí).
 */
function validarReemplazo(
  clave: string,
  definicion: DefinicionDeTexto,
  texto: string,
): Resultado<string, ErrorDeVocabulario> {
  const visible = validarTextoVisible(texto, definicion.largoMaximo ?? LARGO_MAXIMO_DE_TEXTO);
  if (!visible.ok) return err({ codigo: "TEXTO_INVALIDO", texto: clave, motivo: visible.error });
  if (!mismosMarcadores(marcadoresDe(visible.valor), new Set(definicion.marcadores ?? []))) {
    return err({ codigo: "MARCADORES_DISTINTOS", texto: clave });
  }
  return ok(visible.valor);
}

/** El primer error, en el orden en que vienen las claves; si no hay ninguno, el vocabulario canónico. */
export function validarVocabularioContra(
  catalogo: CatalogoDeTextos,
  vocabulario: Vocabulario,
): Resultado<Vocabulario, ErrorDeVocabulario> {
  const canonico: Record<string, string> = {};
  for (const [clave, texto] of Object.entries(vocabulario)) {
    if (!Object.hasOwn(catalogo, clave)) {
      return err({ codigo: "CLAVE_DE_TEXTO_DESCONOCIDA", texto: clave });
    }
    const reemplazo = validarReemplazo(clave, catalogo[clave] as DefinicionDeTexto, texto);
    if (!reemplazo.ok) return reemplazo;
    canonico[clave] = reemplazo.valor;
  }
  return ok(canonico);
}

/**
 * Validación al guardar el borrador (§B.4): la clave existe en el catálogo, el texto es válido y trae
 * los mismos marcadores que el texto por defecto. Devuelve los textos recortados y en NFC.
 */
export const validarVocabulario = (vocabulario: Vocabulario) =>
  validarVocabularioContra(CATALOGO_DE_TEXTOS, vocabulario);

/** Las claves guardadas que el catálogo ya no tiene (el código las quitó): se ignoran y se listan. */
export function clavesHuerfanas(vocabulario: Vocabulario): readonly string[] {
  return Object.keys(vocabulario).filter((clave) => !Object.hasOwn(CATALOGO_DE_TEXTOS, clave));
}

/**
 * Resolución con herencia (§B.4): la cadena viene de la marca hacia sus ancestros (`[marca, padre,
 * abuelo]`); para cada clave gana el primer eslabón que trae un reemplazo VÁLIDO. Una clave huérfana o
 * un reemplazo que ya no es válido (el código cambió los marcadores, el dato se dañó) se saltea y deja
 * pasar al eslabón siguiente y, al final, al texto por defecto: pintar nunca falla ni queda vacío.
 */
export function resolverVocabularioContra(
  catalogo: CatalogoDeTextos,
  cadena: readonly Vocabulario[],
): Readonly<Record<string, string>> {
  const resuelto: Record<string, string> = {};
  for (const vocabulario of cadena) {
    for (const [clave, texto] of Object.entries(vocabulario)) {
      if (Object.hasOwn(resuelto, clave) || !Object.hasOwn(catalogo, clave)) continue;
      const reemplazo = validarReemplazo(clave, catalogo[clave] as DefinicionDeTexto, texto);
      if (reemplazo.ok) resuelto[clave] = reemplazo.valor;
    }
  }
  return resuelto;
}

export const resolverVocabulario = (cadena: readonly Vocabulario[]): DiccionarioResuelto =>
  resolverVocabularioContra(CATALOGO_DE_TEXTOS, cadena);

type Valores = Readonly<Record<string, string | number>>;

/** Inserta los valores como texto, de una sola pasada: un valor que parece un marcador no se vuelve a expandir. */
function rellenar(plantilla: string, valores: Valores | undefined): string {
  return plantilla.replace(MARCADOR, (marcador: string, nombre: string) =>
    valores !== undefined && Object.hasOwn(valores, nombre) ? String(valores[nombre]) : marcador,
  );
}

/**
 * El texto de una clave para pintar (§B.4): el del diccionario de la marca y, si no hay, el por defecto
 * del catálogo, que es total por tipo. Los valores de los marcadores se insertan como TEXTO; un marcador
 * sin valor queda a la vista (`{limite}`) en vez de borrarse. Si el resultado quedara en blanco (un
 * reemplazo que es solo un marcador cuyo valor es vacío), responde con el texto por defecto: un nombre
 * accesible nunca queda vacío.
 */
export function textoContra(
  catalogo: CatalogoDeTextos,
  diccionario: Readonly<Record<string, string>>,
  clave: string,
  valores?: Valores,
): string {
  const porDefecto = rellenar((catalogo[clave] as DefinicionDeTexto).porDefecto, valores);
  if (!Object.hasOwn(diccionario, clave)) return porDefecto;
  const propio = rellenar(diccionario[clave] as string, valores);
  return propio.trim() === "" ? porDefecto : propio;
}

export const texto = (
  diccionario: DiccionarioResuelto,
  clave: ClaveDeTexto,
  valores?: Valores,
): string => textoContra(CATALOGO_DE_TEXTOS, diccionario, clave, valores);

/**
 * Un cambio de texto para la auditoría. Se audita como LISTA de pares y nunca como un objeto cuyos
 * nombres de campo sean las claves del diccionario (§A.4 #2).
 */
export type CambioDeTexto = Readonly<{
  texto: string;
  antes: string | null;
  despues: string | null;
}>;

/** Lo que cambió entre dos vocabularios guardados, ordenado por texto; vacío si son iguales. */
export function diferenciaDeVocabulario(
  antes: Vocabulario,
  despues: Vocabulario,
): readonly CambioDeTexto[] {
  const claves = [...new Set([...Object.keys(antes), ...Object.keys(despues)])].sort();
  return claves
    .map((clave) => ({
      texto: clave,
      antes: Object.hasOwn(antes, clave) ? (antes[clave] as string) : null,
      despues: Object.hasOwn(despues, clave) ? (despues[clave] as string) : null,
    }))
    .filter((cambio) => cambio.antes !== cambio.despues);
}
