import type { MarcaComercialId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/** La base admite hasta dos niveles bajo la principal (nivel 0 = la principal y las marcas sin padre). */
export const NIVEL_MAXIMO_DE_LA_BASE = 2;

/** El código técnico de una marca: minúsculas, dígitos y guion; de 2 a 40 caracteres, empieza con letra. */
const CODIGO_DE_MARCA = /^[a-z][a-z0-9-]{1,39}$/;

export const validarCodigoDeMarca = (
  codigo: string,
): Resultado<string, "CODIGO_DE_MARCA_INVALIDO"> =>
  CODIGO_DE_MARCA.test(codigo) ? ok(codigo) : err("CODIGO_DE_MARCA_INVALIDO");

export type NivelDeMarca = number;

/**
 * `nivel = nivel del padre + 1`, y 0 sin padre (§B.3). Pasar de `NIVEL_MAXIMO_DE_LA_BASE` es un nivel que
 * la base no admite (`marca_nivel_ck`).
 */
export function nivelDeMarca(
  nivelDelPadre: number | null,
): Resultado<NivelDeMarca, "NIVEL_DE_MARCA_EXCEDIDO"> {
  const nivel = nivelDelPadre === null ? 0 : nivelDelPadre + 1;
  return nivel > NIVEL_MAXIMO_DE_LA_BASE ? err("NIVEL_DE_MARCA_EXCEDIDO") : ok(nivel);
}

/** Lo que el alta necesita saber de la marca padre. */
export type PadreDeMarca = Readonly<{
  id: MarcaComercialId;
  nivel: number;
  esPrincipal: boolean;
  estado: "ACTIVA" | "RETIRADA";
}>;

export type ErrorDeAltaDeMarca =
  | "CODIGO_DE_MARCA_INVALIDO"
  | "MARCA_PADRE_RETIRADA"
  | "NIVEL_DE_MARCA_NO_HABILITADO"
  | "NIVEL_DE_MARCA_EXCEDIDO";

export type MarcaPorCrear = Readonly<{
  codigo: string;
  marcaPadreId: MarcaComercialId | null;
  nivel: NivelDeMarca;
}>;

/**
 * Decide el alta de una marca (§B.3 y G.1): código válido; padre activo; en v1 el padre es la marca
 * principal (o no hay padre: una marca independiente); el nivel sale del padre. Una marca nace nunca
 * principal: la principal es una sola y la siembra la migración. Que el padre exista y que el código
 * esté libre lo ve el caso de uso, que lee la base. El primer problema, en este orden.
 */
export function decidirAltaDeMarca(
  codigo: string,
  padre: PadreDeMarca | null,
): Resultado<MarcaPorCrear, ErrorDeAltaDeMarca> {
  const valido = validarCodigoDeMarca(codigo);
  if (!valido.ok) return valido;
  if (padre !== null && padre.estado === "RETIRADA") return err("MARCA_PADRE_RETIRADA");
  if (padre !== null && !padre.esPrincipal) return err("NIVEL_DE_MARCA_NO_HABILITADO");
  const nivel = nivelDeMarca(padre === null ? null : padre.nivel);
  if (!nivel.ok) return nivel;
  return ok({ codigo, marcaPadreId: padre === null ? null : padre.id, nivel: nivel.valor });
}

/** Lo que de una marca no cambia nunca (§B.3, F.3): así no puede haber ciclos ni dos principales. */
export type DatosInmutablesDeMarca = Readonly<{
  codigo: string;
  marcaPadreId: MarcaComercialId | null;
  esPrincipal: boolean;
}>;

export type CampoInmutable = keyof DatosInmutablesDeMarca;

/** El primer dato inmutable que un cambio quiere tocar, o `null` si no toca ninguno. */
export function campoInmutableModificado(
  antes: DatosInmutablesDeMarca,
  despues: DatosInmutablesDeMarca,
): CampoInmutable | null {
  if (antes.codigo !== despues.codigo) return "codigo";
  if (antes.marcaPadreId !== despues.marcaPadreId) return "marcaPadreId";
  if (antes.esPrincipal !== despues.esPrincipal) return "esPrincipal";
  return null;
}
