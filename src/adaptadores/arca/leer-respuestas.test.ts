import { describe, expect, it } from "vitest";
import { grabacion } from "../../../test/utilidades/arca";
import {
  leerAutorizacion,
  leerConsulta,
  leerDummy,
  leerFallaSoap,
  leerTabla,
  leerTicketDeLoginCms,
  leerUltimoAutorizado,
} from "./leer-respuestas";

/**
 * Lectura directa de cada respuesta: lo que dice la estructura, sin decidir qué significa. Lo ilegible, lo que
 * no tiene la forma de la operación y los mensajes mal formados son `null`.
 */
const sobre = (operacion: string, resultado: string) =>
  `<soap:Envelope xmlns:soap="x"><soap:Body><${operacion}Response><${operacion}Result>${resultado}</${operacion}Result></${operacion}Response></soap:Body></soap:Envelope>`;
const error = (codigo: string, texto = "m") =>
  `<Err><Code>${codigo}</Code><Msg>${texto}</Msg></Err>`;

describe("lo que no se puede leer es null, en cada operación", () => {
  const lectores: [string, (c: string) => unknown, string][] = [
    ["FECompUltimoAutorizado", leerUltimoAutorizado, "<PtoVta>1</PtoVta>"],
    ["FECAESolicitar", leerAutorizacion, "<FeCabResp />"],
    ["FECompConsultar", leerConsulta, "<ResultGet />"],
    ["FEParamGetTiposIva", (c) => leerTabla(c, "FEParamGetTiposIva"), "<ResultGet />"],
    ["FEDummy", leerDummy, "<AppServer>OK</AppServer>"],
  ];

  it.each(lectores)(
    "%s: un cuerpo ilegible, vacío o de otra operación",
    (operacion, leer, valido) => {
      expect(leer(sobre(operacion, valido))).not.toBeNull();
      expect(leer("")).toBeNull();
      expect(leer("<a><b>")).toBeNull();
      expect(leer(sobre("OtraOperacion", valido))).toBeNull();
      expect(leer(sobre(operacion, ""))).toBeNull();
      expect(leer(`<!DOCTYPE a>${sobre(operacion, valido)}`)).toBeNull();
    },
  );

  it.each(lectores.filter(([o]) => o !== "FEDummy"))(
    "%s: un error mal formado no se entiende",
    (operacion, leer, valido) => {
      for (const malo of [
        "<Err><Msg>m</Msg></Err>",
        "<Err><Code>1</Code></Err>",
        "<Err><Code>x</Code><Msg>m</Msg></Err>",
        "<Err>texto</Err>",
      ]) {
        expect(leer(sobre(operacion, `${valido}<Errors>${malo}</Errors>`)), malo).toBeNull();
      }
      expect(leer(sobre(operacion, `${valido}<Errors>${error("10016")}</Errors>`))).not.toBeNull();
    },
  );
});

describe("falla SOAP y ticket de WSAA", () => {
  const falla = (cuerpo: string) =>
    `<s:Envelope xmlns:s="x"><s:Body><s:Fault>${cuerpo}</s:Fault></s:Body></s:Envelope>`;

  it("la falla: código sin interpretar y texto saneado y desescapado", () => {
    expect(
      leerFallaSoap(falla("<faultcode>ns1:x.y</faultcode><faultstring>a &amp; b</faultstring>")),
    ).toEqual({
      codigo: "ns1:x.y",
      texto: "a & b",
    });
  });

  it("sin faultstring el texto queda vacío; sin faultcode o sin Fault no hay falla", () => {
    expect(leerFallaSoap(falla("<faultcode>c</faultcode>"))).toEqual({ codigo: "c", texto: "" });
    expect(leerFallaSoap(falla("<faultstring>x</faultstring>"))).toBeNull();
    expect(leerFallaSoap(falla("<faultcode />"))).toBeNull();
    expect(leerFallaSoap(grabacion(1, "032", "respuesta"))).toBeNull();
    expect(leerFallaSoap("<a><b>")).toBeNull();
  });

  const original = grabacion(1, "002", "respuesta");
  it("el ticket de la respuesta real", () => {
    expect(leerTicketDeLoginCms(original)).toEqual({
      token: "[OCULTO]",
      sign: "[OCULTO]",
      vencimiento: "2026-10-14T22:18:05.993-03:00",
    });
  });

  it("sin loginCmsReturn, con el ticket ilegible o con un dato de menos, es null", () => {
    expect(leerTicketDeLoginCms("<a><b>")).toBeNull();
    expect(leerTicketDeLoginCms(grabacion(1, "032", "respuesta"))).toBeNull();
    for (const [de, a] of [
      ["&lt;/loginTicketResponse&gt;", ""],
      ["&lt;token&gt;[OCULTO]&lt;/token&gt;", ""],
      ["&lt;sign&gt;[OCULTO]&lt;/sign&gt;", ""],
      ["&lt;expirationTime&gt;2026-10-14T22:18:05.993-03:00&lt;/expirationTime&gt;", ""],
      ["&lt;credentials&gt;", "&lt;otra&gt;"],
    ] as const) {
      expect(leerTicketDeLoginCms(original.replace(de, a)), de).toBeNull();
    }
  });
});

