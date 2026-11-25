import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CAMPOS_OBLIGATORIOS,
  codeqlSoloHaciaMain,
  copiasDeEstabilidad,
  fechaEnMs,
  gruposSensiblesSinMarca,
  problemasDeLasRutas,
  problemasDelCiLiviano,
  problemasDelRegistro,
  problemasDelWorkflow,
} from "./relajaciones-de-pruebas-apoyo.ts";

const require = createRequire(import.meta.url);
const RAIZ = join(import.meta.dirname, "../..");
const leerJson = (ruta: string): unknown => JSON.parse(readFileSync(join(RAIZ, ruta), "utf8"));

const { cargarLosGrupos } = require("../../arquitectura/grupos-de-mutacion.cjs") as {
  cargarLosGrupos: (raiz: string) => { grupos: { id: string; critico?: true; archivos: string }[] };
};
const { expandir } = require("../../arquitectura/planificar-mutacion.cjs") as {
  expandir: (patrones: string, raiz: string) => string[];
};

/**
 * El contador de relajaciones de pruebas (dueño, 25/11/2026: «ser más flexible para llegar al objetivo, con un contador de deuda; el cliente tendrá 1 o 2 personas
 * operando por sucursal como máximo»). Todo lo que se corre menos de lo que el CI podría correr está en `arquitectura/deuda/relajaciones-de-pruebas.json`, con quién
 * lo decidió, por qué, cuándo se restaura y hasta cuándo vale sin revisar. Previene: recortes del CI que nadie recuerda ni revisa cuando cambia la escala (el
 * cliente deja de ser de 1 o 2 personas por sucursal). Cada caso de abajo es una violación inyectada: si se debilita el verificador, esta prueba se pone roja.
 */
const HOY = "2026-11-25";
const BUENA = {
  id: "una-relajacion",
  estado: "VIGENTE",
  que: "algo que se corre menos",
  donde: ".github/workflows/ci.yml",
  motivo: "ahorra tiempo",
  decidio: "dueño, 2026-11-25",
  fecha: "2026-11-25",
  restaurar_si: "más de 2 personas por sucursal",
  revisar_antes_de: "2027-02-23",
};
const registro = (...relajaciones: unknown[]) => ({ relajaciones });
const problemas = (...relajaciones: unknown[]) =>
  problemasDelRegistro(registro(...relajaciones), HOY);

const CI_BASE = (pr: string, resto: string) =>
  `        corrida: \${{ fromJSON(github.event_name == 'pull_request' && '${pr}' || '${resto}') }}`;
const DOCE = "[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]";
const ESTABILIDAD = (valor: number, estado = "VIGENTE") => ({
  ...BUENA,
  id: "estabilidad-reducida-en-pr",
  estado,
  valor,
});

