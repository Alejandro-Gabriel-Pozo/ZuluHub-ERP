import { describe, expect, it } from "vitest";
import {
  consumidorFinal,
  contextoDeEmision,
  emisorInstantaneo,
  facturaArmada,
  fecha,
  receptorInscripto,
  renglon,
} from "../../../../test/utilidades/facturacion";
import {
  IDENTIDAD_DE_SERIE,
  EMISOR_2,
  EMPRESA,
  OTRA_EMPRESA,
  SOLICITUD_1,
  SOLICITUD_2,
  serieBloqueada,
  serieEnCurso,
  serieLibre,
} from "../../../../test/utilidades/fiscal";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { CODIGO_DE_TIPO_DE_COMPROBANTE, CODIGO_DE_TIPO_DE_DOCUMENTO } from "./codigos-de-arca";
import { puntoDeVentaId } from "./identificadores";
import type { ComprobanteNuevo } from "./comprobante-nuevo";
import type { DatosConsultados, ResultadoDeConsulta } from "./estados-de-comprobante";
import { importesParaArca } from "./importes-para-arca";
import { armarNotaAsociada } from "./nota-asociada";
import {
  reconciliarSerie,
  serieEsConsistente,
  transicionDeSerieValida,
  type Serie,
} from "./numeracion";
import { numeroDeDocumentoParaArca } from "./receptor";
import {
  coincideConLoRegistrado,
  reconciliarComprobante,
  type ComprobanteEnVuelo,
} from "./reconciliacion-de-comprobante";

const VENCE = new Date("2026-10-13T12:00:00Z");
const ANTES = new Date("2026-10-13T11:59:59Z");
const DESPUES = new Date("2026-10-13T12:00:01Z");
const FECHA = fecha("2026-10-13");
const CAE = "70417054367476";

const facturaB = facturaArmada(consumidorFinal, [
  renglon("1210.00", "1", "21"),
  renglon("1050.00", "1", "10.5"),
]);

const enVueloDe = (contenido: ComprobanteNuevo, numero = 11n): ComprobanteEnVuelo => ({
  solicitud: SOLICITUD_1,
  numero,
  fecha: FECHA,
  contenido,
});

/** Lo que ARCA devolvería si el número fuera nuestro, armado desde los mismos importes que se enviaron. */
function registradoDe(enVuelo: ComprobanteEnVuelo): DatosConsultados {
  const c = enVuelo.contenido;
  const i = importesParaArca(c);
  return {
    tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE[c.tipo],
    puntoDeVenta: c.emisor.puntoDeVentaNumero,
    numero: enVuelo.numero,
    fecha: enVuelo.fecha,
    tipoDeDocumento: CODIGO_DE_TIPO_DE_DOCUMENTO[c.receptor.documento.tipo],
    numeroDeDocumento: numeroDeDocumentoParaArca(c.receptor.documento),
    moneda: "PES",
    total: i.total,
    neto: i.neto,
    iva: i.iva,
    alicuotas: i.alicuotas,
    asociado:
      c.asociado === null
        ? null
        : {
            tipoDeComprobante: CODIGO_DE_TIPO_DE_COMPROBANTE[c.asociado.tipo],
            puntoDeVenta: c.asociado.puntoDeVenta,
            numero: c.asociado.numero,
            cuit: c.asociado.cuit,
            fecha: c.asociado.fecha,
          },
  };
}

const encontrado = (datos: DatosConsultados): ResultadoDeConsulta => ({
  tipo: "ENCONTRADO",
  datos,
  codigo: CAE,
  vence: fecha("2026-10-23"),
});

const enCurso = (ultimo = 10n, solicitud = SOLICITUD_1): Serie =>
  serieEnCurso(ultimo, VENCE, solicitud);

const importe = (texto: string) => importeDesdeTexto(ARS, texto);

