import { describe, expect, it } from "vitest";
import {
  AlmacenDeTicketsEnMemoria,
  CredencialesEnMemoria,
  FIRMA_DE_PRUEBA,
  grabacion,
  respuestaDeLoginCms,
  respuestaHttp,
  TOKEN_DE_PRUEBA,
  TransporteFalso,
  VerificacionEnMemoria,
} from "../../../test/utilidades/arca";
import { credencialDePrueba } from "../../../test/utilidades/arca-credencial";
import { servidorFalso } from "../../../test/utilidades/arca-servidor";
import { solicitudDeAutorizacion } from "../../../test/utilidades/emision-falsa";
import { crearTransporteHttp } from "./transporte-http";
import {
  emisorId,
  solicitudId,
  type EmisionElectronica,
  type PuntoDeVentaParaEmision,
  type SolicitudDeAutorizacion,
} from "../../modulos/fiscal/publico";
import { importeDesdeTexto } from "../../primitivas/dinero/importe";
import { ARS } from "../../primitivas/dinero/moneda";
import { ok } from "../../primitivas/resultado/resultado";
import { cuitDesdeTexto } from "../../primitivas/identificacion-fiscal/cuit";
import { empresaId } from "../../primitivas/identificadores/marca";
import { fechaCivilDesdeTexto } from "../../primitivas/tiempo/fecha-civil";
import type { TicketDeAcceso } from "../../puertos/almacen-de-tickets";
import { Secreto } from "../../primitivas/secreto/secreto";
import type {
  CredencialesDescifradas,
  ErrorDeCredenciales,
} from "../../puertos/credenciales-de-emisor";
import {
  crearEmisionArca,
  crearProveedorDeEmisionArca,
  type AdaptadorDeArca,
  type DependenciasDeArca,
} from "./adaptador-arca";
import { DESTINOS_DE_ARCA } from "./constantes";
import { ErrorDeFirma } from "./firmar-cms";
import { armarTra } from "./pedidos-de-wsaa";
import type { PedidoDeTransporte, RespuestaDeTransporte } from "./tipos";

/**
 * El adaptador contra un transporte falso que sirve las respuestas REALES grabadas en homologación (espía F0):
 * el ticket de acceso (reutilizado, renovado, `alreadyAuthenticated`), las cuatro operaciones del puerto, y las
 * dos reglas que no se negocian: una escritura NUNCA se reenvía y nada secreto sale en ningún resultado.
 */
const AHORA = new Date("2026-10-14T13:18:07.000Z");
const EMPRESA = empresaId("11111111-1111-4111-8111-111111111111");
const EMISOR = emisorId("22222222-2222-4222-8222-222222222222");
const CUIT = (() => {
  const c = cuitDesdeTexto("20111111112");
  if (!c.ok) throw new Error("CUIT de prueba");
  return c.valor;
})();
const CUIT_DEL_RECEPTOR = (() => {
  const c = cuitDesdeTexto("30500010912");
  if (!c.ok) throw new Error("CUIT del receptor de prueba");
  return c.valor;
})();
const PUNTO_DE_VENTA: PuntoDeVentaParaEmision = { cuit: CUIT, numero: 1 };
const fecha = (texto: string) => {
  const f = fechaCivilDesdeTexto(texto);
  if (!f.ok) throw new Error(texto);
  return f.valor;
};
const importe = (texto: string) => importeDesdeTexto(ARS, texto);

/** La Factura B número 14 de la grabación (031): dos alícuotas, consumidor final. */
const solicitudDeLaGrabacion = (
  cambios: Partial<SolicitudDeAutorizacion> = {},
): SolicitudDeAutorizacion =>
  solicitudDeAutorizacion(
    {
      puntoDeVenta: PUNTO_DE_VENTA,
      tipo: "FACTURA_B",
      numero: 14n,
      solicitud: solicitudId("00000000-0000-4000-8000-000000000001"),
    },
    {
      fecha: fecha("2026-10-14"),
      importes: {
        total: importe("231.50"),
        neto: importe("200.00"),
        iva: importe("31.50"),
        exento: importe("0.00"),
        noGravado: importe("0.00"),
        tributos: importe("0.00"),
        alicuotas: [
          { alicuota: "21", base: importe("100.00"), iva: importe("21.00") },
          { alicuota: "10.5", base: importe("100.00"), iva: importe("10.50") },
        ],
      },
      ...cambios,
    },
  );

/** El pedido grabado con el token y la firma que usa la prueba en lugar de `[OCULTO]`. */
function conSecretos(pedido: string, token = TOKEN_DE_PRUEBA, sign = FIRMA_DE_PRUEBA): string {
  let k = 0;
  return pedido.replace(/\[OCULTO\]/g, () => (k++ % 2 === 0 ? token : sign));
}

const horas = (n: number) => new Date(AHORA.getTime() + n * 3_600_000);
const unTicket = (token: string, firma: string, venceEn: Date): TicketDeAcceso => ({
  certificadoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  token: new Secreto(token),
  firma: new Secreto(firma),
  generadoEn: AHORA,
  venceEn,
});
const ticketVigente = unTicket(TOKEN_DE_PRUEBA, FIRMA_DE_PRUEBA, horas(10));

/** Que nada secreto aparezca en lo que el adaptador devuelve: la guarda que falla si aparece. */
const PROHIBIDOS = [
  TOKEN_DE_PRUEBA,
  FIRMA_DE_PRUEBA,
  "BEGIN",
  "PRIVATE KEY",
  "postgres://",
  "CMS-FALSO",
];
function sinSecretos<T>(valor: T): T {
  const texto = JSON.stringify(valor, (_clave, v: unknown) =>
    typeof v === "bigint" ? `${v}n` : v,
  );
  for (const prohibido of PROHIBIDOS) {
    if (texto.includes(prohibido))
      throw new Error(`el resultado del adaptador filtra «${prohibido}»`);
  }
  return valor;
}

type Mundo = Readonly<{
  adaptador: AdaptadorDeArca;
  transporte: TransporteFalso;
  tickets: AlmacenDeTicketsEnMemoria;
  credenciales: CredencialesEnMemoria;
  verificacion: VerificacionEnMemoria;
  esperas: number[];
  /** Cada paso de la prueba, en orden: lecturas, guardados y pedidos. */
  bitacora: string[];
}>;

const CLAVE_FALSA = "-----BEGIN PRIVATE KEY-----\nBBBB\n-----END PRIVATE KEY-----";
const CREDENCIAL_FALSA: CredencialesDescifradas = {
  certificadoId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  certificadoPem: "-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----",
  clavePrivada: new Secreto(CLAVE_FALSA),
  venceEn: new Date("2036-01-01T00:00:00Z"),
};

