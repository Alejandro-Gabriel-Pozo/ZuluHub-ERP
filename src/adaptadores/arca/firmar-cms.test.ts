import { createHash, createPublicKey, generateKeyPairSync, verify } from "node:crypto";
import type * as asn1js from "asn1js";
import * as pkijs from "pkijs";
import { describe, expect, it } from "vitest";
import { credencialDePrueba } from "../../../test/utilidades/arca-credencial";
import { ErrorDeFirma, firmarTra } from "./firmar-cms";
import { armarTra } from "./pedidos-de-wsaa";

/**
 * El CMS del pedido de acceso: un `SignedData` con el TRA adentro, SHA-256, el certificado incluido y los tres
 * atributos firmados, que es lo que el WSAA de homologación real aceptó (espía F0). La firma se verifica DOS
 * veces: con pkijs y, de forma independiente, con `node:crypto` sobre los bytes de los atributos firmados.
 */
const OID_SHA256 = "2.16.840.1.101.3.4.2.1";
const OID_DATOS_FIRMADOS = "1.2.840.113549.1.7.2";
const OID_DATOS = "1.2.840.113549.1.7.1";
const OID_TIPO_DE_CONTENIDO = "1.2.840.113549.1.9.3";
const OID_RESUMEN = "1.2.840.113549.1.9.4";
const OID_HORA = "1.2.840.113549.1.9.5";

const ahora = new Date("2026-10-14T13:18:07.000Z");
const tra = armarTra(ahora, "wsfe");

function leerCms(base64: string): pkijs.SignedData {
  const info = pkijs.ContentInfo.fromBER(Buffer.from(base64, "base64"));
  expect(info.contentType).toBe(OID_DATOS_FIRMADOS);
  return new pkijs.SignedData({ schema: info.content });
}

describe("firmarTra", () => {
  it("el CMS lleva el TRA adentro, con SHA-256 y el certificado del emisor", async () => {
    const { credencial, certificadoDer } = await credencialDePrueba();
    const firmado = leerCms(await firmarTra(tra, credencial, ahora));
    expect(firmado.encapContentInfo.eContentType).toBe(OID_DATOS);
    // Contenido ADJUNTO (no separado): WSAA lo exige adentro.
    const contenido = firmado.encapContentInfo.eContent;
    expect(contenido).toBeDefined();
    expect(new TextDecoder().decode(contenido?.getValue())).toBe(tra);
    expect(firmado.signerInfos).toHaveLength(1);
    expect(firmado.signerInfos[0]?.digestAlgorithm.algorithmId).toBe(OID_SHA256);
    expect(firmado.certificates).toHaveLength(1);
    const cert = firmado.certificates?.[0];
    expect(cert).toBeInstanceOf(pkijs.Certificate);
    expect(
      Buffer.from((cert as pkijs.Certificate).toSchema().toBER(false)).equals(
        Buffer.from(certificadoDer),
      ),
    ).toBe(true);
  });

  it("identifica al firmante por emisor y número de serie del certificado", async () => {
    const { credencial } = await credencialDePrueba();
    const firmado = leerCms(await firmarTra(tra, credencial, ahora));
    const sid: unknown = firmado.signerInfos[0]?.sid;
    expect(sid).toBeInstanceOf(pkijs.IssuerAndSerialNumber);
    expect((sid as pkijs.IssuerAndSerialNumber).serialNumber.valueBlock.valueDec).toBe(7);
  });

  it("los tres atributos firmados: tipo de contenido, hora de la firma y resumen del TRA", async () => {
    const { credencial } = await credencialDePrueba();
    const firmado = leerCms(await firmarTra(tra, credencial, ahora));
    const atributos = firmado.signerInfos[0]?.signedAttrs?.attributes ?? [];
    expect(atributos.map((a) => a.type).sort()).toEqual(
      [OID_TIPO_DE_CONTENIDO, OID_RESUMEN, OID_HORA].sort(),
    );
    const de = (oid: string): unknown => atributos.find((a) => a.type === oid)?.values[0];
    expect((de(OID_TIPO_DE_CONTENIDO) as asn1js.ObjectIdentifier).valueBlock.toString()).toBe(
      OID_DATOS,
    );
    const resumen = (de(OID_RESUMEN) as asn1js.OctetString).valueBlock.valueHexView;
    expect(Buffer.from(resumen).toString("hex")).toBe(
      createHash("sha256").update(tra).digest("hex"),
    );
    expect((de(OID_HORA) as asn1js.UTCTime).toDate().toISOString()).toBe(ahora.toISOString());
  });

  it("la firma verifica con pkijs", async () => {
    const { credencial } = await credencialDePrueba();
    const firmado = leerCms(await firmarTra(tra, credencial, ahora));
    await expect(firmado.verify({ signer: 0, checkChain: false })).resolves.toBe(true);
  });

  it("la firma verifica con node:crypto sobre los atributos firmados, con la clave pública del certificado", async () => {
    const { credencial, clavePrivada } = await credencialDePrueba();
    const firmado = leerCms(await firmarTra(tra, credencial, ahora));
    const info = firmado.signerInfos[0];
    const atributos = info?.signedAttrs?.encodedValue;
    expect(atributos).toBeDefined();
    // Lo que se firma es el DER de los atributos con la etiqueta de SET (0x31), no la de [0] IMPLICIT (0xA0).
    const datos = Buffer.from(new Uint8Array(atributos as ArrayBuffer));
    datos[0] = 0x31;
    const firma = Buffer.from(info?.signature.valueBlock.valueHexView ?? new Uint8Array());
    expect(verify("sha256", datos, createPublicKey(clavePrivada), firma)).toBe(true);
    // Y con otra clave no verifica.
    const { publicKey: otra } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    expect(verify("sha256", datos, otra, firma)).toBe(false);
  });

  it("el CMS cambia si cambia el TRA o la hora de la firma, y es el mismo si no cambia nada", async () => {
    const { credencial } = await credencialDePrueba();
    const a = await firmarTra(tra, credencial, ahora);
    expect(await firmarTra(tra, credencial, ahora)).toBe(a);
    expect(await firmarTra(`${tra} `, credencial, ahora)).not.toBe(a);
    expect(await firmarTra(tra, credencial, new Date(ahora.getTime() + 1_000))).not.toBe(a);
  });

  it("acepta una clave en PKCS#1 («RSA PRIVATE KEY») igual que en PKCS#8", async () => {
    const { credencial, clavePrivada } = await credencialDePrueba();
    const pkcs1 = clavePrivada.export({ format: "pem", type: "pkcs1" }).toString();
    expect(pkcs1).toContain("BEGIN RSA PRIVATE KEY");
    expect(await firmarTra(tra, { ...credencial, clavePrivadaPem: pkcs1 }, ahora)).toBe(
      await firmarTra(tra, credencial, ahora),
    );
  });

  it("un certificado con otras líneas antes del bloque (cadena, texto) también se lee", async () => {
    const { credencial } = await credencialDePrueba();
    const conTexto = `subject=/CN=algo\n${credencial.certificadoPem}`;
    expect(await firmarTra(tra, { ...credencial, certificadoPem: conTexto }, ahora)).toBe(
      await firmarTra(tra, credencial, ahora),
    );
  });
});