describe("coincideConLoRegistrado", () => {
  const enVuelo = enVueloDe(facturaB);
  const bueno = registradoDe(enVuelo);

  it("coincide cuando todo es igual", () => {
    expect(coincideConLoRegistrado(enVuelo, bueno)).toBe(true);
  });

  it("no coincide si cambia cualquiera de los datos básicos", () => {
    const cambios: Record<string, Partial<DatosConsultados>> = {
      tipo: { tipoDeComprobante: 1 },
      "punto de venta": { puntoDeVenta: 2 },
      número: { numero: 12n },
      fecha: { fecha: fecha("2026-10-14") },
      "tipo de documento": { tipoDeDocumento: 80 },
      "número de documento": { numeroDeDocumento: 1n },
      moneda: { moneda: "DOL" },
      total: { total: importe("2260.01") },
      neto: { neto: importe("1950.24") },
      iva: { iva: importe("309.78") },
    };
    for (const [campo, cambio] of Object.entries(cambios)) {
      expect(coincideConLoRegistrado(enVuelo, { ...bueno, ...cambio }), campo).toBe(false);
    }
  });

  it("las alícuotas se comparan una por una, sin importar el orden", () => {
    const [a, b] = bueno.alicuotas;
    if (a === undefined || b === undefined) throw new Error("se esperaban dos alícuotas");
    expect(coincideConLoRegistrado(enVuelo, { ...bueno, alicuotas: [b, a] })).toBe(true);
    expect(coincideConLoRegistrado(enVuelo, { ...bueno, alicuotas: [a] })).toBe(false);
    expect(coincideConLoRegistrado(enVuelo, { ...bueno, alicuotas: [] })).toBe(false);
    expect(coincideConLoRegistrado(enVuelo, { ...bueno, alicuotas: [a, a] })).toBe(false);
    expect(
      coincideConLoRegistrado(enVuelo, { ...bueno, alicuotas: [a, { ...b, alicuota: "27" }] }),
    ).toBe(false);
    expect(
      coincideConLoRegistrado(enVuelo, { ...bueno, alicuotas: [a, { ...b, base: a.base }] }),
    ).toBe(false);
    expect(
      coincideConLoRegistrado(enVuelo, { ...bueno, alicuotas: [a, { ...b, iva: a.iva }] }),
    ).toBe(false);
  });

  it("en la letra C no se comparan neto, IVA ni alícuotas (el comprobante no discrimina)", () => {
    const contexto = contextoDeEmision({
      emisor: emisorInstantaneo({ condicionIva: "MONOTRIBUTO" }),
    });
    const c = enVueloDe(
      facturaArmada(consumidorFinal, [renglon("100.00", "1", null)], {}, contexto),
    );
    const registrado = registradoDe(c);
    expect(coincideConLoRegistrado(c, registrado)).toBe(true);
    expect(
      coincideConLoRegistrado(c, {
        ...registrado,
        neto: importe("1.00"),
        iva: importe("2.00"),
        alicuotas: bueno.alicuotas,
      }),
    ).toBe(true);
    expect(coincideConLoRegistrado(c, { ...registrado, total: importe("100.01") })).toBe(false);
  });

  it("el documento identificado se compara por tipo y número", () => {
    const a = enVueloDe(
      facturaArmada(receptorInscripto, [renglon("121.00", "1", "21")], {
        modoDePrecio: "IVA_INCLUIDO",
      }),
    );
    const registrado = registradoDe(a);
    expect(registrado.tipoDeDocumento).toBe(80);
    expect(registrado.numeroDeDocumento).toBe(30712345671n);
    expect(coincideConLoRegistrado(a, registrado)).toBe(true);
    expect(coincideConLoRegistrado(a, { ...registrado, numeroDeDocumento: 30712345672n })).toBe(
      false,
    );
  });

  describe("notas: también el comprobante asociado", () => {
    const autorizada = {
      empresaId: EMPRESA,
      emisorId: contextoDeEmision().emisorId,
      ambiente: "HOMOLOGACION",
      tipo: "FACTURA_B",
      estado: "AUTORIZADO",
      numero: 94n,
      fechaEmision: fecha("2026-10-01"),
      emisor: emisorInstantaneo(),
      receptor: consumidorFinal,
    } as const;
    const nota = armarNotaAsociada(
      autorizada,
      {
        clase: "NOTA_CREDITO",
        motivo: null,
        modoDePrecio: "IVA_INCLUIDO",
        concepto: "PRODUCTOS",
        servicio: null,
        renglones: [renglon("121.00", "1", "21")],
      },
      contextoDeEmision(),
    );
    if (!nota.ok) throw new Error("nota de prueba inválida");
    const e = enVueloDe(nota.valor);
    const r = registradoDe(e);

    it("coincide con el asociado igual", () => {
      expect(r.asociado).not.toBeNull();
      expect(coincideConLoRegistrado(e, r)).toBe(true);
    });

    it("no coincide si cambia cualquier dato del asociado o falta", () => {
      const a = r.asociado;
      if (a === null) throw new Error("se esperaba un asociado");
      const cambios: Record<string, DatosConsultados["asociado"]> = {
        tipo: { ...a, tipoDeComprobante: 1 },
        "punto de venta": { ...a, puntoDeVenta: 99 },
        número: { ...a, numero: 95n },
        cuit: { ...a, cuit: "20123456786" },
        fecha: { ...a, fecha: fecha("2026-10-02") },
        ninguno: null,
      };
      for (const [campo, asociado] of Object.entries(cambios)) {
        expect(coincideConLoRegistrado(e, { ...r, asociado }), campo).toBe(false);
      }
    });

    it("una factura con un asociado registrado tampoco coincide", () => {
      const f = enVueloDe(facturaB);
      const a = r.asociado;
      expect(coincideConLoRegistrado(f, { ...registradoDe(f), asociado: a })).toBe(false);
    });
  });
});

