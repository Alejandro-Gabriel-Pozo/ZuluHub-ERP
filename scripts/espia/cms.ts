import { createPrivateKey, generateKeyPairSync, webcrypto, type KeyObject } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { escapar } from "./xml.ts";

/**
 * Firma del TRA en CMS y pedido de certificado (CSR) con **pkijs + asn1js**, la candidata de la decisión 13, probada
 * SOLO en esta rama descartable (h7 facturación §B.5.6, E1 y E3). Todo en memoria: la clave privada no se escribe en
 * ningún lado salvo donde el dueño lo pide (E1, una ruta suya con permisos 600) y nunca se imprime.
 */

const motor = new pkijs.CryptoEngine({
  name: "node",
  crypto: webcrypto as unknown as ConstructorParameters<typeof pkijs.CryptoEngine>[0]["crypto"],
});
pkijs.setEngine("node", motor);

export type Hash = "SHA-256" | "SHA-1";

/** La clave de WebCrypto tal como la pide pkijs (sin depender de los tipos del navegador). */
type ClaveWeb = webcrypto.CryptoKey;

const OID_DATA = "1.2.840.113549.1.7.1";
const OID_SIGNED_DATA = "1.2.840.113549.1.7.2";
const OID_CONTENT_TYPE = "1.2.840.113549.1.9.3";
const OID_MESSAGE_DIGEST = "1.2.840.113549.1.9.4";
const OID_SIGNING_TIME = "1.2.840.113549.1.9.5";

/** El contenido de un bloque PEM (`-----BEGIN <tipo>-----`) como bytes. */
export function desdePem(pem: string, tipo: string): Uint8Array {
  const m = new RegExp(`-----BEGIN ${tipo}-----([\\s\\S]+?)-----END ${tipo}-----`).exec(pem);
  if (m === null) throw new RangeError(`no hay un bloque ${tipo} en el PEM`);
  return new Uint8Array(Buffer.from((m[1] ?? "").replace(/\s+/g, ""), "base64"));
}

export function aPem(der: ArrayBuffer | Uint8Array, tipo: string): string {
  const b64 = Buffer.from(der instanceof Uint8Array ? der : new Uint8Array(der)).toString("base64");
  const lineas = b64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN ${tipo}-----\n${lineas.join("\n")}\n-----END ${tipo}-----\n`;
}

/** El certificado X.509 (PEM o DER) como objeto de pkijs. */
export function leerCertificado(pemODer: string | Uint8Array): pkijs.Certificate {
  const der =
    typeof pemODer === "string" ? desdePem(pemODer, "CERTIFICATE") : new Uint8Array(pemODer);
  return pkijs.Certificate.fromBER(der);
}

/** La clave privada (PKCS#1 «RSA PRIVATE KEY» o PKCS#8) importada para firmar con ese hash. */
async function importarClave(clave: KeyObject | string, hash: Hash): Promise<ClaveWeb> {
  const objeto = typeof clave === "string" ? createPrivateKey(clave) : clave;
  const pkcs8 = objeto.export({ format: "der", type: "pkcs8" });
  return webcrypto.subtle.importKey("pkcs8", pkcs8, { name: "RSASSA-PKCS1-v1_5", hash }, false, [
    "sign",
  ]);
}

/** Fecha con el huso de Argentina (−03:00), como la piden los ejemplos de WSAA. */
function conHuso(instante: Date): string {
  const local = new Date(instante.getTime() - 3 * 3_600_000);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/**
 * El TRA (copia WSAA 1.2.2, p. 7): `generationTime = ahora − 2 min` y `expirationTime = ahora + 10 min` (ASUMIDO en
 * §B.5.3, para tolerar un reloj algo corrido), `uniqueId` entero sin signo de 32 bits, servicio `wsfe`.
 */
export function armarTra(ahora: Date, servicio = "wsfe"): string {
  const unico = Math.floor(ahora.getTime() / 1000) % 4_294_967_296;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${unico}</uniqueId>` +
    `<generationTime>${conHuso(new Date(ahora.getTime() - 2 * 60_000))}</generationTime>` +
    `<expirationTime>${conHuso(new Date(ahora.getTime() + 10 * 60_000))}</expirationTime>` +
    `</header><service>${escapar(servicio)}</service></loginTicketRequest>`
  );
}

/**
 * CMS `SignedData` con el TRA ADENTRO (contenido adjunto), el certificado incluido y los tres atributos firmados
 * (`contentType`, `messageDigest`, `signingTime`): la misma forma que, según la revisión de terceros, acepta
 * homologación con SHA-256. Devuelve el DER en base64 (lo que va en `loginCms`).
 */
