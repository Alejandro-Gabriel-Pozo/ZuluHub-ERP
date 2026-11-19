import { rutaDeRetorno } from "../experiencia/ruta-de-retorno";
import { esUuidCanonico } from "../../primitivas/identificadores/marca";

/**
 * EL SOBRE DE CONTEXTO (escalabilidad X-1): lo que viaja de la pantalla de origen a la pantalla de una operación, y NADA más: el
 * tipo de contexto, el id de la cosa y a dónde volver. No lleva resultado, ni de ida ni de vuelta (regla del dueño, 18/11).
 *
 * REGLA DE DATOS, obligatoria para toda operación: el sobre IDENTIFICA, no AUTORIZA ni TRANSPORTA. La pantalla de la operación
 * vuelve a buscar la cosa por su id FILTRANDO POR LA EMPRESA DE LA SESIÓN y vuelve a pasar por el guard. Nada de lo que se ve en
 * la pantalla de origen (importes, nombres) viaja en la dirección.
 *
 * LISTA DE PERMITIDOS (todo nace cerrado): `contexto` es una clave del registro; `id` es un uuid canónico; `volver` es una ruta
 * propia de la app (la validación única de `ruta-de-retorno.ts`: previene que el enlace de «Más» mande a un sitio ajeno). Un
 * parámetro repetido, de más, ausente o vacío lo invalida entero. Lo que NO conserva: lo escrito y sin guardar en la pantalla de
 * origen (N-6: con cambios sin guardar «Más» no se ofrece; lo resuelve X-1c). Chequeo: `sobre.test.ts`.
 */

export type Referencia = Readonly<{ tipo: string; id: string }>;
export type SobreDeContexto = Readonly<{ referencia: Referencia; volver: string }>;

/** La dirección de la hoja «Más». Solo la constante: la ruta y la pantalla las construye X-1c. */
export const RUTA_DE_LA_HOJA_DE_MAS = "/mas";

const PARAMETROS = ["contexto", "id", "volver"] as const;

/** Los tres parámetros, siempre los mismos y solo esos: `contexto`, `id`, `volver`. */
export function parametrosDelSobre(sobre: SobreDeContexto): URLSearchParams {
  const parametros = new URLSearchParams();
  parametros.set("contexto", sobre.referencia.tipo);
  parametros.set("id", sobre.referencia.id);
  parametros.set("volver", sobre.volver);
  return parametros;
}

/** La dirección de una ruta con el sobre puesto (para abrir una operación o la hoja). */
export function direccionConSobre(ruta: string, sobre: SobreDeContexto): string {
  return `${ruta}?${parametrosDelSobre(sobre).toString()}`;
}

/** Una ruta propia de la app, tal cual (`rutaDeRetorno` devuelve el inicio cuando no lo es: se compara con lo recibido). */
export function esRutaPropia(ruta: string): boolean {
  return ruta.startsWith("/") && rutaDeRetorno(ruta) === ruta;
}

/** Lee y valida un sobre que llega por la dirección. `null` si algo no cumple. */
export function leerElSobre(
  parametros: Readonly<Record<string, string | readonly string[] | undefined>>,
  contextos: Readonly<Record<string, unknown>>,
): SobreDeContexto | null {
  const claves = Object.keys(parametros);
  if (claves.length !== PARAMETROS.length || !PARAMETROS.every((p) => claves.includes(p)))
    return null;
  const { contexto, id, volver } = parametros;
  if (typeof contexto !== "string" || typeof id !== "string" || typeof volver !== "string")
    return null;
  if (!Object.hasOwn(contextos, contexto)) return null;
  if (!esUuidCanonico(id)) return null;
  if (!esRutaPropia(volver)) return null;
  return { referencia: { tipo: contexto, id }, volver };
}
