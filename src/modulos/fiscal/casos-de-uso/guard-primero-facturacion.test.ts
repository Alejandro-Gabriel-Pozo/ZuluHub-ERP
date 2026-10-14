import { describe, expect, it } from "vitest";
import { clavesDe } from "../../../capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion } from "../../../capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../../capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { EmisionFalsa } from "../../../../test/utilidades/emision-falsa";
import { consumidorFinal, renglon } from "../../../../test/utilidades/facturacion";
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import { comprobanteId, puntoDeVentaId } from "../dominio/identificadores";
import * as publico from "../publico";
import {
  crearCasosDeUsoDeFacturacion,
  type CasosDeUsoDeFacturacion,
} from "./casos-de-uso-de-facturacion";
import type { ContextoDeSistema } from "./contrato";
import type { TxDeFacturacion } from "./contrato-de-facturacion";
import { DECLARACIONES_DE_FACTURACION } from "./declaraciones-de-facturacion";

/**
 * P7 para la facturación (spec H7 facturación §D, «Permisos»): ningún caso de uso con acción se salta el guard.
 * Corren contra una transacción VIGILADA: solo `autorizacion` responde y cualquier otro acceso corta. Además: la
 * matriz de §C con su efecto (en solo lectura no se emite a mano ni una nota de débito; sí la nota de crédito,
 * descartar, reintentar y resincronizar) y los dos trabajos de sistema sin guard ni persona.
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};
const contextoDeSistema: ContextoDeSistema = { ...contexto, personaId: null, marcaDeEntrada: null };

const CLAVE = "0b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60";
const PV = puntoDeVentaId("pv-1");
const ID = comprobanteId(CLAVE);

class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeFacturacion; accesos: string[] }>;

function vigilar(actor: DatosDelActor): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as TxDeFacturacion, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const CON_FACTURACION: ReglasDeEmpresa = {
  catalogo: {
    ...CATALOGO_DE_MODULOS,
    facturacion: { ...CATALOGO_DE_MODULOS.facturacion, estado: "disponible" },
  },
  permisos: PERMISOS_DE_EMPRESA,
};

const casosCon = (
  vigilada: Vigilada,
  reglas: ReglasDeEmpresa = CON_FACTURACION,
): CasosDeUsoDeFacturacion => {
  const transacciones: Transacciones<TxDeFacturacion> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  const falsa = new EmisionFalsa();
  return crearCasosDeUsoDeFacturacion({
    transacciones,
    reglas,
    emision: { para: () => falsa },
    reloj: { ahora: () => new Date(0) },
  });
};

const actor = (rol: RolDeEmpresa | null, soloLectura = false): DatosDelActor => ({
  rol,
  modulosActivados: ["facturacion"],
  modulosHabilitados: soloLectura ? [] : ["facturacion"],
});

type ConAccion = {
  [
    K in keyof typeof DECLARACIONES_DE_FACTURACION
  ]: (typeof DECLARACIONES_DE_FACTURACION)[K] extends {
    accion: ClaveAccion;
  }
    ? K
    : never;
}[keyof typeof DECLARACIONES_DE_FACTURACION];

const nota = {
  clave: CLAVE,
  comprobanteAsociadoId: comprobanteId("aaaaaaaa-8f7d-4c1b-9a2e-1d2c3b4a5f60"),
  puntoDeVentaId: null,
  concepto: "PRODUCTOS",
  servicio: null,
  modoDePrecio: "IVA_INCLUIDO",
  renglones: [renglon("121.00", "1", "21")],
  motivo: "Devolución",
} as const;

/** Cómo se llama a cada caso de uso con acción. Uno nuevo con acción obliga a sumar su fila. */
const LLAMADAS: Record<ConAccion, (casos: CasosDeUsoDeFacturacion) => Promise<unknown>> = {
  emitirComprobanteManual: (c) =>
    c.emitirComprobanteManual(contexto, {
      clave: CLAVE,
      puntoDeVentaId: PV,
      concepto: "PRODUCTOS",
      servicio: null,
      modoDePrecio: "IVA_INCLUIDO",
      receptor: consumidorFinal,
      renglones: [renglon("121.00", "1", "21")],
    }),
  emitirNotaDeCredito: (c) => c.emitirNotaDeCredito(contexto, nota),
  emitirNotaDeDebito: (c) => c.emitirNotaDeDebito(contexto, nota),
  descartarComprobante: (c) =>
    c.descartarComprobante(contexto, { comprobanteId: ID, motivo: "error", versionEsperada: 1 }),
  reintentarComprobante: (c) => c.reintentarComprobante(contexto, { comprobanteId: ID }),
  resincronizarSerie: (c) =>
    c.resincronizarSerie(contexto, {
      puntoDeVentaId: PV,
      tipo: "FACTURA_B",
      ambiente: "HOMOLOGACION",
      ultimoVistoEnArca: 7n,
      motivo: "otro sistema usó el punto de venta",
    }),
  cambiarAmbienteDePuntoDeVenta: (c) =>
    c.cambiarAmbienteDePuntoDeVenta(contexto, {
      puntoDeVentaId: PV,
      ambiente: "PRODUCCION",
      versionEsperada: 1,
    }),
};

