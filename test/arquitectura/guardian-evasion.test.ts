import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RAIZ_ORIGINAL } from "./guardian-apoyo";
import {
  ARCHIVO_DEL_CATALOGO,
  ARCHIVO_DE_LOS_EXTERNOS,
  VIAS,
  casosSinResultado,
  correrLaBateria,
  evaluarResultado,
  leerCatalogo,
  leerJob,
  leerYaml,
  limpiarContexto,
  prepararContexto,
  validarCatalogo,
  viasSinCasos,
  type Caso,
  type Contexto,
  type Observado,
} from "./guardian-evasion-apoyo";

/**
 * BATERÍA DE EVASIÓN (contratos-arquitectonicos.md §11): cada caso de `arquitectura/contratos/evasiones.json`
 * es un intento de evadir al guardián. Acá se arma, por caso, un repositorio git sintético y sano, se le
 * aplican las operaciones del caso y se corre lo que corre la CI en el job `guardian` (el guardián del cambio
 * y la vigilancia de la versión anterior contra el árbol del cambio). El resultado se compara con el estado
 * del caso:
 *  - `exigido`: el cambio TIENE que bloquearse como dice `esperado`;
 *  - `brecha-abierta` y `riesgo-aceptado`: hoy pasa sin detección y tiene que seguir pasando; si deja de
 *    pasar, el caso se pasa a `exigido` (así el bloqueo queda protegido).
 * Una ruta de evasión nueva es una entrada nueva del catálogo, sin código nuevo (ver `arquitectura/LEEME-evasiones.md`).
 *
 * Los metachequeos E1 a E5 (más abajo) son a la batería lo que M1 a M5 son a la matriz: la batería no puede
 * perder una vía, repetir un id, aceptar un caso sin resultado esperado válido, mezclar campos de estados
 * distintos ni omitir un caso de la corrida.
 */

const require = createRequire(import.meta.url);
const { crearUbicador } = require("../../arquitectura/contratos/ubicacion.cjs") as {
  crearUbicador: (leer: (ruta: string) => Buffer | string | null) => (hallazgo: object) => {
    archivo: string;
    linea: number;
    motivo: string;
    correccion: string;
  };
};

/** Presupuesto de la batería entera en la CI (el plan: 70 repositorios sintéticos en menos de un minuto). */
const PRESUPUESTO_EN_MS = 60_000;

const { texto: TEXTO_DEL_CATALOGO, casos: CASOS } = leerCatalogo();
const { casos: EXTERNOS } = leerCatalogo(ARCHIVO_DE_LOS_EXTERNOS);

let contexto: Contexto;
let resultados: Map<string, Observado | Error>;
let duracionEnMs = 0;

beforeAll(async () => {
  contexto = prepararContexto(CASOS.map((caso) => caso.plantilla ?? "sano"));
  const inicio = Date.now();
  resultados = await correrLaBateria(CASOS, contexto);
  duracionEnMs = Date.now() - inicio;
}, 240_000);

afterAll(() => {
  limpiarContexto(contexto);
});

/** Un hallazgo del catálogo, como lo imprime el guardián: `archivo:línea · motivo · corrección`. */
function comoLinea(hallazgo: object, texto: string = TEXTO_DEL_CATALOGO): string {
  const ubicado = crearUbicador((ruta) => (ruta === ARCHIVO_DEL_CATALOGO ? texto : null))(hallazgo);
  return `${ubicado.archivo}:${ubicado.linea} · ${ubicado.motivo} · ${ubicado.correccion}`;
}

describe("cada caso del catálogo se comporta como su estado dice", () => {
  it.each(CASOS.map((caso, indice) => ({ caso, indice })))(
    "$caso.id · $caso.estado · $caso.via",
    ({ caso, indice }) => {
      const observado = resultados.get(caso.id);
      if (observado === undefined) throw new Error(`${caso.id} no tiene resultado en la corrida`);
      if (observado instanceof Error) {
        throw new Error(`${caso.id}: no se pudo correr el caso: ${observado.message}`);
      }
      const hallazgo = evaluarResultado(caso, indice, observado);
      expect(hallazgo === null ? "en regla" : comoLinea(hallazgo)).toBe("en regla");
    },
  );

  it("la batería entera corre dentro del presupuesto de la CI", () => {
    expect(duracionEnMs).toBeGreaterThan(0);
    expect(duracionEnMs).toBeLessThan(PRESUPUESTO_EN_MS);
  });
});

