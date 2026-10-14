import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { Secreto } from "../../primitivas/secreto/secreto";
import type {
  CifradorDeSecretos,
  DondeSeGuarda,
  TextoCifrado,
} from "../../puertos/cifrado-de-secretos";
import { ErrorDeConfiguracion } from "../postgres/errores";

/**
 * Cifrado de secretos con AES-256-GCM (spec H7 facturación §B.6.3): la clave privada de un certificado y el ticket
 * de acceso de ARCA.
 *
 * - Nonce de 12 bytes al azar por cifrado y etiqueta de 16: dos cifrados del mismo secreto no se parecen.
 * - Dato asociado (AAD) = empresa, tabla, fila y columna (`DondeSeGuarda`), en una lista JSON (no se confunden
 *   los límites entre partes aunque una contenga `|`). Previene copiar el texto de una fila a otra, o de otra
 *   empresa, y que descifre igual. Chequeo: `aes-gcm.test.ts` (mover a otra fila, columna o empresa no descifra).
 * - Clave maestra VERSIONADA: cada clave tiene un `kid` y el texto cifrado lo guarda. Se cifra con la activa y se
 *   descifra con la que lo cifró, así rotar la clave maestra (agregar una nueva y pasar la vieja a `anteriores`)
 *   no deja ilegible lo guardado. La rotación automática y su recifrado son de otro tramo.
 * - Acá no se lee el entorno: la composición le pasa el texto de la variable (formato `<kid>:<64 hexadecimales>`)
 *   a `parsearClaveMaestra`. Ningún mensaje de error incluye una clave.
 */

const ALGORITMO = "aes-256-gcm";
const BYTES_DE_CLAVE = 32;
const BYTES_DE_NONCE = 12;
const BYTES_DE_ETIQUETA = 16;
const KID = /^[A-Za-z0-9._-]{1,50}$/;
const HEXADECIMAL_DE_CLAVE = /^[0-9a-fA-F]{64}$/;

/** Una clave maestra con su identificador. La clave nunca sale de este archivo. */
export type ClaveMaestra = Readonly<{ kid: string; clave: Buffer }>;

/**
 * Lee `<kid>:<hex>` (el `kid` de 1 a 50 letras, dígitos, punto, guion o guion bajo; la clave, 64 dígitos
 * hexadecimales = 32 bytes). Lanza `ErrorDeConfiguracion` si no tiene esa forma; su mensaje NUNCA repite el valor.
 */
export function parsearClaveMaestra(texto: string): ClaveMaestra {
  const limpio = texto.trim();
  const separador = limpio.indexOf(":");
  const kid = limpio.slice(0, separador);
  const hexadecimal = limpio.slice(separador + 1);
  if (separador < 0 || !KID.test(kid) || !HEXADECIMAL_DE_CLAVE.test(hexadecimal)) {
    throw new ErrorDeConfiguracion(
      `la clave maestra de cifrado de certificados no tiene la forma <kid>:<${BYTES_DE_CLAVE * 2} hexadecimales>`,
    );
  }
  return { kid, clave: Buffer.from(hexadecimal, "hex") };
}

export type ClavesMaestras = Readonly<{
  /** Con la que se cifra de ahora en más. */
  activa: ClaveMaestra;
  /** Las que cifraron lo ya guardado y todavía se leen. */
  anteriores?: readonly ClaveMaestra[];
}>;

const aad = (donde: DondeSeGuarda): Buffer =>
  Buffer.from(JSON.stringify([donde.empresaId, donde.tabla, donde.filaId, donde.columna]), "utf8");

export function crearCifradorAesGcm(
  claves: ClavesMaestras,
  /** Solo para las pruebas: el generador de bytes al azar. */
  azar: (bytes: number) => Buffer = randomBytes,
): CifradorDeSecretos {
  const porKid = new Map<string, Buffer>();
  for (const { kid, clave } of [claves.activa, ...(claves.anteriores ?? [])]) {
    if (!KID.test(kid) || clave.length !== BYTES_DE_CLAVE || porKid.has(kid)) {
      throw new ErrorDeConfiguracion(
        "las claves maestras de cifrado de certificados no son válidas: kid inválido o repetido, o clave que no es de 32 bytes",
      );
    }
    // Copia: que nadie cambie la clave desde afuera después de construir el cifrador.
    porKid.set(kid, Buffer.from(clave));
  }
  const kidActivo = claves.activa.kid;
  const claveActiva = porKid.get(kidActivo);
  if (claveActiva === undefined) throw new Error("la clave maestra activa no se registró");

  return {
    cifrar(secreto, donde): TextoCifrado {
      const nonce = azar(BYTES_DE_NONCE);
      const cifrador = createCipheriv(ALGORITMO, claveActiva, nonce, {
        authTagLength: BYTES_DE_ETIQUETA,
      });
      cifrador.setAAD(aad(donde));
      const cifrado = Buffer.concat([cifrador.update(secreto.revelar(), "utf8"), cifrador.final()]);
      return { cifrado, nonce, etiqueta: cifrador.getAuthTag(), kid: kidActivo };
    },

    descifrar(texto, donde): Secreto | null {
      const clave = porKid.get(texto.kid);
      if (
        clave === undefined ||
        texto.nonce.length !== BYTES_DE_NONCE ||
        texto.etiqueta.length !== BYTES_DE_ETIQUETA
      ) {
        return null;
      }
      try {
        const descifrador = createDecipheriv(ALGORITMO, clave, texto.nonce, {
          authTagLength: BYTES_DE_ETIQUETA,
        });
        descifrador.setAAD(aad(donde));
        descifrador.setAuthTag(texto.etiqueta);
        const claro = Buffer.concat([descifrador.update(texto.cifrado), descifrador.final()]);
        return new Secreto(claro.toString("utf8"));
      } catch {
        // Etiqueta que no cierra (texto alterado, movido de lugar o clave equivocada): no se dice cuál.
        return null;
      }
    },
  };
}