const NOMBRES = clavesDe(LLAMADAS);

/** La matriz de §C: quién puede cada caso. */
const ROLES_ESPERADOS: Record<ConAccion, readonly RolDeEmpresa[]> = {
  emitirComprobanteManual: ROLES_DE_EMPRESA,
  emitirNotaDeCredito: ROLES_DE_EMPRESA,
  emitirNotaDeDebito: ROLES_DE_EMPRESA,
  descartarComprobante: ROLES_DE_EMPRESA,
  reintentarComprobante: ROLES_DE_EMPRESA,
  resincronizarSerie: ["GERENTE"],
  cambiarAmbienteDePuntoDeVenta: ["GERENTE"],
};

/** En solo lectura (baja de plan): no se crea nada nuevo; lo que cierra lo existente, sí (§C). */
const EN_SOLO_LECTURA: Record<ConAccion, boolean> = {
  emitirComprobanteManual: false,
  emitirNotaDeCredito: true,
  emitirNotaDeDebito: false,
  descartarComprobante: true,
  reintentarComprobante: true,
  resincronizarSerie: true,
  cambiarAmbienteDePuntoDeVenta: false,
};

const pasoElGuard = async (llamada: Promise<unknown>): Promise<boolean> => {
  try {
    await llamada;
    return false;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
};

describe("P7: el guard va primero en cada caso de uso de facturación", () => {
  it("hay siete casos con acción y dos trabajos de sistema", () => {
    expect([...NOMBRES].sort()).toEqual(
      Object.keys(DECLARACIONES_DE_FACTURACION)
        .filter((n) => "accion" in DECLARACIONES_DE_FACTURACION[n as ConAccion])
        .sort(),
    );
    expect(NOMBRES).toHaveLength(7);
    expect(DECLARACIONES_DE_FACTURACION.validarComprobante).toHaveProperty("sinGuard");
    expect(DECLARACIONES_DE_FACTURACION.reconciliarComprobantes).toHaveProperty("sinGuard");
  });

  it("cada caso exige la acción de §C (la NC, notas_de_credito.emitir; la factura y la ND, emitir_manual)", () => {
    expect(
      Object.fromEntries(NOMBRES.map((n) => [n, DECLARACIONES_DE_FACTURACION[n].accion])),
    ).toEqual({
      emitirComprobanteManual: "comprobantes.emitir_manual",
      emitirNotaDeCredito: "notas_de_credito.emitir",
      emitirNotaDeDebito: "comprobantes.emitir_manual",
      descartarComprobante: "comprobantes.descartar",
      reintentarComprobante: "comprobantes.reintentar",
      resincronizarSerie: "series.resincronizar",
      cambiarAmbienteDePuntoDeVenta: "puntos_de_venta.cambiar_ambiente",
    });
  });

  it.each(NOMBRES)("%s: sin rol da SIN_PERMISO sin leer ni escribir nada más", async (nombre) => {
    const vigilada = vigilar(actor(null));
    expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES.flatMap((nombre) => ROLES_DE_EMPRESA.map((rol) => ({ nombre, rol }))))(
    "$nombre con $rol: pasa el guard solo si la matriz lo dice, y recién ahí se toca lo demás",
    async ({ nombre, rol }) => {
      const vigilada = vigilar(actor(rol));
      const puede = ROLES_ESPERADOS[nombre].includes(rol);
      if (puede) {
        expect(await pasoElGuard(LLAMADAS[nombre](casosCon(vigilada)))).toBe(true);
        expect(vigilada.accesos[0]).toBe("autorizacion");
      } else {
        expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({
          ok: false,
          error: "SIN_PERMISO",
        });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
      }
    },
  );

  it.each(NOMBRES)("%s con el catálogo REAL da MODULO_EN_DESARROLLO", async (nombre) => {
    const vigilada = vigilar(actor("GERENTE"));
    expect(await LLAMADAS[nombre](casosCon(vigilada, REGLAS_DE_EMPRESA))).toEqual({
      ok: false,
      error: "MODULO_EN_DESARROLLO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES)(
    "%s en solo lectura: solo pasa lo que cierra lo existente (§C)",
    async (nombre) => {
      const vigilada = vigilar(actor("GERENTE", true));
      const llamada = LLAMADAS[nombre](casosCon(vigilada));
      if (EN_SOLO_LECTURA[nombre]) {
        expect(await pasoElGuard(llamada)).toBe(true);
      } else {
        expect(await llamada).toEqual({ ok: false, error: "MODULO_EN_SOLO_LECTURA" });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
      }
    },
  );

  it.each(NOMBRES)("%s exige SU acción: sin ella nadie pasa", async (nombre) => {
    const accion = DECLARACIONES_DE_FACTURACION[nombre].accion;
    const sinLaAccion = Object.fromEntries(
      clavesDe(PERMISOS_DE_EMPRESA).map((a) => [a, a === accion ? [] : ROLES_DE_EMPRESA]),
    ) as unknown as ReglasDeEmpresa["permisos"];
    const vigilada = vigilar(actor("GERENTE"));
    expect(
      await LLAMADAS[nombre](casosCon(vigilada, { ...CON_FACTURACION, permisos: sinLaAccion })),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });
});

describe("emitir a mano exige una persona y una clave con forma de uuid", () => {
  it("un contexto de sistema no emite: RangeError sin abrir la transacción", async () => {
    const vigilada = vigilar(actor("GERENTE"));
    await expect(
      casosCon(vigilada).emitirComprobanteManual(contextoDeSistema, {
        clave: CLAVE,
        puntoDeVentaId: PV,
        concepto: "PRODUCTOS",
        servicio: null,
        modoDePrecio: "IVA_INCLUIDO",
        receptor: consumidorFinal,
        renglones: [renglon("121.00", "1", "21")],
      }),
    ).rejects.toThrow(RangeError);
    expect(vigilada.accesos).toEqual([]);
  });

  it("una clave que no es un uuid da CLAVE_INVALIDA después del guard y sin leer nada", async () => {
    const vigilada = vigilar(actor("OPERADOR"));
    expect(
      await casosCon(vigilada).emitirNotaDeCredito(contexto, { ...nota, clave: "no-es-uuid" }),
    ).toEqual({ ok: false, error: "CLAVE_INVALIDA" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });
});

describe("los trabajos de sistema no pasan por el guard y no admiten persona", () => {
  it("validarComprobante con persona lanza RangeError sin tocar nada", async () => {
    const vigilada = vigilar(actor("GERENTE"));
    await expect(
      casosCon(vigilada).validarComprobante(contexto as ContextoDeSistema, { comprobanteId: ID }),
    ).rejects.toThrow(RangeError);
    expect(vigilada.accesos).toEqual([]);
  });

  it("reconciliarComprobantes con persona, o con un límite que no es entero positivo, lanza RangeError", async () => {
    const vigilada = vigilar(actor("GERENTE"));
    await expect(
      casosCon(vigilada).reconciliarComprobantes(contexto as ContextoDeSistema),
    ).rejects.toThrow(RangeError);
    for (const limite of [0, -1, 1.5]) {
      await expect(
        casosCon(vigilada).reconciliarComprobantes(contextoDeSistema, { limite }),
      ).rejects.toThrow(RangeError);
    }
    expect(vigilada.accesos).toEqual([]);
  });

  it("validarComprobante de sistema nunca pide la autorización del actor: primero lee el comprobante", async () => {
    const vigilada = vigilar(actor(null));
    expect(
      await pasoElGuard(
        casosCon(vigilada).validarComprobante(contextoDeSistema, { comprobanteId: ID }),
      ),
    ).toBe(true);
    expect(vigilada.accesos).toEqual(["comprobantes"]);
  });

  it("reconciliarComprobantes de sistema tampoco: primero mira si la empresa opera", async () => {
    const vigilada = vigilar(actor(null));
    expect(await pasoElGuard(casosCon(vigilada).reconciliarComprobantes(contextoDeSistema))).toBe(
      true,
    );
    expect(vigilada.accesos).toEqual(["empresas"]);
  });

  it("publico.ts exporta los manejadores de los dos trabajos y ningún cuerpo sin guard", () => {
    expect(typeof publico.crearManejadorDeValidarComprobante).toBe("function");
    expect(typeof publico.crearManejadorDeReconciliar).toBe("function");
    expect(publico.TRABAJO_VALIDAR_COMPROBANTE).toBe("fiscal.validar_comprobante");
    expect(publico.TRABAJO_RECONCILIAR).toBe("fiscal.reconciliar");
    expect(Object.keys(publico).filter((nombre) => /EnTx$/.test(nombre))).toEqual([]);
  });
});