describe("el catálogo real", () => {
  it("está en regla hoy: forma de cada caso, campos de su estado y vencimientos", () => {
    const { fallas } = validarCatalogo(CASOS, { ahora: new Date() });
    expect(fallas.map((f) => `${f.codigo}: ${f.motivo}`)).toEqual([]);
  });

  it("no se achica: los 73 casos de la auditoría (70 ejecutables y 3 que dependen de GitHub) siguen", () => {
    expect(CASOS.length).toBeGreaterThanOrEqual(70);
    expect(EXTERNOS.map((caso) => caso.id).sort()).toEqual(["EV-047", "EV-048", "EV-052"]);
  });

  it("los 16 controles positivos están exigidos", () => {
    const controles = CASOS.filter((caso) => caso.titulo.startsWith("CONTROL"));
    expect(controles.length).toBeGreaterThanOrEqual(16);
    expect(controles.filter((caso) => caso.estado !== "exigido").map((caso) => caso.id)).toEqual(
      [],
    );
  });

  it("lo que pasa sin detección tiene un responsable, una aprobación y una fecha; nada queda sin dueño", () => {
    for (const caso of CASOS) {
      if (caso.estado === "brecha-abierta") {
        expect(caso["responsable"], caso.id).toBeTruthy();
        expect(caso["vence"], caso.id).toBeTruthy();
      }
      if (caso.estado === "riesgo-aceptado") {
        expect(caso["aprobadoPor"], caso.id).toContain("Dueño");
        expect(caso["revisar"], caso.id).toBeTruthy();
      }
    }
  });
});

describe("los casos que dependen de GitHub (evasiones-github.json): documentados, sin corredor", () => {
  it("son de tipo externo, con su vía y lo que ocurriría, y no se corren", () => {
    for (const caso of EXTERNOS) {
      expect(caso["tipo"], caso.id).toBe("externo");
      expect(caso["estado"], caso.id).toBe("externo");
      expect(VIAS, caso.id).toContain(caso.via);
      expect(caso["queOcurriria"], caso.id).toBeTruthy();
      expect(caso["vigilancia"], caso.id).toBeTruthy();
      expect(resultados.has(caso.id), caso.id).toBe(false);
    }
  });
});

// --- Metachequeos E1 a E5 ---------------------------------------------------------------------------------------

/** Un caso válido y mínimo, para romperlo de a una cosa. */
function caso(cambios: Record<string, unknown> = {}): Caso {
  return {
    id: "EV-900",
    via: "filtros",
    titulo: "Caso de prueba",
    construccion: [],
    controlEsperado: "Lo que lo detecta.",
    esperado: { tipo: "exige-excepcion" },
    estado: "exigido",
    ...cambios,
  };
}
const codigosDe = (casos: unknown, ahora = new Date("2026-10-21T12:00:00Z")): string[] =>
  validarCatalogo(casos, { ahora }).fallas.map((f) => f.codigo);

