import { describe, expect, it } from "vitest";
import { grabacion, respuestaDeLoginCms, respuestaHttp } from "../../../test/utilidades/arca";
import { importeATexto } from "../../primitivas/dinero/importe";
import { fechaCivilDesdeTexto } from "../../primitivas/tiempo/fecha-civil";
import {
  clasificarAutorizacion,
  clasificarConsulta,
  clasificarDummy,
  clasificarLoginCms,
  clasificarParametros,
  clasificarUltimoAutorizado,
  type EsperadoDeConsulta,
} from "./clasificar";
import type { RespuestaDeTransporte } from "./tipos";

/**
 * Pruebas de CONTRATO del adaptador sobre las respuestas REALES de homologación del 2026-10-14 (espía F0, dos
 * corridas): lo que ARCA contestó de verdad se clasifica en los resultados del dominio, sin red. Las variantes
 * (un CAE que empieza con 0, una respuesta cortada, un detalle de más...) se arman cambiando la grabación.
 */

const fecha = (texto: string) => {
  const f = fechaCivilDesdeTexto(texto);
  if (!f.ok) throw new Error(texto);
  return f.valor;
};

/** Cambia en `xml` cada `[de, a]`; falla si `de` no está (una prueba que no cambia nada no prueba nada). */
function con(xml: string, ...cambios: readonly (readonly [string, string])[]): string {
  let r = xml;
  for (const [de, a] of cambios) {
    if (!r.includes(de)) throw new Error(`la grabación no tiene «${de}»`);
    r = r.replace(de, a);
  }
  return r;
}

const resp = (corrida: 1 | 2, numero: string) =>
  respuestaHttp(grabacion(corrida, numero, "respuesta"));
const hoy = fecha("2026-10-14");

const sobreDeAutorizacion = (cuerpo: string): string =>
  `<soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/"><soap:Body>` +
  `<FECAESolicitarResponse xmlns="http://ar.gov.afip.dif.FEV1/"><FECAESolicitarResult>${cuerpo}` +
  `</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`;

const cabecera = (resultado: string) =>
  `<FeCabResp><Cuit>20111111112</Cuit><PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><FchProceso>20261014101837</FchProceso><CantReg>1</CantReg><Resultado>${resultado}</Resultado></FeCabResp>`;

const detalle = (cuerpo = "", resultado = "A", numero = "14") =>
  `<FECAEDetResponse><Concepto>1</Concepto><DocTipo>99</DocTipo><DocNro>0</DocNro><CbteDesde>${numero}</CbteDesde><CbteHasta>${numero}</CbteHasta><CbteFch>20261014</CbteFch><Resultado>${resultado}</Resultado>${cuerpo}</FECAEDetResponse>`;

const conCae = "<CAE>86410995000689</CAE><CAEFchVto>20261024</CAEFchVto>";
const error = (codigo: string, texto = "texto de ARCA") =>
  `<Err><Code>${codigo}</Code><Msg>${texto}</Msg></Err>`;

const autorizar = (r: RespuestaDeTransporte, numero = 14n) =>
  clasificarAutorizacion(r, { numero, fecha: hoy });

// ---------------------------------------------------------------------------------------------------------------

describe("FECAESolicitar sobre lo que ARCA contestó de verdad", () => {
  it("Factura B autorizada: el CAE queda como texto de 14 dígitos", () => {
    expect(autorizar(resp(1, "032"))).toEqual({
      tipo: "AUTORIZADO",
      codigo: "86410995000689",
      vence: "2026-10-24",
      fecha: "2026-10-14",
      observaciones: [],
    });
  });

  it("Factura A autorizada con la observación 10217 (no es un rechazo)", () => {
    expect(autorizar(resp(1, "036"), 1n)).toEqual({
      tipo: "AUTORIZADO",
      codigo: "86410995001842",
      vence: "2026-10-24",
      fecha: "2026-10-14",
      observaciones: [
        {
          codigo: 10217,
          texto:
            "El credito fiscal discriminado en el presente comprobante solo podra ser computado a efectos del Procedimiento permanente de transicion al Regimen General.",
        },
      ],
    });
  });

  it("Factura C autorizada", () => {
    expect(autorizar(resp(1, "040"), 1n)).toMatchObject({
      tipo: "AUTORIZADO",
      codigo: "86410995003140",
    });
  });

  it("las notas de crédito B (total, parcial y mayor que la factura) se autorizan; la mayor sin la 10237", () => {
    expect(autorizar(resp(1, "044"), 1n)).toMatchObject({ codigo: "86410995003873" });
    expect(autorizar(resp(1, "048"), 2n)).toMatchObject({ tipo: "AUTORIZADO" });
    expect(autorizar(resp(1, "052"), 3n)).toEqual({
      tipo: "AUTORIZADO",
      codigo: "86410995005320",
      vence: "2026-10-24",
      fecha: "2026-10-14",
      observaciones: [],
    });
  });

  it("reenviar un número ya autorizado da 10016 y NO un CAE: es un rechazo", () => {
    const rechazo = {
      tipo: "RECHAZADO",
      errores: [
        {
          codigo: 10016,
          texto:
            "El numero o fecha del comprobante no se corresponde con el proximo a autorizar. Consultar metodo FECompUltimoAutorizado.",
        },
      ],
      observaciones: [],
    };
    expect(autorizar(resp(1, "054"))).toEqual(rechazo);
    expect(autorizar(resp(1, "056"))).toEqual(rechazo);
  });

  it("la segunda corrida: Factura B 15, A 2, C 2, notas 4, 5 y 6", () => {
    expect(autorizar(resp(2, "032"), 15n)).toMatchObject({ codigo: "86410995487117" });
    expect(autorizar(resp(2, "036"), 2n)).toMatchObject({ codigo: "86410995487620" });
    expect(autorizar(resp(2, "040"), 2n)).toMatchObject({ codigo: "86410995487913" });
    expect(autorizar(resp(2, "044"), 4n)).toMatchObject({ codigo: "86410995488236" });
    expect(autorizar(resp(2, "048"), 5n)).toMatchObject({ codigo: "86410995488401" });
    expect(autorizar(resp(2, "052"), 6n)).toMatchObject({ codigo: "86410995488650" });
  });
});

describe("FECAESolicitar: el CAE es texto", () => {
  it("un CAE que empieza con 0 conserva su cero", () => {
    const r = autorizar(
      respuestaHttp(
        con(grabacion(1, "032", "respuesta"), [
          "<CAE>86410995000689</CAE>",
          "<CAE>01234567890123</CAE>",
        ]),
      ),
    );
    expect(r).toMatchObject({ tipo: "AUTORIZADO", codigo: "01234567890123" });
    expect(typeof (r as { codigo: unknown }).codigo).toBe("string");
  });

  it.each([
    ["13 dígitos", "<CAE>8641099500068</CAE>"],
    ["15 dígitos", "<CAE>864109950006890</CAE>"],
    ["letras", "<CAE>8641099500068X</CAE>"],
    ["con espacios adentro", "<CAE>864109 950006890</CAE>"],
    ["vacío", "<CAE />"],
    ["ausente", ""],
  ])("un A con el CAE %s es incierto: nunca se pierde un CAE ni se inventa", (_nombre, cae) => {
    const xml = con(grabacion(1, "032", "respuesta"), ["<CAE>86410995000689</CAE>", cae]);
    expect(autorizar(respuestaHttp(xml))).toEqual({
      tipo: "INCIERTO",
      motivo: "ARCA respondió A sin un CAE y un vencimiento válidos",
    });
  });

  it.each([
    ["una fecha que no existe", "<CAEFchVto>20261324</CAEFchVto>"],
    ["con otro formato", "<CAEFchVto>2026-10-24</CAEFchVto>"],
    ["con un sufijo", "<CAEFchVto>20261024x</CAEFchVto>"],
    ["con un prefijo", "<CAEFchVto>x20261024</CAEFchVto>"],
    ["vacío", "<CAEFchVto />"],
    ["ausente", ""],
  ])("un A con el vencimiento %s es incierto", (_nombre, vto) => {
    const xml = con(grabacion(1, "032", "respuesta"), ["<CAEFchVto>20261024</CAEFchVto>", vto]);
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ tipo: "INCIERTO" });
  });

  it("si la respuesta no trae la fecha del comprobante, queda la que se pidió", () => {
    const xml = con(grabacion(1, "032", "respuesta"), ["<CbteFch>20261014</CbteFch>", ""]);
    expect(
      clasificarAutorizacion(respuestaHttp(xml), { numero: 14n, fecha: fecha("2026-10-15") }),
    ).toMatchObject({ tipo: "AUTORIZADO", fecha: "2026-10-15" });
  });

  it("si trae una fecha válida, es la que ARCA informa", () => {
    const xml = con(grabacion(1, "032", "respuesta"), [
      "<CbteFch>20261014</CbteFch>",
      "<CbteFch>20261013</CbteFch>",
    ]);
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ fecha: "2026-10-13" });
  });

  it("si la fecha del comprobante viene rota, queda la que se pidió", () => {
    const xml = con(grabacion(1, "032", "respuesta"), [
      "<CbteFch>20261014</CbteFch>",
      "<CbteFch>xx</CbteFch>",
    ]);
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ fecha: "2026-10-14" });
  });
});

