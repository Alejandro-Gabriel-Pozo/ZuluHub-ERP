/**
 * Lo puro del cambio de plan de una empresa: tipos del intento, validación local, rótulos y textos. Sin Next ni
 * React. Los límites espejan al backend (`src/plataforma/dominio/formas-de-entrada.ts`); una prueba los compara.
 */
import { LARGO_MAXIMO_DEL_MOTIVO } from "./entrada-del-plan";
import type { ErrorParaLaPantalla } from "./errores-de-plataforma";
import { fechaLegible } from "./vigencia";

/** Lo que se fija al primer toque del intento y se reusa, igual, en cada reintento. */
export type Fijada = Readonly<{
  versionDePlanId: string;
  vigenteDesde: string;
  motivo: string;
  reemplazaProgramada: boolean;
  numeroEsperado: number | null;
}>;

export type Rechazo =
  | Readonly<{ tipo: "ERROR"; error: ErrorParaLaPantalla; referencia: string | undefined }>
  | Readonly<{ tipo: "CANCELADO" }>;

export type Hecho = Readonly<{ yaExistia: boolean; vigenteDesde: string }>;
export type CampoLocal = "vigenteDesde" | "motivo" | "reemplaza";

/** La fecha más lejana que acepta la consola (`vigencia.ts` rechaza años después de 2100). */
export const FECHA_MAXIMA_DE_VIGENCIA = "2100-12-31";

export const LEYENDA_DE_PROGRAMADA =
  "Si la nueva fecha es igual o anterior, reemplaza el cambio programado; si es posterior, se aplica después de él.";

/** «Pro (versión 2)», con «, actual» si es la que rige hoy. */
export function etiquetaDeVersion(p: {
  nombre: string;
  versionNumero: number;
  esActual: boolean;
}): string {
  const base = `${p.nombre} (versión ${String(p.versionNumero)}`;
  return p.esActual ? `${base}, actual)` : `${base})`;
}

export function armarResumen(
  elegida: { nombre: string; versionNumero: number } | undefined,
  vigenteDesde: string,
): string {
  const destino =
    elegida === undefined
      ? "al plan elegido"
      : `a ${elegida.nombre} (versión ${String(elegida.versionNumero)})`;
  const fecha = vigenteDesde === "" ? "la fecha que elijas" : fechaLegible(vigenteDesde);
  return `Se cambia ${destino}, vigente desde ${fecha}.`;
}

/** Las faltas del formulario, con el mismo criterio que el backend (fecha desde mañana, motivo de 1 a 500). */
export function validarCambio(datos: {
  vigenteDesde: string;
  motivo: string;
  hayProgramada: boolean;
  reemplaza: boolean;
  fechaMinima: string;
}): Partial<Record<CampoLocal, string>> {
  const faltas: Partial<Record<CampoLocal, string>> = {};
  if (datos.vigenteDesde === "") faltas.vigenteDesde = "Elegí desde qué fecha rige.";
  else if (datos.vigenteDesde < datos.fechaMinima) {
    faltas.vigenteDesde = `La fecha tiene que ser desde mañana: ${fechaLegible(datos.fechaMinima)}.`;
  } else if (datos.vigenteDesde > FECHA_MAXIMA_DE_VIGENCIA) {
    faltas.vigenteDesde = `La fecha no puede pasar de ${fechaLegible(FECHA_MAXIMA_DE_VIGENCIA)}.`;
  }
  const largo = datos.motivo.trim().length;
  if (largo === 0) faltas.motivo = "Escribí el motivo del cambio.";
  else if (largo > LARGO_MAXIMO_DEL_MOTIVO) {
    faltas.motivo = `El motivo puede tener hasta ${String(LARGO_MAXIMO_DEL_MOTIVO)} letras.`;
  }
  if (datos.hayProgramada && !datos.reemplaza) {
    faltas.reemplaza = "Tildá la casilla para confirmar que sabés del cambio programado.";
  }
  return faltas;
}

/** El texto de un error que no es de los campos de la ventana. */
export function textoDelError(error: ErrorParaLaPantalla): string | null {
  switch (error.tipo) {
    case "GENERAL":
    case "PANTALLA_VIEJA":
    case "MARCA_RETIRADA":
      return error.texto;
    case "CAMPO":
      return error.campo === "vigenteDesde" ||
        error.campo === "motivo" ||
        error.campo === "versionDePlanId"
        ? null
        : error.texto;
    case "OCULTAR_ACCION":
      return "No tenés permiso para cambiar el plan.";
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return "No pudimos cambiar el plan.";
  }
}
