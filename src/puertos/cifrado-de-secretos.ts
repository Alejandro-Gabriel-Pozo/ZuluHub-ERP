import type { EmpresaId } from "../primitivas/identificadores/marca";
import type { Secreto } from "../primitivas/secreto/secreto";

/**
 * Cifrado de lo que no puede quedar en claro en la base: la clave privada de un certificado y el ticket de
 * acceso de ARCA (spec H7 facturación §B.6.3). Lo implementa el adaptador de AES-256-GCM; los casos de uso solo
 * conocen este contrato y nunca ven la clave maestra.
 */

/**
 * Un texto cifrado con AES-256-GCM: los bytes, el nonce de 12, la etiqueta de 16 y el identificador (`kid`) de la
 * clave maestra que lo cifró. El `kid` viaja con el texto para poder rotar la clave maestra sin dejar de leer lo
 * viejo: se descifra con la clave que lo cifró, y lo nuevo se cifra con la activa.
 */
export type TextoCifrado = Readonly<{
  cifrado: Uint8Array;
  nonce: Uint8Array;
  etiqueta: Uint8Array;
  kid: string;
}>;

/**
 * La fila y la columna donde vive un texto cifrado. Entra al cifrado como dato asociado (AAD) y ata el texto a su
 * lugar: copiarlo a otra fila, a otra columna o a otra empresa y descifrarlo falla. Previene que quien pueda
 * escribir en la base haga pasar la clave (o el ticket) de un emisor por la de otro. Chequeo: las pruebas
 * «mover el texto cifrado a otra fila, columna o empresa no descifra».
 */
export type DondeSeGuarda = Readonly<{
  empresaId: EmpresaId;
  tabla: string;
  /** El identificador de la fila (si la clave es compuesta, todas sus partes). */
  filaId: string;
  columna: string;
}>;

export interface CifradorDeSecretos {
  /** Cifra con la clave maestra ACTIVA y un nonce nuevo; dos cifrados del mismo secreto no se parecen. */
  cifrar(secreto: Secreto, donde: DondeSeGuarda): TextoCifrado;
  /**
   * El secreto, o `null` si no se puede descifrar: `kid` desconocido, texto alterado o movido de lugar. No dice
   * cuál de esas fue (no es un oráculo para quien pruebe cambios).
   */
  descifrar(texto: TextoCifrado, donde: DondeSeGuarda): Secreto | null;
}