describe("FECAESolicitar: la respuesta tiene que ser la de ESTE comprobante", () => {
  it("un A por otro número es incierto, no se le adjudica el CAE a este comprobante", () => {
    expect(autorizar(resp(1, "032"), 15n)).toEqual({
      tipo: "INCIERTO",
      motivo: "ARCA respondió por otro número de comprobante",
    });
  });

  it("también si solo difiere CbteHasta", () => {
    const xml = con(grabacion(1, "032", "respuesta"), [
      "<CbteHasta>14</CbteHasta>",
      "<CbteHasta>15</CbteHasta>",
    ]);
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ tipo: "INCIERTO" });
  });

  it("también si solo difiere CbteDesde o falta", () => {
    const xml = con(grabacion(1, "032", "respuesta"), ["<CbteDesde>14</CbteDesde>", ""]);
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ tipo: "INCIERTO" });
  });
});

describe("FECAESolicitar: lo que no es ni autorizado ni rechazado es incierto", () => {
  it("cabecera y detalle que no coinciden (R y A, A y R)", () => {
    expect(
      autorizar(
        respuestaHttp(
          sobreDeAutorizacion(`${cabecera("R")}<FeDetResp>${detalle(conCae)}</FeDetResp>`),
        ),
      ),
    ).toEqual({
      tipo: "INCIERTO",
      motivo: "ARCA respondió un resultado que no es ni autorizado ni rechazado",
    });
    expect(
      autorizar(
        respuestaHttp(
          sobreDeAutorizacion(`${cabecera("A")}<FeDetResp>${detalle("", "R")}</FeDetResp>`),
        ),
      ),
    ).toEqual({
      tipo: "INCIERTO",
      motivo: "ARCA respondió un resultado que no es ni autorizado ni rechazado",
    });
  });

  it("un resultado parcial (P) o desconocido", () => {
    for (const r of ["P", "", "X", "a"]) {
      const xml = sobreDeAutorizacion(`${cabecera(r)}<FeDetResp>${detalle(conCae, r)}</FeDetResp>`);
      expect(autorizar(respuestaHttp(xml)), r).toEqual({
        tipo: "INCIERTO",
        motivo: "ARCA respondió un resultado que no es ni autorizado ni rechazado",
      });
    }
  });

  it("sin cabecera", () => {
    const xml = sobreDeAutorizacion(`<FeDetResp>${detalle(conCae)}</FeDetResp>`);
    expect(autorizar(respuestaHttp(xml))).toEqual({
      tipo: "INCIERTO",
      motivo: "la respuesta de ARCA no trae la cabecera",
    });
  });

  it("dos detalles para un solo comprobante", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("A")}<FeDetResp>${detalle(conCae)}${detalle(conCae)}</FeDetResp>`,
    );
    expect(autorizar(respuestaHttp(xml))).toEqual({
      tipo: "INCIERTO",
      motivo: "ARCA respondió 2 detalles para un solo comprobante",
    });
  });

  it("tres detalles rechazados tampoco se aceptan como un rechazo", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle("", "R")}${detalle("", "R")}${detalle("", "R")}</FeDetResp>`,
    );
    expect(autorizar(respuestaHttp(xml))).toMatchObject({
      tipo: "INCIERTO",
      motivo: "ARCA respondió 3 detalles para un solo comprobante",
    });
  });

  it("sin detalle y sin errores", () => {
    expect(autorizar(respuestaHttp(sobreDeAutorizacion(`${cabecera("R")}<FeDetResp />`)))).toEqual({
      tipo: "INCIERTO",
      motivo: "ARCA respondió sin detalle del comprobante",
    });
    expect(autorizar(respuestaHttp(sobreDeAutorizacion(`${cabecera("A")}`)))).toMatchObject({
      tipo: "INCIERTO",
    });
  });

  it("sin detalle, con errores pero sin que la cabecera diga R", () => {
    const xml = sobreDeAutorizacion(`${cabecera("A")}<Errors>${error("10000")}</Errors>`);
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ tipo: "INCIERTO" });
  });
});