export async function firmarTra(
  tra: string,
  certificado: pkijs.Certificate,
  clave: KeyObject | string,
  hash: Hash,
  ahora: Date,
): Promise<string> {
  const contenido = new TextEncoder().encode(tra);
  const privada = await importarClave(clave, hash);
  const resumen = await webcrypto.subtle.digest(hash, contenido);
  const firmado = new pkijs.SignedData({
    version: 1,
    encapContentInfo: new pkijs.EncapsulatedContentInfo({
      eContentType: OID_DATA,
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
              type: OID_CONTENT_TYPE,
              values: [new asn1js.ObjectIdentifier({ value: OID_DATA })],
            }),
            new pkijs.Attribute({
              type: OID_SIGNING_TIME,
              values: [new asn1js.UTCTime({ valueDate: ahora })],
            }),
            new pkijs.Attribute({
              type: OID_MESSAGE_DIGEST,
              values: [new asn1js.OctetString({ valueHex: resumen })],
            }),
          ],
        }),
      }),
    ],
    certificates: [certificado],
  });
  await firmado.sign(privada, 0, hash);
  const envoltorio = new pkijs.ContentInfo({
    contentType: OID_SIGNED_DATA,
    content: firmado.toSchema(true),
  });
  return Buffer.from(envoltorio.toSchema().toBER(false)).toString("base64");
}

/** Lee un CMS (base64) y verifica su firma con el certificado que trae adentro. Para las pruebas y el servidor falso. */
export async function verificarCms(
  base64: string,
): Promise<{ valida: boolean; contenido: string; hash: string; certificado: string }> {
  const info = pkijs.ContentInfo.fromBER(Buffer.from(base64, "base64"));
  const firmado = new pkijs.SignedData({ schema: info.content });
  // pkijs lanza (y no devuelve `false`) cuando el resumen del contenido no coincide: las dos cosas son «no verifica».
  const valida = await firmado.verify({ signer: 0, checkChain: false }).catch(() => false);
  const eContent = firmado.encapContentInfo.eContent;
  const contenido = eContent === undefined ? "" : new TextDecoder().decode(eContent.getValue());
  const oid = firmado.signerInfos[0]?.digestAlgorithm.algorithmId ?? "";
  const hash =
    oid === "2.16.840.1.101.3.4.2.1" ? "SHA-256" : oid === "1.3.14.3.2.26" ? "SHA-1" : oid;
  const cert = firmado.certificates?.[0];
  const certificado =
    cert instanceof pkijs.Certificate
      ? Buffer.from(cert.serialNumber.valueBlock.valueHexView).toString("hex") +
        Buffer.from(cert.subjectPublicKeyInfo.subjectPublicKey.valueBlock.valueHexView)
          .subarray(0, 16)
          .toString("hex")
      : "";
  return { valida, contenido, hash, certificado };
}

export type SujetoDelPedido = Readonly<{ organizacion: string; alias: string; cuit: string }>;

/**
 * E1: clave RSA 2048 y CSR con sujeto `C=AR, O=<organización>, CN=<alias>, serialNumber=CUIT <cuit>` (manual WSASS),
 * firmado con SHA-256. Devuelve el CSR en PEM y la clave como objeto (quien llama decide si la guarda y dónde).
 */
export async function generarPedido(
  sujeto: SujetoDelPedido,
): Promise<{ pedidoPem: string; clave: KeyObject }> {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pedido = new pkijs.CertificationRequest();
  pedido.version = 0;
  const atributo = (tipo: string, valor: asn1js.BaseStringBlock) =>
    new pkijs.AttributeTypeAndValue({ type: tipo, value: valor });
  pedido.subject.typesAndValues.push(
    atributo("2.5.4.6", new asn1js.PrintableString({ value: "AR" })),
    atributo("2.5.4.10", new asn1js.Utf8String({ value: sujeto.organizacion })),
    atributo("2.5.4.3", new asn1js.Utf8String({ value: sujeto.alias })),
    atributo("2.5.4.5", new asn1js.PrintableString({ value: `CUIT ${sujeto.cuit}` })),
  );
  const publica = await webcrypto.subtle.importKey(
    "spki",
    publicKey.export({ format: "der", type: "spki" }),
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"],
  );
  await pedido.subjectPublicKeyInfo.importKey(publica);
  await pedido.sign(await importarClave(privateKey, "SHA-256"), "SHA-256");
  return {
    pedidoPem: aPem(pedido.toSchema().toBER(false), "CERTIFICATE REQUEST"),
    clave: privateKey,
  };
}

/** Un certificado autofirmado para la clave dada: SOLO para el modo `--seco` y las pruebas (nunca va a ARCA). */
export async function certificadoDePrueba(
  clave: KeyObject,
  publicaDer: Uint8Array,
  cuit: string,
): Promise<pkijs.Certificate> {
  const cert = new pkijs.Certificate();
  cert.version = 2;
  cert.serialNumber = new asn1js.Integer({ value: 1 });
  const nombre = (n: pkijs.RelativeDistinguishedNames) => {
    n.typesAndValues.push(
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.3",
        value: new asn1js.Utf8String({ value: "espia-seco" }),
      }),
      new pkijs.AttributeTypeAndValue({
        type: "2.5.4.5",
        value: new asn1js.PrintableString({ value: `CUIT ${cuit}` }),
      }),
    );
  };
  nombre(cert.issuer);
  nombre(cert.subject);
  cert.notBefore.value = new Date(Date.UTC(2026, 0, 1));
  cert.notAfter.value = new Date(Date.UTC(2036, 0, 1));
  const publica = await webcrypto.subtle.importKey(
    "spki",
    publicaDer,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    true,
    ["verify"],
  );
  await cert.subjectPublicKeyInfo.importKey(publica);
  await cert.sign(await importarClave(clave, "SHA-256"), "SHA-256");
  return cert;
}
