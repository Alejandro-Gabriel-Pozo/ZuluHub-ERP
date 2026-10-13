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
import {
  empresaId,
  invitacionId,
  personaId,
  sucursalId,
} from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../../puertos/autorizacion";
import type { Tokens } from "../../../puertos/tokens";
import type { Transacciones } from "../../../puertos/transacciones";
import { crearCasosDeUsoDeIdentidad, type CasosDeUsoDeIdentidad } from "./casos-de-uso";
import { crearConsultasDeIdentidad, type ConsultasDeIdentidad } from "../consultas/consultas";
import type { TxDeConsultasDeIdentidad } from "../consultas/contrato";
import { DECLARACIONES_DE_CONSULTAS } from "../consultas/declaraciones";
import type { TxDeIdentidad } from "./contrato";
import { DECLARACIONES } from "./declaraciones";

/**
 * P7: ningún caso de uso se salta el guard. Los casos de uso corren contra una transacción
 * VIGILADA: solo `autorizacion` responde y cualquier otro acceso (un repositorio, la auditoría, los
 * trabajos) queda registrado y corta la ejecución. Un caso de uso que lee o escribe antes de
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

type Vigilada = Readonly<{ tx: TxDeIdentidad; accesos: string[] }>;

function vigilar(actor: DatosDelActor): Vigilada {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as TxDeIdentidad, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

const tokens: Tokens = {
  emitir: () => ({ invitacionId: invitacionId("i-nueva"), token: "token", tokenHash: "hash" }),
  hash: () => "hash",
  derivar: () => "token",
};

const casosCon = (vigilada: Vigilada, reglas: ReglasDeEmpresa = REGLAS_DE_EMPRESA) => {
  const transacciones: Transacciones<TxDeIdentidad> = {
    ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
  };
  return crearCasosDeUsoDeIdentidad({ transacciones, tokens, reglas });
};

type Declaraciones = typeof DECLARACIONES;
type ConAccion = {
  [K in keyof Declaraciones]: Declaraciones[K] extends { accion: ClaveAccion } ? K : never;
}[keyof Declaraciones];

/** Cómo se llama a cada caso de uso con acción. Un caso de uso nuevo con acción obliga a sumar su fila. */
const LLAMADAS: Record<ConAccion, (casos: CasosDeUsoDeIdentidad) => Promise<unknown>> = {
  invitarUsuario: (c) =>
    c.invitarUsuario(contexto, { email: "nueva@prueba.test", rol: "OPERADOR", sucursales: [] }),
  reenviarInvitacion: (c) => c.reenviarInvitacion(contexto, { invitacionId: invitacionId("i-1") }),
  apagarMembresia: (c) => c.apagarMembresia(contexto, { personaId: personaId("p-2") }),
  revocarInvitacion: (c) => c.revocarInvitacion(contexto, { invitacionId: invitacionId("i-1") }),
  asignarSucursales: (c) =>
    c.asignarSucursales(contexto, { personaId: personaId("p-2"), sucursales: [sucursalId("s-1")] }),
  proponerTraspaso: (c) => c.proponerTraspaso(contexto, { entrantePersonaId: personaId("p-2") }),
  cancelarTraspaso: (c) => c.cancelarTraspaso(contexto, {}),
  aceptarTraspaso: (c) => c.aceptarTraspaso(contexto, { traspasoId: "t-1" }),
  rechazarTraspaso: (c) => c.rechazarTraspaso(contexto, { traspasoId: "t-1" }),
};

/**
 * El guard dejó pasar si el caso de uso tocó la transacción vigilada: corta con `AccesoFueraDelGuard`
 * en el primer acceso que no es la autorización.
 */