describe("el registro de relajaciones: forma", () => {
  it("una relajación bien formada no tiene problemas", () => {
    expect(problemas(BUENA)).toEqual([]);
    expect(problemas({ ...BUENA, valor: 1 })).toEqual([]);
  });

  it("falta un campo: falla nombrando el campo", () => {
    for (const campo of CAMPOS_OBLIGATORIOS) {
      const sin: Record<string, unknown> = { ...BUENA };
      delete sin[campo];
      expect(problemas(sin).join("\n"), campo).toContain(`falta «${campo}».`);
    }
  });

  it("un campo de más falla (lista de permitidos)", () => {
    expect(problemas({ ...BUENA, extra: 1 })).toEqual([
      "«una-relajacion»: «extra» no es un campo permitido.",
    ]);
  });

  it("un texto vacío, de más de 400 caracteres o que no es un texto falla", () => {
    for (const campo of ["que", "donde", "motivo", "restaurar_si"]) {
      for (const valor of ["", "   ", 5, "x".repeat(401)]) {
        expect(
          problemas({ ...BUENA, [campo]: valor }).join("\n"),
          `${campo}=${String(valor).slice(0, 5)}`,
        ).toContain(`«${campo}» tiene que ser un texto no vacío`);
      }
    }
  });

  it("`estado` fuera de VIGENTE y RESTAURADA falla", () => {
    for (const estado of ["vigente", "PENDIENTE", "", 1]) {
      expect(problemas({ ...BUENA, estado }).join("\n"), String(estado)).toContain(
        "«estado» tiene que ser VIGENTE o RESTAURADA",
      );
    }
  });

  it("`decidio` sin quién y cuándo, o con otra fecha que `fecha`, falla", () => {
    for (const decidio of ["", "dueño", "el equipo, 2026-11-25", "dueño, 25/11/2026", 3]) {
      expect(problemas({ ...BUENA, decidio }).join("\n"), String(decidio)).toContain(
        "«decidio» tiene que ser «dueño, AAAA-MM-DD»",
      );
    }
    expect(problemas({ ...BUENA, decidio: "dueño, 2026-11-24" })).toEqual([
      "«una-relajacion»: la fecha de «decidio» tiene que ser la misma que «fecha».",
    ]);
  });

  it("una fecha mal escrita o que no existe falla; una futura también", () => {
    for (const fecha of ["2026-13-01", "2026-02-30", "25-11-2026", "", 5]) {
      expect(problemas({ ...BUENA, fecha }).join("\n"), String(fecha)).toContain(
        "«fecha» tiene que ser una fecha AAAA-MM-DD.",
      );
    }
    for (const revisar of ["2027-02-30", "mañana", 5]) {
      expect(
        problemas({ ...BUENA, revisar_antes_de: revisar }).join("\n"),
        String(revisar),
      ).toContain("«revisar_antes_de» tiene que ser una fecha AAAA-MM-DD.");
    }
    expect(
      problemasDelRegistro(
        registro({
          ...BUENA,
          decidio: "dueño, 2026-12-25",
          fecha: "2026-12-25",
          revisar_antes_de: "2027-02-01",
        }),
        HOY,
      ),
    ).toEqual(["«una-relajacion»: «fecha» no puede ser futura."]);
  });

  it("la revisión tiene que ser posterior a la fecha y a no más de 90 días", () => {
    expect(problemas({ ...BUENA, revisar_antes_de: "2026-11-25" })).toEqual([
      "«una-relajacion»: «revisar_antes_de» tiene que ser posterior a «fecha».",
    ]);
    expect(problemas({ ...BUENA, revisar_antes_de: "2027-02-23" })).toEqual([]); // 90 días justos
    expect(problemas({ ...BUENA, revisar_antes_de: "2027-02-24" })).toEqual([
      "«una-relajacion»: «revisar_antes_de» pasa de 90 días desde «fecha».",
    ]);
  });

  it("una relajación VIGENTE con la revisión vencida falla; una RESTAURADA no", () => {
    const vencida = {
      ...BUENA,
      fecha: "2026-08-01",
      decidio: "dueño, 2026-08-01",
      revisar_antes_de: "2026-10-30",
    };
    expect(problemas(vencida)).toEqual([
      "«una-relajacion»: la revisión venció el 2026-10-30: se renueva con el dueño o se restaura.",
    ]);
    expect(problemas({ ...vencida, estado: "RESTAURADA" })).toEqual([]);
    expect(
      problemasDelRegistro(registro({ ...BUENA, revisar_antes_de: "2026-12-01" }), "2026-12-01"),
    ).toEqual([]);
    expect(
      problemasDelRegistro(registro({ ...BUENA, revisar_antes_de: "2026-12-01" }), "2026-12-02"),
    ).toHaveLength(1);
  });

  it("`valor` tiene que ser un entero mayor que cero", () => {
    for (const valor of [0, -1, 1.5, "3", null]) {
      expect(problemas({ ...BUENA, valor }).join("\n"), String(valor)).toContain(
        "«valor» tiene que ser un entero mayor que cero.",
      );
    }
  });

  it("un id repetido, mal escrito o un registro que no es el esperado falla", () => {
    expect(problemas(BUENA, BUENA)).toEqual(["«una-relajacion»: el id está repetido."]);
    expect(problemas({ ...BUENA, id: "Una Relajación" }).join("\n")).toContain(
      "«id» tiene que ser minúsculas, números y guiones",
    );
    for (const malo of [
      null,
      [],
      { relajaciones: [] },
      { relajaciones: "x" },
      { otra: [BUENA] },
      { relajaciones: [BUENA], extra: 1 },
      { relajaciones: [5] },
    ]) {
      expect(problemasDelRegistro(malo, HOY), JSON.stringify(malo)).not.toEqual([]);
    }
  });

  it("`fechaEnMs` solo acepta fechas que existen", () => {
    expect(fechaEnMs("2026-11-25")).toBe(Date.parse("2026-11-25T00:00:00Z"));
    for (const mala of ["2026-02-29", "2026-00-10", "2026-1-1", "", null, 20261125])
      expect(fechaEnMs(mala), String(mala)).toBeNull();
  });
});

