import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { paraEscribir, sanear } from "./saneamiento.ts";
import { enviar, type DatosDeTls, type Falla } from "./transporte.ts";
import { buscar, buscarTodos, desescapar, escapar, leerXml, textoDe, type Nodo } from "./xml.ts";

/**
 * Clientes mínimos de WSAA (`loginCms`) y WSFE (SOAP 1.1) para el espía. DESCARTABLE. Cada llamada:
 *  - va con el tiempo límite propio de su operación (§B.5.4: WSAA 15 s, FECAESolicitar 20 s, consultas 10 s);
 *  - se GRABA saneada (pedido y respuesta, sin `Token`, `Sign` ni el CMS) en `<salida>/grabaciones/`;
 *  - mide su duración (E14).
 * Nada de esto se integra: el adaptador real es el tramo F8.
 */

export type Extremos = Readonly<{ wsaa: string; wsfe: string }>;

/** Homologación según WSFE v4.8 (l. 443) y el SDK TS para WSAA (§B.5.1). Son datos públicos. */
export const HOMOLOGACION: Extremos = {
  wsaa: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
  wsfe: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
};

/** Las mismas en el dominio nuevo de ARCA: E13 prueba si responden (revisión de terceros, §S.b punto 5). */
export const HOMOLOGACION_ARCA_GOB_AR: Extremos = {
  wsaa: "https://wsaahomo.arca.gob.ar/ws/services/LoginCms",
  wsfe: "https://wswhomo.arca.gob.ar/wsfev1/service.asmx",
};

export const TIEMPOS = { wsaaMs: 15_000, autorizarMs: 20_000, consultaMs: 10_000 } as const;

type Mensaje = Readonly<{ codigo: string; texto: string }>;

export type Llamada = Readonly<{
  operacion: string;
  ms: number;
  estadoHttp: number | null;
  falla: Falla | null;
  /** El `faultcode`/`faultstring` de SOAP, si lo hubo. */
  faltaSoap: Mensaje | null;
  tls: DatosDeTls | null;
  /** La respuesta ya leída (null si no hubo respuesta o no es XML). */
  xml: Nodo | null;
  errores: readonly Mensaje[];
  eventos: readonly Mensaje[];
  observaciones: readonly Mensaje[];
}>;

/** Graba pedidos y respuestas saneados; recuerda los secretos de la corrida para la verificación final. */
export class Grabadora {
  readonly secretos: string[] = [];
  private numero = 0;
  private readonly carpeta: string;
  constructor(carpeta: string) {
    this.carpeta = carpeta;
    mkdirSync(join(carpeta, "grabaciones"), { recursive: true });
  }
  recordar(secreto: string): void {
    if (secreto !== "") this.secretos.push(secreto);
  }
  grabar(nombre: string, contenido: string): string {
    this.numero += 1;
    const archivo = `${String(this.numero).padStart(3, "0")}-${nombre.replace(/[^A-Za-z0-9_.-]/g, "_")}.xml`;
    writeFileSync(
      join(this.carpeta, "grabaciones", archivo),
      paraEscribir(contenido, this.secretos, archivo),
      { mode: 0o644 },
    );
    return archivo;
  }
}

const mensajes = (xml: Nodo | null, lista: string, item: string, codigo: string, msg: string) =>
  buscarTodos(buscar(xml ?? undefined, lista), item).map((n) => ({
    codigo: textoDe(n, codigo) ?? "?",
    texto: textoDe(n, msg) ?? "",
  }));

async function llamarSoap(
  grabadora: Grabadora,
  url: string,
  operacion: string,
  accion: string,
  sobre: string,
  limiteMs: number,
  etiqueta: string,
  /** Las credenciales que trae la respuesta, para recordarlas ANTES de grabarla (la verificación final las busca). */
  secretosDeLaRespuesta: (cuerpo: string) => string[] = () => [],
): Promise<Llamada> {
  grabadora.grabar(`${etiqueta}-pedido`, sobre);
  const envio = await enviar(
    url,
    sobre,
    { "Content-Type": "text/xml; charset=utf-8", SOAPAction: `"${accion}"` },
    { totalMs: limiteMs },
  );
  if (!envio.ok) {
    return {
      operacion,
      ms: envio.falla.ms,
      estadoHttp: null,
      falla: envio.falla,
      faltaSoap: null,
      tls: null,
      xml: null,
      errores: [],
      eventos: [],
      observaciones: [],
    };
  }
  const { respuesta } = envio;
  for (const secreto of secretosDeLaRespuesta(respuesta.cuerpo)) grabadora.recordar(secreto);
  grabadora.grabar(`${etiqueta}-respuesta-http${respuesta.estado}`, respuesta.cuerpo);
  const xml = ((): Nodo | null => {
    try {
      return leerXml(respuesta.cuerpo);
    } catch {
      return null;
    }
  })();
  const falta = buscar(xml ?? undefined, "Fault");
  return {
    operacion,
    ms: respuesta.ms,
    estadoHttp: respuesta.estado,
    falla: null,
    faltaSoap:
      falta === undefined
        ? null
        : {
            codigo: textoDe(falta, "faultcode") ?? "?",
            texto: sanear(textoDe(falta, "faultstring") ?? ""),
          },
    tls: respuesta.tls,
    xml,
    errores: mensajes(xml, "Errors", "Err", "Code", "Msg"),
    eventos: mensajes(xml, "Events", "Evt", "Code", "Msg"),
    observaciones: mensajes(xml, "Observaciones", "Obs", "Code", "Msg"),
  };
}