describe("reconciliarComprobante: la tabla de la spec (§B.3.7)", () => {
  const enVuelo = enVueloDe(facturaB);
  const reconciliar = (consulta: ResultadoDeConsulta, ultimo = 10n, serie: Serie = enCurso()) =>
    reconciliarComprobante(serie, enVuelo, consulta, ultimo, DESPUES);

  it("encontrado y coincide: serie libre avanzada al número, comprobante autorizado con el CAE de la consulta", () => {
    const r = reconciliar(encontrado(registradoDe(enVuelo)), 11n);
    expect(r).toEqual({
      ok: true,
      valor: {
        resolucion: "AUTORIZADO_POR_CONSULTA",
        serie: { ...serieLibre(11n), version: 3 },
        numero: 11n,
        codigo: CAE,
        vence: fecha("2026-10-23"),
      },
    });
  });

  it("encontrado y no coincide: serie bloqueada (lo usó otro) y comprobante en conflicto", () => {
    const otro = { ...registradoDe(enVuelo), total: importe("1.00") };
    const r = reconciliar(encontrado(otro), 11n);
    expect(r.ok && r.valor.resolucion).toBe("CONFLICTO");
    if (!r.ok || r.valor.resolucion !== "CONFLICTO") return;
    expect(r.valor.serie).toMatchObject({ estado: "BLOQUEADA", ultimoNumero: 10n, version: 3 });
    expect(r.valor.serie.motivoBloqueo).toContain("11");
    expect(r.valor.serie.motivoBloqueo.trim()).not.toBe("");
  });

  it("no existe y el último de ARCA es el de la serie: se libera sin avanzar y se vuelve a validar", () => {
    const r = reconciliar({ tipo: "NO_ENCONTRADO" }, 10n);
    expect(r).toEqual({
      ok: true,
      valor: { resolucion: "LIBERADO_POR_CONSULTA", serie: { ...serieLibre(10n), version: 3 } },
    });
  });

  it("no existe pero el último de ARCA es otro: desfase, serie bloqueada", () => {
    for (const ultimo of [9n, 11n, 25n]) {
      const r = reconciliar({ tipo: "NO_ENCONTRADO" }, ultimo);
      expect(r.ok && r.valor.resolucion, String(ultimo)).toBe("DESFASE");
      if (!r.ok || r.valor.resolucion !== "DESFASE") continue;
      expect(r.valor.serie).toMatchObject({ estado: "BLOQUEADA", ultimoNumero: 10n });
      expect(r.valor.serie.motivoBloqueo).toContain(String(ultimo));
    }
  });

  it("la consulta falló: nada cambia y se reintenta", () => {
    expect(reconciliar({ tipo: "CONSULTA_FALLIDA", detalle: "tiempo agotado" })).toEqual({
      ok: true,
      valor: { resolucion: "SIN_CAMBIOS" },
    });
  });

  it("la serie que produce conserva la identidad de la reservada, con su ambiente y su versión", () => {
    const produccion = { ...enCurso(), ambiente: "PRODUCCION" } as Serie;
    const deProduccion = facturaArmada(
      consumidorFinal,
      [renglon("1210.00", "1", "21")],
      {},
      contextoDeEmision({ ambiente: "PRODUCCION" }),
    );
    const enVueloDeProduccion = enVueloDe(deProduccion);
    const casos: [ResultadoDeConsulta, bigint][] = [
      [encontrado(registradoDe(enVueloDeProduccion)), 11n],
      [encontrado({ ...registradoDe(enVueloDeProduccion), numero: 12n }), 11n],
      [{ tipo: "NO_ENCONTRADO" }, 10n],
      [{ tipo: "NO_ENCONTRADO" }, 12n],
    ];
    for (const [consulta, ultimo] of casos) {
      const r = reconciliarComprobante(produccion, enVueloDeProduccion, consulta, ultimo, DESPUES);
      if (!r.ok || r.valor.resolucion === "SIN_CAMBIOS") throw new Error("se esperaba una serie");
      expect(r.valor.serie).toMatchObject({ ...IDENTIDAD_DE_SERIE, ambiente: "PRODUCCION" });
    }
  });

  it("cada serie que produce es una transición válida y consistente desde la serie en curso", () => {
    const antes = enCurso();
    const consultas: [ResultadoDeConsulta, bigint][] = [
      [encontrado(registradoDe(enVuelo)), 11n],
      [encontrado({ ...registradoDe(enVuelo), numero: 12n }), 11n],
      [{ tipo: "NO_ENCONTRADO" }, 10n],
      [{ tipo: "NO_ENCONTRADO" }, 12n],
    ];
    for (const [consulta, ultimo] of consultas) {
      const r = reconciliar(consulta, ultimo, antes);
      if (!r.ok || r.valor.resolucion === "SIN_CAMBIOS") throw new Error("se esperaba una serie");
      expect(serieEsConsistente(r.valor.serie)).toBe(true);
      expect(transicionDeSerieValida(antes, r.valor.serie)).toBe(true);
    }
  });

  it("autorizar por consulta deja la misma serie que reconciliarSerie con el último autorizado", () => {
    const antes = enCurso();
    const propia = reconciliar(encontrado(registradoDe(enVuelo)), 11n, antes);
    const vieja = reconciliarSerie(antes, 11n, DESPUES);
    expect(
      propia.ok && propia.valor.resolucion === "AUTORIZADO_POR_CONSULTA" && propia.valor.serie,
    ).toEqual(vieja.ok && vieja.valor.serie);
    const liberada = reconciliar({ tipo: "NO_ENCONTRADO" }, 10n, antes);
    const viejaLiberada = reconciliarSerie(antes, 10n, DESPUES);
    expect(
      liberada.ok && liberada.valor.resolucion === "LIBERADO_POR_CONSULTA" && liberada.valor.serie,
    ).toEqual(viejaLiberada.ok && viejaLiberada.valor.serie);
  });
});

