import { describe, expect, it } from "vitest";
import {
  evaluarGuard,
  type DatosDelGuard,
  type ModuloDelGuard,
  type MotivoDeRechazo,
  type ReglasDelGuard,
} from "./guard";
import { ROLES_DE_EMPRESA, type RolDeEmpresa } from "./roles";

/**
 * P1: la matriz de motivos del guard con un catálogo de PRUEBA (el real solo puede dar
 * `SIN_PERMISO`): cada motivo por separado, el caso permitido y las precedencias.
 */

type Capacidad = "caja" | "balanza";

const CATALOGO = {
  base: {
    estado: "disponible",
    obligatorio: true,
    acciones: {
      "base.ver": { capacidad: null },
      "base.cobrar": { capacidad: "caja" },
      "base.pesar": { capacidad: "balanza" },
    },
  },
  ventas: {
    estado: "disponible",
    obligatorio: false,
    acciones: { "ventas.vender": { capacidad: null } },
  },
  futuro: {
    estado: "en_desarrollo",
    obligatorio: false,
    acciones: { "futuro.pronosticar": { capacidad: null }, "futuro.cobrar": { capacidad: "caja" } },
  },
} as const satisfies Record<string, ModuloDelGuard<Capacidad>>;

type Modulo = keyof typeof CATALOGO;

const PERMISOS = {
  "base.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "base.cobrar": ["GERENTE", "OPERADOR"],
  "base.pesar": ["OPERADOR"],
  "ventas.vender": ["GERENTE", "ADMINISTRADOR"],
  "futuro.pronosticar": ["GERENTE"],
  "futuro.cobrar": ["GERENTE"],
} as const satisfies Record<string, readonly RolDeEmpresa[]>;

type Accion = keyof typeof PERMISOS;

const REGLAS: ReglasDelGuard<Modulo, Accion, Capacidad> = {
  catalogo: CATALOGO,
  permisos: PERMISOS,
};

const datos = (parcial: Partial<DatosDelGuard<Modulo, Capacidad>> = {}) =>
  ({
    rol: "GERENTE",
    modulosActivos: new Set<Modulo>(["base", "ventas", "futuro"]),
    capacidadesDeSucursal: new Set<Capacidad>(["caja", "balanza"]),
    ...parcial,
  }) satisfies DatosDelGuard<Modulo, Capacidad>;

const evaluar = (accion: Accion, parcial: Partial<DatosDelGuard<Modulo, Capacidad>> = {}) =>
  evaluarGuard(REGLAS, accion, datos(parcial));

const rechazo = (motivo: MotivoDeRechazo) => ({ ok: false, error: motivo });
const OK = { ok: true, valor: null };

describe("evaluarGuard: el caso permitido", () => {
  it("módulo disponible y activo, sin capacidad exigida y con un rol de la matriz: ok", () => {
    expect(evaluar("ventas.vender", { rol: "ADMINISTRADOR" })).toEqual(OK);
  });

  it("con capacidad exigida y la sucursal la tiene: ok", () => {
    expect(evaluar("base.cobrar", { rol: "OPERADOR" })).toEqual(OK);
  });

  it("cada rol de la matriz pasa y los demás no (SIN_PERMISO)", () => {
    for (const rol of ROLES_DE_EMPRESA) {
      const esperado = (PERMISOS["base.cobrar"] as readonly RolDeEmpresa[]).includes(rol)
        ? OK
        : rechazo("SIN_PERMISO");
      expect(evaluar("base.cobrar", { rol })).toEqual(esperado);
    }
  });
});

