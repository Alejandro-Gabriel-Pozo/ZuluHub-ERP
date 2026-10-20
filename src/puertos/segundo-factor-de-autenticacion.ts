/**
 * Lo que el segundo factor de la consola de plataforma guarda en el esquema de autenticación y no es de la librería
 * (h5-p8 §2.4 y §2.6): los intentos, los códigos TOTP ya usados y la marca de «segundo factor verificado» de la
 * sesión. Tipos puros: ni la herramienta de datos ni la librería de ingreso aparecen acá.
 */

/** Dentro de un intento, lo que el verificador del código puede registrar. */
export type TxDeIntento = Readonly<{
  /**
   * Registra el paso de reloj del TOTP que coincidió. `false` si ese usuario ya había usado ese paso (G2): el
   * código se está repitiendo y no vale. Lo decide la base con una clave única, no una lectura previa.
   */
  registrarPasoUsado(paso: number): Promise<boolean>;
}>;

export type ResultadoDeIntento =
  /** Hay un bloqueo vigente: el código ni se miró. No se registró ningún fallo. */
  | Readonly<{ tipo: "BLOQUEADO"; hasta: Date }>
  | Readonly<{ tipo: "VALIDO" }>
  /** El código no valía. `bloqueoNuevo` solo está cuando ESTE fallo fue el que completó el bloqueo. */
  | Readonly<{ tipo: "INVALIDO"; bloqueoNuevo: Readonly<{ hasta: Date; fallos: number }> | null }>;

export interface SegundoFactorDeAutenticacion {
  /**
   * Un intento de código del usuario, SERIALIZADO con los demás del mismo usuario (para que el límite de intentos
   * no se esquive pidiendo en paralelo). Con el bloqueo vigente, devuelve `BLOQUEADO` sin llamar al verificador.
   * Si no, llama a `verificar` (que decide si el código vale y puede registrar el paso usado en la MISMA transacción):
   * válido, borra los fallos del usuario; inválido, registra uno. El verificador corre con un candado tomado: tiene
   * que ser rápido y no abrir otra conexión (con el pool lleno, esperaría a quien espera por él).
   */
  intentarCodigo(
    usuario: string,
    ahora: Date,
    verificar: (tx: TxDeIntento) => Promise<boolean>,
  ): Promise<ResultadoDeIntento>;

  /**
   * Marca `segundo_factor_en = ahora` en la sesión con ese token (G1). Devuelve `false` si no hay tal sesión. No
   * retrocede: si ya tenía una marca más nueva, queda esa.
   */
  marcarSegundoFactor(tokenDeSesion: string, ahora: Date): Promise<boolean>;
}

/**
 * La constancia de que el segundo factor de alguien quedó bloqueado por intentos fallidos, en la auditoría de
 * plataforma. SIN datos sensibles: ni códigos, ni secretos, ni direcciones `otpauth`; solo quién (el id del
 * administrador, que sale de su email) y hasta cuándo. Si el email no es de un administrador, no hay nada que auditar.
 */
export interface AuditoriaDeIngresoDePlataforma {
  registrarBloqueoDeSegundoFactor(
    datos: Readonly<{ email: string; hasta: Date; fallos: number }>,
  ): Promise<void>;
}
