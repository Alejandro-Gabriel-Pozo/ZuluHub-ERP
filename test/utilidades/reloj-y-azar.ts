/**
 * Detector compartido de las pruebas "sin reloj ni azar" (identidad y capacidades): busca en el texto
 * de un archivo fuente los usos del reloj o de la aleatoriedad que el código repetible no puede tener.
 */
const PROHIBIDOS: readonly { nombre: string; patron: RegExp }[] = [
  { nombre: "Date.now", patron: /\bDate\s*\.\s*now\b/ },
  // `new Date()` o `new Date` sin argumentos: la hora actual. Con argumento es una fecha dada.
  { nombre: "new Date() sin argumentos", patron: /\bnew\s+Date\b(?!\s*\(\s*[^)\s])/ },
  { nombre: "Math.random", patron: /\bMath\s*\.\s*random\b/ },
  { nombre: "randomUUID", patron: /\brandomUUID\b/ },
  { nombre: "getRandomValues", patron: /\bgetRandomValues\b/ },
  { nombre: "performance.now", patron: /\bperformance\s*\.\s*now\b/ },
];

export function usosProhibidos(fuente: string): string[] {
  return PROHIBIDOS.filter(({ patron }) => patron.test(fuente)).map(({ nombre }) => nombre);
}
