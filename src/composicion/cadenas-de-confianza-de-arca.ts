import type { CadenasDeConfianza } from "../adaptadores/certificados/lector-x509";

/**
 * Las autoridades de ARCA en las que confía la web para cerrar la cadena de un certificado cargado, por ambiente.
 *
 * HOMOLOGACIÓN: la raíz «AC Raiz Test» (2014-2034) y la intermedia «Computadores Test» (2022-2030). Fuente: repositorio de
 * docs Pedernal-docs, `12-referencias-externas/arca-cadena-de-certificacion-homo-2022-2034/README.md`, sección «Autenticidad
 * VERIFICADA el 2026-11-04»: el dueño verificó que un certificado real emitido por ARCA verifica con `openssl verify` contra la
 * intermedia y esta contra la raíz. Los PEM son los `.normalizado.pem` de esa carpeta, byte a byte; las huellas son las verificadas.
 * Una prueba recalcula la huella de cada PEM y falla si un byte cambia (cambiar una autoridad es una decisión del dueño).
 *
 * PRODUCCIÓN: vacía a propósito. Su cadena NO está verificada todavía: sin autoridades la cadena no cierra y cargar un
 * certificado de producción falla cerrado (`CADENA_NO_CONFIABLE`). Se carga recién cuando el dueño verifique las huellas.
 */

export type AutoridadDeArca = Readonly<{
  /** SHA-256 del DER, como lo imprime `openssl x509 -fingerprint -sha256` (la forma del README de docs). */
  huellaSha256: string;
  pem: string;
}>;

export const RAIZ_DE_HOMOLOGACION: AutoridadDeArca = {
  huellaSha256:
    "FD:72:00:97:84:9F:D2:CA:0F:17:3F:1A:94:38:C3:61:71:35:61:C9:16:19:2A:38:FD:9A:E4:49:DD:1B:2D:34",
  pem: `-----BEGIN CERTIFICATE-----
MIIDSzCCAjOgAwIBAgIIOJx/arkZfLowDQYJKoZIhvcNAQENBQAwMzEVMBMGA1UE
AwwMQUMgUmFpeiBUZXN0MQ0wCwYDVQQKDARBRklQMQswCQYDVQQGEwJBUjAeFw0x
NDA2MDUxMzQ4NTZaFw0zNDA2MDYwMDAwMDBaMDMxFTATBgNVBAMMDEFDIFJhaXog
VGVzdDENMAsGA1UECgwEQUZJUDELMAkGA1UEBhMCQVIwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQDABEDpCYyNVpRfsPD95oxAdAWIWiuKdbCOQY92L/ZN
pceRRIUhzidYRxi9bo6ZFR6tC/0njN9/Lm6Zfrc/vrps7Z+wtlo0zAeWNEDOcdny
NtbMcAmM1wIn9oValyWCG178vlkiZimBurVbZj6NJDa92bc4eJOFcYx6QTHJAstD
JQISRnpzTce+XG7ERk8vYkx1z40NAD4iM5HOtIJdsLKx2Ju2Plr/8hI7NC0maJbC
ckQfHOzSJkL0SMpI0CqpEL7008m6F5i1/CjfvFaXj68pQrS0Piqz8fvi3MuAvoAT
MddEFKn/xdbbP5G+lvQjNzbw34P6uHONAStVB8BhnAdzAgMBAAGjYzBhMB0GA1Ud
DgQWBBTqEiR8BNaJTYyDdaImigkdGfycqzAPBgNVHRMBAf8EBTADAQH/MB8GA1Ud
IwQYMBaAFOoSJHwE1olNjIN1oiaKCR0Z/JyrMA4GA1UdDwEB/wQEAwIBhjANBgkq
hkiG9w0BAQ0FAAOCAQEAlAEaxnLodTy74wPn0OUlSijy86zEwI4z+U5q1S+C3RVs
bl4qZM+G5/4yFChqbEx1aH2TaS8ETimtHkayAz8nyZdOJ6VWBtz/E9S0cjnTUfa9
TdrB6p7Q9lDDSYV0+KBodXOYXuOjfCms6K7FDFBfQq/OqV2es28yfoazjWWnnIWf
zZ72vkL8E6A4t3qhoXyBzUuwQQL58t4ZCF7k0U0xzyYUAl/jmg+IsEjZ3LAvW/zx
827MdsFGIXRqc1RNkS2PPmtzzoSbS++tTXqGrU3SywqH0eb31Lv2PQ6S3usFP2YD
pgFCPRntmLKe6Mn0z6qstEsqoKueslDoRNZdb2x+bg==
-----END CERTIFICATE-----
`,
};