const pasoElGuard = async (llamada: Promise<unknown>): Promise<boolean> => {
  try {
    await llamada;
    return false;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
};

const conAccion = Object.entries(DECLARACIONES).flatMap(([nombre, declaracion]) =>
  "accion" in declaracion ? [{ nombre, accion: declaracion.accion }] : [],
);

const llamar = (nombre: string, casos: CasosDeUsoDeIdentidad): Promise<unknown> => {
  if (!esClaveDe(LLAMADAS, nombre)) throw new Error(`falta la llamada de prueba de ${nombre}`);
  return LLAMADAS[nombre](casos);
};

const SIN_ROL: DatosDelActor = { rol: null, modulosActivados: [], modulosHabilitados: [] };

describe("P7: el guard va primero en cada caso de uso", () => {
  it("hay casos de uso con acción que probar", () => {
    expect(conAccion.map((c) => c.nombre).sort()).toEqual([
      "aceptarTraspaso",
      "apagarMembresia",
      "asignarSucursales",
      "cancelarTraspaso",
      "invitarUsuario",
      "proponerTraspaso",
      "rechazarTraspaso",
      "reenviarInvitacion",
      "revocarInvitacion",
    ]);
  });

  it.each(conAccion)(
    "$nombre: sin rol da SIN_PERMISO sin leer ni escribir nada más",
    async ({ nombre }) => {
      const vigilada = vigilar(SIN_ROL);
      const resultado = await llamar(nombre, casosCon(vigilada));
      expect(resultado).toEqual({ ok: false, error: "SIN_PERMISO" });
      expect(vigilada.accesos).toEqual(["autorizacion"]);
    },
  );

  it.each(conAccion.flatMap((c) => ROLES_DE_EMPRESA.map((rol) => ({ ...c, rol }))))(
    "$nombre con $rol: la matriz decide; si no lo incluye da SIN_PERMISO sin tocar nada más, y si lo incluye pasa el guard y recién ahí toca lo demás",
    async ({ nombre, accion, rol }) => {
      const vigilada = vigilar({ rol, modulosActivados: [], modulosHabilitados: [] });
      const llamada = llamar(nombre, casosCon(vigilada));
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
    const tx = new Proxy({} as TxDeIdentidad, {
      get(_objetivo, propiedad) {
        accesos.push(String(propiedad));
        if (propiedad === "autorizacion") return { delActor: () => Promise.resolve(actor) };
        throw new AccesoFueraDelGuard(String(propiedad));
      },
    });
    const casos = casosCon({ tx, accesos });
    expect(await pasoElGuard(LLAMADAS.invitarUsuario(casos))).toBe(true);
    actor = SIN_ROL;
    expect(await LLAMADAS.invitarUsuario(casos)).toEqual({ ok: false, error: "SIN_PERMISO" });
  });
});

describe("cada caso de uso exige SU acción (no la de otro)", () => {
  /** Reglas en las que SOLO el operador puede `accion`, y nadie puede las demás. */
  const soloElOperadorPuede = (accion: ClaveAccion): ReglasDeEmpresa => {
    const roles = (a: ClaveAccion): readonly RolDeEmpresa[] => (a === accion ? ["OPERADOR"] : []);
    const permisos = Object.fromEntries(
      clavesDe(PERMISOS_DE_EMPRESA).map((a) => [a, roles(a)]),
    ) as unknown as ReglasDeEmpresa["permisos"];
    return { catalogo: CATALOGO_DE_MODULOS, permisos };
  };

  for (const propio of conAccion) {
    for (const otro of conAccion) {
      const esElMismo = propio.nombre === otro.nombre;
      it(`con permiso solo para ${propio.accion}: ${otro.nombre} ${esElMismo ? "pasa el guard" : "da SIN_PERMISO"}`, async () => {
        const vigilada = vigilar({ rol: "OPERADOR", modulosActivados: [], modulosHabilitados: [] });
        const casos = casosCon(vigilada, soloElOperadorPuede(propio.accion));
        if (esElMismo) {
          expect(await pasoElGuard(llamar(otro.nombre, casos))).toBe(true);
        } else {
          expect(await llamar(otro.nombre, casos)).toEqual({ ok: false, error: "SIN_PERMISO" });
          expect(vigilada.accesos).toEqual(["autorizacion"]);
        }
      });
    }
  }

  it("la acción declarada de cada caso de uso es la que existe en el catálogo", () => {
    const delCatalogo = Object.values(CATALOGO_DE_MODULOS).flatMap((m) => Object.keys(m.acciones));
    for (const { accion } of conAccion) expect(delCatalogo).toContain(accion);
    // Granular: una acción distinta por caso de uso.
    expect(new Set(conAccion.map((c) => c.accion)).size).toBe(conAccion.length);
  });
});

describe("los demás motivos del guard salen tal cual por el caso de uso", () => {
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
    expect(await LLAMADAS.invitarUsuario(casos)).toEqual({ ok: false, error: "MODULO_NO_ACTIVO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it("un módulo activado por la empresa e incluido en su plan pasa el guard", async () => {
    const vigilada = vigilar({
      rol: "GERENTE",
      modulosActivados: ["administracion"],
      modulosHabilitados: ["administracion"],
    });
    const casos = casosCon(vigilada, administracionComo("disponible", false));
    await expect(LLAMADAS.invitarUsuario(casos)).rejects.toBeInstanceOf(AccesoFueraDelGuard);
  });

  it("un módulo en desarrollo da MODULO_EN_DESARROLLO", async () => {
    const vigilada = vigilar({
      rol: "GERENTE",
      modulosActivados: ["administracion"],
      modulosHabilitados: [],
    });
    const casos = casosCon(vigilada, administracionComo("en_desarrollo", true));
    expect(await LLAMADAS.invitarUsuario(casos)).toEqual({
      ok: false,
      error: "MODULO_EN_DESARROLLO",
    });
  });
});

describe("las declaraciones", () => {
  it("los casos de uso sin guard dicen por qué, con un motivo que no es vacío", () => {
    const sinGuard = Object.entries(DECLARACIONES).flatMap(([nombre, d]) =>
      "sinGuard" in d ? [{ nombre, motivo: d.sinGuard }] : [],
    );
    expect(sinGuard.map((s) => s.nombre)).toEqual(["aceptarInvitacion"]);
    for (const { motivo } of sinGuard) expect(motivo.trim().length).toBeGreaterThan(20);
  });

  it("aceptarInvitacion declara sinGuard y de hecho no consulta la autorización", async () => {
    const vigilada = vigilar(SIN_ROL);
    const casos = casosCon(vigilada);
    const resultado = casos.aceptarInvitacion({
      token: "token",
      emailAutenticado: "nueva@prueba.test",
      ahora: new Date(0),
    });
    await expect(resultado).rejects.toBeInstanceOf(AccesoFueraDelGuard);
    expect(vigilada.accesos).not.toContain("autorizacion");
  });
});

describe("el detector (con la violación inyectada)", () => {
  /** Un caso de uso mal hecho: lee un repositorio ANTES de pedir el permiso. */
  async function casoQueLeeAntes(tx: TxDeIdentidad) {
    await tx.empresas.obtener(contexto.empresaId);
    return exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", () =>
      tx.autorizacion.delActor(contexto),
    );
  }

  /** Otro mal hecho: no pide el permiso. */
  async function casoQueNoAutoriza(tx: TxDeIdentidad) {
    await tx.personas.obtener(personaId("p-2"));
    return { ok: true as const, valor: null };
  }

  /** Uno bien hecho: pide el permiso y se detiene. */
  async function casoBienHecho(tx: TxDeIdentidad) {
    return exigirAccion(REGLAS_DE_EMPRESA, "usuarios.invitar", () =>
      tx.autorizacion.delActor(contexto),
    );
  }

  const guardVaPrimero = async (caso: (tx: TxDeIdentidad) => Promise<unknown>) => {
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

describe("P7: el guard va primero en cada consulta de identidad", () => {
  type TxDeConsulta = TxDeConsultasDeIdentidad;
  type Vigilada = Readonly<{ tx: TxDeConsulta; accesos: string[] }>;

  const vigiladaDeConsulta = (actor: DatosDelActor): Vigilada => {
    const accesos: string[] = [];
    const tx = new Proxy({} as TxDeConsulta, {
      get(_objetivo, propiedad) {
        accesos.push(String(propiedad));
        if (propiedad === "autorizacion") return { delActor: () => Promise.resolve(actor) };
        throw new AccesoFueraDelGuard(String(propiedad));
      },
    });
    return { tx, accesos };
  };

  const consultasCon = (
    vigilada: Vigilada,
    reglas: ReglasDeEmpresa = REGLAS_DE_EMPRESA,
  ): ConsultasDeIdentidad => {
    const transacciones: Transacciones<TxDeConsulta> = {
      ejecutar: (_opciones, trabajo) => trabajo(vigilada.tx),
    };
    return crearConsultasDeIdentidad({ transacciones, reglas });
  };

  type DeclaracionesDeConsultas = typeof DECLARACIONES_DE_CONSULTAS;
  type ConsultaConAccion = {
    [K in keyof DeclaracionesDeConsultas]: DeclaracionesDeConsultas[K] extends {
      accion: ClaveAccion;
    }
      ? K
      : never;
  }[keyof DeclaracionesDeConsultas];
  const LLAMADAS_DE_CONSULTAS: Record<
    ConsultaConAccion,
    (consultas: ConsultasDeIdentidad) => Promise<unknown>
  > = {
    listarMiembros: (c) => c.listarMiembros(contexto),
    listarInvitacionesPendientes: (c) => c.listarInvitacionesPendientes(contexto),
    traspasoEnCurso: (c) => c.traspasoEnCurso(contexto),
  };

  const consultas = Object.entries(DECLARACIONES_DE_CONSULTAS).flatMap(([nombre, declaracion]) =>
    esClaveDe(LLAMADAS_DE_CONSULTAS, nombre)
      ? [{ nombre, accion: declaracion.accion, llamar: LLAMADAS_DE_CONSULTAS[nombre] }]
      : [],
  );

  it("las consultas con acción que hay que probar", () => {
    expect(consultas.map((c) => c.nombre).sort()).toEqual([
      "listarInvitacionesPendientes",
      "listarMiembros",
      "traspasoEnCurso",
    ]);
  });

  it.each(consultas)("$nombre: sin rol da SIN_PERMISO sin leer nada más", async ({ llamar }) => {
    const vigilada = vigiladaDeConsulta(SIN_ROL);
    expect(await llamar(consultasCon(vigilada))).toEqual({ ok: false, error: "SIN_PERMISO" });
    expect(vigilada.accesos).toEqual(["autorizacion"]);
  });

  it.each(consultas.flatMap((c) => ROLES_DE_EMPRESA.map((rol) => ({ ...c, rol }))))(
    "$nombre con $rol: la matriz decide; si no lo incluye da SIN_PERMISO sin tocar nada más, y si lo incluye pasa el guard y recién ahí toca lo demás",
    async ({ llamar, accion, rol }) => {
      const vigilada = vigiladaDeConsulta({ rol, modulosActivados: [], modulosHabilitados: [] });
      const llamada = llamar(consultasCon(vigilada));
      if (!(PERMISOS_DE_EMPRESA[accion] as readonly RolDeEmpresa[]).includes(rol)) {
        expect(await llamada).toEqual({ ok: false, error: "SIN_PERMISO" });
        expect(vigilada.accesos).toEqual(["autorizacion"]);
        return;
      }
      await expect(llamada).rejects.toBeInstanceOf(AccesoFueraDelGuard);
      expect(vigilada.accesos[0]).toBe("autorizacion");
    },
  );

  it("cada consulta exige SU acción (con permiso solo para la de la otra da SIN_PERMISO)", async () => {
    const soloElOperadorPuede = (accion: ClaveAccion): ReglasDeEmpresa => {
      const roles = (a: ClaveAccion): readonly RolDeEmpresa[] => (a === accion ? ["OPERADOR"] : []);
      const permisos = Object.fromEntries(
        clavesDe(PERMISOS_DE_EMPRESA).map((a) => [a, roles(a)]),
      ) as unknown as ReglasDeEmpresa["permisos"];
      return { catalogo: CATALOGO_DE_MODULOS, permisos };
    };
    for (const propia of consultas) {
      const vigilada = vigiladaDeConsulta({
        rol: "OPERADOR",
        modulosActivados: [],
        modulosHabilitados: [],
      });
      await expect(
        propia.llamar(consultasCon(vigilada, soloElOperadorPuede(propia.accion))),
      ).rejects.toBeInstanceOf(AccesoFueraDelGuard);
    }
    const vigilada = vigiladaDeConsulta({
      rol: "OPERADOR",
      modulosActivados: [],
      modulosHabilitados: [],
    });
    const reglas = soloElOperadorPuede("usuarios.invitar");
    for (const { llamar } of consultas) {
      expect(await llamar(consultasCon(vigilada, reglas))).toEqual({
        ok: false,
        error: "SIN_PERMISO",
      });
    }
  });
});
