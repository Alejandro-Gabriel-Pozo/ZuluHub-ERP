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
 * `SIN_PERMISO`): cada motivo por separado, el caso permitido y las precedencias. La solo lectura
 * (corrección 16) tiene su propio bloque: estado del módulo × efecto de la acción × capacidad × permiso.
 */

type Capacidad = "caja" | "balanza";

const CATALOGO = {
  base: {
    estado: "disponible",
    obligatorio: true,
    acciones: {
      "base.ver": { capacidad: null, efecto: "LECTURA" },
      "base.cobrar": { capacidad: "caja", efecto: "COMPLETA_CIERRA" },
      "base.pesar": { capacidad: "balanza", efecto: "CREA_AMPLIA" },
      "base.abrir": { capacidad: null, efecto: "CREA_AMPLIA" },
    },
  },
  ventas: {
    estado: "disponible",
    obligatorio: false,
    acciones: {
      "ventas.vender": { capacidad: null, efecto: "CREA_AMPLIA" },
      "ventas.ver": { capacidad: null, efecto: "LECTURA" },
      "ventas.cerrar": { capacidad: null, efecto: "COMPLETA_CIERRA" },
      "ventas.cobrar": { capacidad: "caja", efecto: "CREA_AMPLIA" },
    },
  },
  futuro: {
    estado: "en_desarrollo",
    obligatorio: false,
    acciones: {
      "futuro.pronosticar": { capacidad: null, efecto: "CREA_AMPLIA" },
      "futuro.cobrar": { capacidad: "caja", efecto: "LECTURA" },
    },
  },
} as const satisfies Record<string, ModuloDelGuard<Capacidad>>;

type Modulo = keyof typeof CATALOGO;

