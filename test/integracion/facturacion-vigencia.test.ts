import { randomUUID } from "node:crypto";
import pg from "pg";
import { afterAll, beforeAll, describe, expect, inject, it, vi } from "vitest";
import { comprobanteId, type ComprobanteId } from "../../src/modulos/fiscal/publico";
import { EmisionFalsa } from "../utilidades/emision-falsa";
import { renglon } from "../utilidades/facturacion";
import { crearBaseAparte } from "./entorno";
import {
  RelojDePrueba,
  casosDeFacturacion,
  crearEntornoDeFacturacion,
  crearEscenarioDeCasos,
  facturaManual,
  notaManual,
} from "./facturacion-casos-apoyo";
import { crearEntornoDeConsultas } from "./facturacion-consultas-apoyo";

/**
 * E1-T2: `vigenciaDeComprobantes` (D-F-1) contra una base real, con las notas emitidas por el caso de uso real y ARCA falsa. Cubre cada motivo,
 * DD-2 (una nota total que todavía no se autorizó NO deja la factura no vigente: si ARCA la rechazara, la factura original valdría y se habría
 * emitido una segunda), el lote (orden, tope de 100, una sola lectura) y el aislamiento entre empresas (un id ajeno no figura).
 */

const base = inject("baseDePruebas");
vi.setConfig({ testTimeout: 120_000 });