describe("firmarTra: lo que no sirve falla con un texto fijo", () => {
  const MENSAJE = "no se pudo firmar el pedido de acceso con la credencial del emisor";

  async function falla(cambios: Partial<{ certificadoPem: string; clavePrivadaPem: string }>) {
    const { credencial } = await credencialDePrueba();
    return firmarTra(tra, { ...credencial, ...cambios }, ahora).then(
      () => null,
      (error: unknown) => error as ErrorDeFirma,
    );
  }

  it("un certificado que no es un PEM", async () => {
    const error = await falla({ certificadoPem: "esto no es un certificado" });
    expect(error).toBeInstanceOf(ErrorDeFirma);
    expect(error?.message).toBe(MENSAJE);
    expect(error?.name).toBe("ErrorDeFirma");
  });

  it("un certificado con un PEM roto adentro", async () => {
    const { credencial } = await credencialDePrueba();
    const roto = credencial.certificadoPem.replace(/[A-Za-z0-9]{10}\n/, "ñandú!\n");
    expect(await falla({ certificadoPem: roto })).toBeInstanceOf(ErrorDeFirma);
  });

  it("una clave que no es un PEM", async () => {
    expect(await falla({ clavePrivadaPem: "esto no es una clave" })).toBeInstanceOf(ErrorDeFirma);
  });

  it("una clave que no es RSA (EC)", async () => {
    const { privateKey } = generateKeyPairSync("ec", { namedCurve: "P-256" });
    const pem = privateKey.export({ format: "pem", type: "pkcs8" }).toString();
    expect(await falla({ clavePrivadaPem: pem })).toBeInstanceOf(ErrorDeFirma);
  });

  it("una clave cifrada con contraseña (no se admite)", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey
      .export({ format: "pem", type: "pkcs8", cipher: "aes-256-cbc", passphrase: "secreto" })
      .toString();
    expect(await falla({ clavePrivadaPem: pem })).toBeInstanceOf(ErrorDeFirma);
  });

  it("el error no repite la clave ni el certificado, y no guarda la causa", async () => {
    const { credencial } = await credencialDePrueba();
    const error = await falla({ clavePrivadaPem: `${credencial.clavePrivadaPem.slice(0, 200)}ñ` });
    const texto = JSON.stringify({
      m: error?.message,
      s: error?.stack,
      c: (error as { cause?: unknown }).cause,
    });
    expect(texto).not.toContain("BEGIN");
    expect(texto).not.toContain(credencial.clavePrivadaPem.split("\n")[1] ?? "x");
    expect((error as { cause?: unknown }).cause).toBeUndefined();
  });
});
