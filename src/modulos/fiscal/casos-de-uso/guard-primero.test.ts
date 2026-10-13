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
import { empresaId, personaId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import { puntoDeVentaId, solicitudId } from "../dominio/identificadores";
import { crearCasosDeUsoDeNumeracion, type CasosDeUsoDeNumeracion } from "./casos-de-uso";
import type { ContextoDeSistema, TxDeNumeracion } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

/**
 * P7 para la numeración: ningún caso de uso con acción se salta el guard. Corren contra una
 * transacción VIGILADA: solo `autorizacion` responde y cualquier otro acceso (un repositorio, la
 * auditoría, los estados de la empresa) queda registrado y corta la ejecución. Sin base de datos.
 * (Las pruebas contra la base real están en `test/integracion/fiscal-numeracion*.test.ts`.)
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};
const contextoDeSistema: ContextoDeSistema = { ...contexto, personaId: null, marcaDeEntrada: null };

const entrada = {
  puntoDeVentaId: puntoDeVentaId("pv-1"),
  tipo: "FACTURA_B",
  solicitud: solicitudId("sol-1"),
} as const;

/** El guard dejó pasar: la transacción vigilada corta en el primer acceso que no es la autorización. */
class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeNumeracion; accesos: string[] }>;

function vigilar(actor: DatosDelActor): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as TxDeNumeracion, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

/** El catálogo real con `facturacion` ya construida. */
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
): CasosDeUsoDeNumeracion => {
  const transacciones: Transacciones<TxDeNumeracion> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearCasosDeUsoDeNumeracion({ transacciones, reglas, emision: new EmisionFalsa() });
};

const actor = (rol: RolDeEmpresa | null): DatosDelActor => ({
  rol,
  modulosActivados: ["facturacion"],
  modulosHabilitados: ["facturacion"],
});

type ConAccion = {
  [K in keyof typeof DECLARACIONES]: (typeof DECLARACIONES)[K] extends { accion: ClaveAccion }
    ? K
    : never;
}[keyof typeof DECLARACIONES];

/** Cómo se llama a cada caso de uso con acción. Uno nuevo con acción obliga a sumar su fila. */
const LLAMADAS: Record<ConAccion, (casos: CasosDeUsoDeNumeracion) => Promise<unknown>> = {
  reservarNumeroDeComprobante: (c) => c.reservarNumeroDeComprobante(contexto, entrada),
  cerrarReservaDeNumero: (c) =>
    c.cerrarReservaDeNumero(contexto, {
      ...entrada,
      numero: 1n,
      resultado: { tipo: "INCIERTO" },
    }),
  numerarComprobante: (c) => c.numerarComprobante(contexto, entrada),
};

const NOMBRES = clavesDe(LLAMADAS);

