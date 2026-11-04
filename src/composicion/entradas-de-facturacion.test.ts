import { describe, expect, it } from "vitest";
import { cantidadATexto } from "../primitivas/cantidad/cantidad";
import { precioUnitarioATexto } from "../primitivas/dinero/precio-unitario";
import { LIMITES_DE_COMPROBANTE } from "../modulos/fiscal/publico";
import {
  entradaDeCambiarAmbiente,
  entradaDeDescartar,
  entradaDeFactura,
  entradaDeListar,
  entradaDeNotaDeCredito,
  entradaDeNotaDeDebito,
  entradaDeReintentar,
  entradaDeResincronizar,
  entradaDeVerComprobante,
} from "./entradas-de-facturacion";

/**
 * La frontera de las acciones de facturación: del JSON del navegador a la entrada de cada caso de uso. Lo que más
 * importa: (1) solo se toma lo declarado (una empresa, un emisor o un ambiente que mande el navegador se descarta),
 * (2) el dinero y las cantidades son TEXTO (un `number` no entra), (3) un dato inválido sale con su campo y nunca con
 * el valor recibido.
 */

const ID = "11111111-1111-4111-8111-111111111111";
const OTRO = "22222222-2222-4222-8222-222222222222";

const renglon = (cambios: Record<string, unknown> = {}) => ({
  descripcion: "Medialunas",
  cantidad: "2",
  precioUnitario: "60.5",
  descuento: null,
  alicuota: "21",
  ...cambios,
});

const factura = (cambios: Record<string, unknown> = {}) => ({
  clave: ID,
  puntoDeVentaId: OTRO,
  concepto: "PRODUCTOS",
  servicio: null,
  modoDePrecio: "IVA_INCLUIDO",
  receptor: {
    nombre: null,
    documento: { tipo: "SIN_IDENTIFICAR" },
    condicionIva: "CONSUMIDOR_FINAL",
    domicilio: null,
  },
  renglones: [renglon()],
  ...cambios,
});

const mal = (resultado: { ok: boolean }) => resultado as { ok: false; error: unknown };