describe("FECAESolicitar: errores sin detalle", () => {
  const sinDetalle = (codigos: string[], resultado = "R") =>
    respuestaHttp(
      sobreDeAutorizacion(
        `${cabecera(resultado)}<FeDetResp />${`<Errors>${codigos.map((c) => error(c)).join("")}</Errors>`}`,
      ),
    );

  it("600 y 601: ARCA no aceptó el token, seguro no procesó el pedido (NO_ENVIADO)", () => {
    expect(autorizar(sinDetalle(["600"]))).toEqual({
      tipo: "NO_ENVIADO",
      motivo: "ARCA no aceptó el token (error 600)",
    });
    expect(autorizar(sinDetalle(["601"]))).toEqual({
      tipo: "NO_ENVIADO",
      motivo: "ARCA no aceptó el token (error 601)",
    });
    expect(autorizar(sinDetalle(["10000", "601"]))).toMatchObject({ tipo: "NO_ENVIADO" });
  });

  it("500, 501 y 502: error interno de ARCA, pudo haber procesado el pedido (INCIERTO)", () => {
    for (const codigo of ["500", "501", "502"]) {
      expect(autorizar(sinDetalle([codigo])), codigo).toEqual({
        tipo: "INCIERTO",
        motivo: `error interno de ARCA (${codigo})`,
      });
    }
    expect(autorizar(sinDetalle(["10000", "502"]))).toMatchObject({ tipo: "INCIERTO" });
  });

  it("un rechazo explícito de la cabecera con otros códigos es un RECHAZADO", () => {
    expect(autorizar(sinDetalle(["10000", "10007"]))).toEqual({
      tipo: "RECHAZADO",
      errores: [
        { codigo: 10000, texto: "texto de ARCA" },
        { codigo: 10007, texto: "texto de ARCA" },
      ],
      observaciones: [],
    });
  });

  it("un 602 o un 10016 sin detalle y con R también es un rechazo", () => {
    expect(autorizar(sinDetalle(["10016"]))).toMatchObject({ tipo: "RECHAZADO" });
    expect(autorizar(sinDetalle(["602"]))).toMatchObject({ tipo: "RECHAZADO" });
  });

  it("con un detalle, los códigos 600 y 500 del resultado no cambian lo que dice el detalle", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle("", "R")}</FeDetResp><Errors>${error("500")}${error("600")}</Errors>`,
    );
    expect(autorizar(respuestaHttp(xml))).toMatchObject({
      tipo: "RECHAZADO",
      errores: [
        { codigo: 500, texto: "texto de ARCA" },
        { codigo: 600, texto: "texto de ARCA" },
      ],
    });
  });
});

describe("FECAESolicitar: rechazos", () => {
  it("el rechazo lleva los errores del resultado y las observaciones del detalle", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle(`<Observaciones><Obs><Code>10048</Code><Msg>total no cuadra</Msg></Obs><Obs><Code>10023</Code><Msg>otra</Msg></Obs></Observaciones>`, "R")}</FeDetResp><Errors>${error("10016", "fuera de secuencia")}</Errors>`,
    );
    expect(autorizar(respuestaHttp(xml))).toEqual({
      tipo: "RECHAZADO",
      errores: [{ codigo: 10016, texto: "fuera de secuencia" }],
      observaciones: [
        { codigo: 10048, texto: "total no cuadra" },
        { codigo: 10023, texto: "otra" },
      ],
    });
  });

  it("un rechazo sin ningún mensaje sigue siendo un rechazo (lo dice ARCA)", () => {
    const xml = sobreDeAutorizacion(`${cabecera("R")}<FeDetResp>${detalle("", "R")}</FeDetResp>`);
    expect(autorizar(respuestaHttp(xml))).toEqual({
      tipo: "RECHAZADO",
      errores: [],
      observaciones: [],
    });
  });

  it("un rechazo de otro número también se informa tal cual: no se le adjudica nada", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle("", "R", "99")}</FeDetResp>`,
    );
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ tipo: "RECHAZADO" });
  });

  it("los códigos reales de rechazo viajan crudos (10007: tipo de comprobante inválido)", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle(`<Observaciones><Obs><Code>10007</Code><Msg>El tipo de comprobante informado no es válido</Msg></Obs></Observaciones>`, "R")}</FeDetResp>`,
    );
    expect(autorizar(respuestaHttp(xml))).toEqual({
      tipo: "RECHAZADO",
      errores: [],
      observaciones: [{ codigo: 10007, texto: "El tipo de comprobante informado no es válido" }],
    });
  });

  it("las observaciones también se leen con el nombre del manual (Obs > Observaciones no, Observaciones > cualquiera sí)", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("A")}<FeDetResp>${detalle(`<Observaciones><Observacion><Code>10217</Code><Msg>m</Msg></Observacion></Observaciones>${conCae}`)}</FeDetResp>`,
    );
    expect(autorizar(respuestaHttp(xml))).toMatchObject({
      tipo: "AUTORIZADO",
      observaciones: [{ codigo: 10217, texto: "m" }],
    });
  });

  it("el detalle puede llamarse como en el manual (FEDetResponse): se leen todos los hijos", () => {
    const xml = con(
      grabacion(1, "032", "respuesta"),
      ["<FECAEDetResponse>", "<FEDetResponse>"],
      ["</FECAEDetResponse>", "</FEDetResponse>"],
    );
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ tipo: "AUTORIZADO" });
  });
});

describe("FECAESolicitar: mensajes mal formados e ilegibles", () => {
  it.each([
    ["un error sin Code", "<Err><Msg>x</Msg></Err>"],
    ["un error sin Msg", "<Err><Code>10016</Code></Err>"],
    ["un Code que no es número", "<Err><Code>abc</Code><Msg>x</Msg></Err>"],
    ["un Code de siete dígitos", "<Err><Code>1000000</Code><Msg>x</Msg></Err>"],
    ["un Code vacío", "<Err><Code></Code><Msg>x</Msg></Err>"],
    ["un Code negativo", "<Err><Code>-1</Code><Msg>x</Msg></Err>"],
    ["un hijo que es un texto", "<Err>hola</Err>"],
  ])("%s: la respuesta no se entiende, es incierto", (_nombre, err) => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle("", "R")}</FeDetResp><Errors>${err}</Errors>`,
    );
    expect(autorizar(respuestaHttp(xml))).toEqual({
      tipo: "INCIERTO",
      motivo: "la respuesta de ARCA no se pudo leer",
    });
  });

  it("una observación mal formada también", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("A")}<FeDetResp>${detalle(`<Observaciones><Obs><Msg>x</Msg></Obs></Observaciones>${conCae}`)}</FeDetResp>`,
    );
    expect(autorizar(respuestaHttp(xml))).toMatchObject({ tipo: "INCIERTO" });
  });

  it("una respuesta cortada a la mitad es incierta, aunque ya trajera el CAE", () => {
    const completa = grabacion(1, "032", "respuesta");
    const corte = completa.indexOf("</CAE>") + 3;
    expect(autorizar(respuestaHttp(completa.slice(0, corte)))).toEqual({
      tipo: "INCIERTO",
      motivo: "la respuesta de ARCA no se pudo leer",
    });
  });

  it("un cuerpo vacío, que no es XML o con DOCTYPE es incierto", () => {
    for (const cuerpo of ["", "hola", "<!DOCTYPE a><a/>"]) {
      expect(autorizar(respuestaHttp(cuerpo)), cuerpo).toMatchObject({ tipo: "INCIERTO" });
    }
  });

  it("una estructura que no es la de la operación es incierta", () => {
    const otra = grabacion(1, "022", "respuesta");
    expect(autorizar(respuestaHttp(otra))).toEqual({
      tipo: "INCIERTO",
      motivo: "la respuesta de ARCA no se pudo leer",
    });
    expect(autorizar(respuestaHttp(sobreDeAutorizacion("")))).toMatchObject({ tipo: "INCIERTO" });
  });

  it("una falla SOAP con HTTP 200 es incierta", () => {
    expect(autorizar(respuestaHttp(grabacion(1, "004", "respuesta")))).toMatchObject({
      tipo: "INCIERTO",
    });
  });
});

describe("FECAESolicitar: fallas del transporte y del servicio", () => {
  it("la conexión que no se abrió seguro no mandó nada: NO_ENVIADO", () => {
    expect(autorizar({ tipo: "NO_SALIO", motivo: "ECONNREFUSED" })).toEqual({
      tipo: "NO_ENVIADO",
      motivo: "no salió: ECONNREFUSED",
    });
  });

  it("un tiempo agotado o un corte después de conectar es INCIERTO", () => {
    expect(autorizar({ tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" })).toEqual({
      tipo: "INCIERTO",
      motivo: "sin respuesta completa: TIEMPO_AGOTADO",
    });
    expect(autorizar({ tipo: "SIN_RESPUESTA", motivo: "CONEXION_CORTADA" })).toMatchObject({
      tipo: "INCIERTO",
    });
  });

  it("un HTTP que no es 200 es INCIERTO, también un 4xx y un 3xx: no se sabe si llegó", () => {
    for (const estado of [201, 204, 301, 400, 403, 404, 500, 502, 503, 504]) {
      expect(
        autorizar(respuestaHttp(grabacion(1, "032", "respuesta"), estado)),
        String(estado),
      ).toEqual({
        tipo: "INCIERTO",
        motivo: `HTTP ${estado}`,
      });
    }
  });

  it("un 500 con una falla SOAP es incierto, no un rechazo", () => {
    expect(autorizar(respuestaHttp(grabacion(1, "004", "respuesta"), 500))).toEqual({
      tipo: "INCIERTO",
      motivo: "HTTP 500",
    });
  });

  it("un motivo del transporte con una credencial no la repite", () => {
    const r = autorizar({ tipo: "NO_SALIO", motivo: `<Token>${"x".repeat(30)}SECRETO</Token>` });
    expect(JSON.stringify(r)).not.toContain("SECRETO");
  });
});

describe("saneamiento de los mensajes de ARCA", () => {
  it("un Msg que repite una credencial sale oculto, también si venía escapado", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle("", "R")}</FeDetResp><Errors>${error("10000", "token &lt;Token&gt;SECRETO-1&lt;/Token&gt; y " + "A".repeat(90))}</Errors>`,
    );
    const r = autorizar(respuestaHttp(xml));
    expect(JSON.stringify(r)).not.toContain("SECRETO-1");
    expect(JSON.stringify(r)).not.toContain("AAAAAAAAAA");
    expect(r).toMatchObject({
      errores: [{ codigo: 10000, texto: "token <Token>[OCULTO]</Token> y [OCULTO]" }],
    });
  });

  it("los Msg de ARCA se desescapan (comillas y símbolos)", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle("", "R")}</FeDetResp><Errors>${error("10000", "A &amp; B &lt;C&gt; &quot;D&quot; &apos;E&apos;")}</Errors>`,
    );
    expect(autorizar(respuestaHttp(xml))).toMatchObject({
      errores: [{ texto: `A & B <C> "D" 'E'` }],
    });
  });

  it("un Msg larguísimo se acota", () => {
    const xml = sobreDeAutorizacion(
      `${cabecera("R")}<FeDetResp>${detalle("", "R")}</FeDetResp><Errors>${error("10000", "palabra ".repeat(200))}</Errors>`,
    );
    const r = autorizar(respuestaHttp(xml));
    expect(r.tipo === "RECHAZADO" && r.errores[0]?.texto.length).toBe(500);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("FECompUltimoAutorizado", () => {
  const esperado = (puntoDeVenta: number, tipoDeComprobante: number) => ({
    puntoDeVenta,
    tipoDeComprobante,
  });

  it("el último número de cada serie, sin números sueltos de más", () => {
    expect(clasificarUltimoAutorizado(resp(1, "022"), esperado(1, 1))).toEqual({
      ok: true,
      valor: 0n,
    });
    expect(clasificarUltimoAutorizado(resp(1, "024"), esperado(1, 6))).toEqual({
      ok: true,
      valor: 13n,
    });
    expect(clasificarUltimoAutorizado(resp(1, "046"), esperado(1, 8))).toEqual({
      ok: true,
      valor: 1n,
    });
    expect(clasificarUltimoAutorizado(resp(2, "050"), esperado(1, 8))).toEqual({
      ok: true,
      valor: 5n,
    });
  });

  it("una respuesta que no es del punto de venta o del tipo pedidos no sirve", () => {
    expect(clasificarUltimoAutorizado(resp(1, "024"), esperado(2, 6)).ok).toBe(false);
    expect(clasificarUltimoAutorizado(resp(1, "024"), esperado(1, 7))).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "ARCA respondió un último autorizado que no es el pedido",
      },
    });
  });

  const conNumero = (cbteNro: string) =>
    respuestaHttp(con(grabacion(1, "024", "respuesta"), ["<CbteNro>13</CbteNro>", cbteNro]));

  it("el número tiene que ser un entero de hasta 8 dígitos", () => {
    expect(
      clasificarUltimoAutorizado(conNumero("<CbteNro>99999999</CbteNro>"), esperado(1, 6)),
    ).toEqual({
      ok: true,
      valor: 99999999n,
    });
    for (const malo of [
      "<CbteNro>123456789</CbteNro>",
      "<CbteNro>x</CbteNro>",
      "<CbteNro>-1</CbteNro>",
      "<CbteNro />",
      "",
    ]) {
      expect(clasificarUltimoAutorizado(conNumero(malo), esperado(1, 6)).ok, malo).toBe(false);
    }
  });

  it("los errores de ARCA: 600 y 601 son una autorización del servicio que falta", () => {
    const conErrores = (...codigos: string[]) =>
      respuestaHttp(
        `<soap:Envelope xmlns:soap="x"><soap:Body><FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><Errors>${codigos.map((c) => error(c)).join("")}</Errors></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`,
      );
    expect(clasificarUltimoAutorizado(conErrores("600"), esperado(1, 6))).toEqual({
      ok: false,
      error: {
        codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE",
        detalle: "ARCA no aceptó el token (error 600)",
      },
    });
    expect(clasificarUltimoAutorizado(conErrores("601"), esperado(1, 6))).toMatchObject({
      error: { codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE" },
    });
    expect(clasificarUltimoAutorizado(conErrores("11002", "600"), esperado(1, 6))).toMatchObject({
      error: {
        codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE",
        detalle: "ARCA no aceptó el token (error 11002, 600)",
      },
    });
    expect(clasificarUltimoAutorizado(conErrores("11002"), esperado(1, 6))).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "ARCA respondió con errores (11002)",
      },
    });
    expect(clasificarUltimoAutorizado(conErrores("500"), esperado(1, 6))).toMatchObject({
      error: { codigo: "SERVICIO_NO_DISPONIBLE" },
    });
  });

  it("las fallas del transporte y del servicio son «servicio no disponible», con su motivo", () => {
    const noDisponible = (detalle: string) => ({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle },
    });
    expect(
      clasificarUltimoAutorizado({ tipo: "NO_SALIO", motivo: "ENOTFOUND" }, esperado(1, 6)),
    ).toEqual(noDisponible("no salió: ENOTFOUND"));
    expect(
      clasificarUltimoAutorizado(
        { tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" },
        esperado(1, 6),
      ),
    ).toEqual(noDisponible("sin respuesta completa: TIEMPO_AGOTADO"));
    expect(clasificarUltimoAutorizado(respuestaHttp("<x/>", 503), esperado(1, 6))).toEqual(
      noDisponible("HTTP 503"),
    );
    expect(clasificarUltimoAutorizado(respuestaHttp("<a><b>"), esperado(1, 6))).toEqual(
      noDisponible("la respuesta de ARCA no se pudo leer"),
    );
    expect(clasificarUltimoAutorizado(resp(1, "032"), esperado(1, 6))).toEqual(
      noDisponible("la respuesta de ARCA no se pudo leer"),
    );
  });

  it("un error mal formado no se entiende", () => {
    const xml = `<soap:Envelope xmlns:soap="x"><soap:Body><FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><PtoVta>1</PtoVta><CbteTipo>6</CbteTipo><CbteNro>1</CbteNro><Errors><Err><Code>x</Code><Msg>m</Msg></Err></Errors></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`;
    expect(clasificarUltimoAutorizado(respuestaHttp(xml), esperado(1, 6))).toMatchObject({
      ok: false,
      error: { detalle: "la respuesta de ARCA no se pudo leer" },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("FECompConsultar", () => {
  const CUIT = "20111111112";
  const esperado = (cambios: Partial<EsperadoDeConsulta> = {}): EsperadoDeConsulta => ({
    cuit: CUIT,
    puntoDeVenta: 1,
    tipoDeComprobante: 6,
    numero: 14n,
    esNota: false,
    ...cambios,
  });

  it("un número que existe: los datos registrados, el CAE como texto y el vencimiento", () => {
    const r = clasificarConsulta(resp(1, "058"), esperado());
    if (r.tipo !== "ENCONTRADO") throw new Error(JSON.stringify(r));
    expect(r.codigo).toBe("86410995000689");
    expect(r.vence).toBe("2026-10-24");
    expect(r.datos).toMatchObject({
      tipoDeComprobante: 6,
      puntoDeVenta: 1,
      numero: 14n,
      fecha: "2026-10-14",
      tipoDeDocumento: 99,
      numeroDeDocumento: 0n,
      moneda: "PES",
      asociado: null,
    });
    expect(importeATexto(r.datos.total)).toBe("231.50");
    expect(importeATexto(r.datos.neto)).toBe("200.00");
    expect(importeATexto(r.datos.iva)).toBe("31.50");
    expect(
      r.datos.alicuotas.map((a) => [a.alicuota, importeATexto(a.base), importeATexto(a.iva)]),
    ).toEqual([
      ["21", "100.00", "21.00"],
      ["10.5", "100.00", "10.50"],
    ]);
  });

  it("la segunda corrida (número 15)", () => {
    const r = clasificarConsulta(resp(2, "058"), esperado({ numero: 15n }));
    expect(r).toMatchObject({ tipo: "ENCONTRADO", codigo: "86410995487117" });
  });

  it("602 es lo único que prueba que el número no existe", () => {
    expect(clasificarConsulta(resp(1, "060"), esperado({ numero: 1014n }))).toEqual({
      tipo: "NO_ENCONTRADO",
    });
  });

  const sinResultGet = (...codigos: string[]) =>
    respuestaHttp(
      `<soap:Envelope xmlns:soap="x"><soap:Body><FECompConsultarResponse><FECompConsultarResult><Errors>${codigos.map((c) => error(c)).join("")}</Errors></FECompConsultarResult></FECompConsultarResponse></soap:Body></soap:Envelope>`,
    );

  it("el 601 NO es «no existe» (un SDK de terceros lo trataba así): es una consulta fallida", () => {
    expect(clasificarConsulta(sinResultGet("601"), esperado())).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "ARCA respondió con errores (601)",
    });
  });

  it("600, 500 y cualquier otro código tampoco; un 602 acompañado de otro error, tampoco", () => {
    for (const codigos of [["600"], ["500"], ["502"], ["10104"], ["602", "601"], ["602", "500"]]) {
      expect(
        clasificarConsulta(sinResultGet(...codigos), esperado()),
        codigos.join(),
      ).toMatchObject({
        tipo: "CONSULTA_FALLIDA",
      });
    }
    expect(clasificarConsulta(sinResultGet("602", "602"), esperado())).toEqual({
      tipo: "NO_ENCONTRADO",
    });
  });

  it("sin datos y sin errores no se sabe nada", () => {
    expect(clasificarConsulta(sinResultGet(), esperado())).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "ARCA respondió sin datos ni errores",
    });
  });

  it("las fallas del transporte y del servicio son consultas fallidas, con su motivo", () => {
    expect(clasificarConsulta({ tipo: "NO_SALIO", motivo: "ENOTFOUND" }, esperado())).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "no salió: ENOTFOUND",
    });
    expect(
      clasificarConsulta({ tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" }, esperado()),
    ).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "sin respuesta completa: TIEMPO_AGOTADO",
    });
    expect(clasificarConsulta(respuestaHttp("<x/>", 500), esperado())).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "HTTP 500",
    });
    expect(clasificarConsulta(respuestaHttp("<a><b>"), esperado())).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "la respuesta de ARCA no se pudo leer",
    });
    expect(clasificarConsulta(resp(1, "032"), esperado())).toMatchObject({
      tipo: "CONSULTA_FALLIDA",
    });
  });

  const original = grabacion(1, "058", "respuesta");
  const cambiada = (...cambios: (readonly [string, string])[]) =>
    respuestaHttp(con(original, ...cambios));

  it.each([
    ["PtoVta", [["<PtoVta>1</PtoVta><CbteTipo>", "<PtoVta>2</PtoVta><CbteTipo>"]]],
    ["PtoVta", [["<PtoVta>1</PtoVta><CbteTipo>", "<CbteTipo>"]]],
    ["CbteTipo", [["<CbteTipo>6</CbteTipo>", "<CbteTipo>8</CbteTipo>"]]],
    ["CbteTipo", [["<CbteTipo>6</CbteTipo>", ""]]],
    ["CbteDesde", [["<CbteDesde>14</CbteDesde>", "<CbteDesde>15</CbteDesde>"]]],
    ["CbteDesde", [["<CbteHasta>14</CbteHasta>", "<CbteHasta>15</CbteHasta>"]]],
    ["CbteDesde", [["<CbteDesde>14</CbteDesde>", ""]]],
    ["CbteFch", [["<CbteFch>20261014</CbteFch>", "<CbteFch>20261314</CbteFch>"]]],
    ["CbteFch", [["<CbteFch>20261014</CbteFch>", ""]]],
    ["DocTipo", [["<DocTipo>99</DocTipo>", "<DocTipo>abc</DocTipo>"]]],
    ["DocTipo", [["<DocTipo>99</DocTipo>", "<DocTipo>123</DocTipo>"]]],
    ["DocNro", [["<DocNro>0</DocNro>", "<DocNro>123456789012</DocNro>"]]],
    ["DocNro", [["<DocNro>0</DocNro>", ""]]],
    ["MonId", [["<MonId>PES</MonId>", "<MonId>pe</MonId>"]]],
    ["MonId", [["<MonId>PES</MonId>", ""]]],
    ["ImpTotal", [["<ImpTotal>231.5</ImpTotal>", "<ImpTotal>231,5</ImpTotal>"]]],
    ["ImpTotal", [["<ImpTotal>231.5</ImpTotal>", ""]]],
    ["ImpNeto", [["<ImpNeto>200</ImpNeto>", "<ImpNeto>-200</ImpNeto>"]]],
    ["ImpNeto", [["<ImpNeto>200</ImpNeto>", ""]]],
    ["ImpIVA", [["<ImpIVA>31.5</ImpIVA>", "<ImpIVA>31.555</ImpIVA>"]]],
    ["ImpIVA", [["<ImpIVA>31.5</ImpIVA>", ""]]],
    ["Iva", [["<Id>5</Id>", "<Id>7</Id>"]]],
    ["Iva", [["<Id>5</Id>", ""]]],
    [
      "Iva",
      [
        [
          "<BaseImp>100</BaseImp><Importe>21</Importe>",
          "<BaseImp>cien</BaseImp><Importe>21</Importe>",
        ],
      ],
    ],
    ["Iva", [["<BaseImp>100</BaseImp><Importe>21</Importe>", "<BaseImp>100</BaseImp>"]]],
    ["Resultado", [["<Resultado>A</Resultado>", "<Resultado>R</Resultado>"]]],
    ["Resultado", [["<Resultado>A</Resultado>", ""]]],
    [
      "CodAutorizacion",
      [
        [
          "<CodAutorizacion>86410995000689</CodAutorizacion>",
          "<CodAutorizacion>8641099500068</CodAutorizacion>",
        ],
      ],
    ],
    ["CodAutorizacion", [["<CodAutorizacion>86410995000689</CodAutorizacion>", ""]]],
    ["FchVto", [["<FchVto>20261024</FchVto>", "<FchVto>20261099</FchVto>"]]],
    ["FchVto", [["<FchVto>20261024</FchVto>", ""]]],
  ] as const)("si falta o no sirve %s, no se da por encontrado (%#)", (campo, cambios) => {
    const r = clasificarConsulta(cambiada(...cambios), esperado());
    expect(r).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: `la respuesta de ARCA no trae un ${campo} válido`,
    });
  });

  it("los importes se normalizan: ceros de más, un decimal y enteros", () => {
    const r = clasificarConsulta(
      cambiada(
        ["<ImpTotal>231.5</ImpTotal>", "<ImpTotal>231.500</ImpTotal>"],
        ["<ImpNeto>200</ImpNeto>", "<ImpNeto>200.0</ImpNeto>"],
        ["<ImpIVA>31.5</ImpIVA>", "<ImpIVA>31.50</ImpIVA>"],
      ),
      esperado(),
    );
    if (r.tipo !== "ENCONTRADO") throw new Error(JSON.stringify(r));
    expect([r.datos.total, r.datos.neto, r.datos.iva].map(importeATexto)).toEqual([
      "231.50",
      "200.00",
      "31.50",
    ]);
  });

  it("los ceros finales de más se descartan sin tocar los de adentro ni el valor", () => {
    for (const [texto, esperadoTexto] of [
      ["0.050", "0.05"],
      ["1.5000", "1.50"],
      ["1.0500", "1.05"],
      ["10.000", "10.00"],
      ["100", "100.00"],
      ["7.05", "7.05"],
    ] as const) {
      const r = clasificarConsulta(
        cambiada(["<ImpTotal>231.5</ImpTotal>", `<ImpTotal>${texto}</ImpTotal>`]),
        esperado(),
      );
      if (r.tipo !== "ENCONTRADO") throw new Error(`${texto}: ${JSON.stringify(r)}`);
      expect(importeATexto(r.datos.total), texto).toBe(esperadoTexto);
    }
  });

  it("la moneda son exactamente tres caracteres", () => {
    for (const mala of ["PESO", "xPES", "PE", ""]) {
      expect(
        clasificarConsulta(cambiada(["<MonId>PES</MonId>", `<MonId>${mala}</MonId>`]), esperado()),
      ).toEqual({
        tipo: "CONSULTA_FALLIDA",
        detalle: "la respuesta de ARCA no trae un MonId válido",
      });
    }
  });

  it("una cifra con ceros a la izquierda, sin parte entera o con exponente no es un importe", () => {
    for (const malo of ["00.5", "007", ".5", "1e3", "1.", "1,5", " ", "0x1"]) {
      const r = clasificarConsulta(
        cambiada(["<ImpTotal>231.5</ImpTotal>", `<ImpTotal>${malo}</ImpTotal>`]),
        esperado(),
      );
      expect(r, malo).toMatchObject({ tipo: "CONSULTA_FALLIDA" });
    }
  });

  it("el cero y los importes grandes se leen sin perder nada", () => {
    const r = clasificarConsulta(
      cambiada(
        ["<ImpTotal>231.5</ImpTotal>", "<ImpTotal>123456789012345.99</ImpTotal>"],
        ["<ImpNeto>200</ImpNeto>", "<ImpNeto>0</ImpNeto>"],
        ["<ImpIVA>31.5</ImpIVA>", "<ImpIVA>0.0</ImpIVA>"],
      ),
      esperado(),
    );
    if (r.tipo !== "ENCONTRADO") throw new Error(JSON.stringify(r));
    expect([r.datos.total, r.datos.neto, r.datos.iva].map(importeATexto)).toEqual([
      "123456789012345.99",
      "0.00",
      "0.00",
    ]);
  });

  it("una Factura C no trae Iva: las alícuotas son una lista vacía", () => {
    const sinIva = con(original, [/<Iva>.*<\/Iva>/.exec(original)?.[0] ?? "no hay Iva", ""]);
    const r = clasificarConsulta(respuestaHttp(sinIva), esperado());
    expect(r).toMatchObject({ tipo: "ENCONTRADO", datos: { alicuotas: [] } });
  });

  it("todas las alícuotas conocidas se reconocen por su id de ARCA", () => {
    const ids: [string, string][] = [
      ["3", "0"],
      ["4", "10.5"],
      ["5", "21"],
      ["6", "27"],
      ["8", "5"],
      ["9", "2.5"],
    ];
    for (const [id, codigo] of ids) {
      const r = clasificarConsulta(
        cambiada([
          /<Iva>.*<\/Iva>/.exec(original)?.[0] ?? "",
          `<Iva><AlicIva><Id>${id}</Id><BaseImp>100</BaseImp><Importe>0</Importe></AlicIva></Iva>`,
        ]),
        esperado(),
      );
      expect(r, id).toMatchObject({
        tipo: "ENCONTRADO",
        datos: { alicuotas: [{ alicuota: codigo }] },
      });
    }
  });
});

describe("FECompConsultar: las notas traen su comprobante asociado", () => {
  const CUIT = "20111111112";
  const nota = (asociados: string) =>
    respuestaHttp(
      con(
        grabacion(1, "058", "respuesta"),
        ["<CbteTipo>6</CbteTipo></ResultGet>", "<CbteTipo>8</CbteTipo></ResultGet>"],
        ["<MonId>PES</MonId>", `<MonId>PES</MonId>${asociados}`],
      ),
    );
  const esperadoNota = (): EsperadoDeConsulta => ({
    cuit: CUIT,
    puntoDeVenta: 1,
    tipoDeComprobante: 8,
    numero: 14n,
    esNota: true,
  });
  const asociado = (cuerpo: string) => `<CbtesAsoc><CbteAsoc>${cuerpo}</CbteAsoc></CbtesAsoc>`;
  const completo =
    "<Tipo>6</Tipo><PtoVta>1</PtoVta><Nro>13</Nro><Cuit>20111111112</Cuit><CbteFch>20261013</CbteFch>";

  it("el asociado completo: tipo, punto de venta, número, CUIT y fecha", () => {
    const r = clasificarConsulta(nota(asociado(completo)), esperadoNota());
    if (r.tipo !== "ENCONTRADO") throw new Error(JSON.stringify(r));
    expect(r.datos.asociado).toEqual({
      tipoDeComprobante: 6,
      puntoDeVenta: 1,
      numero: 13n,
      cuit: "20111111112",
      fecha: "2026-10-13",
    });
  });

  it("si ARCA no repite la CUIT, es la del emisor: una nota no asocia a otro emisor", () => {
    for (const sinCuit of [
      "<Tipo>6</Tipo><PtoVta>1</PtoVta><Nro>13</Nro><CbteFch>20261013</CbteFch>",
      "<Tipo>6</Tipo><PtoVta>1</PtoVta><Nro>13</Nro><Cuit /><CbteFch>20261013</CbteFch>",
    ]) {
      const r = clasificarConsulta(nota(asociado(sinCuit)), {
        ...esperadoNota(),
        cuit: "30711111111",
      });
      expect(r, sinCuit).toMatchObject({ datos: { asociado: { cuit: "30711111111" } } });
    }
  });

  it("si ARCA informa otra CUIT, es esa", () => {
    const r = clasificarConsulta(
      nota(asociado(completo.replace("20111111112", "30711111111"))),
      esperadoNota(),
    );
    expect(r).toMatchObject({ datos: { asociado: { cuit: "30711111111" } } });
  });

  it("sin la fecha del asociado no se puede comparar: es una consulta fallida, no un conflicto", () => {
    expect(
      clasificarConsulta(
        nota(asociado("<Tipo>6</Tipo><PtoVta>1</PtoVta><Nro>13</Nro><Cuit>20111111112</Cuit>")),
        esperadoNota(),
      ),
    ).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "la respuesta de ARCA no trae un CbtesAsoc válido",
    });
  });

  it.each([
    ["una nota sin comprobante asociado", ""],
    [
      "dos comprobantes asociados",
      `<CbtesAsoc><CbteAsoc>${completo}</CbteAsoc><CbteAsoc>${completo}</CbteAsoc></CbtesAsoc>`,
    ],
    ["un Tipo que no es número", asociado(completo.replace("<Tipo>6</Tipo>", "<Tipo>x</Tipo>"))],
    ["sin Tipo", asociado(completo.replace("<Tipo>6</Tipo>", ""))],
    [
      "un punto de venta de seis dígitos",
      asociado(completo.replace("<PtoVta>1</PtoVta>", "<PtoVta>123456</PtoVta>")),
    ],
    ["sin punto de venta", asociado(completo.replace("<PtoVta>1</PtoVta>", ""))],
    [
      "un Nro de nueve dígitos",
      asociado(completo.replace("<Nro>13</Nro>", "<Nro>123456789</Nro>")),
    ],
    ["sin Nro", asociado(completo.replace("<Nro>13</Nro>", ""))],
    ["una CUIT de diez dígitos", asociado(completo.replace("20111111112", "2011111111"))],
    ["una CUIT con letras", asociado(completo.replace("20111111112", "2011111111x"))],
    ["una CUIT de doce dígitos", asociado(completo.replace("20111111112", "201111111123"))],
    ["una CUIT con un prefijo", asociado(completo.replace("20111111112", "x20111111112"))],
    ["una fecha que no existe", asociado(completo.replace("20261013", "20261313"))],
  ])("%s: consulta fallida", (_nombre, asociados) => {
    expect(clasificarConsulta(nota(asociados), esperadoNota())).toMatchObject({
      tipo: "CONSULTA_FALLIDA",
      detalle: "la respuesta de ARCA no trae un CbtesAsoc válido",
    });
  });

  it("una factura no necesita asociado; si ARCA trae uno, se informa para que el dominio compare", () => {
    const r = clasificarConsulta(
      respuestaHttp(
        con(grabacion(1, "058", "respuesta"), [
          "<MonId>PES</MonId>",
          `<MonId>PES</MonId>${asociado(completo)}`,
        ]),
      ),
      { cuit: CUIT, puntoDeVenta: 1, tipoDeComprobante: 6, numero: 14n, esNota: false },
    );
    expect(r).toMatchObject({ tipo: "ENCONTRADO", datos: { asociado: { numero: 13n } } });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("loginCms (WSAA)", () => {
  it("el ticket de la respuesta real: token, firma y vencimiento como instante", () => {
    const r = clasificarLoginCms(resp(1, "002"));
    expect(r).toEqual({
      ok: true,
      valor: {
        token: "[OCULTO]",
        sign: "[OCULTO]",
        venceEn: new Date("2026-10-14T22:18:05.993-03:00"),
      },
    });
  });

  it("con un token y una firma largos, se devuelven enteros", () => {
    const token = `T${"abc/+".repeat(100)}=`;
    const sign = `S${"xyz/+".repeat(60)}=`;
    const r = clasificarLoginCms(respuestaHttp(respuestaDeLoginCms({ token, sign })));
    expect(r).toMatchObject({ ok: true, valor: { token, sign } });
  });

  it("coe.alreadyAuthenticated: ya hay un ticket vigente y no se insiste", () => {
    for (const [corrida, numero] of [
      [1, "004"],
      [1, "006"],
      [2, "004"],
      [2, "006"],
    ] as const) {
      expect(
        clasificarLoginCms(respuestaHttp(grabacion(corrida, numero, "respuesta"), 500)),
      ).toEqual({
        ok: false,
        error: {
          codigo: "ACCESO_YA_EMITIDO",
          detalle:
            "WSAA coe.alreadyAuthenticated: El CEE ya posee un TA valido para el acceso al WSN solicitado",
        },
      });
    }
  });

  const falla = (codigo: string, texto = "texto de WSAA", estado = 500) =>
    respuestaHttp(
      `<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"><soapenv:Body><soapenv:Fault><faultcode xmlns:ns1="http://xml.apache.org/axis/">ns1:${codigo}</faultcode><faultstring>${texto}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
      estado,
    );

  it("coe.notAuthorized: el certificado no está autorizado para el servicio", () => {
    expect(clasificarLoginCms(falla("coe.notAuthorized", "Computador no autorizado"))).toEqual({
      ok: false,
      error: {
        codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE",
        detalle: "WSAA coe.notAuthorized: Computador no autorizado",
      },
    });
  });

  it("cms.*: la credencial no sirve", () => {
    expect(clasificarLoginCms(falla("cms.cert.expired"))).toMatchObject({
      error: { codigo: "SIN_CREDENCIAL", detalle: "WSAA cms.cert.expired: texto de WSAA" },
    });
  });

  it("otras fallas: el servicio no está disponible", () => {
    expect(clasificarLoginCms(falla("wsaa.internalError"))).toMatchObject({
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "WSAA wsaa.internalError: texto de WSAA",
      },
    });
  });

  it("una falla SOAP se mira aunque el HTTP sea 200", () => {
    expect(clasificarLoginCms(falla("coe.alreadyAuthenticated", "x", 200))).toMatchObject({
      error: { codigo: "ACCESO_YA_EMITIDO" },
    });
  });

  it("el texto de la falla sale saneado: una credencial en él no se repite", () => {
    const r = clasificarLoginCms(
      falla("wsaa.internalError", "&lt;token&gt;SECRETO-2&lt;/token&gt;"),
    );
    expect(JSON.stringify(r)).not.toContain("SECRETO-2");
  });

  it("un HTTP que no es 200 y no es una falla SOAP es servicio no disponible", () => {
    expect(clasificarLoginCms(respuestaHttp("<html>Bad Gateway</html>", 502))).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "HTTP 502" },
    });
    expect(clasificarLoginCms(respuestaHttp(grabacion(1, "002", "respuesta"), 503))).toMatchObject({
      error: { detalle: "HTTP 503" },
    });
  });

  it("una respuesta que no trae el ticket, o lo trae roto, no sirve", () => {
    const noSirve = {
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "la respuesta de WSAA no se pudo leer" },
    };
    expect(clasificarLoginCms(respuestaHttp(""))).toEqual(noSirve);
    expect(clasificarLoginCms(respuestaHttp("<a><b>"))).toEqual(noSirve);
    expect(clasificarLoginCms(resp(1, "032"))).toEqual(noSirve);
    const original = grabacion(1, "002", "respuesta");
    for (const cambio of [
      ["&lt;token&gt;[OCULTO]&lt;/token&gt;", ""],
      ["&lt;sign&gt;[OCULTO]&lt;/sign&gt;", ""],
      ["&lt;token&gt;[OCULTO]&lt;/token&gt;", "&lt;token&gt;&lt;/token&gt;"],
      ["&lt;sign&gt;[OCULTO]&lt;/sign&gt;", "&lt;sign&gt;&lt;/sign&gt;"],
      ["&lt;expirationTime&gt;2026-10-14T22:18:05.993-03:00&lt;/expirationTime&gt;", ""],
      ["&lt;/loginTicketResponse&gt;", ""],
      ["&lt;loginTicketResponse version=&quot;1.0&quot;&gt;", "&lt;DOCTYPE&gt;"],
    ] as const) {
      expect(
        clasificarLoginCms(respuestaHttp(con(original, [cambio[0], cambio[1]]))),
        cambio[0],
      ).toEqual(noSirve);
    }
  });

  it("un vencimiento que no es una fecha no sirve", () => {
    const r = clasificarLoginCms(
      respuestaHttp(
        con(grabacion(1, "002", "respuesta"), ["2026-10-14T22:18:05.993-03:00", "mañana"]),
      ),
    );
    expect(r).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "el vencimiento del ticket no es una fecha",
      },
    });
  });

  it("las fallas del transporte son servicio no disponible, con su motivo", () => {
    expect(clasificarLoginCms({ tipo: "NO_SALIO", motivo: "ECONNREFUSED" })).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "no salió: ECONNREFUSED" },
    });
    expect(clasificarLoginCms({ tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" })).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "sin respuesta completa: TIEMPO_AGOTADO",
      },
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("loginCms: fallas SOAP incompletas", () => {
  const sobre = (falla: string, estado: number) =>
    respuestaHttp(
      `<soapenv:Envelope xmlns:soapenv="x"><soapenv:Body><soapenv:Fault>${falla}</soapenv:Fault></soapenv:Body></soapenv:Envelope>`,
      estado,
    );

  it("una falla sin faultcode no es una falla reconocible: manda el estado HTTP", () => {
    expect(clasificarLoginCms(sobre("<faultstring>algo</faultstring>", 500))).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "HTTP 500" },
    });
    expect(clasificarLoginCms(sobre("<faultstring>algo</faultstring>", 200))).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "la respuesta de WSAA no se pudo leer",
      },
    });
  });

  it("una falla sin faultstring conserva su código y deja el texto vacío", () => {
    expect(clasificarLoginCms(sobre("<faultcode>ns1:coe.notAuthorized</faultcode>", 500))).toEqual({
      ok: false,
      error: { codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE", detalle: "WSAA coe.notAuthorized: " },
    });
  });

  it("una falla con el faultcode vacío tampoco es reconocible", () => {
    expect(clasificarLoginCms(sobre("<faultcode></faultcode>", 500))).toMatchObject({
      error: { detalle: "HTTP 500" },
    });
  });
});

