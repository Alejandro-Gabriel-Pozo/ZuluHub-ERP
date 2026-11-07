import type { Marca } from "../identificadores/marca";
import { err, ok, type Resultado } from "../resultado/resultado";

/**
 * CUIT: 11 dígitos, el último es verificador (módulo 11 con pesos 5,4,3,2,7,6,5,4,3,2). Forma
 * canónica: solo dígitos. Se acepta también la forma con guiones `XX-XXXXXXXX-X`.
 *
 * No se valida el prefijo (20, 23, 27, 30, 33...): el principio es ser permisivo como ARCA
 * (ADR-008) y la lista de prefijos vigentes no está verificada.
 */
export type Cuit = Marca<string, "Cuit">;

export type ErrorDeCuit = "CUIT_FORMATO_INVALIDO" | "CUIT_DIGITO_VERIFICADOR_INVALIDO";

const PESOS = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2] as const;
const FORMA_CANONICA = /^[0-9]{11}$/;
const FORMA_CON_GUIONES = /^([0-9]{2})-([0-9]{8})-([0-9])$/;

/** Dígito verificador que corresponde a los primeros diez dígitos (el resto se ignora), o `null` si no existe. */
export function digitoVerificadorDeCuit(digitos: string): number | null {
  const suma = PESOS.reduce((acumulado, peso, i) => acumulado + peso * Number(digitos[i]), 0);
  const resto = 11 - (suma % 11);
  if (resto === 11) return 0;
  return resto === 10 ? null : resto;
}

export function cuitDesdeTexto(texto: string): Resultado<Cuit, ErrorDeCuit> {
  const conGuiones = FORMA_CON_GUIONES.exec(texto);
  const digitos = conGuiones === null ? texto : conGuiones.slice(1).join("");
  if (!FORMA_CANONICA.test(digitos)) return err("CUIT_FORMATO_INVALIDO");
  // Si no existe dígito verificador (`null`), la comparación también falla: el CUIT se rechaza.
  if (digitoVerificadorDeCuit(digitos) !== Number(digitos[10])) {
    return err("CUIT_DIGITO_VERIFICADOR_INVALIDO");
  }
  return ok(digitos as Cuit);
}

const ONCE_DIGITOS = /^[0-9]{11}$/;

/**
 * `30-70308853-4`: para mostrar. La forma canónica es la que se guarda. Es la ÚNICA función que arma el CUIT con guiones (la web y la
 * consola de plataforma la importan; antes cada una tenía su copia). Previene: tres formatos que se desvían con el tiempo.
 */
export function cuitConGuiones(cuit: Cuit): string {
  return `${cuit.slice(0, 2)}-${cuit.slice(2, 10)}-${cuit.slice(10)}`;
}

/**
 * Lo mismo para un texto que todavía no es un `Cuit` (lo que muestra una pantalla): 11 dígitos pasan a `XX-XXXXXXXX-X`; cualquier otro
 * texto (incluido el que ya tiene guiones) vuelve tal cual. Solo es presentación: la validación y el dígito verificador son de
 * `cuitDesdeTexto`, así que nunca lanza.
 */
export function cuitParaMostrar(texto: string): string {
  return ONCE_DIGITOS.test(texto) ? cuitConGuiones(texto as Cuit) : texto;
}
