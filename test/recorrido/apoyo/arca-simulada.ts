import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";

/**
 * La ARCA de mentira del recorrido: un servidor HTTP en 127.0.0.1 que responde, con la forma de las respuestas reales grabadas
 * en homologación (`test/utilidades/arca-grabaciones/corrida1/022` y `032`), las dos operaciones de WSFE que emite una factura:
 * `FECompUltimoAutorizado` y `FECAESolicitar`. Lleva la cuenta del último número por (CUIT, punto de venta, tipo) como el servicio
 * real: autoriza el siguiente y rechaza cualquier otro (error 10016). Todo lo demás (incluido WSAA) responde 500: el recorrido
 * siembra un ticket vigente y un pedido de login sería un defecto del armado.
 */
type PedidoRecibido = Readonly<{ operacion: string; cuerpo: string; hostDeArca: string }>;

/**
 * Cómo responde a `FECAESolicitar` (lo único que se puede cambiar en caliente): `AUTORIZA` es lo normal; `SIN_RESPUESTA_DEFINITIVA` contesta HTTP 500, que
 * para el adaptador es «no sé si ARCA lo registró» (`INCIERTO`, «Confirmando»): una escritura que no se sabe si llegó NUNCA se reenvía (ADR-007,
 * `clasificar.ts`). Lo que ARCA haría con un HTTP 500 está en las grabaciones 053 a 056 de `corrida1`; ningún pedido nuevo se inventa.
 */
export type ModoDeLaSolicitud = "AUTORIZA" | "SIN_RESPUESTA_DEFINITIVA";

export type ArcaSimulada = Readonly<{
  puerto: number;
  pedidos: PedidoRecibido[];
  /** Cambia cómo responde de ahora en más a `FECAESolicitar` (el modo por defecto es `AUTORIZA`). */
  responderALaSolicitud(modo: ModoDeLaSolicitud): void;
  cerrar(): Promise<void>;
}>;

const ENCABEZADO =
  '<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema"><soap:Header><FEHeaderInfo xmlns="http://ar.gov.afip.dif.FEV1/"><ambiente>HomologacionExterno - srt</ambiente><fecha>2026-11-05T10:00:00.0000000-03:00</fecha><id>7.0.0.53</id></FEHeaderInfo></soap:Header><soap:Body>';
const PIE = "</soap:Body></soap:Envelope>";

const dato = (cuerpo: string, etiqueta: string): string =>
  new RegExp(`<ar:${etiqueta}>([^<]*)</ar:${etiqueta}>`).exec(cuerpo)?.[1] ?? "";

export async function levantarArcaSimulada(): Promise<ArcaSimulada> {
  const pedidos: PedidoRecibido[] = [];
  const ultimos = new Map<string, number>();
  let contadorDeCae = 0;
  let modo: ModoDeLaSolicitud = "AUTORIZA";

  const responder = (res: ServerResponse, estado: number, cuerpo: string): void => {
    res.writeHead(estado, { "Content-Type": "text/xml; charset=utf-8" });
    res.end(cuerpo);
  };

  const atender = (req: IncomingMessage, res: ServerResponse, cuerpo: string): void => {
    const operacion = /<ar:(FECompUltimoAutorizado|FECAESolicitar)>/.exec(cuerpo)?.[1] ?? "OTRA";
    pedidos.push({ operacion, cuerpo, hostDeArca: String(req.headers["x-recorrido-host"] ?? "") });
    const clave = `${dato(cuerpo, "Cuit")}/${dato(cuerpo, "PtoVta")}/${dato(cuerpo, "CbteTipo")}`;
    if (operacion === "FECompUltimoAutorizado") {
      responder(
        res,
        200,
        `${ENCABEZADO}<FECompUltimoAutorizadoResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECompUltimoAutorizadoResult><PtoVta>${dato(cuerpo, "PtoVta")}</PtoVta><CbteTipo>${dato(cuerpo, "CbteTipo")}</CbteTipo><CbteNro>${ultimos.get(clave) ?? 0}</CbteNro></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse>${PIE}`,
      );
      return;
    }
    if (operacion === "FECAESolicitar") {
      if (modo === "SIN_RESPUESTA_DEFINITIVA") {
        responder(res, 500, "recorrido: ARCA simulada sin respuesta definitiva");
        return;
      }
      const numero = Number(dato(cuerpo, "CbteDesde"));
      if (numero !== (ultimos.get(clave) ?? 0) + 1) {
        responder(
          res,
          200,
          `${ENCABEZADO}<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult><Errors><Err><Code>10016</Code><Msg>El numero o fecha del comprobante no se corresponde con el proximo a autorizar.</Msg></Err></Errors></FECAESolicitarResult></FECAESolicitarResponse>${PIE}`,
        );
        return;
      }
      ultimos.set(clave, numero);
      contadorDeCae += 1;
      const cae = String(86_410_995_000_000 + contadorDeCae);
      responder(
        res,
        200,
        `${ENCABEZADO}<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult><FeCabResp><Cuit>${dato(cuerpo, "Cuit")}</Cuit><PtoVta>${dato(cuerpo, "PtoVta")}</PtoVta><CbteTipo>${dato(cuerpo, "CbteTipo")}</CbteTipo><FchProceso>${dato(cuerpo, "CbteFch")}101837</FchProceso><CantReg>1</CantReg><Resultado>A</Resultado><Reproceso>N</Reproceso></FeCabResp><FeDetResp><FECAEDetResponse><Concepto>${dato(cuerpo, "Concepto")}</Concepto><DocTipo>${dato(cuerpo, "DocTipo")}</DocTipo><DocNro>${dato(cuerpo, "DocNro")}</DocNro><CbteDesde>${numero}</CbteDesde><CbteHasta>${numero}</CbteHasta><CbteFch>${dato(cuerpo, "CbteFch")}</CbteFch><Resultado>A</Resultado><CAE>${cae}</CAE><CAEFchVto>20261115</CAEFchVto></FECAEDetResponse></FeDetResp></FECAESolicitarResult></FECAESolicitarResponse>${PIE}`,
      );
      return;
    }
    responder(res, 500, "recorrido: operación no simulada");
  };

  const servidor: Server = createServer((req, res) => {
    const partes: Buffer[] = [];
    req.on("data", (p: Buffer) => partes.push(p));
    req.on("end", () => atender(req, res, Buffer.concat(partes).toString("utf8")));
  });
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const { port } = servidor.address() as AddressInfo;
  return {
    puerto: port,
    pedidos,
    responderALaSolicitud(nuevo) {
      modo = nuevo;
    },
    cerrar: () =>
      new Promise<void>((resolver) => {
        servidor.closeAllConnections();
        servidor.close(() => resolver());
      }),
  };
}