describe("FEParamGet*: las seis tablas, con TODOS los hijos de ResultGet", () => {
  const tabla = (numero: string, operacion: string, corrida: 1 | 2 = 1) => {
    const r = clasificarParametros(resp(corrida, numero), operacion);
    if (!r.ok) throw new Error(JSON.stringify(r.error));
    return r.valor;
  };

  it("cada tabla tiene sus filas: 36, 36, 6, 11, 3 y 49", () => {
    expect(tabla("010", "FEParamGetTiposCbte")).toHaveLength(36);
    expect(tabla("012", "FEParamGetTiposDoc")).toHaveLength(36);
    expect(tabla("014", "FEParamGetTiposIva")).toHaveLength(6);
    expect(tabla("016", "FEParamGetCondicionIvaReceptor")).toHaveLength(11);
    expect(tabla("018", "FEParamGetTiposConcepto")).toHaveLength(3);
    expect(tabla("020", "FEParamGetTiposMonedas")).toHaveLength(49);
  });

  it("lo mismo en la segunda corrida", () => {
    expect(tabla("010", "FEParamGetTiposCbte", 2)).toHaveLength(36);
    expect(tabla("020", "FEParamGetTiposMonedas", 2)).toHaveLength(49);
  });

  it("cada fila trae todos sus campos como texto, con su Id y su Desc", () => {
    expect(tabla("010", "FEParamGetTiposCbte")[0]).toEqual({
      Id: "1",
      Desc: "Factura A",
      FchDesde: "20100917",
      FchHasta: "NULL",
    });
    expect(tabla("012", "FEParamGetTiposDoc").find((f) => f["Id"] === "80")).toEqual({
      Id: "80",
      Desc: "CUIT",
      FchDesde: "20080725",
      FchHasta: "NULL",
    });
    expect(tabla("014", "FEParamGetTiposIva").map((f) => [f["Id"], f["Desc"]])).toEqual([
      ["3", "0%"],
      ["4", "10.5%"],
      ["5", "21%"],
      ["6", "27%"],
      ["8", "5%"],
      ["9", "2.5%"],
    ]);
    expect(tabla("016", "FEParamGetCondicionIvaReceptor")[0]).toEqual({
      Id: "1",
      Desc: "IVA Responsable Inscripto",
      Cmp_Clase: "A/ALEY/C",
    });
    expect(tabla("018", "FEParamGetTiposConcepto").map((f) => f["Id"])).toEqual(["1", "2", "3"]);
    expect(tabla("020", "FEParamGetTiposMonedas")[0]).toMatchObject({
      Id: "PES",
      Desc: "Pesos Argentinos",
    });
  });

  it("los acentos de la descripción llegan intactos", () => {
    const descripciones = tabla("010", "FEParamGetTiposCbte").map((f) => f["Desc"]);
    expect(descripciones).toContain("Nota de Débito A");
    expect(descripciones).toContain("Nota de Crédito B");
  });

  it("una tabla de una sola fila (un solo hijo) también es una fila", () => {
    const xml = `<soap:Envelope xmlns:soap="x"><soap:Body><FEParamGetTiposIvaResponse><FEParamGetTiposIvaResult><ResultGet><IvaTipo><Id>5</Id><Desc>21%</Desc></IvaTipo></ResultGet></FEParamGetTiposIvaResult></FEParamGetTiposIvaResponse></soap:Body></soap:Envelope>`;
    expect(clasificarParametros(respuestaHttp(xml), "FEParamGetTiposIva")).toEqual({
      ok: true,
      valor: [{ Id: "5", Desc: "21%" }],
    });
  });

  it("una tabla vacía es una lista vacía (quien la pide decide qué hacer)", () => {
    const xml = `<soap:Envelope xmlns:soap="x"><soap:Body><FEParamGetTiposIvaResponse><FEParamGetTiposIvaResult><ResultGet /></FEParamGetTiposIvaResult></FEParamGetTiposIvaResponse></soap:Body></soap:Envelope>`;
    expect(clasificarParametros(respuestaHttp(xml), "FEParamGetTiposIva")).toEqual({
      ok: true,
      valor: [],
    });
  });

  it("una fila que no es un registro, o una operación que no es la de la respuesta, no se entiende", () => {
    const rota = `<soap:Envelope xmlns:soap="x"><soap:Body><FEParamGetTiposIvaResponse><FEParamGetTiposIvaResult><ResultGet>hola</ResultGet></FEParamGetTiposIvaResult></FEParamGetTiposIvaResponse></soap:Body></soap:Envelope>`;
    expect(clasificarParametros(respuestaHttp(rota), "FEParamGetTiposIva")).toMatchObject({
      ok: false,
    });
    expect(clasificarParametros(resp(1, "014"), "FEParamGetTiposCbte")).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "la respuesta de ARCA no se pudo leer" },
    });
  });

  it("sin ResultGet y sin errores no hay tabla; un ResultGet repetido tampoco", () => {
    const con = (cuerpo: string) =>
      respuestaHttp(
        `<soap:Envelope xmlns:soap="x"><soap:Body><FEParamGetTiposIvaResponse><FEParamGetTiposIvaResult>${cuerpo}</FEParamGetTiposIvaResult></FEParamGetTiposIvaResponse></soap:Body></soap:Envelope>`,
      );
    const ilegible = {
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "la respuesta de ARCA no se pudo leer" },
    };
    expect(clasificarParametros(con("<Otra>x</Otra>"), "FEParamGetTiposIva")).toEqual(ilegible);
    expect(
      clasificarParametros(
        con(
          "<ResultGet><IvaTipo><Id>5</Id></IvaTipo></ResultGet><ResultGet><IvaTipo><Id>4</Id></IvaTipo></ResultGet>",
        ),
        "FEParamGetTiposIva",
      ),
    ).toEqual(ilegible);
  });

  it("los campos que no son texto de una fila (un hijo con hijos) se descartan; el resto se conserva", () => {
    const xml = `<soap:Envelope xmlns:soap="x"><soap:Body><FEParamGetTiposIvaResponse><FEParamGetTiposIvaResult><ResultGet><IvaTipo><Id>5</Id><Anidado><x>1</x></Anidado><Desc>21%</Desc></IvaTipo></ResultGet></FEParamGetTiposIvaResult></FEParamGetTiposIvaResponse></soap:Body></soap:Envelope>`;
    expect(clasificarParametros(respuestaHttp(xml), "FEParamGetTiposIva")).toEqual({
      ok: true,
      valor: [{ Id: "5", Desc: "21%" }],
    });
  });

  it("los errores de ARCA y las fallas del transporte son errores de emisión", () => {
    const conErrores = (codigo: string) =>
      respuestaHttp(
        `<soap:Envelope xmlns:soap="x"><soap:Body><FEParamGetTiposIvaResponse><FEParamGetTiposIvaResult><Errors>${error(codigo)}</Errors></FEParamGetTiposIvaResult></FEParamGetTiposIvaResponse></soap:Body></soap:Envelope>`,
      );
    expect(clasificarParametros(conErrores("600"), "FEParamGetTiposIva")).toMatchObject({
      error: { codigo: "AUTORIZACION_DEL_SERVICIO_FALTANTE" },
    });
    expect(clasificarParametros(conErrores("500"), "FEParamGetTiposIva")).toMatchObject({
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "ARCA respondió con errores (500)" },
    });
    expect(
      clasificarParametros({ tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" }, "x"),
    ).toMatchObject({
      error: { detalle: "sin respuesta completa: TIEMPO_AGOTADO" },
    });
    expect(clasificarParametros(respuestaHttp("<a><b>"), "x")).toMatchObject({ ok: false });
  });
});

