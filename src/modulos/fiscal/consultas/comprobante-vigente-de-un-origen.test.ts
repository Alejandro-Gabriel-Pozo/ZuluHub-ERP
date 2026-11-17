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
import type { ComprobanteParaVigencia } from "../persistencia/lecturas-de-vigencia";
import { crearConsultasDeFacturacion } from "./consultas";
import type { TxDeConsultasDeFacturacion } from "./contrato";

/** `comprobanteVigenteDeUnOrigen` sin base: qué devuelve según lo que hay con ese origen y que valida el origen antes de leer. Con la base real: `facturacion-vigencia.test.ts`. */

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
const ORIGEN = "0b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f61";
const A = comprobanteId("aaaaaaaa-0000-4000-8000-000000000001");
const B = comprobanteId("aaaaaaaa-0000-4000-8000-000000000002");
const importe = (t: string) => importeDesdeTexto(ARS, t);
const factura = (
  id: ComprobanteParaVigencia["id"],
  estado: ComprobanteParaVigencia["estado"],
  total = "100.00",
): ComprobanteParaVigencia => ({ id, tipo: "FACTURA_B", estado, total: importe(total) });
const nota = (estado: NotaParaAcreditar["estado"]): NotaParaAcreditar => ({
  tipo: "NOTA_CREDITO_B",
  estado,
  total: importe("100.00"),
});

function consultas(
  delOrigen: readonly ComprobanteParaVigencia[],
  notas: ReadonlyMap<ComprobanteParaVigencia["id"], readonly NotaParaAcreditar[]> = new Map(),
) {
  const pedidos: unknown[][] = [];
  const tx = {
    autorizacion: {
      delActor: () => Promise.resolve(actor),
      sucursalesDelActor: () => Promise.resolve("TODAS"),
    },
    lecturas: {
      paraVigenciaDelOrigen: (...args: unknown[]) => {
        pedidos.push(args);
        return Promise.resolve(delOrigen);
      },
      notasQueCitanA: () => Promise.resolve(notas),
    },
  } as unknown as TxDeConsultasDeFacturacion;
  const transacciones: Transacciones<TxDeConsultasDeFacturacion> = {
    ejecutar: (_o, trabajo) => trabajo(tx),
  };
  return { ...crearConsultasDeFacturacion({ transacciones, reglas: REGLAS }), pedidos };
}
const pedir = (
  c: ReturnType<typeof consultas>,
  origenTipo = "EJEMPLAR_DE_TICKET",
  origenId = ORIGEN,
) => c.comprobanteVigenteDeUnOrigen(contexto, { origenTipo, origenId });

describe("comprobanteVigenteDeUnOrigen", () => {
  it("sin nada con ese origen: null (nunca se facturó)", async () => {
    expect(await pedir(consultas([]))).toEqual({ ok: true, valor: null });
  });

  it.each(["PENDIENTE", "EN_VALIDACION", "INCIERTO", "CONFLICTO", "AUTORIZADO"] as const)(
    "un comprobante %s es el vigente y se devuelve con su total en texto",
    async (estado) => {
      expect(await pedir(consultas([factura(A, estado, "1234.50")]))).toEqual({
        ok: true,
        valor: { comprobanteId: A, tipo: "FACTURA_B", estado, total: "1234.50" },
      });
    },
  );

  it.each(["RECHAZADO", "DESCARTADO"] as const)("uno %s dejó de valer: null", async (estado) => {
    expect(await pedir(consultas([factura(A, estado)]))).toEqual({ ok: true, valor: null });
  });

  it("acreditado por completo con una nota AUTORIZADA: null; con una nota todavía sin autorizar: sigue vigente", async () => {
    expect(
      await pedir(consultas([factura(A, "AUTORIZADO")], new Map([[A, [nota("AUTORIZADO")]]]))),
    ).toEqual({ ok: true, valor: null });
    expect(
      await pedir(consultas([factura(A, "AUTORIZADO")], new Map([[A, [nota("EN_VALIDACION")]]]))),
    ).toMatchObject({ ok: true, valor: { comprobanteId: A } });
  });

  it("con un rechazado anterior y uno vigente devuelve el vigente", async () => {
    expect(
      await pedir(consultas([factura(A, "RECHAZADO"), factura(B, "PENDIENTE")])),
    ).toMatchObject({
      ok: true,
      valor: { comprobanteId: B },
    });
  });

  it.each([
    ["un tipo que no es de la lista", "MANUAL", ORIGEN],
    ["un tipo vacío", "", ORIGEN],
    ["un id que no es un uuid", "EJEMPLAR_DE_TICKET", "ticket-1"],
    ["un id en mayúscula", "REEMISION_DE_TICKET", ORIGEN.toUpperCase()],
  ])("%s da ORIGEN_INVALIDO sin leer nada", async (_n, tipo, id) => {
    const c = consultas([factura(A, "PENDIENTE")]);
    expect(await pedir(c, tipo, id)).toEqual({ ok: false, error: "ORIGEN_INVALIDO" });
    expect(c.pedidos).toEqual([]);
  });

  it("los dos orígenes permitidos pasan y se leen de la empresa del contexto", async () => {
    for (const tipo of ["EJEMPLAR_DE_TICKET", "REEMISION_DE_TICKET"]) {
      const c = consultas([]);
      expect(await pedir(c, tipo)).toEqual({ ok: true, valor: null });
      expect(c.pedidos).toEqual([[contexto.empresaId, tipo, ORIGEN]]);
    }
  });
});