/** Pasar el guard = tocar algo que no es la autorización (la transacción vigilada corta ahí). */
const pasoElGuard = async (llamada: Promise<unknown>): Promise<boolean> => {
  try {
    await llamada;
    return false;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
};

describe("P7: el guard va primero en cada caso de uso de numeración", () => {
  it("hay tres casos de uso con acción, y los dos de sistema no pasan por el guard", () => {
    expect([...NOMBRES].sort()).toEqual([
      "cerrarReservaDeNumero",
      "numerarComprobante",
      "reservarNumeroDeComprobante",
    ]);
    expect(Object.keys(DECLARACIONES).sort()).toEqual([
      "cerrarReservaDeNumero",
      "numerarComprobante",
      "reconciliarSerie",
      "reconciliarSeriesVencidas",
      "reservarNumeroDeComprobante",
    ]);
  });

  it.each(NOMBRES)("%s exige comprobantes.emitir", (nombre) => {
    expect(DECLARACIONES[nombre]).toEqual({ accion: "comprobantes.emitir" });
  });

  it.each(NOMBRES)("%s: sin rol da SIN_PERMISO sin leer ni escribir nada más", async (nombre) => {
    const vigilada = vigilar(actor(null));
    expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES.flatMap((nombre) => ROLES_DE_EMPRESA.map((rol) => ({ nombre, rol }))))(
    "$nombre con $rol: los tres roles pasan el guard y recién ahí se toca lo demás",
    async ({ nombre, rol }) => {
      const vigilada = vigilar(actor(rol));
      expect(await pasoElGuard(LLAMADAS[nombre](casosCon(vigilada)))).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacion");
    },
  );

  it.each(NOMBRES)(
    "%s con el catálogo REAL da MODULO_EN_DESARROLLO a todos: todavía no se puede emitir (H7, §D)",
    async (nombre) => {
      for (const rol of ROLES_DE_EMPRESA) {
        const vigilada = vigilar(actor(rol));
        expect(await LLAMADAS[nombre](casosCon(vigilada, REGLAS_DE_EMPRESA)), rol).toEqual({
          ok: false,
          error: "MODULO_EN_DESARROLLO",
        });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
      }
    },
  );

  it.each(NOMBRES)("%s con la facturación sin activar da MODULO_NO_ACTIVO", async (nombre) => {
    const vigilada = vigilar({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({
      ok: false,
      error: "MODULO_NO_ACTIVO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES)(
    "%s exige SU acción (comprobantes.emitir) y no la de otro: sin ella nadie pasa",
    async (nombre) => {
      const sinEmitir = Object.fromEntries(
        clavesDe(PERMISOS_DE_EMPRESA).map((a) => [
          a,
          a === "comprobantes.emitir" ? [] : ROLES_DE_EMPRESA,
        ]),
      ) as unknown as ReglasDeEmpresa["permisos"];
      const vigilada = vigilar(actor("GERENTE"));
      const reglas = { ...CON_FACTURACION, permisos: sinEmitir };
      expect(await LLAMADAS[nombre](casosCon(vigilada, reglas))).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    },
  );
});

describe("los trabajos de sistema (reconciliar) no pasan por el guard y no admiten persona", () => {
  it("reconciliarSerie con persona lanza RangeError sin tocar nada", async () => {
    const vigilada = vigilar(actor("GERENTE"));
    const casos = casosCon(vigilada);
    await expect(
      casos.reconciliarSerie(contexto as ContextoDeSistema, {
        puntoDeVentaId: entrada.puntoDeVentaId,
        tipo: "FACTURA_B",
      }),
    ).rejects.toThrow(RangeError);
    expect(vigilada.accesos).toEqual([]);
  });

  it("reconciliarSeriesVencidas con persona lanza RangeError sin tocar nada", async () => {
    const vigilada = vigilar(actor("GERENTE"));
    await expect(
      casosCon(vigilada).reconciliarSeriesVencidas(contexto as ContextoDeSistema),
    ).rejects.toThrow(RangeError);
    expect(vigilada.accesos).toEqual([]);
  });

  it("reconciliarSeriesVencidas rechaza un límite que no es un entero positivo", async () => {
    for (const limite of [0, -1, 1.5, Number.NaN]) {
      const vigilada = vigilar(actor(null));
      await expect(
        casosCon(vigilada).reconciliarSeriesVencidas(contextoDeSistema, { limite }),
      ).rejects.toThrow(RangeError);
      expect(vigilada.accesos).toEqual([]);
    }
  });

  it("reconciliarSerie de sistema nunca pide la autorización del actor (primero mira si la empresa opera)", async () => {
    const vigilada = vigilar(actor(null));
    const llamada = casosCon(vigilada).reconciliarSerie(contextoDeSistema, {
      puntoDeVentaId: entrada.puntoDeVentaId,
      tipo: "FACTURA_B",
    });
    expect(await pasoElGuard(llamada)).toBe(true);
    expect(vigilada.accesos).toEqual(["empresas"]);
  });

  it("reconciliarSeriesVencidas de sistema tampoco: primero mira si la empresa opera", async () => {
    const vigilada = vigilar(actor(null));
    expect(await pasoElGuard(casosCon(vigilada).reconciliarSeriesVencidas(contextoDeSistema))).toBe(
      true,
    );
    expect(vigilada.accesos).toEqual(["empresas"]);
  });
});