// ------------------------------------------------------------------------------------------------
// WSAA
// ------------------------------------------------------------------------------------------------

type TicketDeAcceso = Readonly<{
  token: string;
  sign: string;
  generacion: string | null;
  expiracion: string | null;
}>;

export type ResultadoDeLogin = Readonly<{ llamada: Llamada; ticket: TicketDeAcceso | null }>;

export async function loginCms(
  grabadora: Grabadora,
  extremos: Extremos,
  cms: string,
  etiqueta: string,
): Promise<ResultadoDeLogin> {
  grabadora.recordar(cms);
  const sobre =
    `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/" ` +
    `xmlns:wsaa="http://wsaa.view.sua.dvadac.desein.afip.gov"><soapenv:Header/><soapenv:Body>` +
    `<wsaa:loginCms><wsaa:in0>${cms}</wsaa:in0></wsaa:loginCms></soapenv:Body></soapenv:Envelope>`;
  const llamada = await llamarSoap(
    grabadora,
    extremos.wsaa,
    "loginCms",
    "",
    sobre,
    TIEMPOS.wsaaMs,
    etiqueta,
    (cuerpo) => {
      const claro = desescapar(cuerpo);
      return ["token", "sign"].flatMap((e) =>
        [...claro.matchAll(new RegExp(`<${e}>([\\s\\S]*?)</${e}>`, "gi"))].map((m) =>
          (m[1] ?? "").trim(),
        ),
      );
    },
  );
  const retorno = textoDe(llamada.xml ?? undefined, "loginCmsReturn");
  if (retorno === null) return { llamada, ticket: null };
  const interno = leerXml(desescapar(retorno));
  const token = textoDe(interno, "token");
  const sign = textoDe(interno, "sign");
  if (token === null || sign === null) return { llamada, ticket: null };
  grabadora.recordar(token);
  grabadora.recordar(sign);
  return {
    llamada,
    ticket: {
      token,
      sign,
      generacion: textoDe(interno, "generationTime"),
      expiracion: textoDe(interno, "expirationTime"),
    },
  };
}

// ------------------------------------------------------------------------------------------------
// WSFE
// ------------------------------------------------------------------------------------------------

const NS_WSFE = "http://ar.gov.afip.dif.FEV1/";

export type Credencial = Readonly<{ ticket: TicketDeAcceso; cuit: string }>;

const auth = (c: Credencial) =>
  `<ar:Auth><ar:Token>${escapar(c.ticket.token)}</ar:Token><ar:Sign>${escapar(c.ticket.sign)}</ar:Sign>` +
  `<ar:Cuit>${escapar(c.cuit)}</ar:Cuit></ar:Auth>`;

export function llamarWsfe(
  grabadora: Grabadora,
  extremos: Extremos,
  operacion: string,
  credencial: Credencial | null,
  interno: string,
  limiteMs: number,
  etiqueta: string = operacion,
): Promise<Llamada> {
  const sobre =
    `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:ar="${NS_WSFE}">` +
    `<soap:Header/><soap:Body><ar:${operacion}>${credencial === null ? "" : auth(credencial)}${interno}` +
    `</ar:${operacion}></soap:Body></soap:Envelope>`;
  return llamarSoap(
    grabadora,
    extremos.wsfe,
    operacion,
    `${NS_WSFE}${operacion}`,
    sobre,
    limiteMs,
    etiqueta,
  );
}

// ------------------------------------------------------------------------------------------------
// Importes como texto (ADR-006: nunca `number`)
// ------------------------------------------------------------------------------------------------