describe.skipIf(base === null)("facturación E1-T2: la vigencia de los comprobantes", () => {
  let propia: Awaited<ReturnType<typeof crearBaseAparte>>;
  let dueno: pg.Client;
  let entorno: ReturnType<typeof crearEntornoDeFacturacion>;
  let consultasEntorno: ReturnType<typeof crearEntornoDeConsultas>;

  beforeAll(async () => {
    if (base === null) return;
    propia = await crearBaseAparte(base);
    entorno = crearEntornoDeFacturacion(propia.base, 8);
    consultasEntorno = crearEntornoDeConsultas(propia.base);
    dueno = new pg.Client({ connectionString: propia.base.dueno });
    await dueno.connect();
  });
  afterAll(async () => {
    await dueno.end();
    await entorno.cerrar();
    await consultasEntorno.transacciones.cerrar();
    await propia.destruir();
  });

  const exito = <T>(r: { ok: true; valor: T } | { ok: false; error: unknown }): T => {
    if (!r.ok) throw new Error(`tenía que ser un éxito: ${JSON.stringify(r.error)}`);
    return r.valor;
  };

  async function preparar() {
    const e = await crearEscenarioDeCasos(dueno, propia.base);
    const reloj = new RelojDePrueba(new Date());
    const falsa = new EmisionFalsa();
    const casos = casosDeFacturacion(
      entorno,
      { HOMOLOGACION: falsa, PRODUCCION: new EmisionFalsa() },
      reloj,
    );
    const como = () => e.como(reloj.ahora());
    const consultas = consultasEntorno.consultas();
    const validar = (id: ComprobanteId) =>
      casos.validarComprobante(e.sistema(reloj.ahora()), { comprobanteId: id });
    const factura = async (): Promise<ComprobanteId> =>
      exito(await casos.emitirComprobanteManual(como(), facturaManual(e))).comprobanteId;
    const facturaAutorizada = async (): Promise<ComprobanteId> => {
      const id = await factura();
      exito(await validar(id));
      return id;
    };
    const nota = async (id: ComprobanteId, total: string): Promise<ComprobanteId> =>
      exito(
        await casos.emitirNotaDeCredito(
          como(),
          notaManual(id, { renglones: [renglon(total, "1", "21")] }),
        ),
      ).comprobanteId;
    const vigencia = async (...ids: ComprobanteId[]) =>
      exito(await consultas.vigenciaDeComprobantes(como(), { comprobanteIds: ids }));
    return {
      e,
      falsa,
      casos,
      como,
      consultas,
      validar,
      factura,
      facturaAutorizada,
      nota,
      vigencia,
      reloj,
    };
  }

  it("una factura recién emitida, en validación, o autorizada sin notas, vigente", async () => {
    const p = await preparar();
    const pendiente = await p.factura();
    const autorizada = await p.facturaAutorizada();
    expect(await p.vigencia(pendiente, autorizada)).toEqual([
      { comprobanteId: pendiente, vigente: true, motivoNoVigente: null },
      { comprobanteId: autorizada, vigente: true, motivoNoVigente: null },
    ]);
  });

  it("acreditada por completo con una nota AUTORIZADA: no vigente (ACREDITADO_TOTAL)", async () => {
    const p = await preparar();
    const factura = await p.facturaAutorizada();
    exito(await p.validar(await p.nota(factura, "121.00")));
    expect(await p.vigencia(factura)).toEqual([
      { comprobanteId: factura, vigente: false, motivoNoVigente: "ACREDITADO_TOTAL" },
    ]);
  });

  it("varias notas parciales autorizadas que suman el total la dejan no vigente; con una de menos, vigente", async () => {
    const p = await preparar();
    const factura = await p.facturaAutorizada();
    exito(await p.validar(await p.nota(factura, "60.50")));
    expect(await p.vigencia(factura)).toEqual([
      { comprobanteId: factura, vigente: true, motivoNoVigente: null },
    ]);
    exito(await p.validar(await p.nota(factura, "60.50")));
    expect(await p.vigencia(factura)).toEqual([
      { comprobanteId: factura, vigente: false, motivoNoVigente: "ACREDITADO_TOTAL" },
    ]);
  });

  it("una nota parcial autorizada no la deja no vigente", async () => {
    const p = await preparar();
    const factura = await p.facturaAutorizada();
    exito(await p.validar(await p.nota(factura, "120.99")));
    expect((await p.vigencia(factura))[0]).toMatchObject({ vigente: true });
  });

  it("DD-2: una nota total pendiente o incierta NO la deja no vigente, y si ARCA la rechaza nunca dejó de valer", async () => {
    const p = await preparar();
    const factura = await p.facturaAutorizada();
    const pendiente = await p.nota(factura, "121.00");
    expect((await p.vigencia(factura))[0]).toMatchObject({ vigente: true });
    // El detalle (D-15) sí la cuenta como acreditada: son dos preguntas distintas y las dos tablas conviven.
    expect(
      exito(await p.consultas.verComprobante(p.como(), { comprobanteId: factura })),
    ).toMatchObject({ acreditacion: "TOTAL" });
    p.falsa.programar("INCIERTO");
    await p.validar(pendiente);
    expect((await p.vigencia(factura))[0]).toMatchObject({ vigente: true });
    p.falsa.programar("RECHAZA");
    const otra = await p.nota(factura, "121.00");
    await p.validar(otra);
    expect((await p.vigencia(factura))[0]).toMatchObject({ vigente: true });
  });

  it("una factura rechazada por ARCA es RECHAZADO y una descartada, DESCARTADO", async () => {
    const p = await preparar();
    const rechazada = await p.factura();
    p.falsa.programar("RECHAZA");
    await p.validar(rechazada);
    const descartada = await p.factura();
    exito(
      await p.casos.descartarComprobante(p.como(), {
        comprobanteId: descartada,
        motivo: "se cargó dos veces",
        versionEsperada: 1,
      }),
    );
    expect(await p.vigencia(rechazada, descartada)).toEqual([
      { comprobanteId: rechazada, vigente: false, motivoNoVigente: "RECHAZADO" },
      { comprobanteId: descartada, vigente: false, motivoNoVigente: "DESCARTADO" },
    ]);
  });

  it("conserva el orden de la entrada y lee todo el lote con dos consultas, sin una por comprobante", async () => {
    const p = await preparar();
    const ids: ComprobanteId[] = [];
    for (let i = 0; i < 12; i++) ids.push(await p.factura());
    const invertido = [...ids].reverse();
    const antes = consultasEntorno.consultasFiscalesHechas();
    const salida = await p.vigencia(...invertido);
    expect(salida.map((s) => s.comprobanteId)).toEqual(invertido);
    expect(consultasEntorno.consultasFiscalesHechas() - antes).toBe(2);
  });

  it("acepta 100 ids y rechaza 101 sin leer nada", async () => {
    const p = await preparar();
    const ajenos = Array.from({ length: 101 }, () => comprobanteId(randomUUID()));
    const antes = consultasEntorno.consultasFiscalesHechas();
    expect(await p.vigencia(...ajenos.slice(0, 100))).toEqual([]);
    expect(await p.consultas.vigenciaDeComprobantes(p.como(), { comprobanteIds: ajenos })).toEqual({
      ok: false,
      error: "DEMASIADOS_IDS",
    });
    // Los 100 ids (que no existen) piden UNA lectura y ninguna de notas; los 101 se rechazan sin leer.
    expect(consultasEntorno.consultasFiscalesHechas() - antes).toBe(1);
  });

  it("un id repetido se rechaza", async () => {
    const p = await preparar();
    const id = await p.factura();
    expect(
      await p.consultas.vigenciaDeComprobantes(p.como(), { comprobanteIds: [id, id] }),
    ).toEqual({
      ok: false,
      error: "IDS_REPETIDOS",
    });
  });

  it("aislamiento: un comprobante de otra empresa y uno inexistente no figuran, ni con notas que lo acrediten", async () => {
    const a = await preparar();
    const b = await preparar();
    const deA = await a.facturaAutorizada();
    exito(await a.validar(await a.nota(deA, "121.00")));
    const deB = await b.facturaAutorizada();
    const inexistente = comprobanteId(randomUUID());
    expect(await b.vigencia(deA, inexistente, deB)).toEqual([
      { comprobanteId: deB, vigente: true, motivoNoVigente: null },
    ]);
    expect(await a.vigencia(deB)).toEqual([]);
  });

  it("una nota de crédito en sí es vigente aunque cubra el total de su factura", async () => {
    const p = await preparar();
    const factura = await p.facturaAutorizada();
    const nota = await p.nota(factura, "121.00");
    exito(await p.validar(nota));
    expect(await p.vigencia(nota)).toEqual([
      { comprobanteId: nota, vigente: true, motivoNoVigente: null },
    ]);
  });
});
