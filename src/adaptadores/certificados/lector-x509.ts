import { createHash, createPrivateKey, createPublicKey, X509Certificate } from "node:crypto";
import * as asn1js from "asn1js";
import { Certificate } from "pkijs";
import type { AmbienteDeArca } from "../../puertos/credenciales-de-emisor";
import type { CertificadoLeido, LectorDeCertificados } from "../../puertos/lector-de-certificados";
import type { Secreto } from "../../primitivas/secreto/secreto";
import { ErrorDeConfiguracion } from "../postgres/errores";

/**
 * Lee y comprueba certificados X.509 con `node:crypto` y `pkijs` (spec H7 facturación §B.6.2). No decide si el
 * certificado sirve (eso es del dominio): mide lo que el dominio necesita.
 *
 * La cadena se arma contra las autoridades que le pasa la composición para cada ambiente (la de homologación y la
 * de producción NO se mezclan: «cada ambiente confía solo en su cadena»). Sus PEM salen de
 * `12-referencias-externas/arca-cadena-de-certificacion-*` y su autenticidad la debe confirmar el dueño comparando
 * huellas (D-F7) antes de producción: por eso no están copiadas acá. Sin autoridades para un ambiente, la cadena
 * NO cierra (falla cerrado).
 */

export type CadenasDeConfianza = Readonly<Record<AmbienteDeArca, readonly string[]>>;

/** Una cadena de ARCA tiene una raíz y una intermedia; el tope corta cualquier ciclo. */
const NIVELES_DE_CADENA = 4;
const OID_NUMERO_DE_SERIE = "2.5.4.5";

/** Los archivos de ARCA traen saltos de línea `\r` solos (`openssl` los rechaza): se normalizan. */
const normalizar = (pem: string): string => pem.replace(/\r\n?/g, "\n");

function leerAutoridades(pems: readonly string[]): X509Certificate[] {
  return pems.map((pem) => {
    try {
      return new X509Certificate(normalizar(pem));
    } catch {
      // Nunca se repite el contenido: solo que una autoridad configurada no es un certificado.
      throw new ErrorDeConfiguracion(
        "una autoridad de la cadena de certificación de ARCA no es un certificado X.509 legible",
      );
    }
  });
}

const esAutofirmado = (c: X509Certificate): boolean => c.checkIssued(c) && c.verify(c.publicKey);

export function crearLectorDeCertificados(cadenas: CadenasDeConfianza): LectorDeCertificados {
  const autoridades: Readonly<Record<AmbienteDeArca, readonly X509Certificate[]>> = {
    HOMOLOGACION: leerAutoridades(cadenas.HOMOLOGACION),
    PRODUCCION: leerAutoridades(cadenas.PRODUCCION),
  };

  return {
    leer(certificadoPem): CertificadoLeido | null {
      try {
        const der = new X509Certificate(certificadoPem).raw;
        const asn1 = asn1js.fromBER(der);
        const certificado = new Certificate({ schema: asn1.result });
        const numeroDeSerie = certificado.subject.typesAndValues.find(
          (a) => a.type === OID_NUMERO_DE_SERIE,
        )?.value.valueBlock;
        const valor: unknown =
          numeroDeSerie !== undefined && "value" in numeroDeSerie ? numeroDeSerie.value : null;
        return {
          huellaSha256: createHash("sha256").update(der).digest("hex"),
          numeroDeSerieDelSujeto: typeof valor === "string" ? valor : null,
          noAntes: certificado.notBefore.value,
          noDespues: certificado.notAfter.value,
        };
      } catch {
        return null;
      }
    },

    correspondeALaClave(certificadoPem, clavePrivada: Secreto): boolean {
      try {
        const delCertificado = new X509Certificate(certificadoPem).publicKey.export({
          type: "spki",
          format: "der",
        });
        const derivada = createPublicKey(createPrivateKey(clavePrivada.revelar())).export({
          type: "spki",
          format: "der",
        });
        return delCertificado.equals(derivada);
      } catch {
        return false;
      }
    },

    cadenaCierra(certificadoPem, ambiente, ahora): boolean {
      const anclas = autoridades[ambiente];
      try {
        let actual = new X509Certificate(certificadoPem);
        // Una autoridad pegada como si fuera el certificado del emisor no es un certificado de emisor.
        if (anclas.some((a) => a.fingerprint256 === actual.fingerprint256)) return false;
        for (let nivel = 0; nivel < NIVELES_DE_CADENA; nivel++) {
          const hoy = ahora.getTime();
          const actualParaBuscar = actual;
          const emisor = anclas.find(
            (a) =>
              a.ca &&
              Date.parse(a.validFrom) <= hoy &&
              hoy < Date.parse(a.validTo) &&
              actualParaBuscar.checkIssued(a) &&
              actualParaBuscar.verify(a.publicKey),
          );
          if (emisor === undefined) return false;
          if (esAutofirmado(emisor)) return true;
          actual = emisor;
        }
        return false;
      } catch {
        return false;
      }
    },
  };
}
