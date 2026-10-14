import { createPrivateKey, webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import type { CredencialesDescifradas } from "../../puertos/credenciales-de-emisor";

/**
 * Firma del TRA en CMS (spec H7 facturación §B.5.3) con **pkijs + asn1js**, las librerías aprobadas por el
 * dueño (decisión 13). Es la forma que el WSAA de homologación real aceptó con SHA-256 (espía F0, E3): un
 * `SignedData` con el TRA ADENTRO (contenido adjunto, no separado), el certificado incluido y los tres
 * atributos firmados (`contentType`, `signingTime`, `messageDigest`). SHA-1, que la especificación 1.2.2
 * nombra, no se pudo comprobar (WSAA ya tenía un ticket vigente y respondió `coe.alreadyAuthenticated`): se
 * usa SHA-256, el algoritmo vigente, que sí obtuvo el ticket.
 *
 * La clave privada se usa SOLO acá, en memoria, y no se escribe, no se registra ni sale en ningún error: un
 * fallo de firma lanza `ErrorDeFirma` con un texto fijo, sin el de la excepción original (que podría traer
 * pedazos de la clave o del certificado).
 */

export class ErrorDeFirma extends Error {
  override name = "ErrorDeFirma";
  constructor() {
    super("no se pudo firmar el pedido de acceso con la credencial del emisor");
  }
}

pkijs.setEngine(
  "node",
  new pkijs.CryptoEngine({
    name: "node",
    crypto: webcrypto as unknown as ConstructorParameters<typeof pkijs.CryptoEngine>[0]["crypto"],
  }),
);

const OID_DATOS = "1.2.840.113549.1.7.1";
const OID_DATOS_FIRMADOS = "1.2.840.113549.1.7.2";
const OID_TIPO_DE_CONTENIDO = "1.2.840.113549.1.9.3";
const OID_RESUMEN_DEL_MENSAJE = "1.2.840.113549.1.9.4";
const OID_HORA_DE_FIRMA = "1.2.840.113549.1.9.5";

/** El primer certificado del PEM como DER. */
function certificadoDesdePem(pem: string): pkijs.Certificate {
  const bloque = /-----BEGIN CERTIFICATE-----([\s\S]+?)-----END CERTIFICATE-----/.exec(pem);
  if (bloque === null) throw new ErrorDeFirma();
  return pkijs.Certificate.fromBER(Buffer.from((bloque[1] ?? "").replace(/\s+/g, ""), "base64"));
}

/** La clave privada (PKCS#1 «RSA PRIVATE KEY» o PKCS#8) lista para firmar con RSA y SHA-256. */
async function claveDeFirma(pem: string): Promise<webcrypto.CryptoKey> {
  const pkcs8 = createPrivateKey(pem).export({ format: "der", type: "pkcs8" });
  return webcrypto.subtle.importKey(
    "pkcs8",
    pkcs8,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

/**
 * El CMS (DER en base64) del TRA firmado con la credencial del emisor: lo que va en `loginCms`.
 * `ahora` es la hora de la firma (`signingTime`).
 */
export async function firmarTra(
  tra: string,
  credencial: Pick<CredencialesDescifradas, "certificadoPem" | "clavePrivada">,
  ahora: Date,
): Promise<string> {
  try {
    const certificado = certificadoDesdePem(credencial.certificadoPem);
    // La clave se revela acá, en el último punto posible, y no sale de esta función.
    const clave = await claveDeFirma(credencial.clavePrivada.revelar());
    const contenido = new TextEncoder().encode(tra);
    const resumen = await webcrypto.subtle.digest("SHA-256", contenido);
    const firmado = new pkijs.SignedData({
      version: 1,
      encapContentInfo: new pkijs.EncapsulatedContentInfo({
        eContentType: OID_DATOS,
        eContent: new asn1js.OctetString({ valueHex: contenido }),
      }),
      signerInfos: [
        new pkijs.SignerInfo({
          version: 1,
          sid: new pkijs.IssuerAndSerialNumber({
            issuer: certificado.issuer,
            serialNumber: certificado.serialNumber,
          }),
          signedAttrs: new pkijs.SignedAndUnsignedAttributes({
            type: 0,
            attributes: [
              new pkijs.Attribute({
                type: OID_TIPO_DE_CONTENIDO,
                values: [new asn1js.ObjectIdentifier({ value: OID_DATOS })],
              }),
              new pkijs.Attribute({
                type: OID_HORA_DE_FIRMA,
                values: [new asn1js.UTCTime({ valueDate: ahora })],
              }),
              new pkijs.Attribute({
                type: OID_RESUMEN_DEL_MENSAJE,
                values: [new asn1js.OctetString({ valueHex: resumen })],
              }),
            ],
          }),
        }),
      ],
      certificates: [certificado],
    });
    await firmado.sign(clave, 0, "SHA-256");
    const envoltorio = new pkijs.ContentInfo({
      contentType: OID_DATOS_FIRMADOS,
      content: firmado.toSchema(true),
    });
    return Buffer.from(envoltorio.toSchema().toBER(false)).toString("base64");
  } catch {
    throw new ErrorDeFirma();
  }
}
