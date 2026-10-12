import type { Marca } from "../identificadores/marca";

/**
 * Catálogo de provincias (jurisdicciones) de la Argentina, con la clave ISO 3166-2:AR.
 *
 * VERIFICACIÓN: los 24 códigos coinciden con ISO 3166-2:AR según el paquete `iso-codes` 4.16.0
 * (Debian), cotejados uno a uno el 2026-10-12. Los nombres son para mostrar: se tomaron de esa
 * fuente sin el sufijo "Province"; la Ciudad Autónoma lleva su nombre oficial.
 *
 * NO VERIFICADO: el código numérico de ARCA de cada jurisdicción. No está acá a propósito: la tabla
 * `provincia` lo lleva vacío hasta confirmarlo contra una fuente oficial (diseno-inicial §4) y la
 * emisión lo exigirá.
 */
export type CodigoDeProvincia = Marca<string, "CodigoDeProvincia">;

export type Provincia = Readonly<{ codigo: CodigoDeProvincia; nombre: string }>;

const provincia = (codigo: string, nombre: string): Provincia => ({
  codigo: codigo as CodigoDeProvincia,
  nombre,
});

/** Las 24 jurisdicciones, ordenadas por nombre (para ofrecerlas en una lista). */
export const PROVINCIAS: readonly Provincia[] = [
  provincia("AR-B", "Buenos Aires"),
  provincia("AR-K", "Catamarca"),
  provincia("AR-H", "Chaco"),
  provincia("AR-U", "Chubut"),
  provincia("AR-C", "Ciudad Autónoma de Buenos Aires"),
  provincia("AR-X", "Córdoba"),
  provincia("AR-W", "Corrientes"),
  provincia("AR-E", "Entre Ríos"),
  provincia("AR-P", "Formosa"),
  provincia("AR-Y", "Jujuy"),
  provincia("AR-L", "La Pampa"),
  provincia("AR-F", "La Rioja"),
  provincia("AR-M", "Mendoza"),
  provincia("AR-N", "Misiones"),
  provincia("AR-Q", "Neuquén"),
  provincia("AR-R", "Río Negro"),
  provincia("AR-A", "Salta"),
  provincia("AR-J", "San Juan"),
  provincia("AR-D", "San Luis"),
  provincia("AR-Z", "Santa Cruz"),
  provincia("AR-S", "Santa Fe"),
  provincia("AR-G", "Santiago del Estero"),
  provincia("AR-V", "Tierra del Fuego"),
  provincia("AR-T", "Tucumán"),
];

const POR_CODIGO: ReadonlyMap<string, Provincia> = new Map(PROVINCIAS.map((p) => [p.codigo, p]));

/** La provincia con ese código exacto (mayúsculas, `AR-X`), o `null` si no existe. */
export function provinciaDesdeCodigo(codigo: string): Provincia | null {
  return POR_CODIGO.get(codigo) ?? null;
}