describe("lo que el workflow recorta tiene que figurar en el registro", () => {
  it("lee las copias de Estabilidad de un pull request y del resto", () => {
    expect(copiasDeEstabilidad(CI_BASE("[1, 2, 3]", DOCE))).toEqual({ enPr: 3, enElResto: 12 });
    expect(copiasDeEstabilidad(CI_BASE("[1]", DOCE))).toEqual({ enPr: 1, enElResto: 12 });
  });

  it("si el workflow cambia de forma o la lista no es 1..N, falla cerrado (no se lee)", () => {
    expect(copiasDeEstabilidad("sin matriz")).toBeNull();
    expect(copiasDeEstabilidad(CI_BASE("[1, 3]", DOCE))).toBeNull();
    expect(copiasDeEstabilidad(CI_BASE("[]", DOCE))).toBeNull();
    expect(problemasDelWorkflow("sin matriz", registro(ESTABILIDAD(3)))[0]).toContain(
      "no se pudo leer",
    );
  });

  it("copias reducidas en el pull request con su entrada VIGENTE y el mismo valor: sin problemas", () => {
    expect(problemasDelWorkflow(CI_BASE("[1, 2, 3]", DOCE), registro(ESTABILIDAD(3)))).toEqual([]);
    expect(problemasDelWorkflow(CI_BASE("[1]", DOCE), registro(ESTABILIDAD(1)))).toEqual([]);
  });

  it("VIOLACIÓN: el workflow recorta y no hay entrada", () => {
    expect(problemasDelWorkflow(CI_BASE("[1]", DOCE), registro(BUENA))[0]).toContain(
      "no figura «estabilidad-reducida-en-pr» en el registro",
    );
  });

  it("VIOLACIÓN: el workflow recorta y la entrada está RESTAURADA", () => {
    expect(
      problemasDelWorkflow(CI_BASE("[1]", DOCE), registro(ESTABILIDAD(1, "RESTAURADA")))[0],
    ).toContain("no está VIGENTE");
  });

  it("VIOLACIÓN: el workflow vuelve a las 3 copias y el registro sigue diciendo 1", () => {
    expect(problemasDelWorkflow(CI_BASE("[1, 2, 3]", DOCE), registro(ESTABILIDAD(1)))[0]).toContain(
      "el registro dice 1",
    );
  });

  it("VIOLACIÓN: el workflow baja a 1 y el registro sigue diciendo 3", () => {
    expect(problemasDelWorkflow(CI_BASE("[1]", DOCE), registro(ESTABILIDAD(3)))[0]).toContain(
      "el registro dice 3",
    );
  });

  it("restaurar: el workflow corre las 12 en el pull request y la entrada tiene que estar RESTAURADA", () => {
    expect(problemasDelWorkflow(CI_BASE(DOCE, DOCE), registro(ESTABILIDAD(3)))[0]).toContain(
      "no está marcada RESTAURADA",
    );
    expect(
      problemasDelWorkflow(CI_BASE(DOCE, DOCE), registro(ESTABILIDAD(3, "RESTAURADA"))),
    ).toEqual([]);
    expect(problemasDelWorkflow(CI_BASE(DOCE, DOCE), registro(BUENA))).toEqual([]);
  });
});

