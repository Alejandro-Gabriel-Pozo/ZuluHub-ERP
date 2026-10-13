import { describe, expect, it } from "vitest";
import { clavesDe, esClaveDe } from "../../../capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion } from "../../../capacidades/modulos/catalogo";
import {
  PERMISOS_DE_EMPRESA,
  REGLAS_DE_EMPRESA,
  type ReglasDeEmpresa,
} from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "../../../capacidades/permisos/roles";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "../../../../test/utilidades/marcas";
import { empresaId, personaId, sucursalId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import { crearConsultasDeEmpresas, type ConsultasDeEmpresas } from "../consultas/consultas";
import type { TxDeConsultasDeEmpresas } from "../consultas/contrato";
import { DECLARACIONES_DE_CONSULTAS } from "../consultas/declaraciones";
import { crearCasosDeUsoDeEmpresas, type CasosDeUsoDeEmpresas } from "./casos-de-uso";
import type { TxDeEmpresas } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

/**
 * P7 para empresas: ningún caso de uso ni consulta se salta el guard. Corren contra una transacción
 * VIGILADA: solo `autorizacion` responde y cualquier otro acceso (un repositorio, la auditoría, los
 * estados de la empresa) queda registrado y corta la ejecución. Un caso que lee o escribe antes de
 * autorizar, o que no autoriza, se delata solo. Sin base de datos.
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

type Vigilada = Readonly<{ tx: TxDeEmpresas & TxDeConsultasDeEmpresas; accesos: string[] }>;

function vigilar(actor: DatosDelActor): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as TxDeEmpresas & TxDeConsultasDeEmpresas, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const casosCon = (vigilada: Vigilada, reglas: ReglasDeEmpresa = REGLAS_DE_EMPRESA) => {
  const transacciones: Transacciones<TxDeEmpresas> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearCasosDeUsoDeEmpresas({ transacciones, reglas });
};

const consultasCon = (vigilada: Vigilada, reglas: ReglasDeEmpresa = REGLAS_DE_EMPRESA) => {
  const transacciones: Transacciones<TxDeConsultasDeEmpresas> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearConsultasDeEmpresas({ transacciones, reglas });
};

type Declaraciones = typeof DECLARACIONES;
type ConAccion = {
  [K in keyof Declaraciones]: Declaraciones[K] extends { accion: ClaveAccion } ? K : never;
}[keyof Declaraciones];

/** Cómo se llama a cada caso de uso. Un caso de uso nuevo con acción obliga a sumar su fila. */
const LLAMADAS: Record<ConAccion, (casos: CasosDeUsoDeEmpresas) => Promise<unknown>> = {
  crearSucursal: (c) => c.crearSucursal(contexto, { nombre: "Sucursal norte" }),
  editarSucursal: (c) =>
    c.editarSucursal(contexto, {
      sucursalId: sucursalId("s-1"),
      versionEsperada: 1,
      nombre: "Sucursal sur",
    }),
  desactivarSucursal: (c) => c.desactivarSucursal(contexto, { sucursalId: sucursalId("s-1") }),
  reactivarSucursal: (c) => c.reactivarSucursal(contexto, { sucursalId: sucursalId("s-1") }),
};

/**
 * Las consultas que ya existen (T2); `planYModulos` y `permisosDelActor` las suma el tramo T5 de H6
 * y entonces suman su fila acá. Una consulta declarada y ya implementada sin fila no compila.
 */
type ConsultasPendientes = "planYModulos" | "permisosDelActor";
type DeclaracionesDeConsultas = typeof DECLARACIONES_DE_CONSULTAS;
type ConsultaConAccion = {
  [K in keyof DeclaracionesDeConsultas]: DeclaracionesDeConsultas[K] extends {
    accion: ClaveAccion;
  }
    ? K
    : never;
}[keyof DeclaracionesDeConsultas];
const LLAMADAS_DE_CONSULTAS: Record<
  Exclude<ConsultaConAccion, ConsultasPendientes>,
  (consultas: ConsultasDeEmpresas) => Promise<unknown>
> = {
  listarSucursales: (c) => c.listarSucursales(contexto, { incluirInactivas: true }),
  fichaDeSucursal: (c) => c.fichaDeSucursal(contexto, { sucursalId: sucursalId("s-1") }),
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
  accion: ClaveAccion;
  llamar: (vigilada: Vigilada, reglas?: ReglasDeEmpresa) => Promise<unknown>;
}>;

const llamadaDeCaso = (nombre: ConAccion) => (vigilada: Vigilada, reglas?: ReglasDeEmpresa) =>
  LLAMADAS[nombre](casosCon(vigilada, reglas));
const llamadaDeConsulta =
  (nombre: keyof typeof LLAMADAS_DE_CONSULTAS) => (vigilada: Vigilada, reglas?: ReglasDeEmpresa) =>
    LLAMADAS_DE_CONSULTAS[nombre](consultasCon(vigilada, reglas));

const casos: Entrada[] = Object.entries(DECLARACIONES).flatMap(([nombre, declaracion]) => {
  if (!("accion" in declaracion) || !esClaveDe(LLAMADAS, nombre)) return [];
  return [{ nombre, accion: declaracion.accion, llamar: llamadaDeCaso(nombre) }];
});
const consultas: Entrada[] = Object.entries(DECLARACIONES_DE_CONSULTAS).flatMap(
  ([nombre, declaracion]) => {
    if (!esClaveDe(LLAMADAS_DE_CONSULTAS, nombre)) return [];
    return [{ nombre, accion: declaracion.accion, llamar: llamadaDeConsulta(nombre) }];
  },
);
const todos: Entrada[] = [...casos, ...consultas];

const SIN_ROL: DatosDelActor = { rol: null, modulosActivados: [], modulosHabilitados: [] };

describe("P7: el guard va primero en cada caso de uso y consulta de empresas", () => {
  it("hay casos de uso y consultas con acción que probar", () => {
    expect(casos.map((c) => c.nombre).sort()).toEqual([
      "crearSucursal",
      "desactivarSucursal",
      "editarSucursal",
      "reactivarSucursal",
    ]);
    expect(consultas.map((c) => c.nombre).sort()).toEqual(["fichaDeSucursal", "listarSucursales"]);
  });

  it("los casos de uso con acción son todos los declarados", () => {
    expect(casos).toHaveLength(Object.keys(DECLARACIONES).length);
  });

  it.each(todos)(
    "$nombre: sin rol da SIN_PERMISO sin leer ni escribir nada más",
    async ({ llamar }) => {
      const vigilada = vigilar(SIN_ROL);
      expect(await llamar(vigilada)).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    },
  );

  it.each(todos.flatMap((c) => ROLES_DE_EMPRESA.map((rol) => ({ ...c, rol }))))(
    "$nombre con $rol: la matriz decide; si no lo incluye da SIN_PERMISO sin tocar nada más, y si lo incluye pasa el guard y recién ahí toca lo demás",
    async ({ llamar, accion, rol }) => {
      const vigilada = vigilar({ rol, modulosActivados: [], modulosHabilitados: [] });
      const llamada = llamar(vigilada);
      if (!(PERMISOS_DE_EMPRESA[accion] as readonly RolDeEmpresa[]).includes(rol)) {
        expect(await llamada).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
        return;
      }
      expect(await pasoElGuard(llamada)).toBe(true);
      expect(vigilada.accesos[0]).toBe("autorizacion");
    },
  );

  it("el guard se pide en cada llamada: nada se guarda entre una operación y la siguiente", async () => {
    // Misma transacción vigilada, dos operaciones; el actor cambia entre ambas (lo apagaron).
    let actor: DatosDelActor = { rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] };
    const accesos: string[] = [];
    const tx = new Proxy({} as TxDeEmpresas & TxDeConsultasDeEmpresas, {
      get(_objetivo, propiedad) {
        accesos.push(String(propiedad));
        if (propiedad === "autorizacion") return { delActor: () => Promise.resolve(actor) };
        throw new AccesoFueraDelGuard(String(propiedad));
      },
    });
    const casos = casosCon({ tx, accesos });
    expect(await pasoElGuard(LLAMADAS.crearSucursal(casos))).toBe(true);
    actor = SIN_ROL;
    expect(await LLAMADAS.crearSucursal(casos)).toEqual({ ok: false, error: "SIN_PERMISO" });
  });
});

