import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../test/utilidades/marcas";
import { qrDeFacturaComoSvg } from "../adaptadores/qr/qr-de-factura";
import type { ContextoOperativo } from "../contexto/contexto";
import type { ModeloImpreso } from "../modulos/fiscal/publico";
import { empresaId, personaId } from "../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeFacturacionWeb } from "./facturacion-web";
import { verModeloDeImpresion } from "./modelo-de-impresion-web";

/**
 * La lectura del modelo de impresión que recibe la ruta de impresión: qué sale en la respuesta y cómo se traduce cada error. El
 * permiso, el aislamiento por empresa y el alcance de sucursal son de la consulta (se prueban con la base real en
 * `test/integracion/fiscal-modelo-de-impresion-web.test.ts`); acá la consulta es un falso para ver lo que la composición agrega:
 * validar el pedido, dibujar el QR y no dejar salir ningún error crudo.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date("2026-11-04T12:00:00.000Z"),
};
const ID = "11111111-1111-4111-8111-111111111111";
/** La URL del QR de la factura B del golden de fiscal (la que arma `urlDelQr`; `qr-de-arca.test.ts` la verifica). */
const URL_DEL_QR = readFileSync(
  "src/modulos/fiscal/dominio/golden/qr-factura-b.golden.txt",
  "utf8",
).trim();

/** Un modelo con la forma que arma el dominio (acá a mano: la composición no importa el dominio de fiscal). */
const modelo = (): ModeloImpreso => ({
  versionDeRepresentacion: 2,
  marca: { nombreDeFantasia: "La Panadería de Zulu", logoUrl: null, colorPrincipal: null },
  fiscal: {
    rotulo: "FACTURA",
    letra: "B",
    codigoDelTipo: "006",
    numero: "00001-00000011",
    fecha: "2026-10-13" as ModeloImpreso["fiscal"]["fecha"],
    cae: "70417054367476",
    caeVence: "2026-10-23" as ModeloImpreso["fiscal"]["caeVence"],
    emisor: {
      cuit: "20-11111111-2",
      razonSocial: "Zulu SA",
      condicionIva: "RESPONSABLE_INSCRIPTO",
      domicilioFiscal: "Av. Corrientes 1234, Rosario",
      domicilioDelPuntoDeVenta: "Av. Corrientes 1234, Rosario",
      iibbNumero: null,
      iibbCondicion: null,
      inicioDeActividades: "2019-03-01" as ModeloImpreso["fiscal"]["emisor"]["inicioDeActividades"],
    },
  },
  receptor: {
    nombre: null,
    documento: { tipo: "SIN_IDENTIFICAR" },
    condicionIva: "CONSUMIDOR_FINAL",
    domicilio: null,
  },
  renglones: [],
  totales: { letra: "B", total: "1210.00", ivaContenido: [] },
  asociado: null,
  qr: { url: URL_DEL_QR },
  leyendas: [],
});

type Pedido = Readonly<{ comprobanteId: string }>;

function con(responder: (pedido: Pedido) => Promise<Resultado<unknown, unknown>>) {
  const pedidos: Pedido[] = [];
  const registrados: string[] = [];
  const d: DependenciasDeFacturacionWeb = {
    casosDeUso: () => {
      throw new Error("el modelo de impresión es una lectura: no corre casos de uso");
    },
    consultas: () =>
      ({
        modeloDeImpresion: (_contexto: ContextoOperativo, pedido: Pedido) => {
          pedidos.push(pedido);
          return responder(pedido);
        },
      }) as unknown as ReturnType<DependenciasDeFacturacionWeb["consultas"]>,
    respuesta: { registrar: (x) => registrados.push(x), azar: () => new Uint8Array([1, 2, 3, 4]) },
  };
  return { d, pedidos, registrados };
}

describe("verModeloDeImpresion: lo que sale", () => {
  it("el modelo tal cual lo armó el dominio y el QR dibujado desde SU url, y nada más", async () => {
    const m = modelo();
    const { d, pedidos } = con(() => Promise.resolve(ok(m)));
    const r = await verModeloDeImpresion(d, contexto, { comprobanteId: ID });
    expect(r).toEqual({ ok: true, dato: { modelo: m, qrSvg: qrDeFacturaComoSvg(m.qr.url) } });
    expect(Object.keys(r.ok ? r.dato : {}).sort()).toEqual(["modelo", "qrSvg"]);
    expect(pedidos).toEqual([{ comprobanteId: ID }]);
  });

  it("el QR es solo dibujo: ni la URL ni sus pedazos salen en `qrSvg`", async () => {
    const m = modelo();
    const r = await verModeloDeImpresion(con(() => Promise.resolve(ok(m))).d, contexto, {
      comprobanteId: ID,
    });
    const svg = r.ok ? r.dato.qrSvg : "";
    expect(svg.startsWith("<svg ")).toBe(true);
    expect(svg).not.toContain(m.qr.url);
    expect(svg).not.toMatch(/<script|<text|<image|href=/i);
  });

  it("es una lectura que se repite: la misma respuesta cada vez", async () => {
    const m = modelo();
    const { d } = con(() => Promise.resolve(ok(m)));
    const primera = await verModeloDeImpresion(d, contexto, { comprobanteId: ID });
    const segunda = await verModeloDeImpresion(d, contexto, { comprobanteId: ID });
    expect(segunda).toEqual(primera);
  });
});

