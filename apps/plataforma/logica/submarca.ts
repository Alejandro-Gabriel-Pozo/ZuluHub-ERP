/**
 * Lógica pura de la pantalla «Submarca» (en el código, `marca`): listas cerradas con sus rótulos, el formulario
 * y el cálculo de qué cambió respecto del borrador guardado. Sin Next ni React.
 */

export const ESTILOS = [
  { valor: "CLARO_CON_BORDES", etiqueta: "Claro con bordes" },
  { valor: "MODERNO", etiqueta: "Moderno" },
  { valor: "CLASICO", etiqueta: "Clásico" },
  { valor: "LUDICO", etiqueta: "Lúdico" },
] as const;
export const SUPERFICIES = [
  { valor: "NEUTRA", etiqueta: "Neutra" },
  { valor: "CALIDA", etiqueta: "Cálida" },
  { valor: "FRIA", etiqueta: "Fría" },
] as const;
export const ESQUINAS = [
  { valor: "RECTA", etiqueta: "Rectas" },
  { valor: "SUAVE", etiqueta: "Suaves" },
  { valor: "REDONDEADA", etiqueta: "Redondeadas" },
] as const;
export const TITULOS = [
  { valor: "SANS", etiqueta: "Sin serifa" },
  { valor: "SERIF", etiqueta: "Con serifa" },
] as const;
export const INGRESOS = [
  { valor: "DIVIDIDO", etiqueta: "Dividido" },
  { valor: "CENTRADO", etiqueta: "Centrado" },
  { valor: "CON_IMAGEN", etiqueta: "Con imagen" },
] as const;

type Estilo = (typeof ESTILOS)[number]["valor"];
type Superficie = (typeof SUPERFICIES)[number]["valor"];
type Esquinas = (typeof ESQUINAS)[number]["valor"];
type Titulos = (typeof TITULOS)[number]["valor"];
type Ingreso = (typeof INGRESOS)[number]["valor"];

/** Cada color es `#rrggbb` en minúsculas, o "" si no está definido. */
export type ColoresDeSubmarca = Readonly<{
  primary: string;
  onPrimary: string;
  secondary: string;
  accent: string;
}>;

export type AspectoDeSubmarca = Readonly<{
  estilo: Estilo;
  superficie: Superficie;
  esquinas: Esquinas;
  titulos: Titulos;
  ingreso: Ingreso;
}>;

/**
 * De cuáles datos es dueño el borrador (`propio`) y cuáles los trae la herencia o el defecto. Guardar manda solo
 * los propios y los que la persona editó: si no, editar un color «congelaría» en la submarca lo que heredaba.
 */
export type PropiosDeSubmarca = Readonly<{
  colores: Readonly<Record<keyof ColoresDeSubmarca, boolean>>;
  aspecto: Readonly<Record<keyof AspectoDeSubmarca, boolean>>;
}>;

export type FormularioDeSubmarca = Readonly<{
  nombreVisible: string;
  colores: ColoresDeSubmarca;
  aspecto: AspectoDeSubmarca;
  propio: PropiosDeSubmarca;
}>;

export const SIN_PROPIOS: PropiosDeSubmarca = {
  colores: { primary: false, onPrimary: false, secondary: false, accent: false },
  aspecto: { estilo: false, superficie: false, esquinas: false, titulos: false, ingreso: false },
};

/** Lo que vale cuando nadie define el token (el mismo defecto del dominio de marcas). */
export const ASPECTO_POR_DEFECTO: AspectoDeSubmarca = {
  estilo: "CLARO_CON_BORDES",
  superficie: "NEUTRA",
  esquinas: "SUAVE",
  titulos: "SANS",
  ingreso: "CENTRADO",
};

export const esColorHex = (texto: string): boolean => /^#[0-9a-f]{6}$/.test(texto);

/** Hay algo escrito y, aun normalizado, no es un `#rrggbb`. Vacío (o solo espacios) no es «mal escrito»: es sin definir. */
export const esColorMalEscrito = (texto: string): boolean => {
  const normalizado = normalizarColor(texto);
  return normalizado !== "" && !esColorHex(normalizado);
};

/** Recorta, pasa a minúsculas y antepone `#` si faltaba. Si no queda válido, devuelve el texto recortado tal cual. */
export function normalizarColor(texto: string): string {
  const recortado = texto.trim();
  const candidato = (recortado.startsWith("#") ? recortado : `#${recortado}`).toLowerCase();
  return esColorHex(candidato) ? candidato : recortado;
}

export type CambiosDelBorrador = Readonly<{
  nombreVisible?: string;
  tema?: Readonly<Partial<Record<"primary" | "on-primary" | "secondary" | "accent", string>>>;
  aspecto?: Readonly<Partial<AspectoDeSubmarca>>;
}>;

const CLAVES_DE_ASPECTO = ["estilo", "superficie", "esquinas", "titulos", "ingreso"] as const;
const TOKENS_DE_COLOR = [
  ["primary", "primary"],
  ["onPrimary", "on-primary"],
  ["secondary", "secondary"],
  ["accent", "accent"],
] as const;

/**
 * Solo lo que cambió, y dentro del tema y del aspecto solo lo que el borrador ya tenía como propio más lo que la
 * persona editó: lo que se hereda o rige por defecto y nadie tocó NO se manda (seguiría la herencia). El backend
 * reemplaza el tema entero, así que un color propio que queda en blanco simplemente no se manda: equivale a no
 * definirlo en el borrador.
 */
export function cambiosDelBorrador(
  inicial: FormularioDeSubmarca,
  actual: FormularioDeSubmarca,
): CambiosDelBorrador {
  const cambios: {
    nombreVisible?: string;
    tema?: Partial<Record<"primary" | "on-primary" | "secondary" | "accent", string>>;
    aspecto?: { -readonly [K in keyof AspectoDeSubmarca]?: AspectoDeSubmarca[K] };
  } = {};
  if (actual.nombreVisible.trim() !== inicial.nombreVisible.trim()) {
    cambios.nombreVisible = actual.nombreVisible.trim();
  }
  const colorEditado = (clave: keyof ColoresDeSubmarca): boolean =>
    normalizarColor(actual.colores[clave]) !== normalizarColor(inicial.colores[clave]);
  if (TOKENS_DE_COLOR.some(([clave]) => colorEditado(clave))) {
    const tema: Partial<Record<"primary" | "on-primary" | "secondary" | "accent", string>> = {};
    for (const [clave, token] of TOKENS_DE_COLOR) {
      const valor = normalizarColor(actual.colores[clave]);
      if (valor !== "" && (inicial.propio.colores[clave] || colorEditado(clave))) {
        tema[token] = valor;
      }
    }
    cambios.tema = tema;
  }
  if (CLAVES_DE_ASPECTO.some((k) => actual.aspecto[k] !== inicial.aspecto[k])) {
    const aspecto: { -readonly [K in keyof AspectoDeSubmarca]?: AspectoDeSubmarca[K] } = {
      ...actual.aspecto,
    };
    for (const k of CLAVES_DE_ASPECTO) {
      if (!inicial.propio.aspecto[k] && actual.aspecto[k] === inicial.aspecto[k]) delete aspecto[k];
    }
    cambios.aspecto = aspecto;
  }
  return cambios;
}

export const hayCambios = (inicial: FormularioDeSubmarca, actual: FormularioDeSubmarca): boolean =>
  Object.keys(cambiosDelBorrador(inicial, actual)).length > 0;
