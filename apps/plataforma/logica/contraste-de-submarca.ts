/**
 * Contraste de los colores de una submarca contra la superficie elegida (WCAG 2.x). Espeja la fórmula del
 * dominio de marcas, pero sin importarlo: la prueba compara las dos. Los mínimos y los colores de las
 * superficies llegan del catálogo del backend (`catalogosDeMarca`).
 */
import { normalizarColor, SUPERFICIES, type ColoresDeSubmarca } from "./submarca";

export type CatalogoDeContraste = Readonly<{
  superficies: readonly { valor: string; fondo: string; superficie: string }[];
  pares: readonly { par: string; minimo: number }[];
}>;

export type ResultadoDeContraste = Readonly<{
  par: "on-primary/primary" | "accent/fondo" | "accent/superficie";
  razon: number | null;
  minimo: number;
  cumple: boolean | null;
  texto: string | null;
}>;

function luminancia(color: string): number {
  const canal = (desde: number): number => {
    const c = Number.parseInt(color.slice(desde, desde + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}

/** Razón de contraste WCAG entre dos `#rrggbb`, de 1 a 21, sin redondear. */
export function razonDeContraste(a: string, b: string): number {
  const la = luminancia(a);
  const lb = luminancia(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const HEX = /^#[0-9a-f]{6}$/;
const MINIMO_POR_DEFECTO: Readonly<Record<ResultadoDeContraste["par"], number>> = {
  "on-primary/primary": 4.5,
  "accent/fondo": 3,
  "accent/superficie": 3,
};

/**
 * Trunca a un decimal (nunca sube) y usa coma: 4,499 se muestra «4,4», no «4,5». Sin épsilon. Si la razón no
 * llega al mínimo, el texto tampoco puede mostrar el mínimo (un error de coma flotante podría empujarlo hasta
 * ahí): se muestra «mínimo − 0,1».
 */
export function razonParaLeer(razon: number, minimo: number): string {
  const truncado = Math.floor(razon * 10);
  const decimas =
    razon < minimo && truncado / 10 >= minimo ? Math.round(minimo * 10) - 1 : truncado;
  return (decimas / 10).toFixed(1).replace(".", ",");
}

const minimoParaLeer = (minimo: number): string =>
  (Math.floor(minimo * 10) / 10).toFixed(1).replace(".", ",");

function textoDeContraste(
  par: ResultadoDeContraste["par"],
  razon: number,
  minimo: number,
  superficie: string,
): string {
  const rotulo = (SUPERFICIES.find((s) => s.valor === superficie)?.etiqueta ?? "").toLowerCase();
  const llega = `llega a ${razonParaLeer(razon, minimo)} de ${minimoParaLeer(minimo)} que se necesita.`;
  switch (par) {
    case "on-primary/primary":
      return `El texto no se lee sobre el color principal: ${llega}`;
    case "accent/fondo":
      return `El acento no se lee sobre el fondo de la superficie ${rotulo}: ${llega}`;
    case "accent/superficie":
      return `El acento no se lee sobre las tarjetas de la superficie ${rotulo}: ${llega}`;
  }
}

/** Los tres pares, en orden: texto sobre el principal, acento sobre el fondo y acento sobre las tarjetas. */
export function evaluarContraste(
  colores: ColoresDeSubmarca,
  superficie: string,
  catalogo: CatalogoDeContraste,
): readonly ResultadoDeContraste[] {
  const fondos = catalogo.superficies.find((s) => s.valor === superficie);
  const minimoDe = (par: ResultadoDeContraste["par"]): number =>
    catalogo.pares.find((p) => p.par === par)?.minimo ?? MINIMO_POR_DEFECTO[par];
  const medir = (
    par: ResultadoDeContraste["par"],
    escritoA: string,
    rotuloA: string,
    escritoB: string | undefined,
    rotuloB: string,
  ): ResultadoDeContraste => {
    const minimo = minimoDe(par);
    // Se mide lo que se va a guardar: sin espacios, sin mayúsculas y con el «#».
    const a = normalizarColor(escritoA);
    const b = escritoB === undefined ? undefined : normalizarColor(escritoB);
    const falta = !HEX.test(a) ? rotuloA : b === undefined || !HEX.test(b) ? rotuloB : null;
    if (falta !== null || b === undefined) {
      return {
        par,
        razon: null,
        minimo,
        cumple: null,
        texto: `Falta definir el color ${falta ?? rotuloB}.`,
      };
    }
    const razon = razonDeContraste(a, b);
    const cumple = razon >= minimo;
    return {
      par,
      razon,
      minimo,
      cumple,
      texto: cumple ? null : textoDeContraste(par, razon, minimo, superficie),
    };
  };
  return [
    medir(
      "on-primary/primary",
      colores.onPrimary,
      "del texto sobre el principal",
      colores.primary,
      "principal",
    ),
    medir("accent/fondo", colores.accent, "de acento", fondos?.fondo, "de la superficie elegida"),
    medir(
      "accent/superficie",
      colores.accent,
      "de acento",
      fondos?.superficie,
      "de la superficie elegida",
    ),
  ];
}