/** El adaptador con todo en memoria; sus resultados pasan por la guarda de secretos. */
function armar(
  opciones: Readonly<{
    ticket?: TicketDeAcceso | null;
    credencial?: CredencialesDescifradas | ErrorDeCredenciales | null;
    ambiente?: "HOMOLOGACION" | "PRODUCCION";
    firmar?: NonNullable<DependenciasDeArca["firmar"]>;
    /** Con `true` se usa la firma real (la de `firmar-cms.ts`) en lugar de una firma de mentira. */
    firmaReal?: boolean;
    transporte?: TransporteFalso;
  }> = {},
): Mundo {
  const transporte = opciones.transporte ?? new TransporteFalso();
  const tickets = new AlmacenDeTicketsEnMemoria(
    opciones.ticket === undefined ? ticketVigente : opciones.ticket,
  );
  const credenciales = new CredencialesEnMemoria(
    opciones.credencial === undefined ? CREDENCIAL_FALSA : opciones.credencial,
  );
  const verificacion = new VerificacionEnMemoria();
  const esperas: number[] = [];
  const bitacora: string[] = [];
  const leer = tickets.leer.bind(tickets);
  tickets.leer = () => {
    bitacora.push("leer");
    return leer();
  };
  const guardar = tickets.guardar.bind(tickets);
  tickets.guardar = (...argumentos) => {
    bitacora.push("guardar");
    return guardar(...argumentos);
  };
  const enviar = transporte.transporte;
  const dependencias: DependenciasDeArca = {
    credenciales,
    tickets,
    verificacion,
    transporte: (pedido) => {
      bitacora.push(`pedido:${TransporteFalso.operacionDe(pedido)}`);
      return enviar(pedido);
    },
    reloj: { ahora: () => AHORA },
    esperar: (ms) => {
      esperas.push(ms);
      return Promise.resolve();
    },
    ...(opciones.firmaReal === true
      ? {}
      : { firmar: opciones.firmar ?? (() => Promise.resolve("CMS-DE-PRUEBA")) }),
  };
  const real = crearEmisionArca(dependencias, EMPRESA, EMISOR, opciones.ambiente ?? "HOMOLOGACION");
  const vigilado: AdaptadorDeArca = {
    ultimoAutorizado: async (...a) => sinSecretos(await real.ultimoAutorizado(...a)),
    autorizar: async (...a) => sinSecretos(await real.autorizar(...a)),
    consultar: async (...a) => sinSecretos(await real.consultar(...a)),
    estadoDelServicio: async () => sinSecretos(await real.estadoDelServicio()),
    parametros: async (...a) => sinSecretos(await real.parametros(...a)),
  };
  return {
    adaptador: vigilado,
    transporte,
    tickets,
    credenciales,
    verificacion,
    esperas,
    bitacora,
  };
}

const wsfe = (
  ...programadas: [
    string,
    ...(RespuestaDeTransporte | ((p: PedidoDeTransporte) => RespuestaDeTransporte))[],
  ][]
) => {
  const t = new TransporteFalso();
  for (const [operacion, ...respuestas] of programadas) t.programar(operacion, ...respuestas);
  return t;
};
const grabada = (corrida: 1 | 2, numero: string) =>
  respuestaHttp(grabacion(corrida, numero, "respuesta"));

// ---------------------------------------------------------------------------------------------------------------

