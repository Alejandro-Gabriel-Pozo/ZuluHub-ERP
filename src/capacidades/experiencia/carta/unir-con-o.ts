/**
 * «A, B o C» en castellano, armado a mano: sin `Intl.ListFormat`, cuyo resultado cambia con la versión de Node
 * o del navegador. Ese texto se arma en el servidor y otra vez en el navegador al hidratar, y dos resultados
 * distintos romperían la hidratación. Sin coma antes del «o»; dos elementos: «A o B»; uno: «A»; ninguno: «».
 */
export function unirConO(elementos: readonly string[]): string {
  const ultimo = elementos.at(-1);
  if (ultimo === undefined) return "";
  if (elementos.length === 1) return ultimo;
  return `${elementos.slice(0, -1).join(", ")} o ${ultimo}`;
}
