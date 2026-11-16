import { err, ok, type Resultado } from "../resultado/resultado";
import { LETRAS_LATINAS, textoDeUnaLineaDesdeTexto } from "../texto/texto-de-una-linea";
import { provinciaDesdeCodigo, type CodigoDeProvincia } from "./provincias";

/**
 * Domicilio estructurado (diseno-inicial §4, §10): calle, número (o `S/N`), piso, departamento,
 * localidad, provincia del catálogo y código postal. Valor puro: sin reloj, sin azar y sin I/O.
 * Un domicilio no se edita: se crea otro (la tabla es de solo inserción), así que acá no hay
 * operaciones de cambio.
 *
 * Valores configurables, todos SUPUESTOS (DEC-0047) (ninguno es un requisito verificado de ARCA):
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
/**
 * LISTA DE PERMITIDOS del piso y del departamento: letras latinas con tilde y ñ (las de `texto-de-una-linea.ts`), dígitos, espacio y `º ° ª . / -` (de 1 a su tope; el orquestador pidió las tildes por delegación, 2026-11-16). Se escribe
 * «-1» (subsuelo), «PB», «1°», «B/2»: por eso NO usa el texto de una línea de nombres, que no deja empezar con `-`. SUPUESTO
 * (DEC-0047) del ingeniero, sin fuente del dueño; revertir es cambiar esta constante. Previene: un invisible, `<>` o un emoji en un
 * dato que se imprime (la forma vieja, «sin controles», los dejaba pasar).
 */
function pisoODepartamentoPermitido(maximo: number): RegExp {
  return new RegExp(`^[${LETRAS_LATINAS}0-9º°ª./ -]{1,${maximo}}$`);
}
const PISO_PERMITIDO = pisoODepartamentoPermitido(LIMITES_DE_DOMICILIO.piso);
const DEPARTAMENTO_PERMITIDO = pisoODepartamentoPermitido(LIMITES_DE_DOMICILIO.departamento);

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

/**
 * La calle y la localidad: el texto de una línea de la lista de permitidos (`texto-de-una-linea.ts`, una sola fuente), de 1 al tope.
 * Devuelve el texto canónico (NFC, espacios repetidos en uno) o `null`. No exige letras: «9 de Julio» y «25» pasan.
 */
function textoDeDomicilio(texto: string, maximo: number): string | null {
  const limpio = textoDeUnaLineaDesdeTexto(texto, { maximo, exigirUnaLetra: false });
  return limpio.ok ? limpio.valor : null;
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
  const calle = textoDeDomicilio(datos.calle, LIMITES_DE_DOMICILIO.calle);
  if (calle === null) return err("CALLE_INVALIDA");

  const numero = datos.numero.trim().toUpperCase();
  if (numero !== SIN_NUMERO && !FORMATO_DE_NUMERO.test(numero)) return err("NUMERO_INVALIDO");

  const piso = recortarOpcional(datos.piso);
  if (piso !== null && !PISO_PERMITIDO.test(piso)) return err("PISO_INVALIDO");

  const departamento = recortarOpcional(datos.departamento);
  if (departamento !== null && !DEPARTAMENTO_PERMITIDO.test(departamento)) {
    return err("DEPARTAMENTO_INVALIDO");
  }

  const localidad = textoDeDomicilio(datos.localidad, LIMITES_DE_DOMICILIO.localidad);
  if (localidad === null) return err("LOCALIDAD_INVALIDA");

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
