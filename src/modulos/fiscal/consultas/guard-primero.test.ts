import { describe, expect, it } from "vitest";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { clavesDe } from "../../../capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion } from "../../../capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../../capacidades/permisos/empresa";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import { comprobanteId, emisorId } from "../publico";
import { crearConsultasDeFacturacion, type ConsultasDeFacturacion } from "./consultas";
import type { TxDeConsultasDeFacturacion } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";

/**
 * P7 para las consultas del facturador: ninguna se salta el guard. Corren contra una transacción VIGILADA: solo
 * `autorizacion` responde y cualquier otro acceso (un repositorio, una lectura, la marca) queda registrado y corta
 * la ejecución. Sin base de datos. (Las pruebas contra la base real, con los roles reales, están en
 * `test/integracion/facturacion-consultas.test.ts`.)
 */

const contexto: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};

/** El guard dejó pasar: la transacción vigilada corta en el primer acceso que no es la autorización. */
class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeConsultasDeFacturacion; accesos: string[] }>;

function vigilar(actor: DatosDelActor): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as TxDeConsultasDeFacturacion, {
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

const consultasCon = (
  vigilada: Vigilada,
  reglas: ReglasDeEmpresa = CON_FACTURACION,
): ConsultasDeFacturacion => {
  const transacciones: Transacciones<TxDeConsultasDeFacturacion> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearConsultasDeFacturacion({ transacciones, reglas });
};

const actor = (rol: RolDeEmpresa | null): DatosDelActor => ({
  rol,
  modulosActivados: ["facturacion"],
  modulosHabilitados: ["facturacion"],
});

type ConAccion = {
  [K in keyof typeof DECLARACIONES_DE_CONSULTAS]: (typeof DECLARACIONES_DE_CONSULTAS)[K] extends {
    accion: ClaveAccion;
  }
    ? K
    : never;
}[keyof typeof DECLARACIONES_DE_CONSULTAS];

const ID = comprobanteId("c-1");

/** Cómo se llama a cada consulta. Una nueva obliga a sumar su fila. */
const LLAMADAS: Record<ConAccion, (consultas: ConsultasDeFacturacion) => Promise<unknown>> = {
  listarComprobantes: (c) => c.listarComprobantes(contexto, { sucursalElegida: null }),
  listarPuntosDeVentaDeLaSucursal: (c) =>
    c.listarPuntosDeVentaDeLaSucursal(contexto, { sucursalElegida: sucursalId("s-1") }),
  verComprobante: (c) => c.verComprobante(contexto, { comprobanteId: ID }),
  modeloDeImpresion: (c) => c.modeloDeImpresion(contexto, { comprobanteId: ID }),
  estadoDeCertificados: (c) => c.estadoDeCertificados(contexto, { emisorId: emisorId("x-1") }),
};

const NOMBRES = clavesDe(LLAMADAS);
/**
 * Las que miran comprobantes (`comprobantes.ver`, de los tres roles y de lectura). El estado de los certificados es del
 * gerente y amplía: su guard y su matriz se prueban en `estado-de-certificados.test.ts`.
 */
const NOMBRES_DE_COMPROBANTES = NOMBRES.filter(
  (nombre) => DECLARACIONES_DE_CONSULTAS[nombre].accion === "comprobantes.ver",
);

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

describe("P7: el guard va primero en cada consulta del facturador", () => {
  it("hay cinco consultas, todas con acción: cuatro de comprobantes y la del estado de los certificados", () => {
    expect([...NOMBRES].sort()).toEqual([
      "estadoDeCertificados",
      "listarComprobantes",
      "listarPuntosDeVentaDeLaSucursal",
      "modeloDeImpresion",
      "verComprobante",
    ]);
    expect(Object.keys(DECLARACIONES_DE_CONSULTAS).sort()).toEqual([...NOMBRES].sort());
    expect(NOMBRES_DE_COMPROBANTES).toHaveLength(4);
  });

  it.each(NOMBRES_DE_COMPROBANTES)("%s exige comprobantes.ver", (nombre) => {
    expect(DECLARACIONES_DE_CONSULTAS[nombre]).toEqual({ accion: "comprobantes.ver" });
  });

  it("comprobantes.ver es de solo lectura: se puede aun con el plan dado de baja", () => {
    expect(CATALOGO_DE_MODULOS.facturacion.acciones["comprobantes.ver"]).toEqual({
      capacidad: null,
      efecto: "LECTURA",
    });
  });

  it.each(NOMBRES)("%s: sin rol da SIN_PERMISO sin leer nada más", async (nombre) => {
    const vigilada = vigilar(actor(null));
    expect(await LLAMADAS[nombre](consultasCon(vigilada))).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(
    NOMBRES_DE_COMPROBANTES.flatMap((nombre) => ROLES_DE_EMPRESA.map((rol) => ({ nombre, rol }))),
  )(
    "$nombre con $rol: los tres roles pasan el guard y recién ahí se toca lo demás",
    async ({ nombre, rol }) => {
      const vigilada = vigilar(actor(rol));
      expect(await pasoElGuard(LLAMADAS[nombre](consultasCon(vigilada)))).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacion");
    },
  );

  it.each(NOMBRES)(
    "%s con el catálogo REAL da MODULO_EN_DESARROLLO a todos: todavía no se puede usar (H7, §D)",
    async (nombre) => {
      for (const rol of ROLES_DE_EMPRESA) {
        const vigilada = vigilar(actor(rol));
        expect(await LLAMADAS[nombre](consultasCon(vigilada, REGLAS_DE_EMPRESA)), rol).toEqual({
          ok: false,
          error: "MODULO_EN_DESARROLLO",
        });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
      }
    },
  );

  it.each(NOMBRES)("%s con la facturación sin activar da MODULO_NO_ACTIVO", async (nombre) => {
    const vigilada = vigilar({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    expect(await LLAMADAS[nombre](consultasCon(vigilada))).toEqual({
      ok: false,
      error: "MODULO_NO_ACTIVO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(NOMBRES_DE_COMPROBANTES)(
    "%s con el plan dado de baja (módulo en solo lectura) sigue pasando: mirar es lectura",
    async (nombre) => {
      const vigilada = vigilar({
        rol: "OPERADOR",
        modulosActivados: ["facturacion"],
        modulosHabilitados: [],
      });
      expect(await pasoElGuard(LLAMADAS[nombre](consultasCon(vigilada)))).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacion");
    },
  );

  it.each(NOMBRES)("%s exige SU acción y no la de otro: sin ella nadie pasa", async (nombre) => {
    const accion: ClaveAccion = DECLARACIONES_DE_CONSULTAS[nombre].accion;
    const sinLaAccion = Object.fromEntries(
      clavesDe(PERMISOS_DE_EMPRESA).map((a) => [a, a === accion ? [] : ROLES_DE_EMPRESA]),
    ) as unknown as ReglasDeEmpresa["permisos"];
    const vigilada = vigilar(actor("GERENTE"));
    const reglas = { ...CON_FACTURACION, permisos: sinLaAccion };
    expect(await LLAMADAS[nombre](consultasCon(vigilada, reglas))).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it("el pedido del listado se mira DESPUÉS del guard: sin permiso no se sabe si estaba bien armado", async () => {
    const sinPermiso = vigilar(actor(null));
    expect(
      await consultasCon(sinPermiso).listarComprobantes(contexto, {
        sucursalElegida: null,
        limite: 0,
      }),
    ).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    const conPermiso = vigilar(actor("OPERADOR"));
    expect(
      await consultasCon(conPermiso).listarComprobantes(contexto, {
        sucursalElegida: null,
        limite: 0,
      }),
    ).toEqual({
      ok: false,
      error: "LIMITE_INVALIDO",
    });
    // y un pedido mal armado no llega a leer nada
    expect(conPermiso.accesos).toEqual(["autorizacion"]);
  });
});
