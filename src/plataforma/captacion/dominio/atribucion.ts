/**
 * De dónde vino el interesado (alta por solicitud §2.4): las claves de campaña de la dirección que
 * tocó. Dominio puro. Es un dato que cualquier visitante puede escribir a mano, así que NUNCA bloquea
 * un envío: lo que no sirve se descarta o se limpia, y lo que se guarda tiene la forma que exige la
 * base (`atribucion_valida`: lista cerrada de claves, valores `[A-Za-z0-9._~-]` de 1 a 200).
 */

export const CLAVES_DE_ATRIBUCION = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_content",
  "utm_term",
  "fbclid",
] as const;

export type ClaveDeAtribucion = (typeof CLAVES_DE_ATRIBUCION)[number];

export type Atribucion = Readonly<Partial<Record<ClaveDeAtribucion, string>>>;

export const LARGO_MAXIMO_DE_ATRIBUCION = 200;

const NO_PERMITIDO = /[^A-Za-z0-9._~-]+/g;
const BORDES_SIN_VALOR = /^-+|-+$/g;
const VALOR_EXACTO = /^[A-Za-z0-9._~-]{1,200}$/;

/**
 * Una campaña con espacios o acentos («Promo Verano») es lo normal: cada tramo de caracteres no
 * permitidos pasa a un guion, se sacan los guiones de los bordes y se corta a 200. Si no queda nada, se
 * descarta. Falla que previene: perder la campaña entera (y el tablero «por campaña» con ella) por un
 * espacio.
 */
function limpiarCampania(valor: string): string {
  return valor
    .replace(NO_PERMITIDO, "-")
    .replace(BORDES_SIN_VALOR, "")
    .slice(0, LARGO_MAXIMO_DE_ATRIBUCION);
}

/**
 * El identificador de clic de Meta se guarda tal cual o no se guarda: uno «limpiado» o cortado ya no
 * identifica nada y Meta lo rechazaría.
 */
function clicExacto(valor: string): string {
  const recortado = valor.trim();
  return VALOR_EXACTO.test(recortado) ? recortado : "";
}

/**
 * Normaliza lo que vino en la dirección. Solo existen las claves de la lista; el resto se ignora.
 * `fbclid` identifica a un navegador concreto con Meta: sin consentimiento de medición no se guarda
 * (la base lo exige con `solicitud_medicion_ck`). Las claves salen siempre en el orden de la lista.
 */
export function normalizarAtribucion(
  crudo: Readonly<Record<string, string | undefined>>,
  medicionConsentida: boolean,
): Atribucion {
  const resultado: Partial<Record<ClaveDeAtribucion, string>> = {};
  for (const clave of CLAVES_DE_ATRIBUCION) {
    const valor = crudo[clave];
    if (valor === undefined) continue;
    const limpio =
      clave !== "fbclid" ? limpiarCampania(valor) : medicionConsentida ? clicExacto(valor) : "";
    if (limpio !== "") resultado[clave] = limpio;
  }
  return resultado;
}
