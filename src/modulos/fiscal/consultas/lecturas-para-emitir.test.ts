import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { CATALOGO_DE_MODULOS } from "../../../capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { AlcanceDeSucursales } from "../../../capacidades/permisos/alcance";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { Cuit } from "../../../primitivas/identificacion-fiscal/cuit";
import {
  empresaId,
  personaId,
  sucursalId,
  type EmpresaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import type { Transacciones } from "../../../puertos/transacciones";
import type {
  PuntoDeVentaGuardado,
  RepositorioDeEmisores,
  VersionDeDatosFiscales,
} from "../persistencia/repositorios";
import { domicilioId, emisorId, puntoDeVentaId, versionId } from "../publico";
import { crearConsultasDeFacturacion } from "./consultas";
import type { TxDeConsultasDeFacturacion } from "./contrato";

/**
 * Las dos lecturas de la pantalla de Emitir (D-86) sin base de datos: qué piden (siempre con la empresa del contexto), qué devuelven
 * y que no dejan salir nada más. Que el guard va primero, en `guard-primero.test.ts`; que la regla de «discrimina IVA» coincide con la de
 * la letra, en `test/propiedades/discrimina-iva-y-letra.test.ts`; contra una base real y los roles reales, en
 * `test/integracion/fiscal-lecturas-para-emitir.test.ts`.
 */

// Los tipos salen de la persistencia: las consultas (y sus pruebas) no importan el dominio (regla `consultas-sin-dominio`).
type Emisor = NonNullable<Awaited<ReturnType<RepositorioDeEmisores["obtener"]>>>;
type DatosFiscalesConfirmados = Extract<
  VersionDeDatosFiscales,
  { estado: "CONFIRMADA" }
>["confirmada"];

const AHORA = new Date("2026-11-03T12:00:00.000Z");
const DIA = 86_400_000;
const EMPRESA = empresaId("e-1");
const OTRA_EMPRESA = empresaId("e-2");
const EMISOR = emisorId("emisor-1");
const CENTRO = sucursalId("s-centro");
const NORTE = sucursalId("s-norte");

const contexto = (empresa: EmpresaId = EMPRESA): ContextoOperativo => ({
  tipo: "OPERATIVO",
  empresaId: empresa,
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: AHORA,
});

const REGLAS: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

const emisor: Emisor = {
  id: EMISOR,
  empresaId: EMPRESA,
  esPrincipal: true,
  cuit: "20123456786" as Cuit,
  activo: true,
  version: 1,
};

const confirmada = (cambios: Partial<DatosFiscalesConfirmados> = {}): DatosFiscalesConfirmados => ({
  id: versionId("v-1"),
  empresaId: EMPRESA,
  emisorId: EMISOR,
  numero: 1,
  razonSocial: "Panadería Zulu SA",
  condicionIva: "RESPONSABLE_INSCRIPTO",
  domicilioFiscalId: domicilioId("d-1"),
  inicioActividades: "2020-03-01",
  iibbNumero: "902-123456-7",
  iibbCondicion: "LOCAL",
  vigenteDesde: new Date(AHORA.getTime() - DIA),
  confirmadaEn: new Date(AHORA.getTime() - DIA),
  confirmadaPor: personaId("p-1"),
  motivo: "alta",
  version: 1,
  ...cambios,
});

const punto = (cambios: Partial<PuntoDeVentaGuardado> = {}): PuntoDeVentaGuardado => ({
  id: puntoDeVentaId("pv-1"),
  empresaId: EMPRESA,
  emisorId: EMISOR,
  sucursalId: CENTRO,
  domicilioId: domicilioId("d-2"),
  numero: 1,
  estado: "ACTIVO",
  verificacionArca: "NO_VERIFICADO",
  version: 2,
  ambiente: "HOMOLOGACION",
  ...cambios,
});

type Datos = Partial<{
  principal: Emisor | null;
  confirmadas: DatosFiscalesConfirmados[];
  puntos: PuntoDeVentaGuardado[];
  alcance: AlcanceDeSucursales;
  abiertas: SucursalId[];
  cerradas: SucursalId[];
}>;

function consultasCon(datos: Datos = {}) {
  const opciones: Array<{ aislamiento?: string; soloLectura?: boolean }> = [];
  const lecturas: unknown[][] = [];
  const tx = {
    autorizacion: {
      delActor: () =>
        Promise.resolve({
          rol: "OPERADOR" as const,
          modulosActivados: ["facturacion"],
          modulosHabilitados: ["facturacion"],
        }),
      sucursalesDelActor: () => Promise.resolve(datos.alcance ?? ("TODAS" as const)),
    },
    emisores: {
      delPrincipal: (...args: unknown[]) => {
        lecturas.push(["emisores.delPrincipal", ...args]);
        return Promise.resolve(datos.principal === undefined ? emisor : datos.principal);
      },
    },
    datosFiscales: {
      confirmadas: (...args: unknown[]) => {
        lecturas.push(["datosFiscales.confirmadas", ...args]);
        return Promise.resolve(datos.confirmadas ?? [confirmada()]);
      },
    },
    puntosDeVenta: {
      listarDeLaSucursal: (...args: unknown[]) => {
        lecturas.push(["puntosDeVenta.listarDeLaSucursal", ...args]);
        return Promise.resolve(datos.puntos ?? []);
      },
    },
    sucursales: {
      listar: () =>
        Promise.resolve([
          ...(datos.abiertas ?? [CENTRO]).map((id) => ({
            id,
            nombre: `Sucursal ${id}`,
            activa: true,
          })),
          ...(datos.cerradas ?? []).map((id) => ({ id, nombre: `Sucursal ${id}`, activa: false })),
        ]),
    },
  } as unknown as TxDeConsultasDeFacturacion;
  const transacciones: Transacciones<TxDeConsultasDeFacturacion> = {
    ejecutar: (o, trabajo) => {
      opciones.push(o);
      return trabajo(tx);
    },
  };
  return {
    consultas: crearConsultasDeFacturacion({ transacciones, reglas: REGLAS }),
    opciones,
    lecturas,
  };
}

const valor = <T>(r: { ok: true; valor: T } | { ok: false; error: unknown }): T => {
  if (!r.ok) throw new Error(`debió salir bien: ${JSON.stringify(r.error)}`);
  return r.valor;
};

describe("discriminaIvaAlEmitir (D-86)", () => {
  it.each([
    ["RESPONSABLE_INSCRIPTO", true],
    ["MONOTRIBUTO", false],
    ["EXENTO", false],
  ] as const)("un emisor %s: discrimina IVA = %s", async (condicionIva, esperado) => {
    const { consultas } = consultasCon({ confirmadas: [confirmada({ condicionIva })] });
    expect(valor(await consultas.discriminaIvaAlEmitir(contexto()))).toEqual({
      discriminaIva: esperado,
    });
  });

  it("sale un sí o un no y nada más: ni la condición, ni el CUIT, ni el domicilio, ni Ingresos Brutos", async () => {
    const { consultas } = consultasCon();
    const salida = valor(await consultas.discriminaIvaAlEmitir(contexto()));
    expect(Object.keys(salida)).toEqual(["discriminaIva"]);
    expect(JSON.stringify(salida)).not.toMatch(
      /INSCRIPTO|20123456786|902-123456-7|Corrientes|Zulu/,
    );
  });

  it("mira lo que rige HOY, como emitir: una versión futura no cuenta y, entre las vigentes, gana la más nueva", async () => {
    const vigente = confirmada({ condicionIva: "MONOTRIBUTO", numero: 1 });
    const futura = confirmada({
      condicionIva: "RESPONSABLE_INSCRIPTO",
      numero: 2,
      vigenteDesde: new Date(AHORA.getTime() + DIA),
    });
    expect(
      valor(
        await consultasCon({ confirmadas: [vigente, futura] }).consultas.discriminaIvaAlEmitir(
          contexto(),
        ),
      ),
    ).toEqual({ discriminaIva: false });
    const nueva = confirmada({
      condicionIva: "RESPONSABLE_INSCRIPTO",
      numero: 3,
      vigenteDesde: new Date(AHORA.getTime() - 1000),
    });
    expect(
      valor(
        await consultasCon({ confirmadas: [vigente, nueva] }).consultas.discriminaIvaAlEmitir(
          contexto(),
        ),
      ),
    ).toEqual({ discriminaIva: true });
  });

  it("sin datos fiscales vigentes (ninguno, o solo futuros) es SIN_DATOS_FISCALES_VIGENTES, el mismo error que daría emitir", async () => {
    const error = { ok: false, error: "SIN_DATOS_FISCALES_VIGENTES" };
    expect(
      await consultasCon({ confirmadas: [] }).consultas.discriminaIvaAlEmitir(contexto()),
    ).toEqual(error);
    const futura = confirmada({ vigenteDesde: new Date(AHORA.getTime() + DIA) });
    expect(
      await consultasCon({ confirmadas: [futura] }).consultas.discriminaIvaAlEmitir(contexto()),
    ).toEqual(error);
  });

  it("sin emisor principal es EMISOR_NO_ENCONTRADO y no lee datos fiscales", async () => {
    const { consultas, lecturas } = consultasCon({ principal: null });
    expect(await consultas.discriminaIvaAlEmitir(contexto())).toEqual({
      ok: false,
      error: "EMISOR_NO_ENCONTRADO",
    });
    expect(lecturas.map((l) => l[0])).toEqual(["emisores.delPrincipal"]);
  });

  it("lee el emisor principal y los datos de la empresa del contexto, no de otra", async () => {
    const { consultas, lecturas } = consultasCon();
    valor(await consultas.discriminaIvaAlEmitir(contexto(OTRA_EMPRESA)));
    expect(lecturas).toEqual([
      ["emisores.delPrincipal", OTRA_EMPRESA],
      ["datosFiscales.confirmadas", OTRA_EMPRESA, EMISOR],
    ]);
  });

  it("es de solo lectura: la transacción se abre read committed y de solo lectura", async () => {
    const { consultas, opciones } = consultasCon();
    valor(await consultas.discriminaIvaAlEmitir(contexto()));
    expect(opciones).toEqual([
      expect.objectContaining({ aislamiento: "read committed", soloLectura: true }),
    ]);
  });
});

describe("listarPuntosDeVentaParaEmitir (D-86)", () => {
  const pedir = (datos: Datos, elegida: SucursalId | null = CENTRO, ctx = contexto()) =>
    consultasCon(datos).consultas.listarPuntosDeVentaParaEmitir(ctx, { sucursalElegida: elegida });

  it("devuelve solo los ACTIVOS, de menor a mayor número, cada uno con su identificador, número y ambiente", async () => {
    const r = valor(
      await pedir({
        puntos: [
          punto({ id: puntoDeVentaId("pv-12"), numero: 12, ambiente: "PRODUCCION" }),
          punto({ id: puntoDeVentaId("pv-3"), numero: 3, estado: "INACTIVO" }),
          punto({ id: puntoDeVentaId("pv-1"), numero: 1 }),
        ],
      }),
    );
    expect(r).toEqual({
      items: [
        { id: "pv-1", numero: 1, ambiente: "HOMOLOGACION" },
        { id: "pv-12", numero: 12, ambiente: "PRODUCCION" },
      ],
    });
  });

  it("no deja salir nada más del punto de venta: ni el emisor, ni el domicilio, ni la versión, ni la sucursal, ni el estado", async () => {
    const r = valor(await pedir({ puntos: [punto()] }));
    expect(Object.keys(r)).toEqual(["items"]);
    expect(Object.keys(r.items[0] ?? {}).sort()).toEqual(["ambiente", "id", "numero"]);
  });

  it("pide los puntos de venta de la empresa del contexto y de la sucursal resuelta", async () => {
    const { consultas, lecturas } = consultasCon({ puntos: [punto()] });
    valor(
      await consultas.listarPuntosDeVentaParaEmitir(contexto(OTRA_EMPRESA), {
        sucursalElegida: CENTRO,
      }),
    );
    expect(lecturas).toEqual([["puntosDeVenta.listarDeLaSucursal", OTRA_EMPRESA, CENTRO]]);
  });

  it("una sucursal sin puntos de venta activos da una lista vacía, no un error", async () => {
    expect(valor(await pedir({ puntos: [punto({ estado: "INACTIVO" })] }))).toEqual({ items: [] });
  });

  it("una sucursal CERRADA no ofrece ninguno aunque sus puntos de venta sigan activos (D-50, D-81) y no los lee", async () => {
    const { consultas, lecturas } = consultasCon({
      abiertas: [CENTRO],
      cerradas: [NORTE],
      puntos: [punto({ sucursalId: NORTE })],
    });
    expect(
      valor(await consultas.listarPuntosDeVentaParaEmitir(contexto(), { sucursalElegida: NORTE })),
    ).toEqual({ items: [] });
    expect(lecturas).toEqual([]);
  });

  it("un operador pide solo una sucursal de su alcance; fuera de él no se lee nada", async () => {
    const dentro = consultasCon({
      alcance: [CENTRO],
      abiertas: [CENTRO, NORTE],
      puntos: [punto()],
    });
    expect(
      valor(
        await dentro.consultas.listarPuntosDeVentaParaEmitir(contexto(), {
          sucursalElegida: CENTRO,
        }),
      ).items,
    ).toHaveLength(1);
    const fuera = consultasCon({ alcance: [CENTRO], abiertas: [CENTRO, NORTE], puntos: [punto()] });
    expect(
      await fuera.consultas.listarPuntosDeVentaParaEmitir(contexto(), { sucursalElegida: NORTE }),
    ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(fuera.lecturas).toEqual([]);
    const sinAsignaciones = consultasCon({ alcance: [], puntos: [punto()] });
    expect(
      await sinAsignaciones.consultas.listarPuntosDeVentaParaEmitir(contexto(), {
        sucursalElegida: CENTRO,
      }),
    ).toEqual({ ok: false, error: "SUCURSAL_FUERA_DE_ALCANCE" });
    expect(sinAsignaciones.lecturas).toEqual([]);
  });

  it("sin elegir: con una sola sucursal abierta se toma sola; con varias se pide elegir y no se lee nada", async () => {
    expect(valor(await pedir({ puntos: [punto()] }, null)).items).toHaveLength(1);
    // Una abierta y otra cerrada: la cerrada no cuenta para tomarla sola.
    expect(
      valor(await pedir({ abiertas: [CENTRO], cerradas: [NORTE], puntos: [punto()] }, null)).items,
    ).toHaveLength(1);
    const varias = consultasCon({ abiertas: [CENTRO, NORTE], puntos: [punto()] });
    expect(
      await varias.consultas.listarPuntosDeVentaParaEmitir(contexto(), { sucursalElegida: null }),
    ).toEqual({ ok: false, error: "SUCURSAL_NO_ELEGIDA" });
    expect(varias.lecturas).toEqual([]);
  });

  it("es de solo lectura: la transacción se abre read committed y de solo lectura", async () => {
    const { consultas, opciones } = consultasCon({ puntos: [punto()] });
    valor(await consultas.listarPuntosDeVentaParaEmitir(contexto(), { sucursalElegida: CENTRO }));
    expect(opciones).toEqual([
      expect.objectContaining({ aislamiento: "read committed", soloLectura: true }),
    ]);
  });
});