describe("verModeloDeImpresion: el pedido", () => {
  it.each([
    ["sin pedido", undefined],
    ["nulo", null],
    ["un texto", ID],
    ["sin id", {}],
    ["un id que no es un identificador", { comprobanteId: "no-es-un-id" }],
    ["un id que no es texto", { comprobanteId: 7 }],
  ])("%s: FISCAL_DATOS_INVALIDOS y no se consulta nada", async (_caso, crudo) => {
    const { d, pedidos } = con(() => Promise.resolve(ok(modelo())));
    const r = await verModeloDeImpresion(d, contexto, crudo);
    expect(r).toMatchObject({ ok: false, error: { codigo: "FISCAL_DATOS_INVALIDOS" } });
    expect(pedidos).toEqual([]);
  });

  it("la empresa y la versión de representación del pedido se descartan: la consulta recibe solo el id", async () => {
    const { d, pedidos } = con(() => Promise.resolve(ok(modelo())));
    await verModeloDeImpresion(d, contexto, {
      comprobanteId: ID,
      empresaId: "OTRA-EMPRESA",
      versionDeRepresentacion: 1,
    });
    expect(pedidos).toEqual([{ comprobanteId: ID }]);
  });
});

describe("verModeloDeImpresion: los errores salen por el camino común", () => {
  it("un comprobante que no está, o no es de la empresa, es FISCAL_COMPROBANTE_NO_ENCONTRADO", async () => {
    const { d } = con(() => Promise.resolve(err("COMPROBANTE_NO_ENCONTRADO")));
    expect(await verModeloDeImpresion(d, contexto, { comprobanteId: ID })).toMatchObject({
      ok: false,
      error: { codigo: "FISCAL_COMPROBANTE_NO_ENCONTRADO" },
    });
  });

  it("el motivo del guard pasa tal cual (sin permiso, módulo sin activar)", async () => {
    for (const motivo of ["SIN_PERMISO", "MODULO_NO_ACTIVO"]) {
      const { d } = con(() => Promise.resolve(err(motivo)));
      expect(await verModeloDeImpresion(d, contexto, { comprobanteId: ID })).toMatchObject({
        ok: false,
        error: { codigo: motivo },
      });
    }
  });

  it.each(["COMPROBANTE_NO_AUTORIZADO", "VERSION_DE_REPRESENTACION_DESCONOCIDA", "CAE_INVALIDO"])(
    "%s: error inesperado con referencia, sin el código ni texto nuevo, y el detalle solo al registro",
    async (error) => {
      const { d, registrados } = con(() => Promise.resolve(err(error)));
      const r = await verModeloDeImpresion(d, contexto, { comprobanteId: ID });
      expect(r).toMatchObject({
        ok: false,
        error: { codigo: "ERROR_INTERNO", referencia: expect.stringMatching(/^PD-/) as string },
      });
      expect(JSON.stringify(r)).not.toContain(error);
      expect(registrados).toHaveLength(1);
      expect(registrados[0]).toContain(error);
    },
  );

  it("un error de persistencia no sale: error inesperado con referencia", async () => {
    const { d, registrados } = con(() =>
      Promise.resolve(err({ tipo: "RESTRICCION", restriccion: "comprobante_cae_ck" })),
    );
    const r = await verModeloDeImpresion(d, contexto, { comprobanteId: ID });
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("comprobante_cae_ck");
    expect(registrados).toHaveLength(1);
  });

  it("una excepción de la consulta (la marca sin cablear, la base caída) sale sin su mensaje y con referencia", async () => {
    const { d, registrados } = con(() =>
      Promise.reject(new Error("la marca para imprimir: SECRETO")),
    );
    const r = await verModeloDeImpresion(d, contexto, { comprobanteId: ID });
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("SECRETO");
    expect(registrados).toHaveLength(1);
  });
});

describe("verModeloDeImpresion: falla cerrado si el QR no se puede dibujar", () => {
  it("una url que no entra en un QR no deja salir el modelo a medias: error inesperado con referencia", async () => {
    const m = modelo();
    const sinLugar: ModeloImpreso = { ...m, qr: { url: `https://qr.test/?p=${"A".repeat(5000)}` } };
    const { d, registrados } = con(() => Promise.resolve(ok(sinLugar)));
    const r = await verModeloDeImpresion(d, contexto, { comprobanteId: ID });
    expect(r).toMatchObject({ ok: false, error: { codigo: "ERROR_INTERNO" } });
    expect(JSON.stringify(r)).not.toContain("qr.test");
    expect(registrados).toHaveLength(1);
  });
});