describe("FEDummy", () => {
  it("los tres servidores OK", () => {
    expect(clasificarDummy(resp(1, "008"))).toEqual({
      ok: true,
      valor: { aplicacion: "OK", baseDeDatos: "OK", autenticacion: "OK" },
    });
  });

  it("si falta uno de los tres, o no se puede leer, no es una respuesta válida", () => {
    const original = grabacion(1, "008", "respuesta");
    for (const quitado of [
      "<AppServer>OK</AppServer>",
      "<DbServer>OK</DbServer>",
      "<AuthServer>OK</AuthServer>",
    ]) {
      expect(clasificarDummy(respuestaHttp(con(original, [quitado, ""]))), quitado).toEqual({
        ok: false,
        error: {
          codigo: "SERVICIO_NO_DISPONIBLE",
          detalle: "la respuesta de ARCA no se pudo leer",
        },
      });
    }
    expect(clasificarDummy(respuestaHttp("<a><b>"))).toMatchObject({ ok: false });
    expect(clasificarDummy(resp(1, "032"))).toMatchObject({ ok: false });
    expect(clasificarDummy({ tipo: "NO_SALIO", motivo: "ENOTFOUND" })).toEqual({
      ok: false,
      error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle: "no salió: ENOTFOUND" },
    });
  });

  it("un servidor que informa algo distinto de OK se devuelve tal cual, saneado", () => {
    const original = grabacion(1, "008", "respuesta");
    const r = clasificarDummy(
      respuestaHttp(con(original, ["<DbServer>OK</DbServer>", "<DbServer>CAIDO</DbServer>"])),
    );
    expect(r).toEqual({
      ok: true,
      valor: { aplicacion: "OK", baseDeDatos: "CAIDO", autenticacion: "OK" },
    });
  });
});
