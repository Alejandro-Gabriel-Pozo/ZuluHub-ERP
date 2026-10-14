import type { Secreto } from "../primitivas/secreto/secreto";
import type { AmbienteDeArca } from "./credenciales-de-emisor";

/**
 * Lo que se sabe de un certificado X.509 leído (todo público). Lo arma el adaptador con `node:crypto` y `pkijs`;
 * quién decide si sirve es el dominio (`evaluarCertificado`).
 */
export type CertificadoLeido = Readonly<{
  /** SHA-256 del certificado en DER, hexadecimal minúscula (64 caracteres). */
  huellaSha256: string;
  /** El `serialNumber` del sujeto (`CUIT 20123456786`); `null` si no tiene. */
  numeroDeSerieDelSujeto: string | null;
  noAntes: Date;
  noDespues: Date;
}>;

export interface LectorDeCertificados {
  /** `null` si no es un certificado X.509 legible. */
  leer(certificadoPem: string): CertificadoLeido | null;
  /** ¿La clave pública del certificado es la que se deriva de esa clave privada? */
  correspondeALaClave(certificadoPem: string, clavePrivada: Secreto): boolean;
  /**
   * ¿La cadena del certificado cierra contra la de ARCA de ESE ambiente (nunca la del otro)? Sin cadena configurada
   * para el ambiente, no cierra: falla cerrado.
   */
  cadenaCierra(certificadoPem: string, ambiente: AmbienteDeArca, ahora: Date): boolean;
}
