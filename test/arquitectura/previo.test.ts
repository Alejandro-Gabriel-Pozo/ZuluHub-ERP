import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `npm run previo` (`arquitectura/previo.cjs`) reproduce en local lo que más veces puso en rojo al CI por olvido: tipos, formato, lint,
 * código muerto (knip), arquitectura completa (el comando, los controles contra la rama base y las pruebas de `test/arquitectura`) y composición, y
 * después las pruebas de lo que cambió. Dueño, 26/11/2026 («Sí a las dos, a tu
 * recomendación»). Previene: 26 ejecuciones rojas del CI en dos días, entre ellas «Estático» por un tipo exportado sin uso (knip) y por
 * arquitectura y composición no corridas (#612 en 4 rondas, #621, #603). Esta prueba falla si el script `previo` no existe, si le falta
 * alguno de esos pasos, si los corre en otro orden o si un paso apunta a un script que ya no existe. La lista de pasos esperados es LITERAL
 * acá, a propósito: si saliera del propio script, quitar un paso y quitarlo de la lista serían un solo cambio.
 * LÍMITE: comprueba que los pasos están declarados y en orden, no que un desarrollador los corra; eso lo pide CLAUDE.md («Antes de entregar»).
 */
const RAIZ = join(import.meta.dirname, "../..");
const require = createRequire(import.meta.url);
const previo = require("../../arquitectura/previo.cjs") as {
  PASOS_FIJOS: { id: string; comando: string[] }[];
  planDeLasPruebas: (entrada: {
    archivos: string[] | null;
    modulo?: string;
    modulosExistentes: string[];
  }) => { tipo: string; [clave: string]: unknown };
  comandosDelPlan: (plan: { tipo: string; [clave: string]: unknown }) => string[][];
};

const PASOS_ESPERADOS = [
  "tipos",
  "formato",
  "lint",
  "codigo-muerto",
  "arquitectura",
  "arquitectura-con-la-base",
  "pruebas-de-arquitectura",
  "composicion",
] as const;
const SCRIPT_ESPERADO = "node arquitectura/previo.cjs";

interface Paso {
  id: string;
  comando: string[];
}

/** Lo que está mal en un `previo` (el script de `package.json` y sus pasos). Vacío = bien. */
function problemas(scripts: Record<string, string>, pasos: Paso[]): string[] {
  const salida: string[] = [];
  if (scripts["previo"] !== SCRIPT_ESPERADO) {
    salida.push(`package.json tiene que declarar "previo": "${SCRIPT_ESPERADO}"`);
  }
  const ids = pasos.map((p) => p.id);
  for (const esperado of PASOS_ESPERADOS) {
    if (!ids.includes(esperado)) salida.push(`falta el paso «${esperado}»`);
  }
  const presentes = ids.filter((i) => (PASOS_ESPERADOS as readonly string[]).includes(i));
  const enOrden = PASOS_ESPERADOS.filter((e) => presentes.includes(e));
  if (presentes.join() !== enOrden.join()) {
    salida.push(`los pasos están en otro orden (esperado: ${PASOS_ESPERADOS.join(" > ")})`);
  }
  for (const paso of pasos) {
    const [bin, sub, nombre] = paso.comando;
    if (bin === "npm" && sub === "run" && (nombre === undefined || scripts[nombre] === undefined)) {
      salida.push(`el paso «${paso.id}» corre el script inexistente «${nombre ?? ""}»`);
    }
  }
  return salida;
}

const SCRIPTS = (
  JSON.parse(readFileSync(join(RAIZ, "package.json"), "utf8")) as {
    scripts: Record<string, string>;
  }
).scripts;

describe("npm run previo", () => {
  it("el script y sus pasos reales cumplen lo exigido", () => {
    expect(problemas(SCRIPTS, previo.PASOS_FIJOS)).toEqual([]);
  });

  it("los pasos apuntan a scripts y a carpetas que existen", () => {
    const composicion = previo.PASOS_FIJOS.find((p) => p.id === "composicion");
    expect(composicion?.comando).toContain("src/composicion");
    expect(existsSync(join(RAIZ, "src/composicion"))).toBe(true);
    expect(existsSync(join(RAIZ, "arquitectura/previo.cjs"))).toBe(true);
    const conLaBase = previo.PASOS_FIJOS.find((p) => p.id === "arquitectura-con-la-base");
    expect(conLaBase?.comando).toEqual(["node", "arquitectura/previo.cjs", "--con-la-base"]);
    const deArquitectura = previo.PASOS_FIJOS.find((p) => p.id === "pruebas-de-arquitectura");
    expect(deArquitectura?.comando).toContain("test/arquitectura");
  });

  describe("violaciones inyectadas", () => {
    it("sin el script `previo` falla", () => {
      const sin = Object.fromEntries(Object.entries(SCRIPTS).filter(([n]) => n !== "previo"));
      expect(problemas(sin, previo.PASOS_FIJOS)).toEqual([
        `package.json tiene que declarar "previo": "${SCRIPT_ESPERADO}"`,
      ]);
    });

    it.each(PASOS_ESPERADOS)("sin el paso «%s» falla", (id) => {
      const sin = previo.PASOS_FIJOS.filter((p) => p.id !== id);
      expect(problemas(SCRIPTS, sin)).toEqual([`falta el paso «${id}»`]);
    });

    it("con los pasos en otro orden falla", () => {
      const [primero, ...resto] = previo.PASOS_FIJOS;
      const girado = [...resto, primero as Paso];
      expect(problemas(SCRIPTS, girado)).toEqual([
        `los pasos están en otro orden (esperado: ${PASOS_ESPERADOS.join(" > ")})`,
      ]);
    });

    it("con un paso que corre un script inexistente falla", () => {
      const roto = previo.PASOS_FIJOS.map((p) =>
        p.id === "codigo-muerto" ? { ...p, comando: ["npm", "run", "no-existe"] } : p,
      );
      expect(problemas(SCRIPTS, roto)).toEqual([
        "el paso «codigo-muerto» corre el script inexistente «no-existe»",
      ]);
    });

    it("sin el script analizar:muerto en package.json, el paso de knip falla", () => {
      const sin = Object.fromEntries(
        Object.entries(SCRIPTS).filter(([n]) => n !== "analizar:muerto"),
      );
      expect(problemas(sin, previo.PASOS_FIJOS)).toEqual([
        "el paso «codigo-muerto» corre el script inexistente «analizar:muerto»",
      ]);
    });
  });
});

describe("pruebas que corre previo", () => {
  const modulosExistentes = ["caja", "stock", "ventas"];

  it("con un módulo indicado corre las pruebas de ese módulo", () => {
    const plan = previo.planDeLasPruebas({ archivos: null, modulo: "stock", modulosExistentes });
    expect(plan).toEqual({ tipo: "modulo", modulo: "stock", filtro: "src/modulos/stock/" });
    expect(previo.comandosDelPlan(plan)).toEqual([
      ["npx", "vitest", "run", "--project", "node", "src/modulos/stock/"],
    ]);
  });

  it("un módulo que no existe no se acepta (no corre nada en silencio)", () => {
    const plan = previo.planDeLasPruebas({ archivos: null, modulo: "stok", modulosExistentes });
    expect(plan.tipo).toBe("no-inferible");
    expect(previo.comandosDelPlan(plan)).toEqual([]);
  });

  it("sin diff calculable lo dice y no corre nada", () => {
    const plan = previo.planDeLasPruebas({ archivos: null, modulosExistentes });
    expect(plan.tipo).toBe("no-inferible");
  });

  it("el código de src y test se corre por `vitest related` (incluye las integraciones que lo consumen)", () => {
    const plan = previo.planDeLasPruebas({
      archivos: ["src/modulos/caja/publico.ts", "test/integracion/caja-x.test.ts", "README.md"],
      modulosExistentes,
    });
    expect(previo.comandosDelPlan(plan)).toEqual([
      [
        "npx",
        "vitest",
        "related",
        "--run",
        "--project",
        "node",
        "--passWithNoTests",
        "src/modulos/caja/publico.ts",
        "test/integracion/caja-x.test.ts",
      ],
    ]);
  });

  it("un diff sin código de src ni de test no tiene pruebas que inferir", () => {
    const plan = previo.planDeLasPruebas({ archivos: ["docs/nota.md"], modulosExistentes });
    expect(plan.tipo).toBe("nada");
    expect(previo.comandosDelPlan(plan)).toEqual([]);
  });

  it("tocar apps/ avisa que los componentes y el recorrido no los corre previo", () => {
    const plan = previo.planDeLasPruebas({
      archivos: ["apps/web/ui/Boton.tsx"],
      modulosExistentes,
    });
    expect(plan.tipo).toBe("nada");
    expect(plan["aviso"]).toEqual([expect.stringContaining("test:componentes")]);
  });
});