const PERMISOS = {
  "base.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "base.cobrar": ["GERENTE", "OPERADOR"],
  "base.pesar": ["OPERADOR"],
  "base.abrir": ["GERENTE"],
  "ventas.vender": ["GERENTE", "ADMINISTRADOR"],
  "ventas.ver": ["GERENTE", "ADMINISTRADOR", "OPERADOR"],
  "ventas.cerrar": ["GERENTE", "ADMINISTRADOR"],
  "ventas.cobrar": ["GERENTE", "OPERADOR"],
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

/** El módulo `ventas` (no obligatorio) en cada uno de sus tres estados, y los demás siempre activos. */
const ESTADOS_DE_MODULO = ["ACTIVO", "SOLO_LECTURA", "NO_ACTIVO"] as const;
type EstadoDeModulo = (typeof ESTADOS_DE_MODULO)[number];

const ventasEn = (estado: EstadoDeModulo): Partial<DatosDelGuard<Modulo, Capacidad>> => ({
  modulosActivos: new Set<Modulo>(estado === "ACTIVO" ? ["base", "ventas"] : ["base"]),
  modulosEnSoloLectura: new Set<Modulo>(estado === "SOLO_LECTURA" ? ["ventas"] : []),
});

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

describe("evaluarGuard: precedencia desarrollo → no activo → solo lectura → capacidad → rol", () => {
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

  it("en desarrollo + en solo lectura → MODULO_EN_DESARROLLO", () => {
    expect(
      evaluar("futuro.pronosticar", {
        rol: null,
        modulosEnSoloLectura: new Set<Modulo>(["futuro"]),
      }),
    ).toEqual(rechazo("MODULO_EN_DESARROLLO"));
  });

  it("solo lectura + sin capacidad → MODULO_EN_SOLO_LECTURA", () => {
    expect(
      evaluar("ventas.cobrar", {
        ...ventasEn("SOLO_LECTURA"),
        capacidadesDeSucursal: new Set<Capacidad>(),
      }),
    ).toEqual(rechazo("MODULO_EN_SOLO_LECTURA"));
    expect(
      evaluar("ventas.cobrar", { ...ventasEn("SOLO_LECTURA"), capacidadesDeSucursal: null }),
    ).toEqual(rechazo("MODULO_EN_SOLO_LECTURA"));
  });

  it("solo lectura + sin rol → MODULO_EN_SOLO_LECTURA", () => {
    expect(evaluar("ventas.vender", { ...ventasEn("SOLO_LECTURA"), rol: null })).toEqual(
      rechazo("MODULO_EN_SOLO_LECTURA"),
    );
  });

  it("solo lectura + sin capacidad + sin rol → MODULO_EN_SOLO_LECTURA", () => {
    expect(
      evaluar("ventas.cobrar", {
        ...ventasEn("SOLO_LECTURA"),
        rol: null,
        capacidadesDeSucursal: null,
      }),
    ).toEqual(rechazo("MODULO_EN_SOLO_LECTURA"));
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

describe("evaluarGuard: módulo en solo lectura (corrección 16)", () => {
  it("MODULO_EN_SOLO_LECTURA: una acción que crea o amplía se rechaza, aunque el rol y la capacidad alcancen", () => {
    expect(evaluar("ventas.vender", ventasEn("SOLO_LECTURA"))).toEqual(
      rechazo("MODULO_EN_SOLO_LECTURA"),
    );
  });

  it("una acción de lectura pasa en solo lectura", () => {
    expect(evaluar("ventas.ver", { ...ventasEn("SOLO_LECTURA"), rol: "OPERADOR" })).toEqual(OK);
  });

  it("una acción que completa o cierra lo iniciado pasa en solo lectura", () => {
    expect(evaluar("ventas.cerrar", ventasEn("SOLO_LECTURA"))).toEqual(OK);
  });

  it("en solo lectura, lo que pasa el módulo sigue sujeto a la capacidad y al permiso", () => {
    expect(evaluar("ventas.cerrar", { ...ventasEn("SOLO_LECTURA"), rol: "OPERADOR" })).toEqual(
      rechazo("SIN_PERMISO"),
    );
    expect(evaluar("ventas.cerrar", { ...ventasEn("SOLO_LECTURA"), rol: null })).toEqual(
      rechazo("SIN_PERMISO"),
    );
  });

  it("estado × efecto × capacidad × permiso: las 36 combinaciones salen en el orden fijo", () => {
    // Un módulo no obligatorio con una acción por efecto, las tres con la capacidad `caja` y el permiso del GERENTE.
    const catalogo = {
      m: {
        estado: "disponible",
        obligatorio: false,
        acciones: {
          "m.leer": { capacidad: "caja", efecto: "LECTURA" },
          "m.crear": { capacidad: "caja", efecto: "CREA_AMPLIA" },
          "m.cerrar": { capacidad: "caja", efecto: "COMPLETA_CIERRA" },
        },
      },
    } as const satisfies Record<string, ModuloDelGuard<Capacidad>>;
    const reglas: ReglasDelGuard<"m", "m.leer" | "m.crear" | "m.cerrar", Capacidad> = {
      catalogo,
      permisos: {
        "m.leer": ["GERENTE"],
        "m.crear": ["GERENTE"],
        "m.cerrar": ["GERENTE"],
      },
    };
    const acciones = {
      LECTURA: "m.leer",
      CREA_AMPLIA: "m.crear",
      COMPLETA_CIERRA: "m.cerrar",
    } as const;

    const esperado = (
      estado: EstadoDeModulo,
      efecto: keyof typeof acciones,
      conCapacidad: boolean,
      conPermiso: boolean,
    ): MotivoDeRechazo | null => {
      if (estado === "NO_ACTIVO") return "MODULO_NO_ACTIVO";
      if (estado === "SOLO_LECTURA" && efecto === "CREA_AMPLIA") return "MODULO_EN_SOLO_LECTURA";
      if (!conCapacidad) return "SIN_CAPACIDAD";
      if (!conPermiso) return "SIN_PERMISO";
      return null;
    };

    let combinaciones = 0;
    for (const estado of ESTADOS_DE_MODULO) {
      for (const efecto of Object.keys(acciones) as (keyof typeof acciones)[]) {
        for (const conCapacidad of [true, false]) {
          for (const conPermiso of [true, false]) {
            const motivo = esperado(estado, efecto, conCapacidad, conPermiso);
            const resultado = evaluarGuard(reglas, acciones[efecto], {
              rol: conPermiso ? "GERENTE" : "OPERADOR",
              modulosActivos: new Set<"m">(estado === "ACTIVO" ? ["m"] : []),
              modulosEnSoloLectura: new Set<"m">(estado === "SOLO_LECTURA" ? ["m"] : []),
              capacidadesDeSucursal: new Set<Capacidad>(conCapacidad ? ["caja"] : []),
            });
            expect(
              resultado,
              `${estado} ${efecto} cap=${conCapacidad} permiso=${conPermiso}`,
            ).toEqual(motivo === null ? OK : rechazo(motivo));
            combinaciones += 1;
          }
        }
      }
    }
    expect(combinaciones).toBe(36);
  });

  it("un módulo no activo da MODULO_NO_ACTIVO para cualquier efecto (no es solo lectura)", () => {
    for (const accion of ["ventas.ver", "ventas.cerrar", "ventas.vender"] as const) {
      expect(evaluar(accion, ventasEn("NO_ACTIVO")), accion).toEqual(rechazo("MODULO_NO_ACTIVO"));
    }
  });

  it("un módulo activo opera con los tres efectos", () => {
    for (const accion of ["ventas.ver", "ventas.cerrar", "ventas.vender"] as const) {
      expect(evaluar(accion, ventasEn("ACTIVO")), accion).toEqual(OK);
    }
  });

  it("omitir modulosEnSoloLectura equivale a un conjunto vacío (los llamadores actuales no cambian)", () => {
    const sinEl = datos({ modulosActivos: new Set<Modulo>(["base", "ventas"]) });
    expect("modulosEnSoloLectura" in sinEl).toBe(false);
    expect(evaluarGuard(REGLAS, "ventas.vender", sinEl)).toEqual(OK);
    expect(
      evaluarGuard(REGLAS, "ventas.vender", { ...sinEl, modulosEnSoloLectura: new Set<Modulo>() }),
    ).toEqual(OK);
  });

  it("estar en solo lectura solo afecta al módulo que lo está", () => {
    expect(evaluar("base.abrir", { ...ventasEn("SOLO_LECTURA"), rol: "GERENTE" })).toEqual(OK);
    expect(evaluar("ventas.vender", { modulosEnSoloLectura: new Set<Modulo>(["base"]) })).toEqual(
      OK,
    );
  });

  it("si un módulo figura activo y en solo lectura a la vez, gana el más restrictivo", () => {
    const ambos = {
      modulosActivos: new Set<Modulo>(["base", "ventas"]),
      modulosEnSoloLectura: new Set<Modulo>(["ventas"]),
    };
    expect(evaluar("ventas.vender", ambos)).toEqual(rechazo("MODULO_EN_SOLO_LECTURA"));
    expect(evaluar("ventas.cerrar", ambos)).toEqual(OK);
  });

  it("un módulo solo en la lista de solo lectura (sin figurar activo) opera como solo lectura, no como inactivo", () => {
    const soloEnLaLista = {
      modulosActivos: new Set<Modulo>(["base"]),
      modulosEnSoloLectura: new Set<Modulo>(["ventas"]),
    };
    expect(evaluar("ventas.ver", soloEnLaLista)).toEqual(OK);
    expect(evaluar("ventas.vender", soloEnLaLista)).toEqual(rechazo("MODULO_EN_SOLO_LECTURA"));
  });

  it("el núcleo (módulo obligatorio) nunca entra en solo lectura: el guard ignora ese estado", () => {
    const base = {
      modulosActivos: new Set<Modulo>(["base", "ventas"]),
      modulosEnSoloLectura: new Set<Modulo>(["base"]),
    };
    expect(evaluar("base.abrir", base)).toEqual(OK);
    expect(evaluar("base.pesar", { ...base, rol: "OPERADOR" })).toEqual(OK);
  });

  it("el núcleo fuera de los activos sigue dando MODULO_NO_ACTIVO aunque figure en solo lectura", () => {
    expect(
      evaluar("base.abrir", {
        modulosActivos: new Set<Modulo>(),
        modulosEnSoloLectura: new Set<Modulo>(["base"]),
      }),
    ).toEqual(rechazo("MODULO_NO_ACTIVO"));
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
        acciones: { toString: { capacidad: null, efecto: "LECTURA" } },
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
        acciones: {
          "central.ver": { capacidad: null, efecto: "LECTURA" },
          "central.cerrar": { capacidad: null, efecto: "LECTURA" },
        },
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