describe("cada caso de uso y cada consulta exigen SU acción (no la de otro)", () => {
  /** Reglas en las que SOLO el operador puede `accion`, y nadie puede las demás. */
  const soloElOperadorPuede = (accion: ClaveAccion): ReglasDeEmpresa => {
    const roles = (a: ClaveAccion): readonly RolDeEmpresa[] => (a === accion ? ["OPERADOR"] : []);
    const permisos = Object.fromEntries(
      clavesDe(PERMISOS_DE_EMPRESA).map((a) => [a, roles(a)]),
    ) as unknown as ReglasDeEmpresa["permisos"];
    return { catalogo: CATALOGO_DE_MODULOS, permisos };
  };

  for (const propio of todos) {
    for (const otro of todos) {
      // Las dos consultas de sucursales comparten `sucursales.ver`: con ese permiso pasan las dos.
      const pasa = propio.accion === otro.accion;
      it(`con permiso solo para ${propio.accion} (${propio.nombre}): ${otro.nombre} ${pasa ? "pasa el guard" : "da SIN_PERMISO"}`, async () => {
        const vigilada = vigilar({ rol: "OPERADOR", modulosActivados: [], modulosHabilitados: [] });
        const reglas = soloElOperadorPuede(propio.accion);
        if (pasa) {
          expect(await pasoElGuard(otro.llamar(vigilada, reglas))).toBe(true);
        } else {
          expect(await otro.llamar(vigilada, reglas)).toEqual({ ok: false, error: "SIN_PERMISO" });
          expect(vigilada.accesos).toEqual(["autorizacion"]);
        }
      });
    }
  }

  it("la acción declarada de cada caso de uso es la que existe en el catálogo, una distinta por caso", () => {
    const delCatalogo = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const { accion } of todos) expect(delCatalogo).toContain(accion);
    expect(new Set(casos.map((c) => c.accion)).size).toBe(casos.length);
  });

  it("desactivar y reactivar exigen acciones propias del gerente; ver, crear y editar, las compartidas", () => {
    const acciones = Object.fromEntries(todos.map((t) => [t.nombre, t.accion]));
    expect(acciones).toEqual({
      crearSucursal: "sucursales.crear",
      editarSucursal: "sucursales.editar",
      desactivarSucursal: "sucursales.desactivar",
      reactivarSucursal: "sucursales.reactivar",
      listarSucursales: "sucursales.ver",
      fichaDeSucursal: "sucursales.ver",
    });
  });
});

