/**
 * Apoyo de `migraciones-selladas.test.ts`: las reglas de los sellos de `migraciones/selladas.json`, como función pura para poder inyectarles
 * una violación a cada una. Un sello es el SHA-256 (fin de línea LF, el mismo `checksumDeMigracion` del ejecutor) de una migración que ya
 * corrió en alguna base. Previene: editar una migración aplicada (el ejecutor lo detecta recién en el siguiente migrar de esa base, no en
 * el CI) y colar una migración con un número que ya quedó atrás.
 */
export type ArchivosDeMigraciones = ReadonlyMap<string, string>;

export function problemasDeSellos(
  sellos: Readonly<Record<string, unknown>>,
  /** Nombre del archivo → su checksum HOY. */
  hoy: ArchivosDeMigraciones,
): string[] {
  const problemas: string[] = [];
  for (const [nombre, sello] of Object.entries(sellos)) {
    if (!hoy.has(nombre)) {
      problemas.push(
        `${nombre}: está sellada pero no existe en migraciones/ (borrar una migración aplicada es reescribir el historial).`,
      );
      continue;
    }
    if (typeof sello !== "string" || !/^[0-9a-f]{64}$/.test(sello)) {
      problemas.push(`${nombre}: el sello no es un SHA-256 en hexadecimal.`);
      continue;
    }
    if (hoy.get(nombre) !== sello) {
      problemas.push(
        `${nombre}: se editó después de sellada (el contenido de hoy no es el que corrió). Una migración aplicada no se edita: el cambio va en una migración nueva.`,
      );
    }
  }
  const mayor = Object.keys(sellos)
    .filter((nombre) => hoy.has(nombre))
    .map((nombre) => nombre.slice(0, 4))
    .sort()
    .at(-1);
  if (mayor !== undefined) {
    for (const nombre of hoy.keys()) {
      if (nombre.slice(0, 4) < mayor && !(nombre in sellos)) {
        problemas.push(
          `${nombre}: no está sellada pero hay una sellada con número mayor (${mayor}): una migración nueva no puede tener un número que ya quedó atrás.`,
        );
      }
    }
  }
  return problemas;
}
