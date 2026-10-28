import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";

/**
 * La forma de lo que llega de afuera a los casos de uso de marcas, planes y módulos de empresa (M5):
 * números de control, fechas y motivos. Dominio puro: sin reloj, sin azar, sin base de datos. Se valida
 * DESPUÉS del guard (el caso de uso decide cuándo) y nada se corrige en silencio: un valor mal formado es
 * un error con nombre, no un `NaN` que haga falsas todas las comparaciones, ni una fecha inválida que el
 * dominio de planes rechazaría lanzando una excepción en vez de devolver un error de negocio.
 */

/** El mayor entero de una columna `integer` de Postgres. */
const MAXIMO_ENTERO_DE_LA_BASE = 2_147_483_647;

/** Lo más largo que puede ser el motivo de un cambio de plataforma (el mismo tope que el de retirar un dominio). */
export const LARGO_MAXIMO_DEL_MOTIVO = 500;

const esConsecutivo = (n: number): boolean =>
  Number.isInteger(n) && n >= 1 && n <= MAXIMO_ENTERO_DE_LA_BASE;

/**
 * El `numeroEsperado` de una asignación o de un ajuste: el número de la última decisión que vio quien
 * decide, o `null` si no había ninguna. Un número que no es un entero de 1 en adelante no puede ser el de
 * ninguna decisión, y con `NaN` la huella de la clave de idempotencia coincidiría con la de `null`.
 */
export function validarNumeroEsperado(
  numero: number | null,
): Resultado<number | null, "NUMERO_ESPERADO_INVALIDO"> {
  return numero === null || esConsecutivo(numero) ? ok(numero) : err("NUMERO_ESPERADO_INVALIDO");
}

/** La `versionEsperada` de un borrador: la `version` de la fila que vio quien lo edita, o `null` si no había borrador. */
export function validarVersionEsperada(
  version: number | null,
): Resultado<number | null, "VERSION_ESPERADA_INVALIDA"> {
  return version === null || esConsecutivo(version)
    ? ok(version)
    : err("VERSION_ESPERADA_INVALIDA");
}

/**
 * La `versionEsperada` de una confirmación: la `version` del borrador que vio quien confirma. A diferencia de
 * guardar, no hay «sin borrador» (confirmar exige uno): es un entero de 1 en adelante, nunca `null`. Sin
 * esto, una entrada sin tipar (`undefined`, `NaN`) saltearía el chequeo de qué borrador se está confirmando.
 */
export function validarVersionVista(
  version: number,
): Resultado<number, "VERSION_ESPERADA_INVALIDA"> {
  return esConsecutivo(version) ? ok(version) : err("VERSION_ESPERADA_INVALIDA");
}

/**
 * Desde cuándo rige una decisión: una fecha de verdad. (Que no sea retroactiva lo decide el dominio de la
 * decisión, con el reloj del contexto.)
 */
export function validarVigencia(fecha: Date): Resultado<Date, "VIGENCIA_INVALIDA"> {
  return fecha instanceof Date && !Number.isNaN(fecha.getTime())
    ? ok(fecha)
    : err("VIGENCIA_INVALIDA");
}

/** El largo del motivo (que no esté vacío lo decide el dominio de cada decisión): de a lo sumo `LARGO_MAXIMO_DEL_MOTIVO`. */
export function validarLargoDelMotivo(motivo: string): Resultado<string, "MOTIVO_DEMASIADO_LARGO"> {
  return motivo.trim().length > LARGO_MAXIMO_DEL_MOTIVO
    ? err("MOTIVO_DEMASIADO_LARGO")
    : ok(motivo);
}
