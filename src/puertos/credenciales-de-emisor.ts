import type { EmisorId, EmpresaId } from "../primitivas/identificadores/marca";

/**
 * Puerto de las credenciales de un emisor ante ARCA (spec H7 facturación §B.6, tramo F7): el certificado
 * y la clave privada con los que se firma el pedido de acceso de WSAA. Cada cliente es dueño de su
 * certificado: hay uno por (emisor, ambiente), y pedirle el de otro par sería firmar con la credencial
 * equivocada.
 *
 * Lo implementa F7 (certificados): descifra la clave SOLO en memoria, en el momento de pedirla. Quien la
 * recibe (el adaptador de ARCA) la usa para firmar y la suelta: no la guarda, no la registra ni la
 * incluye en ningún error. Este archivo declara solo la forma mínima que el adaptador necesita; si F7
 * lo declara con otro nombre de archivo, se unifica al integrar.
 */
export type AmbienteDeArca = "HOMOLOGACION" | "PRODUCCION";

/** Ambos en PEM. La clave privada es la del certificado (PKCS#8 o PKCS#1, sin contraseña). */
export type CredencialDeEmisor = Readonly<{
  certificadoPem: string;
  clavePrivadaPem: string;
}>;

export interface CredencialesDeEmisor {
  /** `null` si el emisor no tiene un certificado vigente en ese ambiente (no hay con qué firmar). */
  obtener(
    empresa: EmpresaId,
    emisor: EmisorId,
    ambiente: AmbienteDeArca,
  ): Promise<CredencialDeEmisor | null>;
}
