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

/**
 * Un entero positivo en DER MÍNIMO (X.690 §8.3.2): sin ceros a la izquierda salvo el único que evita que el bit alto
 * se lea como signo. OpenSSL rechaza cualquier otro relleno («illegal padding») y el certificado deja de verificar.
 */
function enteroEnDer(bytes: Uint8Array): Uint8Array {
  let desde = 0;
  while (desde < bytes.length - 1 && bytes[desde] === 0) desde++;
  const significativos = bytes.subarray(desde);
  const signo = ((significativos[0] ?? 0) & 0x80) === 0 ? [] : [0];
  const contenido = Uint8Array.from([...signo, ...significativos]);
  // P-256: cada entero mide a lo sumo 33 bytes, así que el largo cabe en la forma corta (< 128).
  return Uint8Array.from([0x02, contenido.length, ...contenido]);
}

/**
 * La firma ECDSA como la guarda un certificado: `SEQUENCE { INTEGER r, INTEGER s }` en DER, a partir de `r || s` (el
 * formato de WebCrypto, P1363). `pkijs` 3.4.1 lo hace mal en una firma de cada ~65.000: a un `r` o `s` que empieza con
 * dos bytes en cero (y un tercero menor que 0x80) le saca un solo cero y deja un relleno que OpenSSL no acepta; el
 * certificado así firmado no cierra ninguna cadena (visto como falso rojo en el CI, intermitente).
 */
export function firmaEcdsaEnDer(cruda: Uint8Array): Uint8Array {
  const mitad = cruda.length / 2;
  const r = enteroEnDer(cruda.subarray(0, mitad));
  const s = enteroEnDer(cruda.subarray(mitad));
  return Uint8Array.from([0x30, r.length + s.length, ...r, ...s]);
}

/**
 * Firma el certificado con una clave ECDSA P-256 (SHA-256). `pkijs` arma el algoritmo y el cuerpo a firmar; la firma
 * se vuelve a calcular acá sobre ese mismo cuerpo para escribirla en DER mínimo (ver `firmaEcdsaEnDer`).
 */
async function firmar(c: Certificate, claveDeFirma: webcrypto.CryptoKey): Promise<void> {
  await c.sign(claveDeFirma, "SHA-256");
  const cruda = await subtle.sign(
    { name: "ECDSA", hash: "SHA-256" },
    claveDeFirma,
    Uint8Array.from(c.tbsView),
  );
  const der = Uint8Array.from(firmaEcdsaEnDer(new Uint8Array(cruda)));
  c.signatureValue = new asn1js.BitString({ valueHex: der.buffer });
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
  await firmar(c, emisor === null ? par.privateKey : emisor.claveDeFirma);
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
  await firmar(c, autoridad.claveDeFirma);
  return aPem(c.toSchema(true).toBER(false));
}
