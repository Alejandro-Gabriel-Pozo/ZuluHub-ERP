import { diferenciaDeVocabulario } from "../../capacidades/vocabulario/vocabulario";
import type { DefinicionDeMarca } from "../../modulos/marcas/publico";
import type { Dato } from "../../puertos/sin-secretos";
import { datosIguales } from "./marcas-y-planes-comun";

/**
 * Cómo se ven las marcas en la auditoría y en la huella de la clave de idempotencia (M5). Todo es dato
 * plano (`Dato`): ni fechas ni clases. El vocabulario NUNCA va como un objeto cuyas claves sean los textos
 * (`exigirSinSecretos` rechaza todo campo cuyo nombre contenga `clave`, y los textos tienen prefijo de
 * módulo): va como lista de pares `{ texto, antes, despues }` (marcas y planes, §A.4 #2).
 */

/** Un objeto de claves y textos como dato plano (el tema). */
function comoObjeto(objeto: Readonly<Record<string, string | undefined>>): Record<string, Dato> {
  const resultado: Record<string, Dato> = {};
  for (const [campo, valor] of Object.entries(objeto)) {
    if (valor !== undefined) resultado[campo] = valor;
  }
  return resultado;
}

/** Lo que la definición dice por sí misma, SIN el vocabulario (que va aparte, como pares). */
export function datosDeLaDefinicion(definicion: DefinicionDeMarca): Record<string, Dato> {
  return {
    nombreVisible: definicion.nombreVisible,
    tema: comoObjeto(definicion.tema),
    aspecto: comoObjeto(definicion.aspecto),
    logo: definicion.logo,
    modulosIniciales:
      definicion.modulosIniciales === null ? null : [...definicion.modulosIniciales],
    planPorDefectoId: definicion.planPorDefectoId,
  };
}

/** El vocabulario que cambió entre dos definiciones, como lista de pares `{ texto, antes, despues }`. */
export function paresDeVocabulario(
  antes: DefinicionDeMarca | null,
  despues: DefinicionDeMarca,
): Dato {
  return diferenciaDeVocabulario(antes === null ? {} : antes.vocabulario, despues.vocabulario).map(
    (cambio) => ({ texto: cambio.texto, antes: cambio.antes, despues: cambio.despues }),
  );
}

/**
 * ¿Dicen lo mismo dos definiciones? (Guardar un borrador sin cambios no escribe ni audita.) Compara la
 * definición ENTERA, campo por campo y sin listarlos: un campo que se sume a la definición cuenta solo.
 */
export function definicionesIguales(a: DefinicionDeMarca, b: DefinicionDeMarca): boolean {
  return datosIguales(a, b);
}
