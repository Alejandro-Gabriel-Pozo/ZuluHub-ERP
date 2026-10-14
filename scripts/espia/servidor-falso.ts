import { randomBytes } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { verificarCms } from "./cms.ts";
import { escapar, leerXml, textoDe, buscar, buscarTodos } from "./xml.ts";

/**
 * Un ARCA FALSO local (WSAA + WSFE) para el modo `--seco` del espía y para sus pruebas: responde como dicen los
 * manuales y lo que grabaron otros (respuestas simuladas, no copiadas). NUNCA es evidencia de lo que hace ARCA: solo
 * prueba el camino del script (firma, sobres, lectura, saneamiento, informe). Además permite simular un servidor que
 * no responde (`/colgado`) y uno que manda las cabeceras y se cuelga (`/goteo`).
 *
 * Imita lo que importa para el espía:
 *  - WSAA: verifica el CMS (firma y contenido); un segundo pedido con el mismo certificado mientras hay un ticket
 *    vigente da `coe.alreadyAuthenticated`; con otro certificado, ticket propio.
 *  - WSFE: `Errors` 600 si el token no es uno emitido; la secuencia de números (10016); CAE de 14 dígitos que
 *    EMPIEZA CON 0 (para probar que nadie lo convierte en número); observación 10237 en una nota mayor que su
 *    factura; `FECompConsultar` con 602 si el número no existe; factura C rechazada con 10007 si el emisor es RI.
 */

type Comprobante = Readonly<{ total: string; datos: string; cae: string; fecha: string }>;

export type ServidorFalso = Readonly<{
  url: string;
  cerrar: () => Promise<void>;
  /** Cuántas veces se pidió autorizar cada número (para la prueba de «no reenviar»). */
  autorizaciones: Map<string, number>;
}>;

const leerCuerpo = (pedido: IncomingMessage) =>
  new Promise<string>((resolver, rechazar) => {
    const partes: Buffer[] = [];
    pedido.on("data", (p: Buffer) => partes.push(p));
    pedido.on("end", () => resolver(Buffer.concat(partes).toString("utf8")));
    pedido.on("error", rechazar);
  });

const sobre = (cuerpo: string) =>
  `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/">` +
  `<soap:Body>${cuerpo}</soap:Body></soap:Envelope>`;

const falta = (codigo: string, texto: string) =>
  sobre(
    `<soap:Fault><faultcode>${codigo}</faultcode><faultstring>${escapar(texto)}</faultstring></soap:Fault>`,
  );

const errores = (lista: readonly [number, string][]) =>
  `<Errors>${lista.map(([c, m]) => `<Err><Code>${c}</Code><Msg>${escapar(m)}</Msg></Err>`).join("")}</Errors>`;