describe("las operaciones del puerto, con las respuestas reales", () => {
  it("el último autorizado: pide FECompUltimoAutorizado al WSFE de homologación con el ticket guardado", async () => {
    const { adaptador, transporte } = armar({
      transporte: wsfe(["FECompUltimoAutorizado", grabada(1, "024")]),
    });
    expect(await adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
      ok: true,
      valor: 13n,
    });
    expect(transporte.pedidos).toEqual([
      {
        url: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
        accionSoap: "http://ar.gov.afip.dif.FEV1/FECompUltimoAutorizado",
        cuerpo: conSecretos(grabacion(1, "023", "pedido")),
        limiteEnMs: 15_000,
      },
    ]);
  });

  it("en producción las direcciones son las de producción", async () => {
    const { adaptador, transporte } = armar({
      ambiente: "PRODUCCION",
      transporte: wsfe(["FECompUltimoAutorizado", grabada(1, "024")]),
    });
    await adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(transporte.pedidos[0]?.url).toBe("https://servicios1.afip.gov.ar/wsfev1/service.asmx");
  });

  it("autorizar: manda el pedido exacto que ARCA aceptó y devuelve el CAE como texto", async () => {
    const { adaptador, transporte } = armar({
      transporte: wsfe(["FECAESolicitar", grabada(1, "032")]),
    });
    expect(await adaptador.autorizar(solicitudDeLaGrabacion())).toEqual({
      tipo: "AUTORIZADO",
      codigo: "86410995000689",
      vence: "2026-10-24",
      fecha: "2026-10-14",
      observaciones: [],
    });
    expect(transporte.pedidos).toEqual([
      {
        url: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
        accionSoap: "http://ar.gov.afip.dif.FEV1/FECAESolicitar",
        cuerpo: conSecretos(grabacion(1, "031", "pedido")),
        limiteEnMs: 15_000,
      },
    ]);
  });

  it("autorizar una factura A: la observación 10217 viaja cruda, el comprobante queda autorizado", async () => {
    const { adaptador } = armar({ transporte: wsfe(["FECAESolicitar", grabada(1, "036")]) });
    const r = await adaptador.autorizar(
      solicitudDeLaGrabacion({
        tipo: "FACTURA_A",
        numero: 1n,
        receptor: {
          documento: { tipo: "CUIT", numero: CUIT_DEL_RECEPTOR },
          condicionIva: "RESPONSABLE_INSCRIPTO",
        },
      }),
    );
    expect(r).toMatchObject({
      tipo: "AUTORIZADO",
      codigo: "86410995001842",
      observaciones: [{ codigo: 10217 }],
    });
  });

  it("reenviar un número ya autorizado: 10016, un rechazo, jamás un CAE", async () => {
    const { adaptador } = armar({ transporte: wsfe(["FECAESolicitar", grabada(1, "054")]) });
    expect(await adaptador.autorizar(solicitudDeLaGrabacion())).toMatchObject({
      tipo: "RECHAZADO",
      errores: [{ codigo: 10016 }],
    });
  });

  it("consultar: lo que ARCA tiene del número (CodAutorizacion, FchVto e ImpTotal)", async () => {
    const { adaptador, transporte } = armar({
      transporte: wsfe(["FECompConsultar", grabada(1, "058")]),
    });
    const r = await adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 14n);
    expect(r).toMatchObject({ tipo: "ENCONTRADO", codigo: "86410995000689", vence: "2026-10-24" });
    expect(transporte.pedidos[0]).toEqual({
      url: "https://wswhomo.afip.gov.ar/wsfev1/service.asmx",
      accionSoap: "http://ar.gov.afip.dif.FEV1/FECompConsultar",
      cuerpo: conSecretos(grabacion(1, "057", "pedido")),
      limiteEnMs: 15_000,
    });
  });

  it("consultar un número que no existe: 602, NO_ENCONTRADO", async () => {
    const { adaptador, transporte } = armar({
      transporte: wsfe(["FECompConsultar", grabada(1, "060")]),
    });
    expect(await adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 1014n)).toEqual({
      tipo: "NO_ENCONTRADO",
    });
    expect(transporte.pedidos[0]?.cuerpo).toBe(conSecretos(grabacion(1, "059", "pedido")));
  });

  it("consultar una nota de crédito sin asociado en la respuesta no se da por encontrada", async () => {
    const { adaptador } = armar({
      transporte: wsfe([
        "FECompConsultar",
        respuestaHttp(
          grabacion(1, "058", "respuesta").replace(
            "<CbteTipo>6</CbteTipo>",
            "<CbteTipo>8</CbteTipo>",
          ),
        ),
      ]),
    });
    expect(await adaptador.consultar(PUNTO_DE_VENTA, "NOTA_CREDITO_B", 14n)).toMatchObject({
      tipo: "CONSULTA_FALLIDA",
      detalle: "la respuesta de ARCA no trae un CbtesAsoc válido",
    });
  });

  it("FEDummy: la salud del servicio, sin ticket y sin leer el almacén", async () => {
    const { adaptador, transporte, tickets, credenciales } = armar({
      ticket: null,
      credencial: null,
      transporte: wsfe(["FEDummy", grabada(1, "008")]),
    });
    expect(await adaptador.estadoDelServicio()).toEqual({
      ok: true,
      valor: { aplicacion: "OK", baseDeDatos: "OK", autenticacion: "OK" },
    });
    expect(transporte.pedidos[0]?.cuerpo).toBe(grabacion(1, "007", "pedido"));
    expect(transporte.pedidos[0]?.accionSoap).toBe("http://ar.gov.afip.dif.FEV1/FEDummy");
    expect(tickets.lecturas).toBe(0);
    expect(credenciales.pedidas).toBe(0);
  });

  it("FEParamGet*: las seis tablas con sus filas, cada una con su operación", async () => {
    const operaciones = [
      ["TiposCbte", "009", "010", 36],
      ["TiposDoc", "011", "012", 36],
      ["TiposIva", "013", "014", 6],
      ["CondicionIvaReceptor", "015", "016", 11],
      ["TiposConcepto", "017", "018", 3],
      ["TiposMonedas", "019", "020", 49],
    ] as const;
    for (const [tabla, pedido, respuesta, filas] of operaciones) {
      const { adaptador, transporte } = armar({
        transporte: wsfe([`FEParamGet${tabla}`, grabada(1, respuesta)]),
      });
      const r = await adaptador.parametros("20111111112", tabla);
      expect(r.ok && r.valor.length, tabla).toBe(filas);
      expect(transporte.pedidos[0]?.cuerpo, tabla).toBe(
        conSecretos(grabacion(1, pedido, "pedido")),
      );
      expect(transporte.pedidos[0]?.accionSoap).toBe(
        `http://ar.gov.afip.dif.FEV1/FEParamGet${tabla}`,
      );
    }
  });

  it("FEParamGet*: sin ticket devuelve el error de emisión", async () => {
    const { adaptador, transporte } = armar({ ticket: null, credencial: null });
    expect(await adaptador.parametros("20111111112", "TiposIva")).toEqual({
      ok: false,
      error: {
        codigo: "SIN_CREDENCIAL",
        detalle: "el emisor no tiene un certificado vigente en este ambiente",
      },
    });
    expect(transporte.pedidos).toEqual([]);
  });

  it("cumple el puerto de emisión", () => {
    const adaptador: EmisionElectronica = armar().adaptador;
    expect(typeof adaptador.autorizar).toBe("function");
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("el ticket de acceso: se reutiliza, se renueva, no se insiste", () => {
  it("con un ticket vigente guardado no se pide otro ni se tocan las credenciales", async () => {
    const m = armar({ transporte: wsfe(["FECompUltimoAutorizado", grabada(1, "024")]) });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(m.transporte.veces("loginCms")).toBe(0);
    expect(m.credenciales.pedidas).toBe(0);
    expect(m.tickets.guardados).toEqual([]);
    expect(m.bitacora).toEqual(["leer", "pedido:FECompUltimoAutorizado"]);
  });

  it("el ticket guardado va en el pedido: token y firma", async () => {
    const m = armar({
      ticket: unTicket("tok-guardado", "firma-guardada", horas(10)),
      transporte: wsfe(["FECompUltimoAutorizado", grabada(1, "024")]),
    });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(m.transporte.pedidos[0]?.cuerpo).toContain(
      "<ar:Token>tok-guardado</ar:Token><ar:Sign>firma-guardada</ar:Sign>",
    );
  });

  it("un ticket que vence dentro del margen de 5 minutos se renueva; justo en el margen también", async () => {
    for (const [milisegundos, renueva] of [
      [4 * 60_000, true],
      [5 * 60_000, true],
      [5 * 60_000 + 1, false],
    ] as const) {
      const m = armar({
        ticket: unTicket(
          TOKEN_DE_PRUEBA,
          FIRMA_DE_PRUEBA,
          new Date(AHORA.getTime() + milisegundos),
        ),
        transporte: wsfe(
          ["loginCms", respuestaHttp(respuestaDeLoginCms())],
          ["FECompUltimoAutorizado", grabada(1, "024")],
        ),
      });
      await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
      expect(m.transporte.veces("loginCms"), String(milisegundos)).toBe(renueva ? 1 : 0);
    }
  });

  it("un ticket ya vencido se renueva", async () => {
    const m = armar({
      ticket: unTicket(TOKEN_DE_PRUEBA, FIRMA_DE_PRUEBA, horas(-1)),
      transporte: wsfe(
        ["loginCms", respuestaHttp(respuestaDeLoginCms())],
        ["FECompUltimoAutorizado", grabada(1, "024")],
      ),
    });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(m.transporte.veces("loginCms")).toBe(1);
  });

  it("sin ticket: pide las credenciales una vez, firma, llama a loginCms con 20 s y guarda el ticket ANTES de usarlo", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(
        [
          "loginCms",
          respuestaHttp(respuestaDeLoginCms({ vence: "2026-10-14T22:18:05.993-03:00" })),
        ],
        ["FECAESolicitar", grabada(1, "032")],
      ),
    });
    expect(await m.adaptador.autorizar(solicitudDeLaGrabacion())).toMatchObject({
      tipo: "AUTORIZADO",
    });
    expect(m.credenciales.pedidas).toBe(1);
    expect(m.transporte.veces("loginCms")).toBe(1);
    expect(m.transporte.pedidos[0]).toEqual({
      url: "https://wsaahomo.afip.gov.ar/ws/services/LoginCms",
      accionSoap: "",
      cuerpo: grabacion(1, "001", "pedido").replace("[OCULTO]", "CMS-DE-PRUEBA"),
      limiteEnMs: 20_000,
    });
    // El ticket se guardó con su vencimiento, y se guardó antes del pedido a WSFE.
    expect(
      m.tickets.guardados.map((t) => [t.token.revelar(), t.firma.revelar(), t.venceEn]),
    ).toEqual([[TOKEN_DE_PRUEBA, FIRMA_DE_PRUEBA, new Date("2026-10-14T22:18:05.993-03:00")]]);
    expect(m.bitacora).toEqual(["leer", "pedido:loginCms", "guardar", "pedido:FECAESolicitar"]);
    // El ticket recién emitido es el que se usa.
    expect(m.transporte.pedidos[1]?.cuerpo).toBe(conSecretos(grabacion(1, "031", "pedido")));
  });

  it("el TRA firmado es el de ahora (generación −2 min, expiración +10 min) para el servicio wsfe", async () => {
    const firmados: {
      tra: string;
      ahora: Date;
      credencial: Pick<CredencialesDescifradas, "certificadoPem" | "clavePrivada">;
    }[] = [];
    const m = armar({
      ticket: null,
      firmar: (tra, credencial, ahora) => {
        firmados.push({ tra, ahora, credencial });
        return Promise.resolve("CMS-DE-PRUEBA");
      },
      transporte: wsfe(
        ["loginCms", respuestaHttp(respuestaDeLoginCms())],
        ["FECompUltimoAutorizado", grabada(1, "024")],
      ),
    });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(firmados).toEqual([
      { tra: armarTra(AHORA, "wsfe"), ahora: AHORA, credencial: CREDENCIAL_FALSA },
    ]);
  });

  it("de punta a punta con la firma real: el CMS que viaja a WSAA verifica y lleva el TRA", async () => {
    const { credencial } = await credencialDePrueba();
    const m = armar({
      ticket: null,
      credencial,
      firmaReal: true,
      transporte: wsfe(
        ["loginCms", respuestaHttp(respuestaDeLoginCms())],
        ["FECompUltimoAutorizado", grabada(1, "024")],
      ),
    });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    const cms =
      /<wsaa:in0>([^<]+)<\/wsaa:in0>/.exec(m.transporte.pedidos[0]?.cuerpo ?? "")?.[1] ?? "";
    expect(cms.length).toBeGreaterThan(500);
    const pkijs = await import("pkijs");
    const info = pkijs.ContentInfo.fromBER(Buffer.from(cms, "base64"));
    const firmado = new pkijs.SignedData({ schema: info.content });
    await expect(firmado.verify({ signer: 0, checkChain: false })).resolves.toBe(true);
    expect(new TextDecoder().decode(firmado.encapContentInfo.eContent?.getValue())).toBe(
      armarTra(AHORA, "wsfe"),
    );
  });

  it("coe.alreadyAuthenticated: NO se insiste; se espera 3 s y se relee el ticket guardado por el otro proceso", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(
        ["loginCms", respuestaHttp(grabacion(1, "004", "respuesta"), 500)],
        ["FECompUltimoAutorizado", grabada(1, "024")],
      ),
    });
    m.tickets.programarLecturas(null, ticketVigente);
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
      ok: true,
      valor: 13n,
    });
    expect(m.transporte.veces("loginCms")).toBe(1);
    expect(m.esperas).toEqual([3_000]);
    expect(m.tickets.guardados).toEqual([]);
    expect(m.bitacora).toEqual([
      "leer",
      "pedido:loginCms",
      "leer",
      "pedido:FECompUltimoAutorizado",
    ]);
  });

  it("coe.alreadyAuthenticated y el ticket guardado sigue sin aparecer: ACCESO_YA_EMITIDO, y una escritura no sale", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(["loginCms", respuestaHttp(grabacion(1, "004", "respuesta"), 500)]),
    });
    const r = await m.adaptador.autorizar(solicitudDeLaGrabacion());
    expect(r).toEqual({
      tipo: "NO_ENVIADO",
      motivo:
        "sin ticket de acceso (ACCESO_YA_EMITIDO: WSAA coe.alreadyAuthenticated: El CEE ya posee un TA valido para el acceso al WSN solicitado)",
    });
    expect(m.transporte.veces("loginCms")).toBe(1);
    expect(m.transporte.veces("FECAESolicitar")).toBe(0);
    expect(m.esperas).toEqual([3_000]);
  });

  it("el ticket que se relee tampoco sirve si está por vencer", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(["loginCms", respuestaHttp(grabacion(1, "004", "respuesta"), 500)]),
    });
    m.tickets.programarLecturas(null, {
      ...ticketVigente,
      venceEn: new Date(AHORA.getTime() + 60_000),
    });
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toMatchObject({
      ok: false,
      error: { codigo: "ACCESO_YA_EMITIDO" },
    });
  });

  it("se relee una sola vez, sin importar qué conteste el almacén", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(["loginCms", respuestaHttp(grabacion(1, "004", "respuesta"), 500)]),
    });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(m.tickets.lecturas).toBe(2);
  });

  it("sin credencial: SIN_CREDENCIAL y no sale nada a la red", async () => {
    const m = armar({ ticket: null, credencial: null });
    const error = {
      codigo: "SIN_CREDENCIAL",
      detalle: "el emisor no tiene un certificado vigente en este ambiente",
    };
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
      ok: false,
      error,
    });
    expect(await m.adaptador.autorizar(solicitudDeLaGrabacion())).toEqual({
      tipo: "NO_ENVIADO",
      motivo: `sin ticket de acceso (SIN_CREDENCIAL: ${error.detalle})`,
    });
    expect(await m.adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 14n)).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: `sin ticket de acceso (SIN_CREDENCIAL: ${error.detalle})`,
    });
    expect(m.transporte.pedidos).toEqual([]);
  });

  it("una credencial que no sirve para firmar: SIN_CREDENCIAL, y WSAA no se llama", async () => {
    const m = armar({
      ticket: null,
      firmar: () => Promise.reject(new ErrorDeFirma()),
    });
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
      ok: false,
      error: {
        codigo: "SIN_CREDENCIAL",
        detalle: "la credencial del emisor no sirve para firmar el pedido de acceso",
      },
    });
    expect(m.transporte.pedidos).toEqual([]);
  });

  it("si firmar lanza cualquier otra cosa (con una clave adentro), tampoco sale ni se repite", async () => {
    const m = armar({
      ticket: null,
      firmar: () => Promise.reject(new Error(CLAVE_FALSA)),
    });
    const r = await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(r).toMatchObject({ ok: false, error: { codigo: "SIN_CREDENCIAL" } });
  });

  it.each([
    ["coe.notAuthorized", "AUTORIZACION_DEL_SERVICIO_FALTANTE"],
    ["cms.cert.expired", "SIN_CREDENCIAL"],
    ["wsaa.internalError", "SERVICIO_NO_DISPONIBLE"],
  ])("loginCms responde %s: el error de emisión es %s", async (falla, codigo) => {
    const cuerpo = `<soapenv:Envelope xmlns:soapenv="x"><soapenv:Body><soapenv:Fault><faultcode>ns1:${falla}</faultcode><faultstring>f</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;
    const m = armar({ ticket: null, transporte: wsfe(["loginCms", respuestaHttp(cuerpo, 500)]) });
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toMatchObject({
      ok: false,
      error: { codigo },
    });
    expect(m.esperas).toEqual([]);
    expect(m.transporte.veces("loginCms")).toBe(1);
  });

  it("loginCms que no llega o se corta: servicio no disponible; no se guarda nada", async () => {
    for (const respuesta of [
      { tipo: "NO_SALIO", motivo: "ECONNREFUSED" },
      { tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" },
    ] as const) {
      const m = armar({ ticket: null, transporte: wsfe(["loginCms", respuesta]) });
      expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toMatchObject({
        ok: false,
        error: { codigo: "SERVICIO_NO_DISPONIBLE" },
      });
      expect(m.tickets.guardados).toEqual([]);
    }
  });

  it("si no se puede guardar el ticket recién emitido, igual se usa (tirarlo bloquea al certificado por horas)", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(
        ["loginCms", respuestaHttp(respuestaDeLoginCms())],
        ["FECAESolicitar", grabada(1, "032")],
      ),
    });
    m.tickets.fallarAlGuardar = true;
    const r = await m.adaptador.autorizar(solicitudDeLaGrabacion());
    expect(r).toMatchObject({ tipo: "AUTORIZADO" });
    expect(m.transporte.veces("FECAESolicitar")).toBe(1);
  });

  it("si el almacén o las credenciales lanzan (con una cadena de conexión adentro), no hay ticket y el texto no se repite", async () => {
    const falla = () => Promise.reject(new Error("fallo con postgres://usuario:clave@host/base"));
    const m = armar({ transporte: wsfe(["FECAESolicitar", grabada(1, "032")]) });
    m.tickets.leer = falla;
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "no se pudo obtener el ticket de acceso",
      },
    });
    expect(await m.adaptador.autorizar(solicitudDeLaGrabacion())).toEqual({
      tipo: "NO_ENVIADO",
      motivo:
        "sin ticket de acceso (SERVICIO_NO_DISPONIBLE: no se pudo obtener el ticket de acceso)",
    });
    expect(await m.adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 14n)).toMatchObject({
      tipo: "CONSULTA_FALLIDA",
    });
    expect(m.transporte.pedidos).toEqual([]);

    const otro = armar({ ticket: null });
    otro.credenciales.obtener = falla;
    expect(await otro.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toMatchObject({
      ok: false,
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("los puertos de F7: resultados con error, nunca excepciones", () => {
  it("un ticket recién emitido se guarda atado al certificado que lo pidió, envuelto como secreto", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(
        [
          "loginCms",
          respuestaHttp(respuestaDeLoginCms({ vence: "2026-10-14T22:18:05.993-03:00" })),
        ],
        ["FECompUltimoAutorizado", grabada(1, "024")],
      ),
    });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    const [guardado] = m.tickets.guardados;
    expect(m.tickets.guardados).toHaveLength(1);
    expect(guardado?.certificadoId).toBe(CREDENCIAL_FALSA.certificadoId);
    expect(guardado?.token).toBeInstanceOf(Secreto);
    expect(guardado?.token.revelar()).toBe(TOKEN_DE_PRUEBA);
    expect(guardado?.firma.revelar()).toBe(FIRMA_DE_PRUEBA);
    expect(guardado?.generadoEn).toEqual(AHORA);
    expect(guardado?.venceEn).toEqual(new Date("2026-10-14T22:18:05.993-03:00"));
    // Envueltos, no salen por accidente.
    expect(JSON.stringify(guardado)).not.toContain(TOKEN_DE_PRUEBA);
    expect(`${String(guardado?.token)}`).not.toContain(TOKEN_DE_PRUEBA);
  });

  it("si el almacén falla al LEER no se pide otro ticket (podría haber uno vigente): servicio no disponible", async () => {
    for (const error of [
      "TICKET_ILEGIBLE",
      "CERTIFICADO_NO_ENCONTRADO",
      { tipo: "Inesperado", sqlstate: "08006", mensaje: "postgres://usuario:clave@host" },
      { tipo: "ConcurrenciaAgotada" },
    ] as const) {
      const m = armar({
        transporte: wsfe(
          ["loginCms", respuestaHttp(respuestaDeLoginCms())],
          ["FECAESolicitar", grabada(1, "032")],
        ),
      });
      m.tickets.programarLecturas({ error });
      const detalle = "no se pudo leer el ticket de acceso guardado";
      expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
        ok: false,
        error: { codigo: "SERVICIO_NO_DISPONIBLE", detalle },
      });
      expect(await m.adaptador.autorizar(solicitudDeLaGrabacion())).toEqual({
        tipo: "NO_ENVIADO",
        motivo: `sin ticket de acceso (SERVICIO_NO_DISPONIBLE: ${detalle})`,
      });
      expect(await m.adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 14n)).toEqual({
        tipo: "CONSULTA_FALLIDA",
        detalle: `sin ticket de acceso (SERVICIO_NO_DISPONIBLE: ${detalle})`,
      });
      // Ni credenciales, ni WSAA, ni WSFE: no se hizo nada.
      expect(m.credenciales.pedidas).toBe(0);
      expect(m.transporte.pedidos).toEqual([]);
      expect(m.tickets.guardados).toEqual([]);
    }
  });

  it.each([
    [
      "SIN_CERTIFICADO_VIGENTE",
      "SIN_CREDENCIAL",
      "el emisor no tiene un certificado vigente en este ambiente",
    ],
    ["CERTIFICADO_VENCIDO", "SIN_CREDENCIAL", "el certificado del emisor está vencido"],
    ["CLAVE_ILEGIBLE", "SIN_CREDENCIAL", "la clave del certificado del emisor no se pudo leer"],
  ] as const)(
    "credenciales: %s es %s con un texto fijo y no sale nada a la red",
    async (causa, codigo, detalle) => {
      const m = armar({ ticket: null, credencial: causa });
      expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
        ok: false,
        error: { codigo, detalle },
      });
      expect(await m.adaptador.autorizar(solicitudDeLaGrabacion())).toEqual({
        tipo: "NO_ENVIADO",
        motivo: `sin ticket de acceso (${codigo}: ${detalle})`,
      });
      expect(m.transporte.pedidos).toEqual([]);
    },
  );

  it("credenciales: un error de persistencia es servicio no disponible, sin su mensaje", async () => {
    const m = armar({
      ticket: null,
      credencial: {
        tipo: "Inesperado",
        sqlstate: "08006",
        mensaje: "postgres://usuario:clave@host",
      },
    });
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "no se pudieron obtener las credenciales del emisor",
      },
    });
    expect(m.transporte.pedidos).toEqual([]);
  });

  it("si guardar devuelve un error, el ticket igual se usa", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(
        ["loginCms", respuestaHttp(respuestaDeLoginCms())],
        ["FECAESolicitar", grabada(1, "032")],
      ),
    });
    m.tickets.errorAlGuardar = "CERTIFICADO_NO_ENCONTRADO";
    expect(await m.adaptador.autorizar(solicitudDeLaGrabacion())).toMatchObject({
      tipo: "AUTORIZADO",
    });
    expect(m.transporte.veces("FECAESolicitar")).toBe(1);
  });

  it("alreadyAuthenticated y la relectura falla con un error: no hay ticket, ACCESO_YA_EMITIDO, sin pedir otro", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(["loginCms", respuestaHttp(grabacion(1, "004", "respuesta"), 500)]),
    });
    m.tickets.programarLecturas(null, { error: "TICKET_ILEGIBLE" });
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toMatchObject({
      ok: false,
      error: { codigo: "ACCESO_YA_EMITIDO" },
    });
    expect(m.transporte.veces("loginCms")).toBe(1);
  });
});

describe("UNA ESCRITURA NUNCA SE REENVÍA", () => {
  /** Cada una de las maneras de que un FECAESolicitar termine mal, con lo que debe devolver el adaptador. */
  const escenarios: [string, RespuestaDeTransporte | (() => never), string][] = [
    [
      "el servidor no contesta (tiempo agotado)",
      { tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" },
      "INCIERTO",
    ],
    [
      "la conexión se corta a la mitad",
      { tipo: "SIN_RESPUESTA", motivo: "CONEXION_CORTADA" },
      "INCIERTO",
    ],
    [
      "la respuesta es demasiado grande",
      { tipo: "SIN_RESPUESTA", motivo: "RESPUESTA_DEMASIADO_GRANDE" },
      "INCIERTO",
    ],
    ["HTTP 500", respuestaHttp("<x/>", 500), "INCIERTO"],
    ["HTTP 502", respuestaHttp("<x/>", 502), "INCIERTO"],
    ["HTTP 503", respuestaHttp("<x/>", 503), "INCIERTO"],
    ["HTTP 504", respuestaHttp("<x/>", 504), "INCIERTO"],
    ["HTTP 404", respuestaHttp("<x/>", 404), "INCIERTO"],
    ["una falla SOAP", respuestaHttp(grabacion(1, "004", "respuesta"), 500), "INCIERTO"],
    ["una respuesta ilegible", respuestaHttp("esto no es XML"), "INCIERTO"],
    [
      "una respuesta cortada a la mitad",
      respuestaHttp(grabacion(1, "032", "respuesta").slice(0, 700)),
      "INCIERTO",
    ],
    ["una respuesta vacía", respuestaHttp(""), "INCIERTO"],
    [
      "una respuesta con DOCTYPE",
      respuestaHttp('<!DOCTYPE a [<!ENTITY x "y">]><a>&x;</a>'),
      "INCIERTO",
    ],
    [
      "un A sin CAE",
      respuestaHttp(grabacion(1, "032", "respuesta").replace("<CAE>86410995000689</CAE>", "")),
      "INCIERTO",
    ],
    ["una respuesta de otro número", respuestaHttp(grabacion(1, "036", "respuesta")), "INCIERTO"],
    [
      "dos detalles",
      respuestaHttp(
        grabacion(1, "032", "respuesta").replace(
          /<FECAEDetResponse>.*<\/FECAEDetResponse>/,
          (d) => d + d,
        ),
      ),
      "INCIERTO",
    ],
    [
      "el transporte lanza una excepción",
      () => {
        throw new Error(`falla con ${TOKEN_DE_PRUEBA}`);
      },
      "INCIERTO",
    ],
    ["ARCA no aceptó el token (601)", respuestaHttp(sinDetalle("601")), "NO_ENVIADO"],
    ["la conexión no se abrió", { tipo: "NO_SALIO", motivo: "ECONNREFUSED" }, "NO_ENVIADO"],
    ["error interno de ARCA (502)", respuestaHttp(sinDetalle("502")), "INCIERTO"],
  ];

  it.each(escenarios)(
    "%s: un solo pedido a WSFE, resultado %s",
    async (_nombre, respuesta, desenlace) => {
      const guion = typeof respuesta === "function" ? () => respuesta() : respuesta;
      const m = armar({ transporte: wsfe(["FECAESolicitar", guion]) });
      const r = await m.adaptador.autorizar(solicitudDeLaGrabacion());
      expect(r.tipo).toBe(desenlace);
      expect(m.transporte.veces("FECAESolicitar")).toBe(1);
      expect(m.transporte.veces("loginCms")).toBe(0);
      expect(m.transporte.pedidos).toHaveLength(1);
    },
  );

  it("un NO_ENVIADO por el token (600) tampoco se reintenta con otro ticket: lo decide quien llama", async () => {
    const m = armar({
      ticket: null,
      transporte: wsfe(
        ["loginCms", respuestaHttp(respuestaDeLoginCms())],
        ["FECAESolicitar", respuestaHttp(sinDetalle("600"))],
      ),
    });
    expect((await m.adaptador.autorizar(solicitudDeLaGrabacion())).tipo).toBe("NO_ENVIADO");
    expect(m.transporte.veces("FECAESolicitar")).toBe(1);
    expect(m.transporte.veces("loginCms")).toBe(1);
  });

  it("un incierto se resuelve CONSULTANDO, y consultar no escribe nada en ARCA", async () => {
    const m = armar({
      transporte: wsfe(
        ["FECAESolicitar", { tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" }],
        ["FECompConsultar", grabada(1, "058")],
      ),
    });
    expect((await m.adaptador.autorizar(solicitudDeLaGrabacion())).tipo).toBe("INCIERTO");
    expect(await m.adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 14n)).toMatchObject({
      tipo: "ENCONTRADO",
    });
    expect(m.transporte.veces("FECAESolicitar")).toBe(1);
    expect(m.transporte.veces("FECompConsultar")).toBe(1);
  });

  it("un pedido que no se puede traducir no sale (NO_ENVIADO)", async () => {
    const m = armar({ transporte: wsfe(["FECAESolicitar", grabada(1, "032")]) });
    const mal = solicitudDeLaGrabacion({
      importes: {
        ...solicitudDeLaGrabacion().importes,
        alicuotas: [{ alicuota: "EXENTO", base: importe("1.00"), iva: importe("0.00") }],
      },
    });
    expect(await m.adaptador.autorizar(mal)).toEqual({
      tipo: "NO_ENVIADO",
      motivo: "el pedido no se pudo traducir a los valores de WSFE",
    });
    expect(m.transporte.pedidos).toEqual([]);
  });
});

function sinDetalle(codigo: string): string {
  return (
    `<soap:Envelope xmlns:soap="x"><soap:Body><FECAESolicitarResponse><FECAESolicitarResult>` +
    `<FeCabResp><Resultado>R</Resultado></FeCabResp><FeDetResp />` +
    `<Errors><Err><Code>${codigo}</Code><Msg>m</Msg></Err></Errors>` +
    `</FECAESolicitarResult></FECAESolicitarResponse></soap:Body></soap:Envelope>`
  );
}

// ---------------------------------------------------------------------------------------------------------------

describe("consultar y último autorizado ante fallas", () => {
  it("una consulta que no llega es CONSULTA_FALLIDA (se reintenta), no «no existe»", async () => {
    for (const respuesta of [
      { tipo: "NO_SALIO", motivo: "ECONNREFUSED" },
      { tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" },
      respuestaHttp("<x/>", 500),
    ] as const) {
      const m = armar({ transporte: wsfe(["FECompConsultar", respuesta]) });
      expect((await m.adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 14n)).tipo).toBe(
        "CONSULTA_FALLIDA",
      );
    }
  });

  it("el último autorizado que no llega es SERVICIO_NO_DISPONIBLE", async () => {
    const m = armar({
      transporte: wsfe([
        "FECompUltimoAutorizado",
        { tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" },
      ]),
    });
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
      ok: false,
      error: {
        codigo: "SERVICIO_NO_DISPONIBLE",
        detalle: "sin respuesta completa: TIEMPO_AGOTADO",
      },
    });
  });

  it("si el transporte lanza, es una respuesta que no se sabe cómo terminó", async () => {
    const m = armar({
      transporte: wsfe([
        "FECompConsultar",
        () => {
          throw new Error(`boom ${TOKEN_DE_PRUEBA}`);
        },
      ]),
    });
    expect(await m.adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 14n)).toEqual({
      tipo: "CONSULTA_FALLIDA",
      detalle: "sin respuesta completa: FALLA_DEL_TRANSPORTE",
    });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("nada secreto sale: la guarda y los casos adversarios", () => {
  it("la guarda detecta un token, una firma, un PEM o una cadena de conexión en un resultado", () => {
    expect(() => sinSecretos({ motivo: `x ${TOKEN_DE_PRUEBA}` })).toThrow(/filtra/);
    expect(() => sinSecretos({ motivo: FIRMA_DE_PRUEBA })).toThrow(/filtra/);
    expect(() => sinSecretos({ motivo: "-----BEGIN PRIVATE KEY-----" })).toThrow(/filtra/);
    expect(() => sinSecretos({ detalle: "postgres://u:c@h/b" })).toThrow(/filtra/);
    expect(() => sinSecretos({ ok: true, valor: 13n })).not.toThrow();
  });

  it("un Msg de ARCA que repite el token y la firma sale oculto en un rechazo", async () => {
    const xml = grabacion(1, "054", "respuesta").replace(
      "Consultar metodo FECompUltimoAutorizado.",
      `token ${TOKEN_DE_PRUEBA} firma ${FIRMA_DE_PRUEBA}`,
    );
    const m = armar({ transporte: wsfe(["FECAESolicitar", respuestaHttp(xml)]) });
    const r = await m.adaptador.autorizar(solicitudDeLaGrabacion());
    expect(r).toMatchObject({ tipo: "RECHAZADO", errores: [{ codigo: 10016 }] });
  });

  it("una falla de WSAA cuyo texto trae el ticket sale oculta", async () => {
    const cuerpo = `<soapenv:Envelope xmlns:soapenv="x"><soapenv:Body><soapenv:Fault><faultcode>ns1:wsaa.internalError</faultcode><faultstring>&lt;token&gt;${TOKEN_DE_PRUEBA}&lt;/token&gt; ${FIRMA_DE_PRUEBA}</faultstring></soapenv:Fault></soapenv:Body></soapenv:Envelope>`;
    const m = armar({ ticket: null, transporte: wsfe(["loginCms", respuestaHttp(cuerpo, 500)]) });
    const r = await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(r).toMatchObject({ ok: false, error: { codigo: "SERVICIO_NO_DISPONIBLE" } });
  });

  it("los motivos del transporte nunca llevan el texto de una excepción", async () => {
    const m = armar({
      transporte: wsfe([
        "FECAESolicitar",
        () => {
          throw new Error(`${TOKEN_DE_PRUEBA} ${CLAVE_FALSA}`);
        },
      ]),
    });
    expect(await m.adaptador.autorizar(solicitudDeLaGrabacion())).toEqual({
      tipo: "INCIERTO",
      motivo: "sin respuesta completa: FALLA_DEL_TRANSPORTE",
    });
  });

  it("una respuesta de WSFE que trae el ticket en una observación sale oculta en un A", async () => {
    const xml = grabacion(1, "036", "respuesta").replace(
      "El credito fiscal",
      `${TOKEN_DE_PRUEBA} ${FIRMA_DE_PRUEBA} El credito fiscal`,
    );
    const m = armar({ transporte: wsfe(["FECAESolicitar", respuestaHttp(xml)]) });
    const r = await m.adaptador.autorizar(
      solicitudDeLaGrabacion({ tipo: "FACTURA_A", numero: 1n }),
    );
    expect(r).toMatchObject({ tipo: "AUTORIZADO", codigo: "86410995001842" });
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("la primera llamada exitosa verifica la autorización del certificado (D-42)", () => {
  const conErroresDeUltimo = (codigo: string) =>
    respuestaHttp(
      `<soap:Envelope xmlns:soap="x"><soap:Body><FECompUltimoAutorizadoResponse><FECompUltimoAutorizadoResult><Errors><Err><Code>${codigo}</Code><Msg>m</Msg></Err></Errors></FECompUltimoAutorizadoResult></FECompUltimoAutorizadoResponse></soap:Body></soap:Envelope>`,
    );
  const delTicket = { empresa: EMPRESA, certificado: ticketVigente.certificadoId };

  it("el último autorizado exitoso anota al certificado QUE PIDIÓ el ticket, de la empresa del adaptador", async () => {
    const m = armar({ transporte: wsfe(["FECompUltimoAutorizado", grabada(1, "024")]) });
    expect((await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).ok).toBe(true);
    expect(m.verificacion.anotadas).toEqual([delTicket]);
  });

  it("autorizar (AUTORIZADO), consultar (ENCONTRADO) y una tabla de parámetros exitosa también lo anotan", async () => {
    const autorizar = armar({ transporte: wsfe(["FECAESolicitar", grabada(1, "032")]) });
    expect((await autorizar.adaptador.autorizar(solicitudDeLaGrabacion())).tipo).toBe("AUTORIZADO");
    expect(autorizar.verificacion.anotadas).toEqual([delTicket]);

    const consultar = armar({ transporte: wsfe(["FECompConsultar", grabada(1, "058")]) });
    expect((await consultar.adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 14n)).tipo).toBe(
      "ENCONTRADO",
    );
    expect(consultar.verificacion.anotadas).toEqual([delTicket]);

    const parametros = armar({
      transporte: wsfe(["FEParamGetTiposDoc", grabada(1, "012")]),
    });
    expect((await parametros.adaptador.parametros("20111111112", "TiposDoc")).ok).toBe(true);
    expect(parametros.verificacion.anotadas).toEqual([delTicket]);
  });

  it("la verificación usa el certificado del ticket que se pidió a WSAA, no otro", async () => {
    const m = armar({
      ticket: null,
      credencial: { ...CREDENCIAL_FALSA, certificadoId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
      transporte: wsfe(
        ["loginCms", respuestaHttp(respuestaDeLoginCms())],
        ["FECompUltimoAutorizado", grabada(1, "024")],
      ),
    });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(m.verificacion.anotadas).toEqual([
      { empresa: EMPRESA, certificado: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" },
    ]);
  });

  it.each([
    ["ARCA no aceptó el token (600)", conErroresDeUltimo("600")],
    ["la CUIT representada no está en el token (601)", conErroresDeUltimo("601")],
    ["un error interno de ARCA (500)", conErroresDeUltimo("500")],
    ["una respuesta ilegible", respuestaHttp("<html>no es SOAP</html>")],
    ["la conexión no se abrió", { tipo: "NO_SALIO", motivo: "ECONNREFUSED" } as const],
  ])("%s: NO anota nada", async (_nombre, respuesta) => {
    const m = armar({ transporte: wsfe(["FECompUltimoAutorizado", respuesta]) });
    expect((await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).ok).toBe(false);
    expect(m.verificacion.anotadas).toEqual([]);
  });

  it("un comprobante rechazado, uno no encontrado o uno incierto no anotan: no es una llamada exitosa", async () => {
    const rechazado = armar({ transporte: wsfe(["FECAESolicitar", grabada(1, "054")]) });
    expect((await rechazado.adaptador.autorizar(solicitudDeLaGrabacion())).tipo).toBe("RECHAZADO");
    const incierto = armar({
      transporte: wsfe(["FECAESolicitar", { tipo: "SIN_RESPUESTA", motivo: "TIEMPO_AGOTADO" }]),
    });
    expect((await incierto.adaptador.autorizar(solicitudDeLaGrabacion())).tipo).toBe("INCIERTO");
    const noExiste = armar({ transporte: wsfe(["FECompConsultar", grabada(1, "060")]) });
    expect((await noExiste.adaptador.consultar(PUNTO_DE_VENTA, "FACTURA_B", 99n)).tipo).not.toBe(
      "ENCONTRADO",
    );
    expect([rechazado, incierto, noExiste].flatMap((m) => m.verificacion.anotadas)).toEqual([]);
  });

  it("sin ticket ni credencial (nada salió a ARCA) no anota; FEDummy no usa ticket y tampoco", async () => {
    const sinTicket = armar({ ticket: null, credencial: null, transporte: wsfe() });
    expect((await sinTicket.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).ok).toBe(
      false,
    );
    const dummy = armar({ transporte: wsfe(["FEDummy", grabada(1, "008")]) });
    expect((await dummy.adaptador.estadoDelServicio()).ok).toBe(true);
    expect([sinTicket, dummy].flatMap((m) => m.verificacion.anotadas)).toEqual([]);
  });

  it("si anotar falla (la base caída), lo que ARCA contestó se devuelve igual, sin filtrar el texto de la falla", async () => {
    const m = armar({
      transporte: wsfe(
        ["FECompUltimoAutorizado", grabada(1, "024")],
        ["FECAESolicitar", grabada(1, "032")],
      ),
    });
    m.verificacion.fallar = true;
    expect(await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B")).toEqual({
      ok: true,
      valor: 13n,
    });
    expect((await m.adaptador.autorizar(solicitudDeLaGrabacion())).tipo).toBe("AUTORIZADO");
    // `sinSecretos` (dentro de `armar`) ya habría fallado si «postgres://» apareciera en lo devuelto.
    expect(m.verificacion.anotadas).toEqual([]);
  });

  it("cada llamada exitosa vuelve a pedir la anotación (la base decide que es una sola): el adaptador no recuerda nada", async () => {
    const m = armar({
      transporte: wsfe(["FECompUltimoAutorizado", grabada(1, "024"), grabada(1, "024")]),
    });
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    await m.adaptador.ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(m.verificacion.anotadas).toEqual([delTicket, delTicket]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("el proveedor: un adaptador por (empresa, emisor, ambiente)", () => {
  it("cada ambiente usa sus direcciones y cada par lee su propio ticket", async () => {
    const transporte = wsfe(["FECompUltimoAutorizado", grabada(1, "024")]);
    const pedidosDelAlmacen: unknown[][] = [];
    const tickets = new AlmacenDeTicketsEnMemoria(ticketVigente);
    tickets.leer = (...argumentos: unknown[]) => {
      pedidosDelAlmacen.push(argumentos);
      return Promise.resolve(ok(ticketVigente));
    };
    const proveedor = crearProveedorDeEmisionArca({
      credenciales: new CredencialesEnMemoria(CREDENCIAL_FALSA),
      tickets,
      verificacion: new VerificacionEnMemoria(),
      transporte: transporte.transporte,
      reloj: { ahora: () => AHORA },
      esperar: () => Promise.resolve(),
    });
    const otraEmpresa = empresaId("33333333-3333-4333-8333-333333333333");
    const otroEmisor = emisorId("44444444-4444-4444-8444-444444444444");
    await proveedor
      .para(EMPRESA, EMISOR, "HOMOLOGACION")
      .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    await proveedor
      .para(otraEmpresa, otroEmisor, "PRODUCCION")
      .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(pedidosDelAlmacen).toEqual([
      [EMPRESA, EMISOR, "HOMOLOGACION", "wsfe"],
      [otraEmpresa, otroEmisor, "PRODUCCION", "wsfe"],
    ]);
    expect(transporte.pedidos.map((p) => p.url)).toEqual([
      DESTINOS_DE_ARCA.HOMOLOGACION.wsfe,
      DESTINOS_DE_ARCA.PRODUCCION.wsfe,
    ]);
  });

  it("las credenciales se piden para el par exacto", async () => {
    const pedidas: unknown[][] = [];
    const credenciales = {
      obtener: (...argumentos: unknown[]) => {
        pedidas.push(argumentos);
        return Promise.resolve(null);
      },
    } as unknown as DependenciasDeArca["credenciales"];
    const proveedor = crearProveedorDeEmisionArca({
      credenciales,
      tickets: new AlmacenDeTicketsEnMemoria(null),
      verificacion: new VerificacionEnMemoria(),
      transporte: new TransporteFalso().transporte,
      reloj: { ahora: () => AHORA },
      esperar: () => Promise.resolve(),
    });
    await proveedor
      .para(EMPRESA, EMISOR, "PRODUCCION")
      .ultimoAutorizado(PUNTO_DE_VENTA, "FACTURA_B");
    expect(pedidas).toEqual([[EMPRESA, EMISOR, "PRODUCCION"]]);
  });
});

// ---------------------------------------------------------------------------------------------------------------

describe("de punta a punta con el transporte REAL contra un servidor de loopback", () => {
  /** El transporte real, con las direcciones de ARCA reescritas a un servidor local y un tiempo límite corto. */
  const haciaLoopback = (url: string, limiteEnMs?: number): DependenciasDeArca["transporte"] => {
    const real = crearTransporteHttp();
    return (pedido) =>
      real({ ...pedido, url, ...(limiteEnMs === undefined ? {} : { limiteEnMs }) });
  };
  const armarConServidor = (transporte: DependenciasDeArca["transporte"]) =>
    crearEmisionArca(
      {
        credenciales: new CredencialesEnMemoria(CREDENCIAL_FALSA),
        tickets: new AlmacenDeTicketsEnMemoria(ticketVigente),
        verificacion: new VerificacionEnMemoria(),
        transporte,
        reloj: { ahora: () => AHORA },
        esperar: () => Promise.resolve(),
      },
      EMPRESA,
      EMISOR,
      "HOMOLOGACION",
    );

  it("autoriza contra un «ARCA» local que sirve la respuesta grabada", async () => {
    const servidor = await servidorFalso((_p, r) => r.end(grabacion(1, "032", "respuesta")));
    try {
      const r = await armarConServidor(haciaLoopback(servidor.url)).autorizar(
        solicitudDeLaGrabacion(),
      );
      expect(r).toMatchObject({ tipo: "AUTORIZADO", codigo: "86410995000689" });
      expect(servidor.pedidos).toHaveLength(1);
      expect(servidor.pedidos[0]?.cuerpo).toBe(conSecretos(grabacion(1, "031", "pedido")));
    } finally {
      await servidor.cerrar();
    }
  });

  it("un «ARCA» que no responde: INCIERTO dentro del tiempo límite, y un solo pedido", async () => {
    const servidor = await servidorFalso(() => undefined);
    try {
      const inicio = Date.now();
      const r = await armarConServidor(haciaLoopback(servidor.url, 250)).autorizar(
        solicitudDeLaGrabacion(),
      );
      expect(r).toEqual({ tipo: "INCIERTO", motivo: "sin respuesta completa: TIEMPO_AGOTADO" });
      expect(Date.now() - inicio).toBeLessThan(2_000);
      expect(servidor.pedidos).toHaveLength(1);
    } finally {
      await servidor.cerrar();
    }
  });

  it("un «ARCA» que corta la respuesta a la mitad: INCIERTO, aunque ya hubiera mandado el CAE", async () => {
    const completa = grabacion(1, "032", "respuesta");
    const servidor = await servidorFalso((_p, r) => {
      r.writeHead(200, { "Content-Length": String(Buffer.byteLength(completa)) });
      r.write(completa.slice(0, completa.indexOf("</CAE>") + 3));
      setTimeout(() => r.destroy(), 20);
    });
    try {
      const r = await armarConServidor(haciaLoopback(servidor.url)).autorizar(
        solicitudDeLaGrabacion(),
      );
      expect(r.tipo).toBe("INCIERTO");
      expect(servidor.pedidos).toHaveLength(1);
    } finally {
      await servidor.cerrar();
    }
  });

  it("un «ARCA» que manda un cuerpo cortado pero con el HTTP completo: INCIERTO", async () => {
    const completa = grabacion(1, "032", "respuesta");
    const servidor = await servidorFalso((_p, r) =>
      r.end(completa.slice(0, completa.indexOf("</CAE>") + 3)),
    );
    try {
      const r = await armarConServidor(haciaLoopback(servidor.url)).autorizar(
        solicitudDeLaGrabacion(),
      );
      expect(r).toEqual({ tipo: "INCIERTO", motivo: "la respuesta de ARCA no se pudo leer" });
    } finally {
      await servidor.cerrar();
    }
  });

  it("un «ARCA» al que no se llega (conexión rechazada): NO_ENVIADO", async () => {
    const { puertoCerrado } = await import("../../../test/utilidades/arca-servidor");
    const puerto = await puertoCerrado();
    const r = await armarConServidor(haciaLoopback(`http://127.0.0.1:${puerto}/`)).autorizar(
      solicitudDeLaGrabacion(),
    );
    expect(r).toEqual({ tipo: "NO_ENVIADO", motivo: "no salió: ECONNREFUSED" });
  });
});