describe("entradaDeFactura", () => {
  it("convierte el pedido: texto a cantidad y precio, ids con marca, y nada más", () => {
    const r = entradaDeFactura(factura());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.clave).toBe(ID);
    expect(r.valor.puntoDeVentaId).toBe(OTRO);
    expect(r.valor.receptor.condicionIva).toBe("CONSUMIDOR_FINAL");
    const [primero] = r.valor.renglones;
    expect(primero && cantidadATexto(primero.cantidad)).toBe("2.0000");
    expect(primero && precioUnitarioATexto(primero.precioUnitario)).toBe("60.500000");
    expect(primero?.alicuota).toBe("21");
  });

  it("descarta lo que no declara: ni la empresa, ni el emisor, ni el ambiente, ni quién actúa se toman del navegador", () => {
    const r = entradaDeFactura(
      factura({
        empresaId: OTRO,
        emisorId: OTRO,
        ambiente: "PRODUCCION",
        personaId: OTRO,
        creadoPor: OTRO,
      }),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.valor).sort()).toEqual([
      "clave",
      "concepto",
      "modoDePrecio",
      "puntoDeVentaId",
      "receptor",
      "renglones",
      "servicio",
    ]);
  });

  it("convierte el período de un servicio con fechas civiles", () => {
    const r = entradaDeFactura(
      factura({
        concepto: "SERVICIOS",
        servicio: { desde: "2026-10-01", hasta: "2026-10-31", vencimientoDePago: "2026-11-10" },
      }),
    );
    expect(r.ok && r.valor.servicio).toEqual({
      desde: "2026-10-01",
      hasta: "2026-10-31",
      vencimientoDePago: "2026-11-10",
    });
  });

  it.each([
    ["una clave que no es uuid", factura({ clave: "no-es-uuid" }), "clave"],
    ["un punto de venta sin forma de id", factura({ puntoDeVentaId: "1" }), "puntoDeVentaId"],
    ["un concepto desconocido", factura({ concepto: "OTRO" }), "concepto"],
    [
      "una cantidad que es un número (el dinero y las cantidades son texto)",
      factura({ renglones: [renglon(), renglon({ cantidad: 1.5 })] }),
      "renglon2.cantidad",
    ],
    [
      "un precio que es un número",
      factura({ renglones: [renglon({ precioUnitario: 60.5 })] }),
      "renglon1.precioUnitario",
    ],
    [
      "una cantidad con notación científica",
      factura({ renglones: [renglon({ cantidad: "1e3" })] }),
      "renglon1.cantidad",
    ],
    [
      "una cantidad negativa",
      factura({ renglones: [renglon({ cantidad: "-1" })] }),
      "renglon1.cantidad",
    ],
    [
      "un precio con más decimales que la escala",
      factura({ renglones: [renglon({ precioUnitario: "1.1234567" })] }),
      "renglon1.precioUnitario",
    ],
    [
      "un descuento que no es decimal",
      factura({ renglones: [renglon({ descuento: "diez" })] }),
      "renglon1.descuento",
    ],
    [
      "una alícuota que no existe",
      factura({ renglones: [renglon({ alicuota: "99" })] }),
      "renglon1.alicuota",
    ],
    [
      "una condición de IVA desconocida",
      factura({
        receptor: {
          nombre: null,
          documento: { tipo: "SIN_IDENTIFICAR" },
          condicionIva: "OTRA",
          domicilio: null,
        },
      }),
      "receptor.condicionIva",
    ],
    [
      "un documento sin número",
      factura({
        receptor: {
          nombre: "A",
          documento: { tipo: "CUIT" },
          condicionIva: "RESPONSABLE_INSCRIPTO",
          domicilio: null,
        },
      }),
      "receptor.documento",
    ],
    [
      "una fecha de servicio que no existe",
      factura({
        concepto: "SERVICIOS",
        servicio: { desde: "2026-02-30", hasta: "2026-03-01", vencimientoDePago: "2026-03-10" },
      }),
      "servicio.desde",
    ],
    ["un pedido que no es un objeto", "texto", undefined],
    ["un pedido vacío", null, undefined],
  ])("rechaza %s, con su campo y sin el valor", (_caso, entrada, campo) => {
    const r = mal(entradaDeFactura(entrada));
    expect(r.ok).toBe(false);
    expect(r.error).toEqual(
      campo === undefined
        ? { codigo: "FISCAL_DATOS_INVALIDOS" }
        : { codigo: "FISCAL_DATOS_INVALIDOS", campo },
    );
    expect(JSON.stringify(r.error)).not.toContain("1.1234567");
    expect(JSON.stringify(r.error)).not.toContain("diez");
  });

  it("acota la cantidad de renglones que lee (el límite fino es del dominio)", () => {
    const r = mal(
      entradaDeFactura(factura({ renglones: Array.from({ length: 501 }, () => renglon()) })),
    );
    expect(r.error).toEqual({ codigo: "FISCAL_DATOS_INVALIDOS", campo: "renglones" });
  });
});

