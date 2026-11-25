import type { ResultadoDeGuardarElNivel } from "./resultado-de-nivel";

/**
 * El modelo de vista de «Nivel de compras» (Compras PR 11; maqueta `compra-nivel.html`): las opciones del selector con su texto y si hay algo para guardar. Puro: sin React ni servidor. No decide
 * qué niveles existen ni cuáles se pueden elegir (eso lo trae el servidor: la lista sale del dominio) ni si la persona puede cambiarlo (el servidor rechaza al guardar).
 */

export type NivelParaLaPantalla = Readonly<{
  nivel: string;
  version: number;
  niveles: readonly string[];
}>;

export type TextosDeNivelDeCompras = Readonly<{
  titulo: string;
  guardar: string;
  /** El texto de cada nivel que se ofrece (los de la fase 5 no están: no se ofrecen). */
  niveles: Readonly<Partial<Record<string, string>>>;
}>;

export type OpcionDeNivel = Readonly<{ valor: string; etiqueta: string }>;

/** Las opciones del selector, en el orden que manda el servidor; un nivel sin texto aprobado no se dibuja (nunca un código crudo). */
export function opcionesDeNivel(
  niveles: readonly string[],
  textos: TextosDeNivelDeCompras,
): readonly OpcionDeNivel[] {
  return niveles.flatMap((n) => {
    const etiqueta = textos.niveles[n];
    return etiqueta === undefined ? [] : [{ valor: n, etiqueta }];
  });
}

/** «Guardar» solo se ofrece con algo distinto de lo vigente (sin cambios, apagado: maqueta, «Nivel vigente»). */
export const hayCambios = (vigente: string, elegido: string): boolean => vigente !== elegido;

/** El nivel vigente que muestra la pantalla: el que dejó el último guardado (o el rechazo por versión, que trae el que quedó); sin ninguno, el que se leyó al abrirla. */
export function nivelVigente(resultado: ResultadoDeGuardarElNivel, alAbrir: string): string {
  if (resultado.estado === "HECHO") return resultado.nivel;
  if (resultado.estado === "ERROR" && resultado.vigente !== null) return resultado.vigente.nivel;
  return alAbrir;
}
