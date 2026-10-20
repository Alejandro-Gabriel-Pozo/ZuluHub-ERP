import { generateKeyPairSync, webcrypto, type KeyObject } from "node:crypto";
import * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { Secreto } from "../../src/primitivas/secreto/secreto";
import type { CredencialesDescifradas } from "../../src/puertos/credenciales-de-emisor";

/**
 * Una credencial de prueba para el adaptador de ARCA: clave RSA y certificado autofirmado generados al vuelo
 * (nunca van a ARCA). Aparte de `arca.ts` porque arrastra `pkijs`, y las pruebas puras no lo necesitan.
 */

export type CredencialGenerada = Readonly<{
  credencial: CredencialesDescifradas;
  clavePrivada: KeyObject;
  certificadoDer: Uint8Array;
}>;

const PEM = (tipo: string, der: Uint8Array): string =>
  `-----BEGIN ${tipo}-----\n${(
    Buffer.from(der)
      .toString("base64")
      .match(/.{1,64}/g) ?? []
  ).join("\n")}\n-----END ${tipo}-----\n`;

let generada: Promise<CredencialGenerada> | null = null;

/** Una clave RSA de 2048 bits y su certificado autofirmado (CUIT de prueba en `serialNumber`). Una por proceso. */
export function credencialDePrueba(): Promise<CredencialGenerada> {
  generada ??= (async (): Promise<CredencialGenerada> => {
    pkijs.setEngine(
      "prueba",
      new pkijs.CryptoEngine({
        name: "prueba",
        crypto: webcrypto as unknown as ConstructorParameters<
          typeof pkijs.CryptoEngine
        >[0]["crypto"],
      }),
    );
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const certificado = new pkijs.Certificate();
    certificado.version = 2;
    certificado.serialNumber = new asn1js.Integer({ value: 7 });
    const nombre = (n: pkijs.RelativeDistinguishedNames): void => {
      n.typesAndValues.push(
        new pkijs.AttributeTypeAndValue({
          type: "2.5.4.3",
          value: new asn1js.Utf8String({ value: "pedernal-prueba" }),
        }),
        new pkijs.AttributeTypeAndValue({
          type: "2.5.4.5",
          value: new asn1js.PrintableString({ value: "CUIT 20111111112" }),
        }),
      );
    };
    nombre(certificado.issuer);
    nombre(certificado.subject);
    certificado.notBefore.value = new Date(Date.UTC(2026, 0, 1));
    certificado.notAfter.value = new Date(Date.UTC(2036, 0, 1));
    const spki = publicKey.export({ format: "der", type: "spki" });
    await certificado.subjectPublicKeyInfo.importKey(
      await webcrypto.subtle.importKey(
        "spki",
        spki,
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        true,
        ["verify"],
      ),
    );
    await certificado.sign(
      await webcrypto.subtle.importKey(
        "pkcs8",
        privateKey.export({ format: "der", type: "pkcs8" }),
        { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
        false,
        ["sign"],
      ),
      "SHA-256",
    );
    const certificadoDer = new Uint8Array(certificado.toSchema().toBER(false));
    return {
      credencial: {
        certificadoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        certificadoPem: PEM("CERTIFICATE", certificadoDer),
        clavePrivada: new Secreto(privateKey.export({ format: "pem", type: "pkcs8" }).toString()),
        venceEn: new Date(Date.UTC(2036, 0, 1)),
      },
      clavePrivada: privateKey,
      certificadoDer,
    };
  })();
  return generada;
}
