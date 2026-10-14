import { describe, expect, it } from "vitest";
import { grabacion } from "../../../test/utilidades/arca";
import { TABLAS_DE_PARAMETROS } from "./codigos";
import { armarTra, pedidoLoginCms } from "./pedidos-de-wsaa";
import {
  accionDeWsfe,
  ESPACIO_DE_NOMBRES_DE_WSFE,
  pedidoFECAESolicitar,
  pedidoFECompConsultar,
  pedidoFECompUltimoAutorizado,
  pedidoFEDummy,
  pedidoFEParamGet,
  type AutenticacionDeWsfe,
  type SolicitudDeWsfe,
} from "./pedidos-de-wsfe";

/**
 * Cada pedido que arma el adaptador se compara, LETRA POR LETRA, con el pedido grabado de la homologación real
 * del 2026-10-14, que ARCA aceptó. Las grabaciones tienen el `Token` y el `Sign` como `[OCULTO]`: se arma con
 * esos mismos valores.
 */
const AUTH: AutenticacionDeWsfe = { token: "[OCULTO]", sign: "[OCULTO]", cuit: "20111111112" };

const base: SolicitudDeWsfe = {
  puntoDeVenta: 1,
  tipoDeComprobante: 6,
  concepto: 1,
  tipoDeDocumento: 99,
  numeroDeDocumento: "0",
  numero: "14",
  fecha: "20261014",
  total: "231.50",
  noGravado: "0.00",
  neto: "200.00",
  exento: "0.00",
  tributos: "0.00",
  iva: "31.50",
  servicio: null,
  moneda: "PES",
  condicionIva: 5,
  asociado: null,
  alicuotas: [
    { id: 5, base: "100.00", importe: "21.00" },
    { id: 4, base: "100.00", importe: "10.50" },
  ],
};

const asociadoDeLaFactura = {
  tipoDeComprobante: 6,
  puntoDeVenta: 1,
  numero: "14",
  cuit: "20111111112",
  fecha: "20261014",
};

const una = [{ id: 5, base: "100.00", importe: "21.00" }];

