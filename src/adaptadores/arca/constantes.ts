import type { AmbienteDeArca } from "../../puertos/credenciales-de-emisor";

/**
 * Direcciones, tiempos y márgenes del adaptador de ARCA (spec H7 facturación §B.5.1 y §B.5.4). Son datos
 * públicos y decisiones medidas, no variables de entorno: cambiarlas es cambiar el código y una prueba.
 */

/**
 * Los extremos de WSAA (`loginCms`) y de WSFE v4.8 de cada ambiente. El dominio es **`afip.gov.ar`**:
 * `wsaahomo`/`wswhomo` en homologación y `wsaa`/`servicios1` en producción (WSFE v4.8, l. 337 y 443; WSAA 1.2.2,
 * p. 5). Los nombres de `arca.gob.ar` NO sirven: el certificado TLS no los cubre (`ERR_TLS_CERT_ALTNAME_INVALID`,
 * medido contra homologación real en el espía F0, 2026-10-14). Siempre `https`: no hay una variante sin cifrar.
 */
export const DESTINOS_DE_ARCA: Readonly<
  Record<AmbienteDeArca, Readonly<{ wsaa: string; wsfe: string }>>
> = {
  HOMOLOGACION: {
    wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
  },
  PRODUCCION: {
    wsaa: "https://wsaa.afip.gov.ar/ws/services/LoginCms",
    wsfe: "https://servicios1.afip.gov.ar/wsfev1/service.asmx",
  },
};

/**
 * Tiempo límite de una operación de WSFE: 15 s, y cubre la conexión, el envío y la lectura COMPLETA del
 * cuerpo. El espía midió desde la PC del dueño: operaciones normales de 0,2 a 1 s, con picos de 4 s
 * (`FECompUltimoAutorizado`). 15 s deja casi cuatro veces el pico sin colgar un trabajo. A confirmar desde
 * `gru1` (Vercel). Un `FECAESolicitar` que no vuelve en este tiempo es `INCIERTO`, nunca se reenvía.
 */
export const TIEMPO_LIMITE_DE_WSFE_EN_MS = 15_000;

/**
 * Tiempo límite de `loginCms`: 20 s. El espía midió que un `loginCms` que WSAA rechaza tarda 10 a 11 s
 * (el éxito, mucho menos): 20 s deja casi el doble del peor caso medido, y sigue por debajo de lo que la
 * reserva de la serie (5 minutos) tolera.
 */
export const TIEMPO_LIMITE_DE_LOGIN_EN_MS = 20_000;

/**
 * Tiempo para ABRIR la conexión (DNS, TCP y TLS): 5 s (§B.5.4). Si no se abrió, ni un byte del pedido salió y es
 * seguro que ARCA no lo procesó (`NO_ENVIADO`); pasado ese momento, cualquier falla es incierta.
 */
export const TIEMPO_LIMITE_DE_CONEXION_EN_MS = 5_000;

/** Lo máximo que se lee de una respuesta: la más grande medida (`FEParamGetTiposMonedas`) pesa 6 KB. */
export const MAXIMO_DE_RESPUESTA_EN_BYTES = 2 * 1024 * 1024;

/**
 * Un ticket guardado se descarta 5 minutos antes de su vencimiento (§B.6.3): no se arranca una operación con un
 * ticket que vence en el medio.
 */
export const MARGEN_DEL_TICKET_EN_MS = 5 * 60_000;

/**
 * Ante `coe.alreadyAuthenticated` WSAA no emite otro ticket: otro proceso acaba de pedirlo y lo está guardando.
 * No se insiste ante WSAA: se espera 3 s y se relee el ticket guardado, una sola vez.
 */
export const ESPERA_TRAS_ACCESO_YA_EMITIDO_EN_MS = 3_000;

/** El servicio de negocio para el que se pide el ticket de acceso. */
export const SERVICIO_DE_ARCA = "wsfe";