describe("evaluarGuard: cada motivo por separado", () => {
  it("MODULO_EN_DESARROLLO: el módulo no está construido, aunque esté 'activo' y el rol alcance", () => {
    expect(evaluar("futuro.pronosticar", { rol: "GERENTE" })).toEqual(
      rechazo("MODULO_EN_DESARROLLO"),
    );
  });

  it("MODULO_NO_ACTIVO: el módulo existe pero la empresa no lo tiene", () => {
    expect(evaluar("ventas.vender", { modulosActivos: new Set<Modulo>(["base"]) })).toEqual(
      rechazo("MODULO_NO_ACTIVO"),
    );
  });

  it("SIN_CAPACIDAD: la acción exige una capacidad que la sucursal no tiene", () => {
    expect(
      evaluar("base.cobrar", { capacidadesDeSucursal: new Set<Capacidad>(["balanza"]) }),
    ).toEqual(rechazo("SIN_CAPACIDAD"));
    expect(evaluar("base.cobrar", { capacidadesDeSucursal: new Set<Capacidad>() })).toEqual(
      rechazo("SIN_CAPACIDAD"),
    );
  });

  it("SIN_CAPACIDAD: la acción exige una capacidad y la operación no es de una sucursal (null)", () => {
    expect(evaluar("base.cobrar", { capacidadesDeSucursal: null })).toEqual(
      rechazo("SIN_CAPACIDAD"),
    );
  });

  it("una acción sin capacidad exigida no pide sucursal: con null no exige nada", () => {
    expect(evaluar("base.ver", { capacidadesDeSucursal: null })).toEqual(OK);
    expect(evaluar("base.ver", { capacidadesDeSucursal: new Set<Capacidad>() })).toEqual(OK);
  });

  it("SIN_PERMISO: sin rol (null) o con un rol que la matriz no incluye", () => {
    expect(evaluar("ventas.vender", { rol: null })).toEqual(rechazo("SIN_PERMISO"));
    expect(evaluar("ventas.vender", { rol: "OPERADOR" })).toEqual(rechazo("SIN_PERMISO"));
  });

  it("la capacidad que cuenta es la de ESA acción, no cualquiera de la sucursal", () => {
    expect(
      evaluar("base.pesar", {
        rol: "OPERADOR",
        capacidadesDeSucursal: new Set<Capacidad>(["caja"]),
      }),
    ).toEqual(rechazo("SIN_CAPACIDAD"));
    expect(
      evaluar("base.cobrar", {
        rol: "OPERADOR",
        capacidadesDeSucursal: new Set<Capacidad>(["balanza"]),
      }),
    ).toEqual(rechazo("SIN_CAPACIDAD"));
  });

  it("el módulo que cuenta es el DUEÑO de la acción, no cualquier módulo activo", () => {
    expect(
      evaluar("ventas.vender", { modulosActivos: new Set<Modulo>(["base", "futuro"]) }),
    ).toEqual(rechazo("MODULO_NO_ACTIVO"));
  });
});

describe("evaluarGuard: precedencia módulo → capacidad → rol", () => {
  it("en desarrollo + no activo → MODULO_EN_DESARROLLO", () => {
    expect(
      evaluar("futuro.pronosticar", { rol: null, modulosActivos: new Set<Modulo>(["base"]) }),
    ).toEqual(rechazo("MODULO_EN_DESARROLLO"));
  });

  it("en desarrollo + sin capacidad + sin rol → MODULO_EN_DESARROLLO", () => {
    expect(evaluar("futuro.cobrar", { rol: null, capacidadesDeSucursal: null })).toEqual(
      rechazo("MODULO_EN_DESARROLLO"),
    );
  });

  it("no activo + sin capacidad → MODULO_NO_ACTIVO", () => {
    expect(
      evaluar("base.cobrar", {
        modulosActivos: new Set<Modulo>(),
        capacidadesDeSucursal: new Set<Capacidad>(),
      }),
    ).toEqual(rechazo("MODULO_NO_ACTIVO"));
  });

  it("no activo + sin rol → MODULO_NO_ACTIVO", () => {
    expect(evaluar("ventas.vender", { rol: null, modulosActivos: new Set<Modulo>() })).toEqual(
      rechazo("MODULO_NO_ACTIVO"),
    );
  });

  it("sin capacidad + sin rol → SIN_CAPACIDAD", () => {
    expect(evaluar("base.cobrar", { rol: null, capacidadesDeSucursal: null })).toEqual(
      rechazo("SIN_CAPACIDAD"),
    );
    expect(evaluar("base.cobrar", { rol: "ADMINISTRADOR", capacidadesDeSucursal: null })).toEqual(
      rechazo("SIN_CAPACIDAD"),
    );
  });
});

describe("evaluarGuard: defectos de configuración (nunca se autoriza por omisión)", () => {
  // Con `A = string` se puede pedir cualquier nombre; el compilador no lo frena y el guard sí.
  const reglasAbiertas: ReglasDelGuard<Modulo, string, Capacidad> = {
    catalogo: CATALOGO,
    permisos: PERMISOS,
  };
  const evaluarAbierta = (accion: string) => evaluarGuard(reglasAbiertas, accion, datos());

  it("una acción que ningún módulo declara lanza RangeError", () => {
    expect(() => evaluarAbierta("nadie.hace")).toThrow(RangeError);
    expect(() => evaluarAbierta("nadie.hace")).toThrow("nadie.hace");
  });

  it("una acción con permisos pero sin módulo dueño lanza RangeError con su motivo", () => {
    const huerfana: ReglasDelGuard<Modulo, string, Capacidad> = {
      catalogo: CATALOGO,
      permisos: { ...PERMISOS, "huerfana.hacer": ["GERENTE"] },
    };
    expect(() => evaluarGuard(huerfana, "huerfana.hacer", datos())).toThrow(
      "la acción huerfana.hacer no la declara ningún módulo",
    );
  });

  it("los nombres heredados de Object (constructor, toString) no son acciones", () => {
    expect(() => evaluarAbierta("constructor")).toThrow(RangeError);
    expect(() => evaluarAbierta("toString")).toThrow(RangeError);
    expect(() => evaluarAbierta("__proto__")).toThrow(RangeError);
  });

  it("una acción declarada en el catálogo pero sin permisos definidos lanza RangeError", () => {
    const sinPermisos: ReglasDelGuard<Modulo, string, Capacidad> = {
      catalogo: CATALOGO,
      permisos: { "base.ver": ["GERENTE"] },
    };
    expect(() => evaluarGuard(sinPermisos, "ventas.vender", datos())).toThrow(RangeError);
    expect(() => evaluarGuard(sinPermisos, "ventas.vender", datos())).toThrow(
      "ventas.vender no tiene permisos",
    );
  });

  it("un nombre heredado en los permisos no cuenta como permiso definido", () => {
    const catalogo = {
      base: {
        estado: "disponible",
        obligatorio: true,
        acciones: { toString: { capacidad: null } },
      },
    } as const satisfies Record<string, ModuloDelGuard<Capacidad>>;
    const reglas: ReglasDelGuard<"base", string, Capacidad> = { catalogo, permisos: {} };
    expect(() =>
      evaluarGuard(reglas, "toString", {
        rol: "GERENTE",
        modulosActivos: new Set<"base">(["base"]),
        capacidadesDeSucursal: null,
      }),
    ).toThrow("toString no tiene permisos");
  });

  it("el defecto se detecta aunque el módulo esté en desarrollo o inactivo (antes de decidir)", () => {
    const sinPermisos: ReglasDelGuard<Modulo, string, Capacidad> = {
      catalogo: CATALOGO,
      permisos: {},
    };
    expect(() =>
      evaluarGuard(sinPermisos, "futuro.pronosticar", datos({ modulosActivos: new Set<Modulo>() })),
    ).toThrow(RangeError);
  });
});