describe("entradaDeNotaDeCredito y entradaDeNotaDeDebito", () => {
  const nota = (cambios: Record<string, unknown> = {}) => ({
    clave: ID,
    comprobanteAsociadoId: OTRO,
    puntoDeVentaId: null,
    concepto: "PRODUCTOS",
    servicio: null,
    modoDePrecio: "IVA_INCLUIDO",
    renglones: [renglon()],
    motivo: "Devolución",
    ...cambios,
  });

  it("toma el comprobante asociado y el motivo; el punto de venta es opcional", () => {
    const r = entradaDeNotaDeCredito(nota());
    expect(r.ok && r.valor.comprobanteAsociadoId).toBe(OTRO);
    expect(r.ok && r.valor.puntoDeVentaId).toBeNull();
    expect(r.ok && r.valor.motivo).toBe("Devolución");
    const conPuntoDeVenta = entradaDeNotaDeCredito(nota({ puntoDeVentaId: ID }));
    expect(conPuntoDeVenta.ok && conPuntoDeVenta.valor.puntoDeVentaId).toBe(ID);
  });

  it("rechaza un asociado sin forma de id", () => {
    for (const leer of [entradaDeNotaDeCredito, entradaDeNotaDeDebito]) {
      expect(mal(leer(nota({ comprobanteAsociadoId: "x" }))).error).toEqual({
        codigo: "FISCAL_DATOS_INVALIDOS",
        campo: "comprobanteAsociadoId",
      });
    }
  });

  describe("el motivo (D-17)", () => {
    const motivoInvalido = { codigo: "FISCAL_MOTIVO_INVALIDO", campo: "motivo" };
    const limite = LIMITES_DE_COMPROBANTE.motivo;

    it("la nota de crédito exige un motivo: ausente, vacío o de solo espacios se rechazan con el código del motivo", () => {
      for (const motivo of [null, "", " ", "   ", "\n\t"]) {
        expect(mal(entradaDeNotaDeCredito(nota({ motivo }))).error, JSON.stringify(motivo)).toEqual(
          motivoInvalido,
        );
      }
      // un pedido sin la clave `motivo` tampoco: no es un motivo
      const sinMotivo = nota({ motivo: undefined });
      expect(mal(entradaDeNotaDeCredito(sinMotivo)).error).toEqual({
        codigo: "FISCAL_DATOS_INVALIDOS",
        campo: "motivo",
      });
    });

    it("el largo es el del dominio, contado sin los espacios de los bordes: el límite pasa y uno más no", () => {
      const justo = entradaDeNotaDeCredito(nota({ motivo: "m".repeat(limite) }));
      expect(justo.ok && justo.valor.motivo).toBe("m".repeat(limite));
      expect(mal(entradaDeNotaDeCredito(nota({ motivo: "m".repeat(limite + 1) }))).error).toEqual(
        motivoInvalido,
      );
      // 1000 y más ya no es otro error: es el mismo código del motivo
      expect(mal(entradaDeNotaDeCredito(nota({ motivo: "m".repeat(5000) }))).error).toEqual(
        motivoInvalido,
      );
      // con espacios alrededor, lo que cuenta es el texto recortado (el dominio lo recorta igual)
      expect(entradaDeNotaDeCredito(nota({ motivo: ` ${"m".repeat(limite)} ` })).ok).toBe(true);
    });

    it("la nota de débito sigue con motivo opcional, pero con el mismo largo máximo", () => {
      for (const motivo of [null, "", "   "]) {
        expect(entradaDeNotaDeDebito(nota({ motivo })).ok, JSON.stringify(motivo)).toBe(true);
      }
      expect(entradaDeNotaDeDebito(nota({ motivo: "m".repeat(limite) })).ok).toBe(true);
      expect(mal(entradaDeNotaDeDebito(nota({ motivo: "m".repeat(limite + 1) }))).error).toEqual(
        motivoInvalido,
      );
    });
  });
});

describe("descartar, reintentar y ver", () => {
  it("descartar: la versión llega como número o como texto de dígitos", () => {
    for (const version of [3, "3"]) {
      const r = entradaDeDescartar({
        comprobanteId: ID,
        motivo: "Error de carga",
        versionEsperada: version,
      });
      expect(r.ok && r.valor.versionEsperada).toBe(3);
    }
  });

  it.each(["3.5", "1e3", "-1", "", true, null, 2 ** 40])("descartar rechaza la versión %s", (v) => {
    const r = mal(entradaDeDescartar({ comprobanteId: ID, motivo: "x", versionEsperada: v }));
    expect(r.error).toEqual({ codigo: "FISCAL_DATOS_INVALIDOS", campo: "versionEsperada" });
  });

  it("reintentar y ver solo toman el id del comprobante", () => {
    expect(entradaDeReintentar({ comprobanteId: ID, empresaId: OTRO })).toEqual({
      ok: true,
      valor: { comprobanteId: ID },
    });
    expect(entradaDeVerComprobante({ comprobanteId: ID, empresaId: OTRO })).toEqual({
      ok: true,
      valor: { comprobanteId: ID },
    });
    expect(mal(entradaDeVerComprobante({ comprobanteId: "x" })).error).toEqual({
      codigo: "FISCAL_DATOS_INVALIDOS",
      campo: "comprobanteId",
    });
  });
});