describe("tablas", () => {
  const tabla = (resultado: string) =>
    leerTabla(sobre("FEParamGetTiposIva", resultado), "FEParamGetTiposIva");

  it("filas con sus campos de texto; los campos anidados o repetidos se descartan", () => {
    expect(
      tabla(
        "<ResultGet><IvaTipo><Id>5</Id><Desc>21%</Desc></IvaTipo><IvaTipo><Id>4</Id><Dup>1</Dup><Dup>2</Dup><N><x>1</x></N></IvaTipo></ResultGet>",
      ),
    ).toEqual({ errores: [], filas: [{ Id: "5", Desc: "21%" }, { Id: "4" }] });
  });

  it("vacía con errores (sin ResultGet) o con ResultGet vacío es una tabla sin filas", () => {
    expect(tabla("<ResultGet />")).toEqual({ errores: [], filas: [] });
    expect(tabla(`<Errors>${error("600")}</Errors>`)).toEqual({
      errores: [{ codigo: 600, texto: "m" }],
      filas: [],
    });
  });

  it("sin ResultGet y sin errores, o con un ResultGet que no es una tabla, es null", () => {
    expect(tabla("<Otra>x</Otra>")).toBeNull();
    expect(tabla("<ResultGet>hola</ResultGet>")).toBeNull();
    expect(tabla(`<ResultGet>hola</ResultGet><Errors>${error("600")}</Errors>`)).toBeNull();
    expect(tabla("<ResultGet><A>x</A></ResultGet>")).toBeNull();
    expect(
      tabla("<ResultGet><A><Id>1</Id></A></ResultGet><ResultGet><A><Id>2</Id></A></ResultGet>"),
    ).toBeNull();
  });
});

describe("FEDummy, último autorizado, autorización y consulta", () => {
  it("FEDummy: los tres servidores, y vacío el que falta", () => {
    expect(leerDummy(grabacion(1, "008", "respuesta"))).toEqual({
      aplicacion: "OK",
      baseDeDatos: "OK",
      autenticacion: "OK",
    });
    expect(leerDummy(sobre("FEDummy", "<AppServer>OK</AppServer>"))).toEqual({
      aplicacion: "OK",
      baseDeDatos: "",
      autenticacion: "",
    });
  });

  it("último autorizado: los tres campos como texto", () => {
    expect(leerUltimoAutorizado(grabacion(1, "024", "respuesta"))).toEqual({
      errores: [],
      puntoDeVenta: "1",
      tipoDeComprobante: "6",
      numero: "13",
    });
  });

  it("autorización: cabecera y detalle de la respuesta real, con la observación 10217", () => {
    const leida = leerAutorizacion(grabacion(1, "036", "respuesta"));
    expect(leida?.cabecera).toEqual({ resultado: "A" });
    expect(leida?.errores).toEqual([]);
    expect(leida?.detalles).toHaveLength(1);
    expect(leida?.detalles[0]).toMatchObject({
      resultado: "A",
      desde: "1",
      hasta: "1",
      fecha: "20261014",
      codigo: "86410995001842",
      vencimiento: "20261024",
      observaciones: [{ codigo: 10217 }],
    });
  });

  it("autorización: sin FeCabResp la cabecera es null; un FeCabResp vacío trae el resultado vacío", () => {
    expect(leerAutorizacion(sobre("FECAESolicitar", "<FeDetResp />"))?.cabecera).toBeNull();
    expect(
      leerAutorizacion(sobre("FECAESolicitar", "<FeCabResp><Cuit>1</Cuit></FeCabResp>"))?.cabecera,
    ).toEqual({
      resultado: "",
    });
    expect(leerAutorizacion(sobre("FECAESolicitar", "<FeCabResp />"))?.cabecera).toBeNull();
  });

  it("autorización: una observación mal formada, null; sin observaciones, lista vacía", () => {
    const detalle = (o: string) =>
      sobre(
        "FECAESolicitar",
        `<FeCabResp><Resultado>A</Resultado></FeCabResp><FeDetResp><D><Resultado>A</Resultado>${o}</D></FeDetResp>`,
      );
    expect(
      leerAutorizacion(detalle("<Observaciones><Obs><Msg>x</Msg></Obs></Observaciones>")),
    ).toBeNull();
    expect(leerAutorizacion(detalle(""))?.detalles[0]?.observaciones).toEqual([]);
  });

  it("consulta: ResultGet de la respuesta real", () => {
    const leida = leerConsulta(grabacion(1, "058", "respuesta"));
    expect(leida?.errores).toEqual([]);
    expect(leida?.comprobante).toMatchObject({
      puntoDeVenta: "1",
      tipoDeComprobante: "6",
      desde: "14",
      hasta: "14",
      fecha: "20261014",
      tipoDeDocumento: "99",
      numeroDeDocumento: "0",
      moneda: "PES",
      total: "231.5",
      neto: "200",
      iva: "31.5",
      resultado: "A",
      codigo: "86410995000689",
      vencimiento: "20261024",
      asociados: [],
      alicuotas: [
        { id: "5", base: "100", importe: "21" },
        { id: "4", base: "100", importe: "10.5" },
      ],
    });
  });

  it("consulta: sin ResultGet (602) no hay comprobante pero sí los errores", () => {
    expect(leerConsulta(grabacion(1, "060", "respuesta"))).toEqual({
      errores: [
        {
          codigo: 602,
          texto: "No existen datos en nuestros registros para los parametros ingresados.",
        },
      ],
      comprobante: null,
    });
    expect(
      leerConsulta(sobre("FECompConsultar", "<ResultGet>hola</ResultGet>"))?.comprobante,
    ).toBeNull();
  });
});