export const INTERMEDIA_DE_HOMOLOGACION: AutoridadDeArca = {
  huellaSha256:
    "40:FD:CA:A7:BA:F7:66:D3:A6:44:E6:07:59:D4:EA:48:DD:9E:AB:E2:D5:42:EF:EB:5E:F0:73:B6:89:57:76:9E",
  pem: `-----BEGIN CERTIFICATE-----
MIID4TCCAsmgAwIBAgIIVZV/yzaQUuIwDQYJKoZIhvcNAQENBQAwMzEVMBMGA1UE
AwwMQUMgUmFpeiBUZXN0MQ0wCwYDVQQKDARBRklQMQswCQYDVQQGEwJBUjAeFw0y
MjA3MDcxMjUwNTlaFw0zMDA3MDcxMjUwNTlaMDgxGjAYBgNVBAMMEUNvbXB1dGFk
b3JlcyBUZXN0MQ0wCwYDVQQKDARBRklQMQswCQYDVQQGEwJBUjCCASIwDQYJKoZI
hvcNAQEBBQADggEPADCCAQoCggEBAK945tuMUJJuN7SqhWstJnfPMgiHPCg/tka8
N2yy/Ci9sncfbe7DCRuNGkU5DxDN6l8IMO9DKiU/d2hsdHUCUylixcImYoB2fwFq
yYlMElYwVQ6uzHdpSyqneU/bFFEpcLVh4Ikl7CstJikefn5GyHwSsralgzNRiuDu
231iNt1b9XV9wi1mFY07TE4yw2okfgcSPWRaWzLbPlM+3YYFNo84dY5pP7krOtqK
IYGRkYy9crWOZndsZ6i0R18dryW4uhkaqzSikqGwvg1FCvyby2xZKTv7ae5CuNJG
q+78QR6C2R40Cde/GSOLc+RVK3aSIy5lA18Q0qe/r6Up7bMZoMECAwEAAaOB8zCB
8DAPBgNVHRMBAf8EBTADAQH/MB8GA1UdIwQYMBaAFOoSJHwE1olNjIN1oiaKCR0Z
/JyrMEEGCCsGAQUFBwEBBDUwMzAxBggrBgEFBQcwAYYlaHR0cDovL2F1dGhob21v
LWV4dC5hZmlwLmdvYi5hci9vY3NwLzBKBgNVHR8EQzBBMD+gPaA7hjlodHRwOi8v
YXV0aGhvbW8tZXh0LmFmaXAuZ29iLmFyL2NybC9hZmlwLXJvb3QtdGVzdC1jYS5j
cmwwHQYDVR0OBBYEFLOy0//96bre3o2vESGc1iB98k9vMA4GA1UdDwEB/wQEAwIB
hjANBgkqhkiG9w0BAQ0FAAOCAQEAo13CI5Bg4kYu4IPulBESERw1HfC8Aa9V56oj
M3Dr/HZ+SS5MRtkJ4kIMrL6VK9c0TDqKuVyckdsIjKuZn6IbIAZdQmsqMpZHwyTf
CYFHAPOvyowqp17PSbe77NLzDtCTIAudSj1UF5eX/6sip0FHy6SdkrHNaFyfdaaF
Eq1d1YnAI2x722urZ9xax39cA9tVzd4t3xNbCa2lMjrNV3UkHQPfJ7Kuc6d+TGci
2rCZ+LHZLziT84BK3A3LM5f9mUUTbe8qKAG3KEKtlkT2f93E83lizAf8r/IwHMQP
YmxVeWCQzOJMOVrsOa6wVH7gfS06//Ysw6cpDt+/PbJScoTmAA==
-----END CERTIFICATE-----
`,
};

export const CADENAS_DE_CONFIANZA_DE_ARCA: CadenasDeConfianza = {
  HOMOLOGACION: [RAIZ_DE_HOMOLOGACION.pem, INTERMEDIA_DE_HOMOLOGACION.pem],
  PRODUCCION: [],
};