describe("un grupo de mutación que muta rutas sensibles tiene que ser crítico", () => {
  const RUTAS = ["^src/primitivas/dinero/", "^src/modulos/caja/"];
  const grupo = (id: string, expandidos: string[], critico?: true) => ({
    id,
    expandidos,
    ...(critico === undefined ? {} : { critico }),
  });

  it("un grupo crítico, o uno que no toca rutas sensibles, no se marca", () => {
    expect(
      gruposSensiblesSinMarca(
        [grupo("a", ["src/primitivas/dinero/x.ts"], true), grupo("b", ["src/otra/x.ts"])],
        RUTAS,
      ),
    ).toEqual([]);
  });

  it("VIOLACIÓN: un grupo nuevo de dinero sin `critico: true`", () => {
    expect(
      gruposSensiblesSinMarca([grupo("dinero-nuevo", ["src/primitivas/dinero/x.ts"])], RUTAS),
    ).toEqual([{ id: "dinero-nuevo", archivo: "src/primitivas/dinero/x.ts" }]);
  });

  it("VIOLACIÓN: basta UN archivo sensible entre varios, y el rango de líneas no lo esconde", () => {
    expect(
      gruposSensiblesSinMarca(
        [grupo("mixto", ["src/otra/a.ts", "src/modulos/caja/dominio/y.ts:1-50"])],
        RUTAS,
      ),
    ).toEqual([{ id: "mixto", archivo: "src/modulos/caja/dominio/y.ts" }]);
  });

  it("las reglas de rutas mal formadas fallan", () => {
    expect(problemasDeLasRutas({ rutas: ["^src/a/"] })).toEqual([]);
    for (const malo of [
      null,
      [],
      { rutas: [] },
      { rutas: ["src/a/"] },
      { rutas: [5] },
      { rutas: ["^("] },
      { rutas: ["^a"], extra: 1 },
    ]) {
      expect(problemasDeLasRutas(malo), JSON.stringify(malo)).not.toEqual([]);
    }
  });
});

describe("el CI liviano figura en el registro mientras se aplica", () => {
  const LIVIANO = { ...BUENA, id: "ci-liviano-en-pr-a-integracion" };
  const aplica = { aplicaElPlanificador: true, codeqlSoloHaciaMain: true };
  const noAplica = { aplicaElPlanificador: false, codeqlSoloHaciaMain: false };

  it("aplicado con su entrada VIGENTE y CodeQL solo hacia main: sin problemas; restaurado con la entrada RESTAURADA: sin problemas", () => {
    expect(problemasDelCiLiviano(aplica, registro(LIVIANO))).toEqual([]);
    expect(problemasDelCiLiviano(noAplica, registro({ ...LIVIANO, estado: "RESTAURADA" }))).toEqual(
      [],
    );
    expect(problemasDelCiLiviano(noAplica, registro(BUENA))).toEqual([]);
  });

  it("VIOLACIÓN: el planificador recorta y no hay entrada", () => {
    expect(problemasDelCiLiviano(aplica, registro(BUENA))[0]).toContain(
      "no figura «ci-liviano-en-pr-a-integracion»",
    );
  });

  it("VIOLACIÓN: el planificador recorta y la entrada está RESTAURADA", () => {
    expect(
      problemasDelCiLiviano(aplica, registro({ ...LIVIANO, estado: "RESTAURADA" }))[0],
    ).toContain("no está VIGENTE");
  });

  it("VIOLACIÓN: se restauró el planificador y la entrada sigue VIGENTE", () => {
    expect(problemasDelCiLiviano(noAplica, registro(LIVIANO))[0]).toContain(
      "no está marcada RESTAURADA",
    );
  });

  it("VIOLACIÓN: el CI liviano dice que CodeQL no corre en esos pull requests y codeql.yml sigue corriendo en todos (y a la inversa)", () => {
    expect(
      problemasDelCiLiviano({ ...aplica, codeqlSoloHaciaMain: false }, registro(LIVIANO))[0],
    ).toContain("codeql.yml sigue corriendo en todos");
    expect(
      problemasDelCiLiviano(
        { ...noAplica, codeqlSoloHaciaMain: true },
        registro({ ...LIVIANO, estado: "RESTAURADA" }),
      )[0],
    ).toContain("sigue corriendo solo hacia main");
  });

  it("codeql.yml: solo se reconoce `pull_request:` con `branches: [main]` pegado debajo", () => {
    expect(codeqlSoloHaciaMain("on:\n  pull_request:\n    branches: [main]\n  schedule:\n")).toBe(
      true,
    );
    expect(codeqlSoloHaciaMain("on:\n  pull_request:\n  schedule:\n")).toBe(false);
    expect(codeqlSoloHaciaMain("on:\n  push:\n    branches: [main]\n  pull_request:\n")).toBe(
      false,
    );
  });
});

