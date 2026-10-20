import { randomBytes, webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import {
  AttributeTypeAndValue,
  BasicConstraints,
  Certificate,
  CertificationRequest,
  Extension,
  RelativeDistinguishedNames,
} from "pkijs";

/**
 * Certificados de PRUEBA (nunca claves reales): una autoridad raíz, una intermedia y la emisión de un certificado a
 * partir del pedido (CSR) que genera Pedernal, como haría ARCA. Las claves de las autoridades son de curva elíptica
 * solo por velocidad; lo que importa del certificado emitido es el sujeto, la clave pública del pedido, el emisor
 * y las fechas. Todo se genera en la propia prueba con `pkijs` y el WebCrypto de Node.
 */

const subtle = webcrypto.subtle;
const DIA = 86_400_000;

export type Autoridad = Readonly<{
  certificado: Certificate;
  certificadoPem: string;
  claveDeFirma: webcrypto.CryptoKey;
}>;

export type VigenciaDePrueba = Readonly<{ noAntes: Date; noDespues: Date }>;

const aPem = (der: ArrayBuffer): string => {
  const base64 = Buffer.from(der).toString("base64");
  const lineas = base64.match(/.{1,64}/g) ?? [];
  return `-----BEGIN CERTIFICATE-----\n${lineas.join("\n")}\n-----END CERTIFICATE-----\n`;
};

const atributo = (type: string, value: string): AttributeTypeAndValue =>
  new AttributeTypeAndValue({ type, value: new asn1js.Utf8String({ value }) });

/** Un nombre con un conjunto por atributo (como el de un `-subj` de `openssl`). */
function nombreDe(atributos: readonly AttributeTypeAndValue[]): RelativeDistinguishedNames {
  const nombre = new asn1js.Sequence({
    value: atributos.map((a) => new asn1js.Set({ value: [a.toSchema()] })),
  });
  return new RelativeDistinguishedNames({ schema: asn1js.fromBER(nombre.toBER()).result });
}

const numeroDeSerieAlAzar = (): ArrayBuffer => {
  const bytes = randomBytes(16);
  // Positivo y sin ceros a la izquierda (un INTEGER no mínimo lo rechaza X.509): primer byte entre 0x40 y 0x7f
  // (con máscara y no con módulo: el módulo sobre bytes al azar es la alerta de CodeQL de sesgo).
  bytes[0] = 0x40 | ((bytes[0] ?? 0) & 0x3f);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
};

function base(vigencia: VigenciaDePrueba): Certificate {
  const c = new Certificate();
  c.version = 2;
  c.serialNumber = new asn1js.Integer({ valueHex: numeroDeSerieAlAzar() });
  c.notBefore.value = vigencia.noAntes;
  c.notAfter.value = vigencia.noDespues;
  return c;
}

const restriccionesBasicas = (esCa: boolean): Extension =>
  new Extension({
    extnID: "2.5.29.19",
    critical: true,
    extnValue: new BasicConstraints({ cA: esCa }).toSchema().toBER(false),
  });

const usoDeClaveDeAutoridad = (): Extension =>
  new Extension({
    extnID: "2.5.29.15",
    critical: true,
    // keyCertSign (bit 5) y cRLSign (bit 6).
    extnValue: new asn1js.BitString({
      valueHex: new Uint8Array([0x06]).buffer,
      unusedBits: 1,
    }).toBER(false),
  });

async function crearAutoridad(
  nombre: string,
  emisor: Autoridad | null,
  vigencia: VigenciaDePrueba,
  esCa = true,
): Promise<Autoridad> {
  const par = await subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, [
    "sign",
    "verify",
  ]);
  const c = base(vigencia);
  c.subject = nombreDe([
    atributo("2.5.4.6", "AR"),
    atributo("2.5.4.10", "AFIP"),
    atributo("2.5.4.3", nombre),
  ]);
  c.issuer = emisor === null ? c.subject : emisor.certificado.subject;
  c.extensions = esCa
    ? [restriccionesBasicas(true), usoDeClaveDeAutoridad()]
    : [restriccionesBasicas(false)];
  await c.subjectPublicKeyInfo.importKey(par.publicKey);
  await c.sign(emisor === null ? par.privateKey : emisor.claveDeFirma, "SHA-256");
  return {
    certificado: c,
    certificadoPem: aPem(c.toSchema(true).toBER(false)),
    claveDeFirma: par.privateKey,
  };
}

const vigenciaPorDefecto = (): VigenciaDePrueba => ({
  noAntes: new Date(Date.now() - 3650 * DIA),
  noDespues: new Date(Date.now() + 3650 * DIA),
});

export const crearAutoridadRaiz = (
  nombre: string,
  vigencia: VigenciaDePrueba = vigenciaPorDefecto(),
) => crearAutoridad(nombre, null, vigencia);

/** `esCa: false` arma un certificado que NO es de autoridad (sin `CA:TRUE`) pero igual firma al siguiente. */
export const crearAutoridadIntermedia = (
  emisor: Autoridad,
  nombre: string,
  vigencia: VigenciaDePrueba = vigenciaPorDefecto(),
  esCa = true,
) => crearAutoridad(nombre, emisor, vigencia, esCa);

export type OpcionesDeEmision = Readonly<{
  /** Cambia el `serialNumber` del sujeto (por defecto, el del pedido). `null`: el certificado no lo trae. */
  numeroDeSerie?: string | null;
  noAntes?: Date;
  noDespues?: Date;
}>;

/**
 * El certificado que emitiría ARCA para un pedido: mismo sujeto y misma clave pública que el pedido, emitido y
 * firmado por `autoridad`, vigente un año por defecto. Devuelve el PEM.
 */
export async function emitirCertificado(
  autoridad: Autoridad,
  pedidoPem: string,
  opciones: OpcionesDeEmision = {},
): Promise<string> {
  const cuerpo = pedidoPem.replace(/-----[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const pedido = new CertificationRequest({
    schema: asn1js.fromBER(Buffer.from(cuerpo, "base64")).result,
  });
  const atributos = pedido.subject.typesAndValues.flatMap((a) => {
    if (a.type !== "2.5.4.5" || opciones.numeroDeSerie === undefined) return [a];
    return opciones.numeroDeSerie === null ? [] : [atributo("2.5.4.5", opciones.numeroDeSerie)];
  });
  const ahora = Date.now();
  const c = base({
    noAntes: opciones.noAntes ?? new Date(ahora - DIA),
    noDespues: opciones.noDespues ?? new Date(ahora + 365 * DIA),
  });
  c.subject = nombreDe(atributos);
  c.issuer = autoridad.certificado.subject;
  c.subjectPublicKeyInfo = pedido.subjectPublicKeyInfo;
  c.extensions = [restriccionesBasicas(false)];
  await c.sign(autoridad.claveDeFirma, "SHA-256");
  return aPem(c.toSchema(true).toBER(false));
}
