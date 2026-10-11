/**
 * Los datos que viajan a la cola de trabajos y a la auditoría no llevan secretos (ADR-007): ni
 * tokens en claro, ni hashes de tokens, ni credenciales. Es una red de seguridad por NOMBRE de
 * campo, no una garantía: lo que no debe estar nunca se decide antes de armar los datos.
 */
const NOMBRE_DE_SECRETO = /token|secret|clave|passw|contrase|credencial|hash|firma/i;

export type Dato =
  string | number | boolean | null | readonly Dato[] | { readonly [campo: string]: Dato };

/** El primer campo (con su ruta) cuyo nombre parece de un secreto, o `null` si no hay ninguno. */
export function campoConPosibleSecreto(dato: Dato, ruta = ""): string | null {
  if (dato === null || typeof dato !== "object") return null;
  if (Array.isArray(dato)) {
    for (const [indice, valor] of (dato as readonly Dato[]).entries()) {
      const hallado = campoConPosibleSecreto(valor, `${ruta}[${indice}]`);
      if (hallado !== null) return hallado;
    }
    return null;
  }
  for (const [campo, valor] of Object.entries(dato as { readonly [campo: string]: Dato })) {
    const completa = ruta === "" ? campo : `${ruta}.${campo}`;
    if (NOMBRE_DE_SECRETO.test(campo)) return completa;
    const hallado = campoConPosibleSecreto(valor, completa);
    if (hallado !== null) return hallado;
  }
  return null;
}

/** Lanza `RangeError` si los datos parecen llevar un secreto: es un defecto del llamador. */
export function exigirSinSecretos(dato: Dato, donde: string): void {
  const campo = campoConPosibleSecreto(dato);
  if (campo !== null) {
    throw new RangeError(`${donde}: el campo '${campo}' parece un secreto y no puede guardarse`);
  }
}