describe("metachequeos de la batería (E1 a E5)", () => {
  it("E1: cada vía tiene al menos un caso (el catálogo y los casos externos juntos)", () => {
    expect(viasSinCasos([...CASOS, ...EXTERNOS])).toEqual([]);
    // y se nota cuando falta una
    const sinFormato = CASOS.filter((c) => c.via !== "formato-no-soportado");
    expect(viasSinCasos([...sinFormato, ...EXTERNOS])).toEqual(["formato-no-soportado"]);
    expect(viasSinCasos([])).toEqual([...VIAS]);
  });

  it("E2: los ids son únicos y tienen la forma EV-000 (en los dos archivos)", () => {
    const ids = [...CASOS, ...EXTERNOS].map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id).toMatch(/^EV-\d{3}$/);
    expect(codigosDe([caso(), caso()])).toEqual(["evasion-invalida"]);
    expect(codigosDe([caso({ id: "EV-9" })])).toEqual(["evasion-invalida"]);
  });

  it("E3: todo caso tiene un control esperado y un resultado esperado válidos", () => {
    for (const c of CASOS) {
      expect(c.controlEsperado.trim(), c.id).not.toBe("");
      expect(["bloquea", "exige-excepcion"], c.id).toContain(c.esperado.tipo);
    }
    const sinControl = { controlEsperado: undefined };
    expect(codigosDe([{ ...caso(), ...sinControl }])).toEqual(["evasion-invalida"]);
    expect(codigosDe([caso({ esperado: undefined })])).toEqual(["evasion-invalida"]);
    expect(codigosDe([caso({ esperado: { tipo: "bloquea" } })])).toEqual([
      "evasion-invalida",
      "evasion-invalida",
    ]);
    expect(codigosDe([caso({ esperado: { tipo: "nada" } })])).toEqual(["evasion-invalida"]);
  });

  it("E4: un caso exigido no puede traer campos de brecha ni de riesgo", () => {
    for (const c of CASOS.filter((x) => x.estado === "exigido")) {
      expect(
        Object.keys(c).filter((k) =>
          /responsable|severidad|mitigacion|vence|revisar|aprobadoPor/.test(k),
        ),
        c.id,
      ).toEqual([]);
    }
    expect(codigosDe([caso({ vence: "2026-12-20" })])).toEqual(["evasion-invalida"]);
    expect(codigosDe([caso({ revisar: "2027-01-01" })])).toEqual(["evasion-invalida"]);
    expect(codigosDe([caso({ aprobadoPor: "Dueño" })])).toEqual(["evasion-invalida"]);
  });

  it("E5: ningún caso del catálogo queda sin resultado en la corrida", () => {
    expect(casosSinResultado(CASOS, resultados)).toEqual([]);
    expect(resultados.size).toBe(CASOS.length);
    const sinUno = new Map([...resultados].filter(([id]) => id !== CASOS[0]?.id));
    expect(casosSinResultado(CASOS, sinUno)).toEqual([CASOS[0]?.id]);
  });

  it("los casos que no pudieron correrse son un error de la batería, no un resultado", () => {
    for (const [id, resultado] of resultados) {
      expect(resultado instanceof Error ? `${id}: ${resultado.message}` : "ok").toBe("ok");
    }
  });
});

describe("el emulador del job guardian", () => {
  it("lee las claves entrecomilladas, con espacio antes de los dos puntos y los bloques de texto", () => {
    const yaml = [
      "name: x",
      "steps:",
      "  - name: Uno",
      '    "if": false',
      "    run: |",
      "      exit 0",
      "      node a.cjs",
      "  - name: Dos",
      "    if : false",
      "    run: echo hola # comentario",
      "    env:",
      "      A: 1",
    ].join("\n");
    expect(leerYaml(yaml)).toEqual({
      name: "x",
      steps: [
        { name: "Uno", if: false, run: "exit 0\nnode a.cjs\n" },
        { name: "Dos", if: false, run: "echo hola", env: { A: "1" } },
      ],
    });
  });

  it("lee el job guardian del ci.yml real: el guardián, la rama base y la vigilancia, en ese orden", () => {
    const ci = readFileSync(join(RAIZ_ORIGINAL, ".github/workflows/ci.yml"), "utf8");
    const job = leerJob(ci, "guardian") as { steps: Record<string, unknown>[] };
    const pasos = job.steps.map((paso) => `${String(paso["run"] ?? paso["uses"])}`);
    expect(pasos.filter((paso) => paso.includes("guardian.cjs"))).toHaveLength(1);
    const posicion = (texto: string): number => pasos.findIndex((paso) => paso.includes(texto));
    expect(posicion("guardian.cjs")).toBeGreaterThan(-1);
    expect(posicion("guardian.cjs")).toBeLessThan(posicion("no-debilitar.cjs"));
    expect(
      job.steps.some((paso) => (paso["with"] as { path?: string } | undefined)?.path === "base"),
    ).toBe(true);
  });

  it("lanza ante un YAML que no entiende en vez de suponer que pasa", () => {
    expect(() => leerYaml("a: 1\n  b: 2\n")).toThrow(/YAML no soportado/);
  });
});
