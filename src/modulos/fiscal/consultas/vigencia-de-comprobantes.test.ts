import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { importeDesdeTexto } from "../../../primitivas/dinero/importe";
import { ARS } from "../../../primitivas/dinero/moneda";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import type { DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { NotaParaAcreditar } from "../dominio/acreditacion";
import { comprobanteId } from "../publico";
import type { ComprobanteParaVigencia } from "../persistencia/lecturas-de-comprobantes";
import type { TxDeConsultasDeFacturacion } from "./contrato";
import { crearConsultasDeFacturacion } from "./consultas";
import { LIMITE_DE_IDS_DE_VIGENCIA } from "./vigencia-de-comprobantes";

/**
 * `vigenciaDeComprobantes` (D-F-1) sin base de datos: el contrato de entrada y salida y que NO cuenta como acreditado lo que no está
 * autorizado (DD-2). La prueba con la base real, dos empresas y las notas de verdad está en `test/integracion/facturacion-vigencia.test.ts`;
 * el guard primero, en `guard-primero.test.ts`.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};
const REGLAS: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};
const actor: DatosDelActor = {
  rol: "OPERADOR",
  modulosActivados: ["facturacion"],
  modulosHabilitados: ["facturacion"],
};

const A = comprobanteId("aaaaaaaa-0000-4000-8000-000000000001");
const B = comprobanteId("aaaaaaaa-0000-4000-8000-000000000002");
const C = comprobanteId("aaaaaaaa-0000-4000-8000-000000000003");
const importe = (t: string) => importeDesdeTexto(ARS, t);
const factura = (
  id: ComprobanteParaVigencia["id"],
  estado: ComprobanteParaVigencia["estado"],
): ComprobanteParaVigencia => ({ id, tipo: "FACTURA_B", estado, total: importe("100.00") });
const notaDe = (estado: NotaParaAcreditar["estado"], total = "100.00"): NotaParaAcreditar => ({
  tipo: "NOTA_CREDITO_B",
  estado,
  total: importe(total),
});

function consultas(datos: {
  comprobantes: readonly ComprobanteParaVigencia[];
  notas?: ReadonlyMap<ComprobanteParaVigencia["id"], readonly NotaParaAcreditar[]>;
}) {
  const lecturas = { empresas: [] as unknown[], notas: [] as unknown[], ids: [] as unknown[] };
  const tx = {
    autorizacion: {
      delActor: () => Promise.resolve(actor),
      sucursalesDelActor: () => Promise.resolve("TODAS"),
    },
    lecturas: {
      paraVigencia: (empresa: unknown, ids: unknown) => {
        lecturas.empresas.push(empresa);
        lecturas.ids.push(ids);
        return Promise.resolve(datos.comprobantes);
      },
      notasQueCitanA: (_empresa: unknown, ids: unknown) => {
        lecturas.notas.push(ids);
        return Promise.resolve(datos.notas ?? new Map());
      },
    },
  } as unknown as TxDeConsultasDeFacturacion;
  const transacciones: Transacciones<TxDeConsultasDeFacturacion> = {
    ejecutar: (_opciones, trabajo) => trabajo(tx),
  };
  return { ...crearConsultasDeFacturacion({ transacciones, reglas: REGLAS }), lecturas };
}

describe("vigenciaDeComprobantes", () => {
  it("dice por qué dejó de valer cada uno y conserva el orden de la entrada", async () => {
    const c = consultas({
      comprobantes: [factura(A, "AUTORIZADO"), factura(B, "RECHAZADO"), factura(C, "DESCARTADO")],
      notas: new Map([[A, [notaDe("AUTORIZADO")]]]),
    });
    const r = await c.vigenciaDeComprobantes(contexto, { comprobanteIds: [C, A, B] });
    expect(r).toEqual({
      ok: true,
      valor: [
        { comprobanteId: C, vigente: false, motivoNoVigente: "DESCARTADO" },
        { comprobanteId: A, vigente: false, motivoNoVigente: "ACREDITADO_TOTAL" },
        { comprobanteId: B, vigente: false, motivoNoVigente: "RECHAZADO" },
      ],
    });
  });

  it("un autorizado sin notas, o con una nota total todavía sin autorizar, o con una parcial, sigue vigente", async () => {
    const c = consultas({
      comprobantes: [
        factura(A, "AUTORIZADO"),
        factura(B, "AUTORIZADO"),
        factura(C, "EN_VALIDACION"),
      ],
      notas: new Map([
        [A, [notaDe("EN_VALIDACION")]],
        [B, [notaDe("AUTORIZADO", "99.99")]],
      ]),
    });
    const r = await c.vigenciaDeComprobantes(contexto, { comprobanteIds: [A, B, C] });
    expect(r).toEqual({
      ok: true,
      valor: [
        { comprobanteId: A, vigente: true, motivoNoVigente: null },
        { comprobanteId: B, vigente: true, motivoNoVigente: null },
        { comprobanteId: C, vigente: true, motivoNoVigente: null },
      ],
    });
  });

  it("un id inexistente o de otra empresa no figura en la salida", async () => {
    const c = consultas({ comprobantes: [factura(A, "AUTORIZADO")] });
    const r = await c.vigenciaDeComprobantes(contexto, { comprobanteIds: [B, A] });
    expect(r).toEqual({
      ok: true,
      valor: [{ comprobanteId: A, vigente: true, motivoNoVigente: null }],
    });
  });

  it("lee de la empresa del contexto, en una sola vez, y pide las notas solo de lo que encontró", async () => {
    const c = consultas({ comprobantes: [factura(A, "AUTORIZADO")] });
    await c.vigenciaDeComprobantes(contexto, { comprobanteIds: [B, A] });
    expect(c.lecturas.empresas).toEqual([contexto.empresaId]);
    expect(c.lecturas.ids).toEqual([[B, A]]);
    expect(c.lecturas.notas).toEqual([[A]]);
  });

  it("acepta exactamente el límite y rechaza uno más sin leer nada", async () => {
    const ids = Array.from({ length: LIMITE_DE_IDS_DE_VIGENCIA + 1 }, (_, i) =>
      comprobanteId(`aaaaaaaa-0000-4000-8000-${String(i).padStart(12, "0")}`),
    );
    const c = consultas({ comprobantes: [] });
    expect(
      await c.vigenciaDeComprobantes(contexto, {
        comprobanteIds: ids.slice(0, LIMITE_DE_IDS_DE_VIGENCIA),
      }),
    ).toEqual({ ok: true, valor: [] });
    const demasiados = consultas({ comprobantes: [] });
    expect(await demasiados.vigenciaDeComprobantes(contexto, { comprobanteIds: ids })).toEqual({
      ok: false,
      error: "DEMASIADOS_IDS",
    });
    expect(demasiados.lecturas.ids).toEqual([]);
  });

  it("un id repetido se rechaza sin leer nada", async () => {
    const c = consultas({ comprobantes: [] });
    expect(await c.vigenciaDeComprobantes(contexto, { comprobanteIds: [A, A] })).toEqual({
      ok: false,
      error: "IDS_REPETIDOS",
    });
    expect(c.lecturas.ids).toEqual([]);
  });

  it("sin ids devuelve vacío", async () => {
    const c = consultas({ comprobantes: [] });
    expect(await c.vigenciaDeComprobantes(contexto, { comprobanteIds: [] })).toEqual({
      ok: true,
      valor: [],
    });
  });
});
