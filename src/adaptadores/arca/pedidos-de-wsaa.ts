import { escaparXml } from "./xml";

/**
 * Los pedidos a WSAA (spec H7 facturación §B.5.3): el TRA que se firma y el sobre SOAP de `loginCms`. Valor
 * puro: la hora entra como dato.
 */

/** El huso de Argentina: −03:00 todo el año (no hay horario de verano desde 2009). */
const HUSO_EN_MS = 3 * 3_600_000;

/** Fecha con el huso de Argentina, como la piden los ejemplos de WSAA: `2026-10-14T10:18:05-03:00`. */
function conHuso(instante: Date): string {
  const local = new Date(instante.getTime() - HUSO_EN_MS);
  return `${local.toISOString().slice(0, 19)}-03:00`;
}

/**
 * El TRA (ticket de requerimiento de acceso). `uniqueId` es un entero sin signo de 32 bits: los segundos
 * desde 1970, que no se repiten entre pedidos distintos; `generationTime = ahora − 2 min` y
 * `expirationTime = ahora + 10 min` (ASUMIDOS en §B.5.3: toleran un reloj algo corrido, que es lo que
 * previene `xml.generationTime.invalid`). Este TRA obtuvo ticket de WSAA de homologación real (espía F0).
 */
export function armarTra(ahora: Date, servicio: string): string {
  const unico = Math.floor(ahora.getTime() / 1000) % 4_294_967_296;
  return (
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<loginTicketRequest version="1.0"><header>` +
    `<uniqueId>${unico}</uniqueId>` +
    `<generationTime>${conHuso(new Date(ahora.getTime() - 2 * 60_000))}</generationTime>` +
    `<expirationTime>${conHuso(new Date(ahora.getTime() + 10 * 60_000))}</expirationTime>` +
    `</header><service>${escaparXml(servicio)}</service></loginTicketRequest>`
  );
}

/** El sobre SOAP de `loginCms` con el CMS (base64) adentro. Es la forma que WSAA de homologación aceptó. */
export function pedidoLoginCms(cmsEnBase64: string): string {
  return (
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body>` +
    `<wsaa:loginCms><wsaa:in0>${escaparXml(cmsEnBase64)}</wsaa:in0></wsaa:loginCms>` +
    `</soapenv:Body></soapenv:Envelope>`
  );
}
