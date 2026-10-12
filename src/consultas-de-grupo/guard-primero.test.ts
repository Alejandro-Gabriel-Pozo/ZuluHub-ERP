import { describe, expect, it } from "vitest";
import { esClaveDe } from "../capacidades/modulos/activos";
import { exigirAccion } from "../capacidades/permisos/exigir";
import {
  CATALOGO_DE_GRUPO,
  PERMISOS_DE_GRUPO,
  REGLAS_DE_GRUPO,
  ROLES_DE_GRUPO,
  type ClaveAccionDeGrupo,
  type ReglasDeGrupo,
  type RolDeGrupo,
} from "../capacidades/permisos/grupo";
import type { ContextoDeGrupo } from "../contexto/contexto";
import { personaId, tenantId } from "../primitivas/identificadores/marca";
import type {
  CargaDeAutorizacionDeGrupo,
  DatosDelPropietario,
} from "../puertos/autorizacion-de-grupo";
import type { Transacciones } from "../puertos/transacciones";
import { crearConsultasDeGrupo, type ConsultasDeGrupo } from "./consultas";
import type { TxDeConsultasDeGrupo } from "./contrato";
import { DECLARACIONES_DE_CONSULTAS_DE_GRUPO } from "./declaraciones";

/**
 * P7 para el grupo: ninguna consulta de grupo se salta el guard. Corren contra una transacción
 * VIGILADA: solo `autorizacion` responde y cualquier otro acceso (el tenant, las empresas, el registro
 * de acceso) queda registrado y corta la ejecución. Una consulta que lee o escribe antes de autorizar,
 * o que no autoriza, se delata sola. Sin base de datos.
 */

const contexto: ContextoDeGrupo = {
  tipo: "GRUPO",
  tenantId: tenantId("t-1"),
  personaId: personaId("p-1"),
  ahora: new Date(0),
};

/** El guard dejó pasar: la transacción vigilada corta en el primer acceso que no es la autorización. */
class AccesoFueraDelGuard extends Error {}

type Vigilada = Readonly<{ tx: TxDeConsultasDeGrupo; accesos: string[] }>;

