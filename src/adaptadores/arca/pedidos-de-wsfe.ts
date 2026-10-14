import type { TablaDeParametros } from "./codigos";
import { escaparXml } from "./xml";

/**
 * Los pedidos SOAP a WSFE v4.8 (spec H7 facturación §B.5.1), armados con plantillas propias. Valor puro. El
 * orden de los elementos es el de la secuencia del WSDL y el de los pedidos que homologación real aceptó
 * (espía F0, grabados en `test/utilidades/arca-grabaciones/`): una prueba compara cada pedido, letra por
 * letra, con el grabado.
 *
 * Los importes entran ya como texto decimal (`231.50`): jamás pasan por `number` (ADR-006).
 */

export const ESPACIO_DE_NOMBRES_DE_WSFE = "http://ar.gov.afip.dif.FEV1/";

/** La cabecera `SOAPAction` de una operación de WSFE (SOAP 1.1). */
export const accionDeWsfe = (operacion: string): string =>
  `${ESPACIO_DE_NOMBRES_DE_WSFE}${operacion}`;

/** El ticket de acceso y la CUIT del emisor: va en cada operación menos `FEDummy`. */
export type AutenticacionDeWsfe = Readonly<{ token: string; sign: string; cuit: string }>;

/** `FECAESolicitar` con un comprobante, ya traducido a los valores de ARCA (números como texto). */
export type SolicitudDeWsfe = Readonly<{
  puntoDeVenta: number;
  tipoDeComprobante: number;
  concepto: number;
  tipoDeDocumento: number;
  numeroDeDocumento: string;
  numero: string;
  /** `yyyymmdd`. */
  fecha: string;
  total: string;
  noGravado: string;
  neto: string;
  exento: string;
  tributos: string;
  iva: string;
  /** Las tres fechas del abono (`yyyymmdd`), solo en los conceptos 2 y 3. */
  servicio: Readonly<{ desde: string; hasta: string; vencimientoDePago: string }> | null;
  moneda: string;
  condicionIva: number;
  asociado: Readonly<{
    tipoDeComprobante: number;
    puntoDeVenta: number;
    numero: string;
    cuit: string;
    fecha: string;
  }> | null;
  alicuotas: readonly Readonly<{ id: number; base: string; importe: string }>[];
}>;

const SOBRE =
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" ` +
  `xmlns:ar="${ESPACIO_DE_NOMBRES_DE_WSFE}"><soap:Header/><soap:Body>`;
const CIERRE_DEL_SOBRE = `</soap:Body></soap:Envelope>`;

const elemento = (nombre: string, valor: string | number): string =>
  `<ar:${nombre}>${escaparXml(String(valor))}</ar:${nombre}>`;

const autenticacion = (a: AutenticacionDeWsfe): string =>
  `<ar:Auth>${elemento("Token", a.token)}${elemento("Sign", a.sign)}${elemento("Cuit", a.cuit)}</ar:Auth>`;

function operacion(nombre: string, autenticacionDeLaOperacion: string, interior: string): string {
  return `${SOBRE}<ar:${nombre}>${autenticacionDeLaOperacion}${interior}</ar:${nombre}>${CIERRE_DEL_SOBRE}`;
}

/** `FEDummy`: la salud del servicio, sin autenticación. */
export const pedidoFEDummy = (): string => operacion("FEDummy", "", "");

export function pedidoFECompUltimoAutorizado(
  auth: AutenticacionDeWsfe,
  puntoDeVenta: number,
  tipoDeComprobante: number,
): string {
  return operacion(
    "FECompUltimoAutorizado",
    autenticacion(auth),
    elemento("PtoVta", puntoDeVenta) + elemento("CbteTipo", tipoDeComprobante),
  );
}

export function pedidoFECompConsultar(
  auth: AutenticacionDeWsfe,
  puntoDeVenta: number,
  tipoDeComprobante: number,
  numero: string,
): string {
  return operacion(
    "FECompConsultar",
    autenticacion(auth),
    `<ar:FeCompConsReq>${elemento("CbteTipo", tipoDeComprobante)}${elemento("CbteNro", numero)}` +
      `${elemento("PtoVta", puntoDeVenta)}</ar:FeCompConsReq>`,
  );
}

/** Una de las seis operaciones `FEParamGet*`: solo llevan la autenticación. */
export function pedidoFEParamGet(auth: AutenticacionDeWsfe, tabla: TablaDeParametros): string {
  return operacion(`FEParamGet${tabla}`, autenticacion(auth), "");
}

const fechasDelServicio = (s: SolicitudDeWsfe["servicio"]): string =>
  s === null
    ? ""
    : elemento("FchServDesde", s.desde) +
      elemento("FchServHasta", s.hasta) +
      elemento("FchVtoPago", s.vencimientoDePago);

const comprobanteAsociado = (a: SolicitudDeWsfe["asociado"]): string =>
  a === null
    ? ""
    : `<ar:CbtesAsoc><ar:CbteAsoc>${elemento("Tipo", a.tipoDeComprobante)}` +
      `${elemento("PtoVta", a.puntoDeVenta)}${elemento("Nro", a.numero)}` +
      `${elemento("Cuit", a.cuit)}${elemento("CbteFch", a.fecha)}</ar:CbteAsoc></ar:CbtesAsoc>`;

const alicuotas = (lista: SolicitudDeWsfe["alicuotas"]): string =>
  lista.length === 0
    ? ""
    : `<ar:Iva>${lista
        .map(
          (a) =>
            `<ar:AlicIva>${elemento("Id", a.id)}${elemento("BaseImp", a.base)}` +
            `${elemento("Importe", a.importe)}</ar:AlicIva>`,
        )
        .join("")}</ar:Iva>`;

/**
 * `FECAESolicitar` con `CantReg = 1` (un solo comprobante por pedido). Sin `Tributos` (la primera entrega no
 * los informa: `ImpTrib` va en cero) y sin `Iva` cuando no hay alícuotas (la letra C no lo informa).
 */
export function pedidoFECAESolicitar(auth: AutenticacionDeWsfe, s: SolicitudDeWsfe): string {
  const detalle =
    elemento("Concepto", s.concepto) +
    elemento("DocTipo", s.tipoDeDocumento) +
    elemento("DocNro", s.numeroDeDocumento) +
    elemento("CbteDesde", s.numero) +
    elemento("CbteHasta", s.numero) +
    elemento("CbteFch", s.fecha) +
    elemento("ImpTotal", s.total) +
    elemento("ImpTotConc", s.noGravado) +
    elemento("ImpNeto", s.neto) +
    elemento("ImpOpEx", s.exento) +
    elemento("ImpTrib", s.tributos) +
    elemento("ImpIVA", s.iva) +
    fechasDelServicio(s.servicio) +
    elemento("MonId", s.moneda) +
    elemento("MonCotiz", "1") +
    elemento("CondicionIVAReceptorId", s.condicionIva) +
    comprobanteAsociado(s.asociado) +
    alicuotas(s.alicuotas);
  return operacion(
    "FECAESolicitar",
    autenticacion(auth),
    `<ar:FeCAEReq><ar:FeCabReq>${elemento("CantReg", 1)}${elemento("PtoVta", s.puntoDeVenta)}` +
      `${elemento("CbteTipo", s.tipoDeComprobante)}</ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>` +
      `${detalle}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`,
  );
}
