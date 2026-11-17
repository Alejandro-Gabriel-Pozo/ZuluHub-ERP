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
 * PRODUCCIÓN: la raíz «AFIP Root CA 2» (2015-2035) y la intermedia «Computadores» (2024-2035). Fuente: repositorio de docs Pedernal-docs,
 * `12-referencias-externas/arca-cadena-de-certificacion-prod-2024-2035/README.md` (recibida del dueño el 2026-10-12), sección
 * «Autenticidad VERIFICADA el 2026-11-17»: el dueño obtuvo un certificado REAL de producción emitido por ARCA ese día (emisor
 * «Computadores, AFIP») y verificó con `openssl verify` que cierra contra la intermedia y esta contra la raíz; las huellas coinciden con las
 * del README. Los PEM son los de esa carpeta (la raíz, el `.normalizado.pem`), byte a byte. Una prueba recalcula la huella de cada PEM y
 * falla si un byte cambia (cambiar una autoridad es una decisión del dueño; autorizada para producción el 2026-11-17, «si dale»).
 * Producción y homologación no se mezclan: cada ambiente confía solo en su cadena.
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

export const RAIZ_DE_PRODUCCION: AutoridadDeArca = {
  huellaSha256:
    "81:40:C0:02:63:70:0B:5A:FC:CB:F4:62:28:CF:84:6F:EC:6F:1E:50:53:35:77:F4:D4:77:03:EA:C2:23:5B:95",
  pem: `-----BEGIN CERTIFICATE-----
MIIDrTCCApWgAwIBAgIIJfHgOpZsfpgwDQYJKoZIhvcNAQENBQAwNTEXMBUGA1UE
AwwOQUZJUCBSb290IENBIDIxDTALBgNVBAoMBEFGSVAxCzAJBgNVBAYTAkFSMB4X
DTE1MTIxNjEzNTM1MVoXDTM1MTEyNTAzMDAwMFowNTEXMBUGA1UEAwwOQUZJUCBS
b290IENBIDIxDTALBgNVBAoMBEFGSVAxCzAJBgNVBAYTAkFSMIIBIjANBgkqhkiG
9w0BAQEFAAOCAQ8AMIIBCgKCAQEAo1qbU6FTo9m5mH8tpVgQPErqv9PqYiN2GLA8
aQmit5D1EeWZgjNoDLQ490Jpka33prp8Nb1/ZcZ40r4pd6gEmyVgIPHVqXwWfXlx
BJd+tlDJlnkLS9ce2mnOiY+wctdRrqAEazeTZVeRYewnFjNGvgaQqxPSyaT6X3LX
TuUmT77Vit4i8REDU9shq8Bw05qDuuQX1XQTGgASqOrGWzfjbLffAlKsUghcnDVu
OwL7rlh89NzFS6u+YrR1YD8ymq8y2tcOc2/I3/WN3U9hGBjwO4WsAudhDnV9MLAt
yTgWTzqInlqQtzS0JoFK1IATfcLftc0BsOHP6kUqgtI7UryeWwIDAQABo4HAMIG9
MB0GA1UdDgQWBBSub6bslHl0a1A02pk2VbNxXSiaBjAPBgNVHRMBAf8EBTADAQH/
MB8GA1UdIwQYMBaAFK5vpuyUeXRrUDTamTZVs3FdKJoGMBkGA1UdIAQSMBAwDgYM
KwYBBAGBu2MBAgEBMD8GA1UdHwQ4MDYwNKAyoDCGLmh0dHA6Ly9hdXRoLmFmaXAu
Z29iLmFyL2NybC9hZmlwLXJvb3QtY2EtMi5jcmwwDgYDVR0PAQH/BAQDAgGGMA0G
CSqGSIb3DQEBDQUAA4IBAQAKouuzospUKiOGza2SQbAeGCQ+C570l0M6Hxz4tSog
KKK1nvJZtHwXr/MuKq0s4/3BMWWQxk3HzIb+w42CaE7JcolwfmjFXGu3y+MXAGv8
CqaSOWqb+OVoshGZpp9qQXJO5o+vG9zmveAvChKQ+CRvfIwvGouNvj8/K8h4mice
KDm02uDAQBcXz0sL7KFl402y+KiPXuZOJExJYjZhlCFOoO9/Gig/8bzBFRhPa0BL
quFsZLTl7QgB/ee1HPyzhncW/P1uCDN7AILl2s+JzBRLow4MPIvfYMyScT8FUicN
7SW0VI2MfOgj4uS8LNenDpl77BHySz3U6OI8EAEc/82+
-----END CERTIFICATE-----
`,
};