function vigilar(propietario: DatosDelPropietario): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacionDeGrupo = {
    delPropietario: () => Promise.resolve(propietario),
  };
  const tx = new Proxy({} as TxDeConsultasDeGrupo, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const consultasCon = (
  vigilada: Vigilada,
  reglas: ReglasDeGrupo = REGLAS_DE_GRUPO,
): ConsultasDeGrupo => {
  const transacciones: Transacciones<TxDeConsultasDeGrupo> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearConsultasDeGrupo({ transacciones, reglas });
};

/** Cómo se llama a cada consulta. Una consulta nueva declarada sin fila no compila. */
const LLAMADAS: Record<
  keyof typeof DECLARACIONES_DE_CONSULTAS_DE_GRUPO,
  (consultas: ConsultasDeGrupo) => Promise<unknown>
> = {
  listarEmpresasDelGrupo: (c) => c.listarEmpresasDelGrupo(contexto),
};

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

type Entrada = Readonly<{
  nombre: string;
  accion: ClaveAccionDeGrupo;
  llamar: (vigilada: Vigilada, reglas?: ReglasDeGrupo) => Promise<unknown>;
}>;

const consultas: Entrada[] = Object.entries(DECLARACIONES_DE_CONSULTAS_DE_GRUPO).flatMap(
  ([nombre, declaracion]) => {
    if (!esClaveDe(LLAMADAS, nombre)) return [];
    return [
      {
        nombre,
        accion: declaracion.accion,
        llamar: (vigilada: Vigilada, reglas?: ReglasDeGrupo) =>
          LLAMADAS[nombre](consultasCon(vigilada, reglas)),
      },
    ];
  },
);

const SIN_ROL: DatosDelPropietario = { rol: null };

describe("P7: el guard va primero en cada consulta de grupo", () => {
  it("hay consultas de grupo con acción que probar, y son todas las declaradas", () => {
    expect(consultas.map((c) => c.nombre)).toEqual(["listarEmpresasDelGrupo"]);
    expect(consultas).toHaveLength(Object.keys(DECLARACIONES_DE_CONSULTAS_DE_GRUPO).length);
  });

  it("cada consulta exige una acción que existe en el catálogo de grupo, y la lista es la esperada", () => {
    const delCatalogo = Object.values(CATALOGO_DE_GRUPO).flatMap((m) => Object.keys(m.acciones));
    for (const { accion } of consultas) expect(delCatalogo).toContain(accion);
    expect(Object.fromEntries(consultas.map((c) => [c.nombre, c.accion]))).toEqual({
      listarEmpresasDelGrupo: "grupo.ver_empresas",
    });
  });

  it.each(consultas)(
    "$nombre: sin ser propietario activo da SIN_PERMISO sin leer ni escribir nada más",
    async ({ llamar }) => {
      const vigilada = vigilar(SIN_ROL);
      expect(await llamar(vigilada)).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    },
  );

  it.each(consultas.flatMap((c) => ROLES_DE_GRUPO.map((rol) => ({ ...c, rol }))))(
    "$nombre con $rol: la matriz decide; si lo incluye pasa el guard y recién ahí toca lo demás",
    async ({ llamar, accion, rol }) => {
      const vigilada = vigilar({ rol });
      const llamada = llamar(vigilada);
      if (!(PERMISOS_DE_GRUPO[accion] as readonly RolDeGrupo[]).includes(rol)) {
        expect(await llamada).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
        return;
      }
      expect(await pasoElGuard(llamada)).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacion");
      // Lo primero que toca después del guard es el tenant: nunca el registro de acceso.
      expect(vigilada.accesos).toEqual(["autorizacion", "tenants"]);
    },
  );

  it("una matriz donde nadie puede la acción rechaza incluso al propietario, sin tocar nada más", async () => {
    const reglas: ReglasDeGrupo = {
      catalogo: CATALOGO_DE_GRUPO,
      permisos: { "grupo.ver_empresas": [] },
    };
    const vigilada = vigilar({ rol: "PROPIETARIO" });
    expect(await LLAMADAS.listarEmpresasDelGrupo(consultasCon(vigilada, reglas))).toEqual({
      ok: false,
      error: "SIN_PERMISO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it("el guard se pide en cada llamada: nada se guarda entre una consulta y la siguiente", async () => {
    // Misma transacción vigilada, dos llamadas; el propietario deja de serlo entre ambas (lo apagaron).
    let propietario: DatosDelPropietario = { rol: "PROPIETARIO" };
    const accesos: string[] = [];
    const tx = new Proxy({} as TxDeConsultasDeGrupo, {
      get(_objetivo, propiedad) {
        accesos.push(String(propiedad));
        if (propiedad === "autorizacion") {
          return { delPropietario: () => Promise.resolve(propietario) };
        }
        throw new AccesoFueraDelGuard(String(propiedad));
      },
    });
    const c = consultasCon({ tx, accesos });
    expect(await pasoElGuard(LLAMADAS.listarEmpresasDelGrupo(c))).toBe(true);
    propietario = SIN_ROL;
    expect(await LLAMADAS.listarEmpresasDelGrupo(c)).toEqual({ ok: false, error: "SIN_PERMISO" });
  });

  it("la autorización se carga una sola vez por llamada y con el contexto de la consulta", async () => {
    const llamadas: ContextoDeGrupo[] = [];
    const tx = new Proxy({} as TxDeConsultasDeGrupo, {
      get(_objetivo, propiedad) {
        if (propiedad === "autorizacion") {
          return {
            delPropietario: (c: ContextoDeGrupo) => {
              llamadas.push(c);
              return Promise.resolve(SIN_ROL);
            },
          };
        }
        throw new AccesoFueraDelGuard(String(propiedad));
      },
    });
    await LLAMADAS.listarEmpresasDelGrupo(consultasCon({ tx, accesos: [] }));
    expect(llamadas).toEqual([contexto]);
  });

  it("la consulta abre una transacción de GRUPO en read committed y que escribe (solo el registro de acceso)", async () => {
    const vistas: unknown[] = [];
    const vigilada = vigilar(SIN_ROL);
    const transacciones: Transacciones<TxDeConsultasDeGrupo> = {
      ejecutar: (opciones, trabajo) => {
        vistas.push(opciones);
        return trabajo(vigilada.tx);
      },
    };
    await crearConsultasDeGrupo({
      transacciones,
      reglas: REGLAS_DE_GRUPO,
    }).listarEmpresasDelGrupo(contexto);
    // Sin `soloLectura`: la transacción inserta el registro de acceso (D11 de H6, R3).
    expect(vistas).toEqual([{ contexto, aislamiento: "read committed" }]);
  });
});

describe("los demás motivos del guard salen tal cual", () => {
  const grupoComo = (
    estado: "disponible" | "en_desarrollo",
    obligatorio: boolean,
  ): ReglasDeGrupo => ({
    catalogo: {
      grupo: { estado, obligatorio, acciones: CATALOGO_DE_GRUPO.grupo.acciones },
    },
    permisos: PERMISOS_DE_GRUPO,
  });

  it("un módulo en desarrollo da MODULO_EN_DESARROLLO (y el rol ya no importa)", async () => {
    const vigilada = vigilar({ rol: "PROPIETARIO" });
    const reglas = grupoComo("en_desarrollo", true);
    expect(await LLAMADAS.listarEmpresasDelGrupo(consultasCon(vigilada, reglas))).toEqual({
      ok: false,
      error: "MODULO_EN_DESARROLLO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it("un módulo activable que la empresa no activó da MODULO_NO_ACTIVO: el grupo no tiene módulos activados", async () => {
    const vigilada = vigilar({ rol: "PROPIETARIO" });
    const reglas = grupoComo("disponible", false);
    expect(await LLAMADAS.listarEmpresasDelGrupo(consultasCon(vigilada, reglas))).toEqual({
      ok: false,
      error: "MODULO_NO_ACTIVO",
    });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });
});

describe("el detector (con la violación inyectada)", () => {
  /** Una consulta mal hecha: lee ANTES de pedir el permiso. */
  async function consultaQueLeeAntes(tx: TxDeConsultasDeGrupo) {
    await tx.empresas.listarDelTenant(contexto.tenantId);
    return exigirAccion(REGLAS_DE_GRUPO, "grupo.ver_empresas", () =>
      tx.autorizacion.delPropietario(contexto).then((p) => ({ ...p, modulosActivados: [] })),
    );
  }

  /** Otra mal hecha: registra el acceso sin pedir el permiso. */
  async function consultaQueNoAutoriza(tx: TxDeConsultasDeGrupo) {
    await tx.accesos.registrar({ empresaId: null });
    return { ok: true as const, valor: null };
  }

  /** Una bien hecha: pide el permiso y se detiene. */
  async function consultaBienHecha(tx: TxDeConsultasDeGrupo) {
    return exigirAccion(REGLAS_DE_GRUPO, "grupo.ver_empresas", () =>
      tx.autorizacion.delPropietario(contexto).then((p) => ({ ...p, modulosActivados: [] })),
    );
  }

  const guardVaPrimero = async (consulta: (tx: TxDeConsultasDeGrupo) => Promise<unknown>) => {
    const { tx, accesos } = vigilar(SIN_ROL);
    try {
      await consulta(tx);
    } catch (e) {
      if (!(e instanceof AccesoFueraDelGuard)) throw e;
    }
    return accesos.length === 1 && accesos[0] === "autorizacion";
  };

  it("detecta una consulta que lee antes de autorizar", async () => {
    expect(await guardVaPrimero(consultaQueLeeAntes)).toBe(false);
  });

  it("detecta una consulta que no autoriza", async () => {
    expect(await guardVaPrimero(consultaQueNoAutoriza)).toBe(false);
  });

  it("deja pasar una que autoriza primero", async () => {
    expect(await guardVaPrimero(consultaBienHecha)).toBe(true);
  });
});