describe("los demás motivos del guard salen tal cual", () => {
  const administracionComo = (
    estado: "disponible" | "en_desarrollo",
    obligatorio: boolean,
  ): ReglasDeEmpresa => ({
    catalogo: {
      ...CATALOGO_DE_MODULOS,
      administracion: {
        estado,
        obligatorio,
        acciones: CATALOGO_DE_MODULOS.administracion.acciones,
      },
    },
    permisos: REGLAS_DE_EMPRESA.permisos,
  });

  it("un módulo no activo da MODULO_NO_ACTIVO (y el rol ya no importa)", async () => {
    const vigilada = vigilar({ rol: "GERENTE", modulosActivados: [], modulosHabilitados: [] });
    const casos = casosCon(vigilada, administracionComo("disponible", false));
    expect(await LLAMADAS.crearSucursal(casos)).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it("un módulo en desarrollo da MODULO_EN_DESARROLLO, también en las consultas", async () => {
    const vigilada = vigilar({
      rol: "GERENTE",
      modulosActivados: ["administracion"],
      modulosHabilitados: [],
    });
    const reglas = administracionComo("en_desarrollo", true);
    expect(await LLAMADAS.desactivarSucursal(casosCon(vigilada, reglas))).toEqual({
      ok: false,
      error: "MODULO_EN_DESARROLLO",
    });
    expect(await LLAMADAS_DE_CONSULTAS.listarSucursales(consultasCon(vigilada, reglas))).toEqual({
      ok: false,
      error: "MODULO_EN_DESARROLLO",
    });
  });
});

describe("el detector (con la violación inyectada)", () => {
  /** Un caso de uso mal hecho: lee un repositorio ANTES de pedir el permiso. */
  async function casoQueLeeAntes(tx: TxDeEmpresas) {
    await tx.empresas.obtener(contexto.empresaId);
    return exigirAccion(REGLAS_DE_EMPRESA, "sucursales.crear", () =>
      tx.autorizacion.delActor(contexto),
    );
  }

  /** Otro mal hecho: no pide el permiso. */
  async function casoQueNoAutoriza(tx: TxDeEmpresas) {
    await tx.sucursales.listar(contexto.empresaId);
    return { ok: true as const, valor: null };
  }

  /** Uno bien hecho: pide el permiso y se detiene. */
  async function casoBienHecho(tx: TxDeEmpresas) {
    return exigirAccion(REGLAS_DE_EMPRESA, "sucursales.crear", () =>
      tx.autorizacion.delActor(contexto),
    );
  }

  const guardVaPrimero = async (caso: (tx: TxDeEmpresas) => Promise<unknown>) => {
    const { tx, accesos } = vigilar(SIN_ROL);
    try {
      await caso(tx);
    } catch (e) {
      if (!(e instanceof AccesoFueraDelGuard)) throw e;
    }
    return accesos.length === 1 && accesos[0] === "autorizacion";
  };

  it("detecta un caso de uso que lee antes de autorizar", async () => {
    expect(await guardVaPrimero(casoQueLeeAntes)).toBe(false);
  });

  it("detecta un caso de uso que no autoriza", async () => {
    expect(await guardVaPrimero(casoQueNoAutoriza)).toBe(false);
  });

  it("deja pasar uno que autoriza primero", async () => {
    expect(await guardVaPrimero(casoBienHecho)).toBe(true);
  });
});