export const INTERMEDIA_DE_PRODUCCION: AutoridadDeArca = {
  huellaSha256:
    "92:84:C8:A4:8B:A1:79:1F:AC:74:4A:95:B5:F7:E9:8C:0F:6A:DF:6E:78:6A:CB:84:69:91:11:35:F7:35:A5:1D",
  pem: `-----BEGIN CERTIFICATE-----
MIIDyzCCArOgAwIBAgIIWwdIzRZnKFUwDQYJKoZIhvcNAQENBQAwNTEXMBUGA1UE
AwwOQUZJUCBSb290IENBIDIxDTALBgNVBAoMBEFGSVAxCzAJBgNVBAYTAkFSMB4X
DTI0MDEwMzEyMzQ0MVoXDTM1MDEwMzEyMzQ0MVowMzEVMBMGA1UEAwwMQ29tcHV0
YWRvcmVzMQ0wCwYDVQQKDARBRklQMQswCQYDVQQGEwJBUjCCASIwDQYJKoZIhvcN
AQEBBQADggEPADCCAQoCggEBAMbq4S98I6cFRHbbd9jWVVavfEbAhV56hE0eA2+L
EJLh1rbn1w7UxaQ7VjQdGiOnPhFRfcYnjNqZAsmqwGvm7aaPTKe5TiUP85zCuRgT
qyFpQ10niJJfHwjP50M/mdXlskPDCNCvdY6mTRZKhGf3t6pj+1Flv0uDWR4qTPM7
yF2W5wlwImRs93vbfnL1shjfXZeZiKEKlkjHO5KsFATVb9yxQWnyd1gfs2uS8gxa
2KoCswYiN2FXMvAt/EU+H2GSz9T1yTb+7Oa9SQCEnX6nKkYd2GP2UUDxyx4M59+Q
ve7Xd/av/SQ2hvavrO8HnLlwvN5zMla3T14CzVQLeg52Rh8CAwEAAaOB4DCB3TAP
BgNVHRMBAf8EBTADAQH/MB8GA1UdIwQYMBaAFK5vpuyUeXRrUDTamTZVs3FdKJoG
MDkGCCsGAQUFBwEBBC0wKzApBggrBgEFBQcwAYYdaHR0cDovL2F1dGguYWZpcC5n
b2IuYXIvb2NzcC8wPwYDVR0fBDgwNjA0oDKgMIYuaHR0cDovL2F1dGguYWZpcC5n
b2IuYXIvY3JsL2FmaXAtcm9vdC1jYS0yLmNybDAdBgNVHQ4EFgQUKw0vyN9h/QjJ
ThHQNZMEbY5b0G4wDgYDVR0PAQH/BAQDAgGGMA0GCSqGSIb3DQEBDQUAA4IBAQA8
2z3Fyh8PDS7Sw2R3HtS7BHN7bRsb2H8NdWhFDcgoY1GfMTCa1ECzIRk8Y1WUeiQt
1Ahx4SeBs5n6B3mnMBD0f6LPNAlgoLWrITvrxj+yDkhGzD09WbgfG1Qg3yy0lBzR
2loIFL19d3ihMRV9cGkrce5tR7JVy1xWHmfm4Xvi/dCoiNCZPI4K3oqc29WOrLEd
5MG8jFnLxvurN6aKpH8++rv1R3c1cvgNDCQqwyvo9oV4cHt0nT2Xc4yW0LW0BTce
28koDvg+sury8nXtHQVmnCSUjQPZjprNipWnCXcYhrRPYcS4bHRsJVbn2tDwJCcZ
TKkMVBPVNkQZ120BLFcn
-----END CERTIFICATE-----
`,
};

export const CADENAS_DE_CONFIANZA_DE_ARCA: CadenasDeConfianza = {
  HOMOLOGACION: [RAIZ_DE_HOMOLOGACION.pem, INTERMEDIA_DE_HOMOLOGACION.pem],
  PRODUCCION: [RAIZ_DE_PRODUCCION.pem, INTERMEDIA_DE_PRODUCCION.pem],
};
