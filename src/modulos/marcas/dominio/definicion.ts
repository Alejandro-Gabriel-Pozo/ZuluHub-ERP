import type { DefinicionDeModulo } from "../../../capacidades/modulos/catalogo";
import {
  resolverVocabulario,
  type DiccionarioResuelto,
  type Vocabulario,
} from "../../../capacidades/vocabulario/vocabulario";
import { validarTextoVisible } from "../../../capacidades/vocabulario/texto-visible";
import type { PlanId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { TOKENS_DE_ASPECTO, completarAspecto, type Aspecto, type AspectoCompleto } from "./aspecto";
import { TOKENS_DE_TEMA, type Tema, type TemaCompleto } from "./tema";

/**
 * Definición de producto (marcas y planes, §B.3): lo que UNA versión de marca dice por sí misma. Un
 * campo sin definir (`null`, o `{}` en el tema y el vocabulario) hereda de la marca padre. `[]` en los
 * módulos iniciales NO es «sin definir»: es «solo administración».
 */
export type DefinicionDeMarca = Readonly<{
  nombreVisible: string | null;
  tema: Tema;
  /** Cinco datos de lista cerrada (`aspecto.ts`); `{}` = sin definir, hereda token por token. */
  aspecto: Aspecto;
  logo: string | null;
  vocabulario: Vocabulario;
  modulosIniciales: readonly string[] | null;
  planPorDefectoId: PlanId | null;
}>;

/** Una definición sin nada definido: el punto de partida de un borrador nuevo. */
export const DEFINICION_VACIA: DefinicionDeMarca = {
  nombreVisible: null,
  tema: {},
  aspecto: {},
  logo: null,
  vocabulario: {},
  modulosIniciales: null,
  planPorDefectoId: null,
};

/** La definición con la herencia aplicada: lo que un campo no define lo trae el primer ancestro que sí. */
export type DefinicionResuelta = Readonly<{
  nombreVisible: string | null;
  tema: Tema;
  /** Solo los tokens que algún eslabón define: los defectos se aplican al completar. */
  aspecto: Aspecto;
  logo: string | null;
  vocabulario: DiccionarioResuelto;
  modulosIniciales: readonly string[] | null;
  planPorDefectoId: PlanId | null;
}>;

/** Una definición resuelta sin huecos: lo que hace falta para confirmar una versión. */
export type DefinicionCompleta = Readonly<{
  nombreVisible: string;
  tema: TemaCompleto;
  /** Con los defectos aplicados: un aspecto siempre está completo. */
  aspecto: AspectoCompleto;
  logo: string;
  vocabulario: DiccionarioResuelto;
  modulosIniciales: readonly string[];
  planPorDefectoId: PlanId;
}>;

const primero = <T>(valores: readonly (T | null | undefined)[]): T | null =>
  valores.find((valor): valor is T => valor !== null && valor !== undefined) ?? null;

/**
 * La herencia (§B.3) como función pura sobre la cadena `[marca, padre, abuelo]` (a lo sumo tres
 * eslabones; la marca siempre primero). Un eslabón `null` es una marca sin versión vigente: no aporta
 * nada. Cada campo sale del primer eslabón que lo define; el tema y el aspecto, token por token; el
 * vocabulario, clave por clave (con el respaldo del catálogo al pintar). No inventa ni pierde: lo que ningún
 * eslabón define queda sin definir.
 */
export function resolverDefinicion(
  cadena: readonly (DefinicionDeMarca | null)[],
): DefinicionResuelta {
  const eslabones = cadena.filter((e): e is DefinicionDeMarca => e !== null);
  const tema: Partial<Record<(typeof TOKENS_DE_TEMA)[number], string>> = {};
  for (const token of TOKENS_DE_TEMA) {
    const color = primero(eslabones.map((e) => e.tema[token]));
    if (color !== null) tema[token] = color;
  }
  const aspecto: Partial<Record<(typeof TOKENS_DE_ASPECTO)[number], string>> = {};
  for (const token of TOKENS_DE_ASPECTO) {
    const valor = primero(eslabones.map((e) => e.aspecto[token]));
    if (valor !== null) aspecto[token] = valor;
  }
  return {
    nombreVisible: primero(eslabones.map((e) => e.nombreVisible)),
    tema,
    aspecto: aspecto as Aspecto,
    logo: primero(eslabones.map((e) => e.logo)),
    vocabulario: resolverVocabulario(eslabones.map((e) => e.vocabulario)),
    modulosIniciales: primero(eslabones.map((e) => e.modulosIniciales)),
    planPorDefectoId: primero(eslabones.map((e) => e.planPorDefectoId)),
  };
}

/** Lo que le falta a una definición para estar completa. */
export type CampoFaltante =
  | "nombre_visible"
  | `tema.${(typeof TOKENS_DE_TEMA)[number]}`
  | "logo"
  | "modulos_iniciales"
  | "plan_por_defecto";

/**
 * Los huecos de una definición al confirmar (§B.3): la RESUELTA tiene que estar completa, pero el
 * nombre visible lo define cada marca por sí misma (un producto que hereda el nombre se vería igual a
 * su padre). Para la principal, sin ancestros, «resuelta» y «propia» coinciden: define todo. El aspecto no
 * tiene huecos (lo que nadie define toma el defecto). Sin huecos, devuelve la definición completa.
 */
export function completarDefinicion(
  propia: DefinicionDeMarca,
  resuelta: DefinicionResuelta,
): Resultado<DefinicionCompleta, readonly CampoFaltante[]> {
  const faltan: CampoFaltante[] = [];
  if (propia.nombreVisible === null) faltan.push("nombre_visible");
  for (const token of TOKENS_DE_TEMA) {
    if (resuelta.tema[token] === undefined) faltan.push(`tema.${token}`);
  }
  if (resuelta.logo === null) faltan.push("logo");
  if (resuelta.modulosIniciales === null) faltan.push("modulos_iniciales");
  if (resuelta.planPorDefectoId === null) faltan.push("plan_por_defecto");
  if (faltan.length > 0) return err(faltan);
  return ok({
    nombreVisible: propia.nombreVisible as string,
    tema: resuelta.tema as TemaCompleto,
    aspecto: completarAspecto(resuelta.aspecto),
    logo: resuelta.logo as string,
    vocabulario: resuelta.vocabulario,
    modulosIniciales: resuelta.modulosIniciales as readonly string[],
    planPorDefectoId: resuelta.planPorDefectoId as PlanId,
  });
}

// --- Validación de cada campo al guardar el borrador -------------------------------------------------

const LARGO_MAXIMO_DEL_NOMBRE = 60;

/** Nombre visible: texto visible de 1 a 60 caracteres (NFC, sin control ni formato ni `<` `>`). */
export function validarNombreVisible(
  nombre: string,
): Resultado<string, "NOMBRE_DE_MARCA_INVALIDO"> {
  const visible = validarTextoVisible(nombre, LARGO_MAXIMO_DEL_NOMBRE);
  return visible.ok ? visible : err("NOMBRE_DE_MARCA_INVALIDO");
}

/**
 * Logo: una ruta a un archivo propio del despliegue, PNG o WebP. Sin SVG (puede llevar scripts), sin
 * URL externa, sin `..`: las etiquetas son `[a-z0-9-]`.
 */
const RUTA_DE_LOGO = /^\/marcas\/[a-z0-9-]+\/[a-z0-9-]+\.(png|webp)$/;

export const validarLogo = (logo: string): Resultado<string, "LOGO_INVALIDO"> =>
  RUTA_DE_LOGO.test(logo) ? ok(logo) : err("LOGO_INVALIDO");

export type ErrorDeModuloInicial = Readonly<{ codigo: "MODULO_DESCONOCIDO"; modulo: string }>;

/**
 * Módulos iniciales: claves del catálogo, DISPONIBLES (no en desarrollo) y NO obligatorias (los
 * obligatorios están siempre). Cualquier otra clave es `MODULO_DESCONOCIDO` con su nombre. Sin
 * repetidos: queda la primera aparición, en el orden dado. `[]` es válido (solo administración).
 */
export function validarModulosIniciales(
  catalogo: Readonly<Record<string, Pick<DefinicionDeModulo, "estado" | "obligatorio">>>,
  claves: readonly string[],
): Resultado<readonly string[], ErrorDeModuloInicial> {
  for (const modulo of claves) {
    const definicion = Object.hasOwn(catalogo, modulo) ? catalogo[modulo] : undefined;
    if (definicion === undefined || definicion.estado !== "disponible" || definicion.obligatorio) {
      return err({ codigo: "MODULO_DESCONOCIDO", modulo });
    }
  }
  return ok([...new Set(claves)]);
}