/** Centavos (bigint) → `"121.50"`. */
export function importe(centavos: bigint): string {
  const signo = centavos < 0n ? "-" : "";
  const abs = centavos < 0n ? -centavos : centavos;
  return `${signo}${abs / 100n}.${(abs % 100n).toString().padStart(2, "0")}`;
}

type AlicuotaDelPedido = Readonly<{ id: number; base: bigint; iva: bigint }>;

export type DatosDelComprobante = Readonly<{
  puntoDeVenta: number;
  tipo: number;
  numero: bigint;
  concepto: number;
  docTipo: number;
  docNro: string;
  fecha: string;
  total: bigint;
  neto: bigint;
  iva: bigint;
  condicionIvaReceptor: number;
  alicuotas: readonly AlicuotaDelPedido[];
  asociado: Readonly<{
    tipo: number;
    puntoDeVenta: number;
    numero: bigint;
    cuit: string;
    fecha: string;
  }> | null;
}>;

/**
 * El cuerpo de `FECAESolicitar` con un solo comprobante (`CantReg = 1`). El orden de los elementos sigue el WSDL de
 * WSFE (secuencia): si homologación lo rechaza por el orden o por un campo, el error queda grabado (es para eso).
 */
export function cuerpoDeAutorizacion(d: DatosDelComprobante): string {
  const iva =
    d.alicuotas.length === 0
      ? ""
      : `<ar:Iva>${d.alicuotas
          .map(
            (a) =>
              `<ar:AlicIva><ar:Id>${a.id}</ar:Id><ar:BaseImp>${importe(a.base)}</ar:BaseImp>` +
              `<ar:Importe>${importe(a.iva)}</ar:Importe></ar:AlicIva>`,
          )
          .join("")}</ar:Iva>`;
  const asociado =
    d.asociado === null
      ? ""
      : `<ar:CbtesAsoc><ar:CbteAsoc><ar:Tipo>${d.asociado.tipo}</ar:Tipo>` +
        `<ar:PtoVta>${d.asociado.puntoDeVenta}</ar:PtoVta><ar:Nro>${d.asociado.numero}</ar:Nro>` +
        `<ar:Cuit>${escapar(d.asociado.cuit)}</ar:Cuit><ar:CbteFch>${d.asociado.fecha}</ar:CbteFch>` +
        `</ar:CbteAsoc></ar:CbtesAsoc>`;
  return (
    `<ar:FeCAEReq><ar:FeCabReq><ar:CantReg>1</ar:CantReg><ar:PtoVta>${d.puntoDeVenta}</ar:PtoVta>` +
    `<ar:CbteTipo>${d.tipo}</ar:CbteTipo></ar:FeCabReq><ar:FeDetReq><ar:FECAEDetRequest>` +
    `<ar:Concepto>${d.concepto}</ar:Concepto><ar:DocTipo>${d.docTipo}</ar:DocTipo>` +
    `<ar:DocNro>${escapar(d.docNro)}</ar:DocNro><ar:CbteDesde>${d.numero}</ar:CbteDesde>` +
    `<ar:CbteHasta>${d.numero}</ar:CbteHasta><ar:CbteFch>${d.fecha}</ar:CbteFch>` +
    `<ar:ImpTotal>${importe(d.total)}</ar:ImpTotal><ar:ImpTotConc>0.00</ar:ImpTotConc>` +
    `<ar:ImpNeto>${importe(d.neto)}</ar:ImpNeto><ar:ImpOpEx>0.00</ar:ImpOpEx>` +
    `<ar:ImpTrib>0.00</ar:ImpTrib><ar:ImpIVA>${importe(d.iva)}</ar:ImpIVA>` +
    `<ar:MonId>PES</ar:MonId><ar:MonCotiz>1</ar:MonCotiz>` +
    `<ar:CondicionIVAReceptorId>${d.condicionIvaReceptor}</ar:CondicionIVAReceptorId>` +
    `${asociado}${iva}</ar:FECAEDetRequest></ar:FeDetReq></ar:FeCAEReq>`
  );
}

/** Lo que interesa de la respuesta de `FECAESolicitar` (todo como TEXTO). */
export function leerAutorizacion(llamada: Llamada): Readonly<{
  resultado: string | null;
  cae: string | null;
  vence: string | null;
}> {
  const det = buscar(llamada.xml ?? undefined, "FECAEDetResponse");
  return {
    resultado: textoDe(det, "Resultado") ?? textoDe(llamada.xml ?? undefined, "Resultado"),
    cae: textoDe(det, "CAE"),
    vence: textoDe(det, "CAEFchVto"),
  };
}
