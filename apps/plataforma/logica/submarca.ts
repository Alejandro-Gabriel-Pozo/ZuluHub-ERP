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

export type FormularioDeSubmarca = Readonly<{
  nombreVisible: string;
  colores: ColoresDeSubmarca;
  aspecto: AspectoDeSubmarca;
}>;

/** Lo que vale cuando nadie define el token (el mismo defecto del dominio de marcas). */
export const ASPECTO_POR_DEFECTO: AspectoDeSubmarca = {
  estilo: "CLARO_CON_BORDES",
  superficie: "NEUTRA",
  esquinas: "SUAVE",
  titulos: "SANS",
  ingreso: "CENTRADO",
};

export const esColorHex = (texto: string): boolean => /^#[0-9a-f]{6}$/.test(texto);

/** Recorta, pasa a minúsculas y antepone `#` si faltaba. Si no queda válido, devuelve el texto recortado tal cual. */
export function normalizarColor(texto: string): string {
  const recortado = texto.trim();
  const candidato = (recortado.startsWith("#") ? recortado : `#${recortado}`).toLowerCase();
  return esColorHex(candidato) ? candidato : recortado;
}

export type CambiosDelBorrador = Readonly<{
  nombreVisible?: string;
  tema?: Readonly<Record<"primary" | "on-primary" | "secondary" | "accent", string>>;
  aspecto?: AspectoDeSubmarca;
}>;

const CLAVES_DE_ASPECTO = ["estilo", "superficie", "esquinas", "titulos", "ingreso"] as const;

function coloresDe(c: ColoresDeSubmarca): readonly string[] {
  return [c.primary, c.onPrimary, c.secondary, c.accent].map(normalizarColor);
}

/**
 * Solo lo que cambió. El tema y el aspecto van COMPLETOS si cambió cualquiera de sus partes. El backend
 * reemplaza el tema entero: un color vacío en `actual` NO se manda (se manda solo lo definido), así que
 * dejar un color en blanco equivale a no definirlo en el borrador.
 */
export function cambiosDelBorrador(
  inicial: FormularioDeSubmarca,
  actual: FormularioDeSubmarca,
): CambiosDelBorrador {
  const cambios: {
    nombreVisible?: string;
    tema?: Record<"primary" | "on-primary" | "secondary" | "accent", string>;
    aspecto?: AspectoDeSubmarca;
  } = {};
  if (actual.nombreVisible.trim() !== inicial.nombreVisible.trim()) {
    cambios.nombreVisible = actual.nombreVisible.trim();
  }
  const antes = coloresDe(inicial.colores);
  const ahora = coloresDe(actual.colores);
  if (ahora.some((c, i) => c !== antes[i])) {
    const tema: Partial<Record<"primary" | "on-primary" | "secondary" | "accent", string>> = {};
    const [primary, onPrimary, secondary, accent] = ahora;
    if (primary) tema.primary = primary;
    if (onPrimary) tema["on-primary"] = onPrimary;
    if (secondary) tema.secondary = secondary;
    if (accent) tema.accent = accent;
    cambios.tema = tema as Record<"primary" | "on-primary" | "secondary" | "accent", string>;
  }
  if (CLAVES_DE_ASPECTO.some((k) => actual.aspecto[k] !== inicial.aspecto[k])) {
    cambios.aspecto = { ...actual.aspecto };
  }
  return cambios;
}

export const hayCambios = (inicial: FormularioDeSubmarca, actual: FormularioDeSubmarca): boolean =>
  Object.keys(cambiosDelBorrador(inicial, actual)).length > 0;
