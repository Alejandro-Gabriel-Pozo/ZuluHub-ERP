import { err, ok, type Resultado } from "../resultado/resultado";
import { provinciaDesdeCodigo, type CodigoDeProvincia } from "./provincias";

/**
 * Domicilio estructurado (diseno-inicial §4, §10): calle, número (o `S/N`), piso, departamento,
 * localidad, provincia del catálogo y código postal. Valor puro: sin reloj, sin azar y sin I/O.
 * Un domicilio no se edita: se crea otro (la tabla es de solo inserción), así que acá no hay
 * operaciones de cambio.
 *
 * Valores configurables, todos SUPUESTOS (ninguno es un requisito verificado de ARCA):
 * - `LIMITES_DE_DOMICILIO`: largo máximo de cada texto;
 * - `FORMATO_DE_CODIGO_POSTAL`: alfanumérico de 4 a 8 (permisivo a propósito, NO VERIFICADO).
 */
export const LIMITES_DE_DOMICILIO = {
  calle: 100,
  localidad: 100,
  piso: 20,
  departamento: 20,
} as const;

export const FORMATO_DE_CODIGO_POSTAL = /^[A-Z0-9]{4,8}$/;

const FORMATO_DE_NUMERO = /^[0-9]{1,6}$/;
const SIN_NUMERO = "S/N";
const CARACTERES_DE_CONTROL = /\p{Cc}/u;

/** Lo que llega de un formulario o de la frontera: texto, con los opcionales ausentes, nulos o vacíos. */
export type DatosDeDomicilio = Readonly<{
  calle: string;
  numero: string;
  piso?: string | null;
  departamento?: string | null;
  localidad: string;
  provincia: string;
  codigoPostal?: string | null;
}>;

export type Domicilio = Readonly<{
  calle: string;
  /** Hasta seis dígitos, o `S/N`. */
  numero: string;
  piso: string | null;
  departamento: string | null;
  localidad: string;
  provincia: CodigoDeProvincia;
  /** En mayúsculas; `null` si no se informó. */
  codigoPostal: string | null;
}>;

export type ErrorDeDomicilio =
  | "CALLE_INVALIDA"
  | "NUMERO_INVALIDO"
  | "PISO_INVALIDO"
  | "DEPARTAMENTO_INVALIDO"
  | "LOCALIDAD_INVALIDA"
  | "PROVINCIA_INVALIDA"
  | "CODIGO_POSTAL_INVALIDO";

/** ¿Entra en `maximo` y no trae caracteres de control (saltos de línea, tabulaciones)? */
function textoAceptable(texto: string, maximo: number): boolean {
  return texto.length <= maximo && !CARACTERES_DE_CONTROL.test(texto);
}

/** Recorta; lo ausente, nulo o en blanco es `null` (un opcional vacío). */
function recortarOpcional(valor: string | null | undefined): string | null {
  const limpio = valor?.trim() ?? "";
  return limpio === "" ? null : limpio;
}

/**
 * Valida y normaliza un domicilio. Devuelve el PRIMER error, en el orden calle, número, piso,
 * departamento, localidad, provincia, código postal. Normaliza: recorta blancos, pasa el número y
 * el código postal a mayúsculas y vuelve `null` los opcionales vacíos.
 */
export function domicilioDesdeDatos(
  datos: DatosDeDomicilio,
): Resultado<Domicilio, ErrorDeDomicilio> {
  const calle = datos.calle.trim();
  if (calle === "" || !textoAceptable(calle, LIMITES_DE_DOMICILIO.calle)) {
    return err("CALLE_INVALIDA");
  }

  const numero = datos.numero.trim().toUpperCase();
  if (numero !== SIN_NUMERO && !FORMATO_DE_NUMERO.test(numero)) return err("NUMERO_INVALIDO");

  const piso = recortarOpcional(datos.piso);
  if (piso !== null && !textoAceptable(piso, LIMITES_DE_DOMICILIO.piso)) {
    return err("PISO_INVALIDO");
  }

  const departamento = recortarOpcional(datos.departamento);
  if (departamento !== null && !textoAceptable(departamento, LIMITES_DE_DOMICILIO.departamento)) {
    return err("DEPARTAMENTO_INVALIDO");
  }

  const localidad = datos.localidad.trim();
  if (localidad === "" || !textoAceptable(localidad, LIMITES_DE_DOMICILIO.localidad)) {
    return err("LOCALIDAD_INVALIDA");
  }

  const provincia = provinciaDesdeCodigo(datos.provincia.trim());
  if (provincia === null) return err("PROVINCIA_INVALIDA");

  const codigoPostal = recortarOpcional(datos.codigoPostal)?.toUpperCase() ?? null;
  if (codigoPostal !== null && !FORMATO_DE_CODIGO_POSTAL.test(codigoPostal)) {
    return err("CODIGO_POSTAL_INVALIDO");
  }

  return ok({
    calle,
    numero,
    piso,
    departamento,
    localidad,
    provincia: provincia.codigo,
    codigoPostal,
  });
}

/**
 * Una línea para mostrar: `Av. Corrientes 1234, piso 5, depto B, Rosario, Santa Fe (CP S2000)`.
 * Es solo presentación; lo que se guarda y se compara son los campos.
 */
export function formatearDomicilio(domicilio: Domicilio): string {
  const partes = [`${domicilio.calle} ${domicilio.numero}`];
  if (domicilio.piso !== null) partes.push(`piso ${domicilio.piso}`);
  if (domicilio.departamento !== null) partes.push(`depto ${domicilio.departamento}`);
  partes.push(domicilio.localidad);
  // La provincia siempre sale del catálogo (se validó al construir); si no estuviera, es un error de programación.
  const provincia = provinciaDesdeCodigo(domicilio.provincia);
  if (provincia === null) throw new RangeError(`provincia desconocida: ${domicilio.provincia}`);
  partes.push(provincia.nombre);
  const linea = partes.join(", ");
  return domicilio.codigoPostal === null ? linea : `${linea} (CP ${domicilio.codigoPostal})`;
}