describe("FECAESolicitar: igual a lo que homologación real aceptó", () => {
  const casos: { nombre: string; grabado: string; solicitud: SolicitudDeWsfe }[] = [
    {
      nombre: "Factura B a consumidor final, IVA en dos alícuotas",
      grabado: "031",
      solicitud: base,
    },
    {
      nombre: "Factura A a un CUIT",
      grabado: "035",
      solicitud: {
        ...base,
        tipoDeComprobante: 1,
        tipoDeDocumento: 80,
        numeroDeDocumento: "30500010912",
        numero: "1",
        total: "121.00",
        neto: "100.00",
        iva: "21.00",
        condicionIva: 1,
        alicuotas: una,
      },
    },
    {
      nombre: "Factura C (sin Iva)",
      grabado: "039",
      solicitud: {
        ...base,
        tipoDeComprobante: 11,
        numero: "1",
        total: "100.00",
        neto: "100.00",
        iva: "0.00",
        alicuotas: [],
      },
    },
    {
      nombre: "nota de crédito B total, con el comprobante asociado",
      grabado: "043",
      solicitud: { ...base, tipoDeComprobante: 8, numero: "1", asociado: asociadoDeLaFactura },
    },
    {
      nombre: "nota de crédito B parcial",
      grabado: "047",
      solicitud: {
        ...base,
        tipoDeComprobante: 8,
        numero: "2",
        total: "121.00",
        neto: "100.00",
        iva: "21.00",
        asociado: asociadoDeLaFactura,
        alicuotas: una,
      },
    },
    {
      nombre: "nota de crédito B mayor que su factura",
      grabado: "051",
      solicitud: {
        ...base,
        tipoDeComprobante: 8,
        numero: "3",
        total: "500.00",
        neto: "413.22",
        iva: "86.78",
        asociado: asociadoDeLaFactura,
        alicuotas: [{ id: 5, base: "413.22", importe: "86.78" }],
      },
    },
    { nombre: "reenvío con los mismos datos", grabado: "053", solicitud: base },
    {
      nombre: "reenvío con otros datos",
      grabado: "055",
      solicitud: { ...base, total: "121.00", neto: "100.00", iva: "21.00", alicuotas: una },
    },
  ];

  it.each(casos)("$nombre", ({ grabado, solicitud }) => {
    expect(pedidoFECAESolicitar(AUTH, solicitud)).toBe(grabacion(1, grabado, "pedido"));
  });

  it("los mismos pedidos de la segunda corrida (otros números)", () => {
    expect(pedidoFECAESolicitar(AUTH, { ...base, numero: "15" })).toBe(
      grabacion(2, "031", "pedido"),
    );
    expect(
      pedidoFECAESolicitar(AUTH, {
        ...base,
        tipoDeComprobante: 1,
        tipoDeDocumento: 80,
        numeroDeDocumento: "30500010912",
        numero: "2",
        total: "121.00",
        neto: "100.00",
        iva: "21.00",
        condicionIva: 1,
        alicuotas: una,
      }),
    ).toBe(grabacion(2, "035", "pedido"));
  });

  it("un comprobante de servicios lleva las tres fechas del abono entre ImpIVA y MonId", () => {
    const xml = pedidoFECAESolicitar(AUTH, {
      ...base,
      concepto: 2,
      servicio: { desde: "20261001", hasta: "20261031", vencimientoDePago: "20261110" },
    });
    expect(xml).toContain(
      "<ar:ImpIVA>31.50</ar:ImpIVA><ar:FchServDesde>20261001</ar:FchServDesde>" +
        "<ar:FchServHasta>20261031</ar:FchServHasta><ar:FchVtoPago>20261110</ar:FchVtoPago>" +
        "<ar:MonId>PES</ar:MonId>",
    );
    expect(xml).toContain("<ar:Concepto>2</ar:Concepto>");
  });

  it("sin servicio no lleva ninguna fecha del abono", () => {
    expect(pedidoFECAESolicitar(AUTH, base)).not.toContain("FchServ");
    expect(pedidoFECAESolicitar(AUTH, base)).not.toContain("FchVtoPago");
  });

  it("cada comprobante lleva un solo registro: CantReg 1, CbteDesde igual a CbteHasta", () => {
    const xml = pedidoFECAESolicitar(AUTH, { ...base, numero: "99999999" });
    expect(xml).toContain("<ar:CantReg>1</ar:CantReg>");
    expect(xml).toContain(
      "<ar:CbteDesde>99999999</ar:CbteDesde><ar:CbteHasta>99999999</ar:CbteHasta>",
    );
  });

  it("los importes van como texto con sus decimales, tal cual llegan", () => {
    const xml = pedidoFECAESolicitar(AUTH, {
      ...base,
      total: "0.10",
      neto: "0.08",
      iva: "0.02",
      noGravado: "0.01",
      exento: "0.03",
      tributos: "0.04",
    });
    expect(xml).toContain(
      "<ar:ImpTotal>0.10</ar:ImpTotal><ar:ImpTotConc>0.01</ar:ImpTotConc><ar:ImpNeto>0.08</ar:ImpNeto>" +
        "<ar:ImpOpEx>0.03</ar:ImpOpEx><ar:ImpTrib>0.04</ar:ImpTrib><ar:ImpIVA>0.02</ar:ImpIVA>",
    );
  });

  it("el token y la firma se escapan: un valor con < o & no rompe el XML", () => {
    const xml = pedidoFECAESolicitar({ token: "a<b", sign: "c&d", cuit: "20111111112" }, base);
    expect(xml).toContain("<ar:Token>a&lt;b</ar:Token><ar:Sign>c&amp;d</ar:Sign>");
  });
});

