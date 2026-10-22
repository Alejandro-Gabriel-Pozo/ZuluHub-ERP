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
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import { emisorId, puntoDeVentaId } from "../dominio/identificadores";
import * as publico from "../publico";
import {
  crearCasosDeUsoDeConfiguracionFiscal,
  type CasosDeUsoDeConfiguracionFiscal,
} from "./casos-de-uso-de-configuracion";
import type { TxDeConfiguracionFiscal } from "./contrato-de-configuracion";
import { DECLARACIONES_DE_CONFIGURACION } from "./declaraciones-de-configuracion";

/**
 * P7 para la configuración fiscal del gerente (spec H7 fiscal §C, T5): ningún caso de uso se salta el guard. Corren
 * contra una transacción VIGILADA: solo `autorizacion` responde y cualquier otro acceso (un repositorio, la
 * auditoría, los estados de la empresa) queda registrado y corta la ejecución. Sin base de datos. Y la matriz: solo el
 * gerente, con el catálogo REAL (la facturación está en desarrollo y eso no frena a la configuración: las siete
 * acciones son de `administracion`).
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};
const contextoDeSistema: ContextoOperativo = { ...contexto, personaId: null, marcaDeEntrada: null };
const ID = "0b3a0c5e-8f7d-4c1b-9a2e-1d2c3b4a5f60";

/** El guard dejó pasar: la transacción vigilada corta en el primer acceso que no es la autorización. */
class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeConfiguracionFiscal; accesos: string[] }>;

function vigilar(actor: DatosDelActor): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as TxDeConfiguracionFiscal, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const casosCon = (
  vigilada: Vigilada,
  reglas: ReglasDeEmpresa = REGLAS_DE_EMPRESA,
): CasosDeUsoDeConfiguracionFiscal => {
  const transacciones: Transacciones<TxDeConfiguracionFiscal> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearCasosDeUsoDeConfiguracionFiscal({ transacciones, reglas });
};

/** Sin módulos activados ni habilitados por el plan: `administracion` es obligatoria y no los necesita. */
const actor = (rol: RolDeEmpresa | null): DatosDelActor => ({
  rol,
  modulosActivados: [],
  modulosHabilitados: [],
});

type Nombre = keyof typeof DECLARACIONES_DE_CONFIGURACION;

const emisor = emisorId("emisor-1");
const pv = puntoDeVentaId("pv-1");

/** Cómo se llama a cada caso de uso. Uno nuevo con acción obliga a sumar su fila. */
const LLAMADAS: Record<
  Nombre,
  (casos: CasosDeUsoDeConfiguracionFiscal, c?: ContextoOperativo) => Promise<unknown>