describe("evaluarGuard: es puro", () => {
  it("no modifica sus entradas y repite el mismo resultado", () => {
    const entrada = datos({ rol: "OPERADOR" });
    const antes = JSON.stringify([...entrada.modulosActivos]);
    const primero = evaluarGuard(REGLAS, "base.cobrar", entrada);
    const segundo = evaluarGuard(REGLAS, "base.cobrar", entrada);
    expect(primero).toEqual(segundo);
    expect(JSON.stringify([...entrada.modulosActivos])).toBe(antes);
    expect(entrada.rol).toBe("OPERADOR");
  });
});

describe("evaluarGuard: el tipo de rol es un parámetro (H5 P1)", () => {
  type RolAjeno = "JEFE" | "AYUDANTE";
  type ModuloAjeno = "central";

  const REGLAS_AJENAS: ReglasDelGuard<
    ModuloAjeno,
    "central.ver" | "central.cerrar",
    never,
    RolAjeno
  > = {
    catalogo: {
      central: {
        estado: "disponible",
        obligatorio: true,
        acciones: { "central.ver": { capacidad: null }, "central.cerrar": { capacidad: null } },
      },
    },
    permisos: { "central.ver": ["JEFE", "AYUDANTE"], "central.cerrar": ["JEFE"] },
  };

  const evaluarAjena = (
    accion: "central.ver" | "central.cerrar",
    rol: RolAjeno | null,
    modulosActivos: ReadonlySet<ModuloAjeno> = new Set<ModuloAjeno>(["central"]),
  ) => evaluarGuard(REGLAS_AJENAS, accion, { rol, modulosActivos, capacidadesDeSucursal: null });

  it("cada rol ajeno pasa solo donde la matriz lo nombra; los demás, SIN_PERMISO", () => {
    expect(evaluarAjena("central.ver", "AYUDANTE")).toEqual(OK);
    expect(evaluarAjena("central.ver", "JEFE")).toEqual(OK);
    expect(evaluarAjena("central.cerrar", "JEFE")).toEqual(OK);
    expect(evaluarAjena("central.cerrar", "AYUDANTE")).toEqual(rechazo("SIN_PERMISO"));
  });

  it("sin rol (null) nunca pasa, y un rol de empresa no tiene ningún trato especial", () => {
    expect(evaluarAjena("central.ver", null)).toEqual(rechazo("SIN_PERMISO"));
    // El guard compara el texto del rol con la matriz que recibe: "GERENTE" no está en esta.
    const intruso = "GERENTE" as unknown as RolAjeno;
    expect(evaluarAjena("central.ver", intruso)).toEqual(rechazo("SIN_PERMISO"));
  });

  it("la precedencia no cambia: el módulo inactivo gana sobre el rol", () => {
    expect(evaluarAjena("central.ver", "JEFE", new Set<ModuloAjeno>())).toEqual(
      rechazo("MODULO_NO_ACTIVO"),
    );
  });

  it("un rol de otro tipo no compila (el tipo de rol lo fija la matriz)", () => {
    const noSeEjecuta = () =>
      evaluarGuard(REGLAS_AJENAS, "central.ver", {
        // @ts-expect-error "GERENTE" no es un rol de esta matriz
        rol: "GERENTE",
        modulosActivos: new Set<ModuloAjeno>(["central"]),
        capacidadesDeSucursal: null,
      });
    expect(noSeEjecuta).toBeTypeOf("function");
  });
});