describe("las demás operaciones de WSFE: igual a lo grabado", () => {
  it("FEDummy no lleva autenticación", () => {
    expect(pedidoFEDummy()).toBe(grabacion(1, "007", "pedido"));
  });

  it("las seis FEParamGet llevan solo la autenticación", () => {
    const grabados = ["009", "011", "013", "015", "017", "019"];
    expect(TABLAS_DE_PARAMETROS).toHaveLength(6);
    TABLAS_DE_PARAMETROS.forEach((tabla, i) => {
      expect(pedidoFEParamGet(AUTH, tabla), tabla).toBe(grabacion(1, grabados[i] ?? "", "pedido"));
    });
  });

  it("FECompUltimoAutorizado: punto de venta y tipo, en ese orden", () => {
    expect(pedidoFECompUltimoAutorizado(AUTH, 1, 1)).toBe(grabacion(1, "021", "pedido"));
    expect(pedidoFECompUltimoAutorizado(AUTH, 1, 6)).toBe(grabacion(1, "023", "pedido"));
    expect(pedidoFECompUltimoAutorizado(AUTH, 1, 11)).toBe(grabacion(1, "027", "pedido"));
  });

  it("FECompConsultar: tipo, número y punto de venta, en ese orden", () => {
    expect(pedidoFECompConsultar(AUTH, 1, 6, "14")).toBe(grabacion(1, "057", "pedido"));
    expect(pedidoFECompConsultar(AUTH, 1, 6, "1014")).toBe(grabacion(1, "059", "pedido"));
  });

  it("la cabecera SOAPAction de cada operación es el espacio de nombres más su nombre", () => {
    expect(ESPACIO_DE_NOMBRES_DE_WSFE).toBe("http://ar.gov.afip.dif.FEV1/");
    expect(accionDeWsfe("FECAESolicitar")).toBe("http://ar.gov.afip.dif.FEV1/FECAESolicitar");
  });
});

describe("WSAA: el TRA y el pedido de loginCms", () => {
  const ahora = new Date("2026-10-14T13:18:07.123Z");

  it("el TRA: generación 2 minutos antes, expiración 10 después, con el huso de Argentina", () => {
    expect(armarTra(ahora, "wsfe")).toBe(
      '<?xml version="1.0" encoding="UTF-8"?><loginTicketRequest version="1.0"><header>' +
        "<uniqueId>1791983887</uniqueId>" +
        "<generationTime>2026-10-14T10:16:07-03:00</generationTime>" +
        "<expirationTime>2026-10-14T10:28:07-03:00</expirationTime>" +
        "</header><service>wsfe</service></loginTicketRequest>",
    );
  });

  it("el huso corre el día: una hora UTC de la madrugada es la noche anterior en Argentina", () => {
    const tra = armarTra(new Date("2026-10-15T01:30:00Z"), "wsfe");
    expect(tra).toContain("<generationTime>2026-10-14T22:28:00-03:00</generationTime>");
    expect(tra).toContain("<expirationTime>2026-10-14T22:40:00-03:00</expirationTime>");
    expect(tra).toContain("<uniqueId>1792027800</uniqueId>");
  });

  it("el uniqueId es un entero sin signo de 32 bits: da la vuelta pasado 2^32 segundos", () => {
    expect(armarTra(new Date("2110-01-01T00:00:00Z"), "wsfe")).toContain(
      "<uniqueId>123010304</uniqueId>",
    );
  });

  it("el servicio se escapa", () => {
    expect(armarTra(ahora, "a&b")).toContain("<service>a&amp;b</service>");
  });

  it("loginCms: el CMS va en in0, igual a lo que WSAA aceptó", () => {
    expect(pedidoLoginCms("[OCULTO]")).toBe(grabacion(1, "001", "pedido"));
  });

  it("el CMS en base64 no se altera (+ / = no se escapan) y un valor con & sí", () => {
    expect(pedidoLoginCms("AB+/cd==")).toContain("<wsaa:in0>AB+/cd==</wsaa:in0>");
    expect(pedidoLoginCms("a&b")).toContain("<wsaa:in0>a&amp;b</wsaa:in0>");
  });
});
