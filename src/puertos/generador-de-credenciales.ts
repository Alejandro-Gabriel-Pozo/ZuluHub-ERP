import type { Secreto } from "../primitivas/secreto/secreto";

/**
 * Genera el par de claves de un certificado de ARCA y su pedido (CSR) dentro del servidor (spec H7 facturación
 * §B.6, decisión del dueño 2026-10-14): la clave privada NUNCA sale de ZuluHub; ARCA solo recibe el pedido, que es
 * público.
 */
export type DatosDelPedido = Readonly<{
  /** El alias (`CN`): letras y dígitos, ya validado. */
  alias: string;
  /** La organización (`O`): ya validada. */
  organizacion: string;
  /** El `serialNumber` del sujeto (`CUIT 20123456786`): ya armado. */
  numeroDeSerie: string;
}>;

export type CredencialGenerada = Readonly<{
  /** La clave privada en PEM (PKCS#8), envuelta: solo se cifra y se guarda, nunca se muestra. */
  clavePrivada: Secreto;
  /** El pedido en PEM (`CERTIFICATE REQUEST`) con sujeto `C=AR, O, CN, serialNumber`. Es público. */
  pedidoPem: string;
}>;

export interface GeneradorDeCredenciales {
  /** Un par RSA de 2048 bits y su CSR firmado con SHA-256. Cada llamada genera un par nuevo. */
  generar(datos: DatosDelPedido): Promise<CredencialGenerada>;
}
