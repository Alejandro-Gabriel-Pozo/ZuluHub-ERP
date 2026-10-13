/**
 * Límites contra el abuso del formulario público (alta por solicitud §4.2). Dominio puro: la hora entra
 * como dato, el HMAC de la IP o del correo lo calcula la capa de afuera (acá solo se valida su forma).
 *
 * Cómo se usa: por cada regla, el caso cuenta el intento en `limite_de_captacion` (un contador por
 * clave, regla y ventana) y obtiene la cuenta, que YA incluye este intento. `decidirLimite` mira esas
 * cuentas. Con tope N pasan exactamente los intentos 1..N: el N + 1 ya es de más.
 */

export type CapaDeLimite = "IP" | "CORREO" | "GLOBAL_SOLICITUDES" | "GLOBAL_VERIFICACIONES";
export type VentanaDeLimite = "HORA" | "DIA" | "SEMANA";

/**
 * Qué ve el interesado al pasarse. `VISIBLE`: «recibimos muchas solicitudes, probá más tarde»;
 * `SILENCIOSO`: la misma respuesta de siempre sin hacer nada (no revela que ese correo ya pidió ni que
 * se lo está usando para bombardear a un tercero).
 */
export type AlPasar = "VISIBLE" | "SILENCIOSO";

export type ReglaDeLimite = Readonly<{
  capa: CapaDeLimite;
  ventana: VentanaDeLimite;
  tope: number;
  alPasar: AlPasar;
}>;

export const DURACION_DE_VENTANA_EN_MS: Readonly<Record<VentanaDeLimite, number>> = {
  HORA: 3_600_000,
  DIA: 86_400_000,
  SEMANA: 7 * 86_400_000,
};

/**
 * Los contadores se purgan pasados 8 días: la ventana más larga es una semana y sobra un día. Retener
 * más es retener seudónimos de IP y de correo más allá de su uso. La política de borrado de la base usa
 * el mismo número (`limite_captacion_purgar`); una prueba de integración compara ambos.
 */
export const RETENCION_DE_CONTADORES_EN_MS = 8 * 86_400_000;

export type ConfiguracionDeLimites = Readonly<{
  /**
   * Tope diario de correos de verificación de toda la plataforma. Tiene que ser como mucho el 50 % de
   * la cuota diaria del plan de Resend, que COMPARTEN las invitaciones de clientes reales (B2): sin ese
   * dato no hay un número honesto, así que no tiene valor por defecto.
   */
  topeGlobalDeVerificacionesPorDia: number;
}>;

/**
 * Las reglas de §4.2. Los topes por IP son holgados a propósito: las redes móviles comparten IP (NAT de
 * operador) y un tope justo bloquearía a personas reales.
 */
export function reglasDeLimite(configuracion: ConfiguracionDeLimites): readonly ReglaDeLimite[] {
  const global = configuracion.topeGlobalDeVerificacionesPorDia;
  if (!Number.isSafeInteger(global) || global < 1) {
    throw new RangeError("el tope global de verificaciones por día debe ser un entero positivo");
  }
  return [
    { capa: "IP", ventana: "HORA", tope: 10, alPasar: "VISIBLE" },
    { capa: "IP", ventana: "DIA", tope: 30, alPasar: "VISIBLE" },
    { capa: "CORREO", ventana: "DIA", tope: 5, alPasar: "SILENCIOSO" },
    { capa: "CORREO", ventana: "SEMANA", tope: 10, alPasar: "SILENCIOSO" },
    { capa: "GLOBAL_SOLICITUDES", ventana: "HORA", tope: 100, alPasar: "VISIBLE" },
    { capa: "GLOBAL_VERIFICACIONES", ventana: "DIA", tope: global, alPasar: "VISIBLE" },
  ];
}

/**
 * Tres días: del jueves 1 de enero de 1970 (el origen del reloj) al lunes anterior. Es múltiplo de la hora y
 * del día, así que correr la cuenta no cambia dónde empiezan esas ventanas: solo alinea la semana en el lunes.
 */
const DESFASE_DE_LA_SEMANA_EN_MS = 3 * 86_400_000;

/**
 * Dónde empieza la ventana que contiene a `ahora`, en UTC: la hora en punto, la medianoche, o el lunes
 * a las 00:00 (semana ISO). Es la `ventana_inicio` del contador.
 */
export function inicioDeVentana(ventana: VentanaDeLimite, ahora: Date): Date {
  const duracion = DURACION_DE_VENTANA_EN_MS[ventana];
  const inicio =
    Math.floor((ahora.getTime() + DESFASE_DE_LA_SEMANA_EN_MS) / duracion) * duracion -
    DESFASE_DE_LA_SEMANA_EN_MS;
  return new Date(inicio);
}

const HUELLA = /^[0-9a-f]{64}$/;

/**
 * La clave del contador, con la forma que exige `limite_clave_ck`. IP y correo van como HMAC (hex de 64
 * dígitos) calculado con el secreto del servidor: un hash sin clave de una IPv4 se revierte probando
 * 2^32 valores, y nunca se guarda la IP ni el correo en claro. Las dos globales no llevan huella.
 */
export function claveDeContador(capa: CapaDeLimite, huella?: string): string {
  if (capa === "GLOBAL_SOLICITUDES") return "global:solicitudes";
  if (capa === "GLOBAL_VERIFICACIONES") return "global:verificaciones";
  // `String(undefined)` es "undefined", que no tiene la forma: una sola comprobación cubre los dos casos.
  if (!HUELLA.test(String(huella))) {
    throw new RangeError("la huella debe ser un HMAC en hexadecimal minúsculo de 64 dígitos");
  }
  return `${capa === "IP" ? "ip" : "correo"}:${huella}`;
}

/** Lo que devolvió el contador: la regla y la cuenta de la ventana, con este intento incluido. */
export type Observacion = Readonly<{ regla: ReglaDeLimite; cuenta: number }>;

export type DecisionDeLimite =
  | Readonly<{ tipo: "PERMITIDO" }>
  | Readonly<{ tipo: "EXCEDIDO"; capa: CapaDeLimite; visible: boolean }>;

/**
 * Pasa si ninguna cuenta supera su tope. Si se pasan varias, gana la primera `VISIBLE`: avisar «muchas
 * solicitudes» no revela nada de ningún correo, y callar sería dejar a una persona sin explicación.
 * Si solo se pasan silenciosas, gana la primera. La `capa` es para el tablero.
 */
export function decidirLimite(observaciones: readonly Observacion[]): DecisionDeLimite {
  const excedidas = observaciones.filter((o) => o.cuenta > o.regla.tope);
  const elegida = excedidas.find((o) => o.regla.alPasar === "VISIBLE") ?? excedidas[0];
  if (elegida === undefined) return { tipo: "PERMITIDO" };
  return {
    tipo: "EXCEDIDO",
    capa: elegida.regla.capa,
    visible: elegida.regla.alPasar === "VISIBLE",
  };
}