describe("el repositorio real", () => {
  it("el registro de relajaciones está bien formado y ninguna revisión venció", () => {
    const hoy = new Date().toISOString().slice(0, 10);
    expect(
      problemasDelRegistro(leerJson("arquitectura/deuda/relajaciones-de-pruebas.json"), hoy),
    ).toEqual([]);
  });

  it("el workflow no recorta nada que no figure en el registro (y a la inversa)", () => {
    const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");
    expect(
      problemasDelWorkflow(ci, leerJson("arquitectura/deuda/relajaciones-de-pruebas.json")),
    ).toEqual([]);
  });

  it("el planificador y codeql.yml están de acuerdo con el registro sobre el CI liviano", () => {
    const { BASE_DE_INTEGRACION, perfilDelPullRequest } =
      require("../../arquitectura/planificar-mutacion.cjs") as {
        BASE_DE_INTEGRACION: string;
        perfilDelPullRequest: (e: { evento: string; base: string; origen: string }) => string;
      };
    const codeql = readFileSync(join(RAIZ, ".github/workflows/codeql.yml"), "utf8");
    const entrada = {
      aplicaElPlanificador:
        perfilDelPullRequest({
          evento: "pull_request",
          base: BASE_DE_INTEGRACION,
          origen: "feat/x",
        }) === "liviano",
      codeqlSoloHaciaMain: codeqlSoloHaciaMain(codeql),
    };
    expect(
      problemasDelCiLiviano(entrada, leerJson("arquitectura/deuda/relajaciones-de-pruebas.json")),
    ).toEqual([]);
  });

  it("las reglas de rutas sensibles están bien formadas", () => {
    expect(problemasDeLasRutas(leerJson("arquitectura/rutas-sensibles-de-mutacion.json"))).toEqual(
      [],
    );
  });

  it("ningún grupo de mutación real que mute rutas sensibles queda sin `critico: true`", () => {
    const { rutas } = leerJson("arquitectura/rutas-sensibles-de-mutacion.json") as {
      rutas: string[];
    };
    const grupos = cargarLosGrupos(RAIZ).grupos.map((g) => ({
      ...g,
      expandidos: expandir(g.archivos, RAIZ),
    }));
    expect(grupos.length).toBeGreaterThan(90);
    expect(gruposSensiblesSinMarca(grupos, rutas)).toEqual([]);
  });

  it("los grupos críticos son una parte propia: ni todos ni ninguno", () => {
    const { grupos } = cargarLosGrupos(RAIZ);
    const criticos = grupos.filter((g) => g.critico === true).length;
    expect(criticos).toBeGreaterThan(50);
    expect(criticos).toBeLessThan(grupos.length - 20);
    expect(grupos.filter((g) => g.id.startsWith("guardian-") && g.critico === true)).toEqual([]);
  });
});
