/**
 * Cómo se crea toda base descartable de las pruebas: UTF8 con locale `C`, a propósito.
 *  - UTF8 es la codificación de producción (Neon); un servidor local armado con SQL_ASCII daría
 *    resultados que producción no da (por ejemplo, `char_length` contaría bytes y el orden ICU de
 *    0005 no existiría).
 *  - Locale `C` es el peor caso para `lower()` y los órdenes de texto: `lower('CAFÉ')` no es
 *    `café`. Si una regla de la base dependiera del locale del servidor, las pruebas lo mostrarían
 *    en cualquier máquina, tenga el locale que tenga.
 * `TEMPLATE template0` es lo que permite elegir codificación y locale distintos de los del servidor.
 */
export const OPCIONES_DE_BASE = "TEMPLATE template0 ENCODING 'UTF8' LC_COLLATE 'C' LC_CTYPE 'C'";

/** Las únicas zonas con que se puede abrir una sesión de la base de pruebas: la de Argentina (la de siempre) y UTC (la de producción en Neon, para ver qué depende de la zona de la sesión). */
export const ZONAS_DE_LA_BASE_DE_PRUEBAS = ["America/Argentina/Buenos_Aires", "UTC"] as const;
export type ZonaDeLaBaseDePruebas = (typeof ZONAS_DE_LA_BASE_DE_PRUEBAS)[number];
export const VARIABLE_DE_LA_ZONA_DE_LA_BASE = "PEDERNAL_ZONA_DE_LA_BASE";

/**
 * La zona horaria de la sesión de la base de pruebas. Por defecto, la de Argentina: así un `::date` o un `date_trunc` sobre un `timestamptz` da el día de negocio
 * y no el de UTC (tres noches de CI en rojo por mezclar los dos). Con `PEDERNAL_ZONA_DE_LA_BASE=UTC` la suite crítica se corre también como la ve Neon.
 * Solo se aceptan las zonas de `ZONAS_DE_LA_BASE_DE_PRUEBAS`; cualquier otro valor lanza (denegar por defecto).
 */
export function zonaDeLaBaseDePruebas(valor: string | undefined): ZonaDeLaBaseDePruebas {
  if (valor === undefined || valor === "") return "America/Argentina/Buenos_Aires";
  const zona = ZONAS_DE_LA_BASE_DE_PRUEBAS.find((permitida) => permitida === valor);
  if (zona === undefined) {
    throw new Error(
      `${VARIABLE_DE_LA_ZONA_DE_LA_BASE} tiene que ser una de: ${ZONAS_DE_LA_BASE_DE_PRUEBAS.join(", ")}.`,
    );
  }
  return zona;
}

/** La sentencia que deja la zona en la base descartable `nombre` (`pedernal_it_<hex>`, generado por la prueba): toda sesión nueva contra esa base la toma. La zona sale de la lista cerrada de arriba. */
export function sentenciaDeZonaDeLaBase(nombre: string, zona: ZonaDeLaBaseDePruebas): string {
  if (!/^pedernal_it_[0-9a-f]{16}$/.test(nombre)) {
    throw new Error("El nombre de la base descartable no tiene la forma pedernal_it_<16 hex>.");
  }
  return `ALTER DATABASE ${nombre} SET timezone TO '${zona}'`;
}

/** Deja la zona pedida por `PEDERNAL_ZONA_DE_LA_BASE` (o la de Argentina) en la base descartable `nombre`, recién creada. Todo `CREATE DATABASE` de una base de pruebas la llama. */
export async function fijarLaZonaDeLaBase(
  admin: { query: (sentencia: string) => Promise<unknown> },
  nombre: string,
): Promise<void> {
  const zona = zonaDeLaBaseDePruebas(process.env[VARIABLE_DE_LA_ZONA_DE_LA_BASE]);
  await admin.query(sentenciaDeZonaDeLaBase(nombre, zona));
}
