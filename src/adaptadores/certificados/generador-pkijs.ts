import { webcrypto } from "node:crypto";
import * as asn1js from "asn1js";
import { AttributeTypeAndValue, CertificationRequest, RelativeDistinguishedNames } from "pkijs";
import { Secreto } from "../../primitivas/secreto/secreto";
import type {
  CredencialGenerada,
  DatosDelPedido,
  GeneradorDeCredenciales,
} from "../../puertos/generador-de-credenciales";

/**
 * Genera la clave privada de un certificado de ARCA y su pedido (CSR) con `pkijs` y el WebCrypto de Node (spec H7
 * facturación §B.6, decisión del dueño 2026-10-14). Todo ocurre en el servidor: la clave se exporta una sola vez, a
 * PKCS#8 en PEM, envuelta en un `Secreto` para que `generar` la entregue a quien la cifra y la guarda; el
 * pedido sale en PEM y es público.
 *
 * Lo que pide ARCA (WSASS y «Administración de Certificados Digitales»): RSA de 2048 bits, firma SHA-256 y sujeto
 * `C=AR, O=<organización>, CN=<alias>, serialNumber=CUIT <11 dígitos>`.
 */

const ALGORITMO = { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" } as const;
const OID = {
  pais: "2.5.4.6",
  organizacion: "2.5.4.10",
  nombreComun: "2.5.4.3",
  numeroDeSerie: "2.5.4.5",
} as const;
const COLUMNAS = 64;

const subtle = webcrypto.subtle;

function aPem(etiqueta: string, der: ArrayBuffer): string {
  const base64 = Buffer.from(der).toString("base64");
  const lineas: string[] = [];
  for (let i = 0; i < base64.length; i += COLUMNAS) lineas.push(base64.slice(i, i + COLUMNAS));
  return `-----BEGIN ${etiqueta}-----\n${lineas.join("\n")}\n-----END ${etiqueta}-----\n`;
}

const atributo = (type: string, value: asn1js.Utf8String | asn1js.PrintableString) =>
  new AttributeTypeAndValue({ type, value });

/**
 * El sujeto como lo arma `openssl req -subj /C=AR/O=.../CN=.../serialNumber=...`: un conjunto (RDN) por cada
 * atributo, en ese orden. `pkijs` por defecto junta todos en UN conjunto («RDN multivaluado»), que es otro
 * nombre para X.509 y que la autoridad de ARCA podría no aceptar; por eso se arma el nombre a mano y se le
 * entrega ya codificado.
 */
function sujetoDe(atributos: readonly AttributeTypeAndValue[]): RelativeDistinguishedNames {
  const nombre = new asn1js.Sequence({
    value: atributos.map((a) => new asn1js.Set({ value: [a.toSchema()] })),
  });
  return new RelativeDistinguishedNames({ schema: asn1js.fromBER(nombre.toBER()).result });
}

export function crearGeneradorDeCredenciales(): GeneradorDeCredenciales {
  return {
    async generar(datos: DatosDelPedido): Promise<CredencialGenerada> {
      const par = await subtle.generateKey(
        { ...ALGORITMO, modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]) },
        true,
        ["sign", "verify"],
      );
      if (!("privateKey" in par)) throw new Error("no se generó el par de claves");

      const pedido = new CertificationRequest({ version: 0 });
      pedido.subject = sujetoDe([
        atributo(OID.pais, new asn1js.PrintableString({ value: "AR" })),
        atributo(OID.organizacion, new asn1js.Utf8String({ value: datos.organizacion })),
        atributo(OID.nombreComun, new asn1js.Utf8String({ value: datos.alias })),
        atributo(OID.numeroDeSerie, new asn1js.PrintableString({ value: datos.numeroDeSerie })),
      ]);
      await pedido.subjectPublicKeyInfo.importKey(par.publicKey);
      await pedido.sign(par.privateKey, "SHA-256");

      const pkcs8 = await subtle.exportKey("pkcs8", par.privateKey);
      return {
        clavePrivada: new Secreto(aPem("PRIVATE KEY", pkcs8)),
        pedidoPem: aPem("CERTIFICATE REQUEST", pedido.toSchema().toBER()),
      };
    },
  };
}