> = {
  guardarBorradorDeDatosFiscales: (casos, c = contexto) =>
    casos.guardarBorradorDeDatosFiscales(c, { emisorId: emisor, borradorId: ID, cambios: {} }),
  confirmarDatosFiscales: (casos, c = contexto) =>
    casos.confirmarDatosFiscales(c, {
      emisorId: emisor,
      borradorId: ID,
      versionEsperada: 1,
      vigenteDesde: new Date(1),
      motivo: "alta",
    }),
  crearPuntoDeVenta: (casos, c = contexto) =>
    casos.crearPuntoDeVenta(c, {
      id: ID,
      emisorId: emisor,
      sucursalId: sucursalId("s-1"),
      numero: 1,
    }),
  editarPuntoDeVenta: (casos, c = contexto) =>
    casos.editarPuntoDeVenta(c, { puntoDeVentaId: pv, versionEsperada: 1, numero: 2 }),
  activarPuntoDeVenta: (casos, c = contexto) =>
    casos.activarPuntoDeVenta(c, { puntoDeVentaId: pv }),
  desactivarPuntoDeVenta: (casos, c = contexto) =>
    casos.desactivarPuntoDeVenta(c, { puntoDeVentaId: pv }),
  confirmarReglaDeEmisor: (casos, c = contexto) =>
    casos.confirmarReglaDeEmisor(c, {
      versionId: ID,
      permitirEleccionManual: false,
      vigenteDesde: new Date(1),
      motivo: "cambio",
    }),
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

describe("P7: el guard va primero en cada caso de uso de configuración fiscal", () => {
  it("hay siete casos de uso, cada uno con SU acción, todos de administracion y solo del gerente", () => {
    expect(NOMBRES).toHaveLength(7);
    expect(DECLARACIONES_DE_CONFIGURACION).toEqual({
      guardarBorradorDeDatosFiscales: { accion: "datos_fiscales.editar" },
      confirmarDatosFiscales: { accion: "datos_fiscales.confirmar" },
      crearPuntoDeVenta: { accion: "puntos_de_venta.crear" },
      editarPuntoDeVenta: { accion: "puntos_de_venta.editar" },
      activarPuntoDeVenta: { accion: "puntos_de_venta.activar" },
      desactivarPuntoDeVenta: { accion: "puntos_de_venta.desactivar" },
      confirmarReglaDeEmisor: { accion: "emisores.confirmar_regla" },
    });
    for (const nombre of NOMBRES) {
      const accion = DECLARACIONES_DE_CONFIGURACION[nombre].accion;
      expect(Object.keys(CATALOGO_DE_MODULOS.administracion.acciones), nombre).toContain(accion);
      expect(PERMISOS_DE_EMPRESA[accion], nombre).toEqual(["GERENTE"]);
    }
  });

  it.each(NOMBRES)("%s: sin rol da SIN_PERMISO sin leer ni escribir nada más", async (nombre) => {
    const vigilada = vigilar(actor(null));
    expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES.flatMap((nombre) => ROLES_DE_EMPRESA.map((rol) => ({ nombre, rol }))))(
    "$nombre con $rol: pasa el guard solo si es el gerente, y recién ahí se toca lo demás",
    async ({ nombre, rol }) => {
      const vigilada = vigilar(actor(rol));
      if (rol === "GERENTE") {
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

  it.each(NOMBRES)("%s exige SU acción: sin ella nadie pasa", async (nombre) => {
    const accion: ClaveAccion = DECLARACIONES_DE_CONFIGURACION[nombre].accion;
    const sinLaAccion = Object.fromEntries(
      clavesDe(PERMISOS_DE_EMPRESA).map((a) => [a, a === accion ? [] : ROLES_DE_EMPRESA]),
    ) as unknown as ReglasDeEmpresa["permisos"];
    const vigilada = vigilar(actor("GERENTE"));
    expect(
      await LLAMADAS[nombre](casosCon(vigilada, { ...REGLAS_DE_EMPRESA, permisos: sinLaAccion })),
    ).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES)(
    "%s con un módulo activo que no es de administracion rechaza igual a quien no es gerente",
    async (nombre) => {
      // Que la facturación esté activada y habilitada no le da nada al administrador.
      const vigilada = vigilar({
        rol: "ADMINISTRADOR",
        modulosActivados: ["facturacion"],
        modulosHabilitados: ["facturacion"],
      });
      expect(await LLAMADAS[nombre](casosCon(vigilada))).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
    },
  );
});

describe("la configuración fiscal exige una persona", () => {
  it.each(NOMBRES)(
    "%s con un contexto de sistema: RangeError sin abrir la transacción",
    async (nombre) => {
      const vigilada = vigilar(actor("GERENTE"));
      await expect(LLAMADAS[nombre](casosCon(vigilada), contextoDeSistema)).rejects.toThrow(
        RangeError,
      );
      expect(vigilada.accesos).toEqual([]);
    },
  );
});

describe("publico.ts: la puerta de la configuración fiscal", () => {
  it("ofrece los casos de uso y las declaraciones, y no exporta cuerpos sin guard", () => {
    expect(typeof publico.crearCasosDeUsoDeConfiguracionFiscal).toBe("function");
    expect(publico.DECLARACIONES_DE_CONFIGURACION_FISCAL).toBe(DECLARACIONES_DE_CONFIGURACION);
    expect(Object.keys(publico).filter((nombre) => /EnTx$/.test(nombre))).toEqual([]);
  });
});