describe("resincronizar y cambiar de ambiente", () => {
  const resincronizar = (cambios: Record<string, unknown> = {}) => ({
    puntoDeVentaId: ID,
    tipo: "FACTURA_B",
    ambiente: "HOMOLOGACION",
    ultimoVistoEnArca: "13",
    motivo: "Otro sistema usó el punto de venta",
    ...cambios,
  });

  it("el último número que vio la persona llega como texto y se vuelve bigint", () => {
    const r = entradaDeResincronizar(resincronizar());
    expect(r.ok && r.valor.ultimoVistoEnArca).toBe(13n);
    const cero = entradaDeResincronizar(resincronizar({ ultimoVistoEnArca: "0" }));
    expect(cero.ok && cero.valor.ultimoVistoEnArca).toBe(0n);
  });

  it.each(["007", "1e3", "-1", "1.5", "123456789", 13, null])(
    "rechaza el último número %s",
    (v) => {
      expect(mal(entradaDeResincronizar(resincronizar({ ultimoVistoEnArca: v }))).error).toEqual({
        codigo: "FISCAL_DATOS_INVALIDOS",
        campo: "ultimoVistoEnArca",
      });
    },
  );

  it("el tipo y el ambiente son de una lista cerrada", () => {
    expect(mal(entradaDeResincronizar(resincronizar({ tipo: "FACTURA_Z" }))).error).toEqual({
      codigo: "FISCAL_DATOS_INVALIDOS",
      campo: "tipo",
    });
    expect(
      mal(entradaDeCambiarAmbiente({ puntoDeVentaId: ID, ambiente: "PRUEBA", versionEsperada: 1 }))
        .error,
    ).toEqual({
      codigo: "FISCAL_DATOS_INVALIDOS",
      campo: "ambiente",
    });
  });

  it("cambiar de ambiente toma el punto de venta, el ambiente y la versión", () => {
    expect(
      entradaDeCambiarAmbiente({
        puntoDeVentaId: ID,
        ambiente: "PRODUCCION",
        versionEsperada: "2",
      }),
    ).toEqual({
      ok: true,
      valor: { puntoDeVentaId: ID, ambiente: "PRODUCCION", versionEsperada: 2 },
    });
  });
});

describe("entradaDeListar", () => {
  it("sin pedido, o con uno vacío, son los valores por defecto", () => {
    expect(entradaDeListar(undefined)).toEqual({ ok: true, valor: {} });
    expect(entradaDeListar({})).toEqual({ ok: true, valor: {} });
  });

  it("toma los filtros declarados y descarta los demás", () => {
    expect(
      entradaDeListar({
        estado: "AUTORIZADO",
        tipo: "FACTURA_B",
        ambiente: "HOMOLOGACION",
        desde: "2026-10-01",
        hasta: "2026-10-31",
        texto: "panadería",
        letra: "B",
        puntoDeVenta: "1",
        origenTipo: "MANUAL",
        origenId: ID,
        limite: 20,
        despuesDe: "opaca",
        empresaId: OTRO,
      }),
    ).toEqual({
      ok: true,
      valor: {
        estado: "AUTORIZADO",
        tipo: "FACTURA_B",
        ambiente: "HOMOLOGACION",
        desde: "2026-10-01",
        hasta: "2026-10-31",
        texto: "panadería",
        letra: "B",
        puntoDeVenta: 1,
        origenTipo: "MANUAL",
        origenId: ID,
        limite: 20,
        despuesDe: "opaca",
      },
    });
  });

  it.each([
    [{ estado: "ANULADO" }, "estado"],
    [{ desde: "2026-02-30" }, "desde"],
    [{ hasta: "ayer" }, "hasta"],
    [{ letra: "D" }, "letra"],
    [{ limite: "mucho" }, "limite"],
    [{ origenTipo: "OTRO" }, "origenTipo"],
  ])("rechaza el filtro %j", (entrada, campo) => {
    expect(mal(entradaDeListar(entrada)).error).toEqual({
      codigo: "FISCAL_DATOS_INVALIDOS",
      campo,
    });
  });
});