describe("reconciliarComprobante: errores", () => {
  const enVuelo = enVueloDe(facturaB);
  const consulta = encontrado(registradoDe(enVuelo));
  const con = (serie: Serie, ahora = DESPUES, e = enVuelo) =>
    reconciliarComprobante(serie, e, consulta, 11n, ahora);

  it("la serie tiene que estar en curso", () => {
    expect(con(serieLibre(10n))).toEqual({ ok: false, error: "SERIE_NO_EN_CURSO" });
    expect(con(serieBloqueada(10n))).toEqual({ ok: false, error: "SERIE_NO_EN_CURSO" });
  });

  it("la reserva tiene que ser de este comprobante", () => {
    expect(con(enCurso(10n, SOLICITUD_2))).toEqual({ ok: false, error: "SOLICITUD_NO_VIGENTE" });
    const otra = (cambios: Record<string, unknown>) => ({ ...enCurso(), ...cambios }) as Serie;
    for (const cambio of [
      { empresaId: OTRA_EMPRESA },
      { puntoDeVentaId: puntoDeVentaId("pv-9") },
      { emisorId: EMISOR_2 },
      { ambiente: "PRODUCCION" },
      { tipo: "FACTURA_A" },
    ]) {
      expect(con(otra(cambio)), JSON.stringify(cambio)).toEqual({
        ok: false,
        error: "SOLICITUD_NO_VIGENTE",
      });
    }
  });

  it("un comprobante de homologación no reconcilia la serie de producción (ni al revés)", () => {
    const deProduccion = facturaArmada(
      consumidorFinal,
      [renglon("1210.00", "1", "21")],
      {},
      contextoDeEmision({ ambiente: "PRODUCCION" }),
    );
    const enVueloDeProduccion = enVueloDe(deProduccion);
    const registrado = encontrado(registradoDe(enVueloDeProduccion));
    expect(
      reconciliarComprobante(enCurso(), enVueloDeProduccion, registrado, 11n, DESPUES),
    ).toEqual({ ok: false, error: "SOLICITUD_NO_VIGENTE" });
    const produccion = { ...enCurso(), ambiente: "PRODUCCION" } as Serie;
    expect(
      reconciliarComprobante(produccion, enVueloDeProduccion, registrado, 11n, DESPUES).ok,
    ).toBe(true);
    expect(con(produccion)).toEqual({ ok: false, error: "SOLICITUD_NO_VIGENTE" });
  });

  it("el número del comprobante es el de la reserva", () => {
    expect(con(enCurso(), DESPUES, { ...enVuelo, numero: 12n })).toEqual({
      ok: false,
      error: "NUMERO_INVALIDO",
    });
  });

  it("solo con la reserva vencida: justo en el vencimiento ya se puede", () => {
    expect(con(enCurso(), ANTES)).toEqual({ ok: false, error: "RESERVA_NO_VENCIDA" });
    expect(con(enCurso(), VENCE).ok).toBe(true);
    expect(
      reconciliarComprobante(
        enCurso(),
        enVuelo,
        { tipo: "CONSULTA_FALLIDA", detalle: "x" },
        10n,
        ANTES,
      ),
    ).toEqual({ ok: false, error: "RESERVA_NO_VENCIDA" });
  });

  it("el orden: serie en curso, solicitud, número, vencimiento", () => {
    expect(con(serieLibre(10n), ANTES, { ...enVuelo, numero: 99n })).toEqual({
      ok: false,
      error: "SERIE_NO_EN_CURSO",
    });
    expect(con(enCurso(10n, SOLICITUD_2), ANTES, { ...enVuelo, numero: 99n })).toEqual({
      ok: false,
      error: "SOLICITUD_NO_VIGENTE",
    });
    expect(con(enCurso(), ANTES, { ...enVuelo, numero: 99n })).toEqual({
      ok: false,
      error: "NUMERO_INVALIDO",
    });
  });
});