export async function levantarServidorFalso(
  opciones: { emisorEsMonotributo?: boolean } = {},
): Promise<ServidorFalso> {
  const tickets = new Map<string, { token: string; vence: number }>();
  const tokens = new Set<string>();
  const ultimos = new Map<string, bigint>();
  const comprobantes = new Map<string, Comprobante>();
  const autorizaciones = new Map<string, number>();
  let cae = 1n;

  async function wsaa(cuerpo: string): Promise<[number, string]> {
    const cms = textoDe(leerXml(cuerpo), "in0") ?? "";
    let verificado;
    try {
      verificado = await verificarCms(cms);
    } catch {
      return [500, falta("ns1:cms.bad", "CMS ilegible")];
    }
    if (!verificado.valida) return [500, falta("ns1:cms.sign.invalid", "firma inválida")];
    if (!verificado.contenido.includes("<service>wsfe</service>")) {
      return [500, falta("ns1:xml.bad", "TRA inválido")];
    }
    // Un ticket por certificado (alias): se identifica por el certificado que viaja en el CMS.
    const clave = verificado.certificado;
    const vigente = tickets.get(clave);
    if (vigente !== undefined && vigente.vence > Date.now()) {
      return [
        500,
        falta(
          "ns1:coe.alreadyAuthenticated",
          "El CEE ya posee un TA valido para el acceso al WSN solicitado",
        ),
      ];
    }
    const token = randomBytes(48).toString("base64");
    const sign = randomBytes(24).toString("base64");
    tickets.set(clave, { token, vence: Date.now() + 12 * 3_600_000 });
    tokens.add(token);
    const ticket =
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><loginTicketResponse version="1.0"><header>` +
      `<source>CN=wsaahomo, O=AFIP, C=AR</source><destination>SERIALNUMBER=CUIT 20000000001</destination>` +
      `<uniqueId>1</uniqueId><generationTime>2026-10-14T10:00:00.000-03:00</generationTime>` +
      `<expirationTime>2026-10-14T22:00:00.000-03:00</expirationTime></header><credentials>` +
      `<token>${token}</token><sign>${sign}</sign></credentials></loginTicketResponse>`;
    return [
      200,
      sobre(
        `<loginCmsResponse><loginCmsReturn>${escapar(ticket)}</loginCmsReturn></loginCmsResponse>`,
      ),
    ];
  }

  function wsfe(accion: string, cuerpo: string): [number, string] {
    const operacion = accion
      .replace(/^"?http:\/\/ar\.gov\.afip\.dif\.FEV1\//, "")
      .replace(/"$/, "");
    const xml = leerXml(cuerpo);
    const responder = (interno: string) =>
      [
        200,
        sobre(
          `<${operacion}Response xmlns="http://ar.gov.afip.dif.FEV1/"><${operacion}Result>${interno}</${operacion}Result></${operacion}Response>`,
        ),
      ] as [number, string];
    if (operacion === "FEDummy") {
      return responder(
        "<AppServer>OK</AppServer><DbServer>OK</DbServer><AuthServer>OK</AuthServer>",
      );
    }
    const token = textoDe(xml, "Token") ?? "";
    if (!tokens.has(token))
      return responder(errores([[600, "ValidacionDeToken: No validaron las credenciales"]]));
    // Como ARCA de verdad (manual WSFE v4.8): cada tabla usa su propio nombre de elemento.
    const tabla = (elemento: string, items: readonly [string, string][]) =>
      `<ResultGet>${items.map(([id, desc]) => `<${elemento}><Id>${id}</Id><Desc>${desc}</Desc><FchDesde>20100917</FchDesde><FchHasta>NULL</FchHasta></${elemento}>`).join("")}</ResultGet>`;
    switch (operacion) {
      case "FEParamGetTiposCbte":
        return responder(
          tabla("CbteTipo", [
            ["1", "Factura A"],
            ["6", "Factura B"],
            ["8", "Nota de Crédito B"],
            ["11", "Factura C"],
          ]),
        );
      case "FEParamGetTiposDoc":
        return responder(
          tabla("DocTipo", [
            ["80", "CUIT"],
            ["96", "DNI"],
            ["99", "Doc. (Otro)"],
          ]),
        );
      case "FEParamGetTiposIva":
        return responder(
          tabla("IvaTipo", [
            ["3", "0%"],
            ["4", "10.5%"],
            ["5", "21%"],
            ["6", "27%"],
            ["8", "5%"],
            ["9", "2.5%"],
          ]),
        );
      case "FEParamGetCondicionIvaReceptor":
        return responder(
          `<ResultGet><CondicionIvaReceptor><Id>1</Id><Desc>IVA Responsable Inscripto</Desc><Cmp_Clase>A/M/C</Cmp_Clase></CondicionIvaReceptor>` +
            `<CondicionIvaReceptor><Id>5</Id><Desc>Consumidor Final</Desc><Cmp_Clase>B/C</Cmp_Clase></CondicionIvaReceptor></ResultGet>`,
        );
      case "FEParamGetTiposConcepto":
        return responder(
          tabla("ConceptoTipo", [
            ["1", "Producto"],
            ["2", "Servicios"],
            ["3", "Productos y Servicios"],
          ]),
        );
      case "FEParamGetTiposMonedas":
        return responder(tabla("Moneda", [["PES", "Pesos Argentinos"]]));
      case "FECompUltimoAutorizado": {
        const clave = `${textoDe(xml, "PtoVta")}|${textoDe(xml, "CbteTipo")}`;
        return responder(
          `<PtoVta>${textoDe(xml, "PtoVta")}</PtoVta><CbteTipo>${textoDe(xml, "CbteTipo")}</CbteTipo><CbteNro>${ultimos.get(clave) ?? 0n}</CbteNro>`,
        );
      }
      case "FECAESolicitar": {
        const pv = textoDe(xml, "PtoVta") ?? "0";
        const tipo = textoDe(xml, "CbteTipo") ?? "0";
        const numero = BigInt(textoDe(xml, "CbteDesde") ?? "0");
        const clave = `${pv}|${tipo}`;
        autorizaciones.set(
          `${clave}|${numero}`,
          (autorizaciones.get(`${clave}|${numero}`) ?? 0) + 1,
        );
        const cabecera = `<FeCabResp><PtoVta>${pv}</PtoVta><CbteTipo>${tipo}</CbteTipo><Resultado>R</Resultado></FeCabResp>`;
        const rechazo = (c: number, m: string) =>
          responder(
            `${cabecera}<FeDetResp><FECAEDetResponse><CbteDesde>${numero}</CbteDesde><Resultado>R</Resultado></FECAEDetResponse></FeDetResp>${errores([[c, m]])}`,
          );
        if (tipo === "11" && opciones.emisorEsMonotributo !== true) {
          return rechazo(10007, "El tipo de comprobante no es válido para la condición del emisor");
        }
        const ultimo = ultimos.get(clave) ?? 0n;
        if (numero !== ultimo + 1n) return rechazo(10016, `El numero debe ser ${ultimo + 1n}`);
        const total = textoDe(xml, "ImpTotal") ?? "0";
        const asociados = buscarTodos(buscar(xml, "CbtesAsoc"), "CbteAsoc");
        const obs: string[] = [];
        for (const a of asociados) {
          const suyo = comprobantes.get(
            `${textoDe(a, "PtoVta")}|${textoDe(a, "Tipo")}|${textoDe(a, "Nro")}`,
          );
          if (suyo !== undefined && Number(total) > Number(suyo.total)) {
            obs.push(
              "<Obs><Code>10237</Code><Msg>El importe de la nota supera al del comprobante asociado</Msg></Obs>",
            );
          }
        }
        ultimos.set(clave, numero);
        // 14 dígitos que empiezan con 0: quien lo convierta en número pierde un dígito.
        const codigo = `0${(7_400_000_000_000n + cae).toString()}`;
        cae += 1n;
        comprobantes.set(`${clave}|${numero}`, {
          total,
          datos: textoDe(xml, "DocNro") ?? "",
          cae: codigo,
          fecha: textoDe(xml, "CbteFch") ?? "",
        });
        return responder(
          `<FeCabResp><PtoVta>${pv}</PtoVta><CbteTipo>${tipo}</CbteTipo><Resultado>A</Resultado></FeCabResp>` +
            `<FeDetResp><FECAEDetResponse><CbteDesde>${numero}</CbteDesde><Resultado>A</Resultado>` +
            `${obs.length > 0 ? `<Observaciones>${obs.join("")}</Observaciones>` : ""}` +
            `<CAE>${codigo}</CAE><CAEFchVto>20261024</CAEFchVto></FECAEDetResponse></FeDetResp>`,
        );
      }
      case "FECompConsultar": {
        const clave = `${textoDe(xml, "PtoVta")}|${textoDe(xml, "CbteTipo")}|${textoDe(xml, "CbteNro")}`;
        const c = comprobantes.get(clave);
        if (c === undefined)
          return responder(
            errores([
              [602, "No existen datos en nuestros registros para los parametros ingresados."],
            ]),
          );
        return responder(
          `<ResultGet><CbteDesde>${textoDe(xml, "CbteNro")}</CbteDesde><CbteFch>${c.fecha}</CbteFch><ImpTotal>${c.total}</ImpTotal>` +
            `<DocNro>${c.datos}</DocNro><CodAutorizacion>${c.cae}</CodAutorizacion><FchVto>20261024</FchVto><Resultado>A</Resultado></ResultGet>`,
        );
      }
      default:
        return [500, falta("soap:Client", `operación desconocida: ${operacion}`)];
    }
  }

  async function atender(pedido: IncomingMessage, respuesta: ServerResponse): Promise<void> {
    const ruta = pedido.url ?? "/";
    if (ruta.startsWith("/colgado")) return; // nunca responde
    if (ruta.startsWith("/goteo")) {
      respuesta.writeHead(200, { "Content-Type": "text/xml" });
      respuesta.write("<?xml version=");
      return; // manda el comienzo y se cuelga
    }
    const cuerpo = await leerCuerpo(pedido);
    let estado: number;
    let xml: string;
    try {
      [estado, xml] = ruta.includes("LoginCms")
        ? await wsaa(cuerpo)
        : wsfe(String(pedido.headers["soapaction"] ?? ""), cuerpo);
    } catch {
      [estado, xml] = [500, falta("soap:Server", "error interno del falso")];
    }
    respuesta.writeHead(estado, { "Content-Type": "text/xml; charset=utf-8" });
    respuesta.end(xml);
  }

  const servidor: Server = createServer((p, r) => {
    void atender(p, r);
  });
  await new Promise<void>((resolver) => servidor.listen(0, "127.0.0.1", resolver));
  const { port } = servidor.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    autorizaciones,
    cerrar: () =>
      new Promise<void>((resolver) => {
        servidor.closeAllConnections();
        servidor.close(() => resolver());
      }),
  };
}
