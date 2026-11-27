import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * «Parar la línea» (CLAUDE.md) mira la corrida nocturna de `main`: el `schedule` diario de `ci.yml`. Desde el 26/11/2026 la rama de integración se retira y su workflow
 * `nocturna-de-integracion.yml` se borró: con la rama retirada, un `schedule` que despachara el CI sobre ella fallaría todos los días y taparía una falla real. Esta prueba falla si
 * `ci.yml` pierde su `schedule` diario (la nocturna que respalda lo que un PR recorta) o si reaparece una nocturna de integración, y si `CLAUDE.md` deja de nombrar la nocturna de `main`.
 * LÍMITE: lee texto; que el orquestador mire el resultado cada mañana es proceso.
 */
const RAIZ = join(import.meta.dirname, "../..");

const NOCTURNA_DE_MAIN = /^ {2}schedule:\n(?: {4}#[^\n]*\n)* {4}- cron: "\d+ \d+ \* \* \*"$/m;

/** Lo que está mal en la forma de la nocturna. Vacío = bien. */
function problemas(ci: string, workflows: readonly string[], claude: string): string[] {
  const salida: string[] = [];
  if (!NOCTURNA_DE_MAIN.test(ci)) {
    salida.push(
      "ci.yml no tiene un `schedule` diario: no hay nocturna que respalde lo que un PR recorta",
    );
  }
  if (workflows.some((w) => /nocturna.*integracion|integracion.*nocturna/.test(w))) {
    salida.push("hay un workflow de nocturna de integración: la rama de integración se retiró");
  }
  if (!claude.includes("la nocturna de `main` (`ci.yml`, `schedule` 06:17 UTC")) {
    salida.push("CLAUDE.md no nombra la nocturna de `main` en «Parar la línea»");
  }
  if (!claude.includes("entre las 14:35 y las\n  18:09 UTC (media tarde)")) {
    salida.push("CLAUDE.md no dice que el schedule de GitHub sale a media tarde y no a las 06:17");
  }
  return salida;
}

const CI = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");
const CLAUDE = readFileSync(join(RAIZ, "CLAUDE.md"), "utf8");
const WORKFLOWS = readdirSync(join(RAIZ, ".github/workflows"));

describe("parar la línea mira la nocturna de main", () => {
  it("lo real cumple: ci.yml con su schedule diario, sin nocturna de integración, CLAUDE.md al día", () => {
    expect(problemas(CI, WORKFLOWS, CLAUDE)).toEqual([]);
    expect(existsSync(join(RAIZ, ".github/workflows/nocturna-de-integracion.yml"))).toBe(false);
  });

  it("violación inyectada: ci.yml sin schedule", () => {
    const sin = CI.replace(/^ {2}schedule:\n(?: {4}[^\n]*\n)+/m, "");
    expect(problemas(sin, WORKFLOWS, CLAUDE)).toEqual([
      "ci.yml no tiene un `schedule` diario: no hay nocturna que respalde lo que un PR recorta",
    ]);
  });

  it("violación inyectada: reaparece la nocturna de integración", () => {
    expect(problemas(CI, [...WORKFLOWS, "nocturna-de-integracion.yml"], CLAUDE)).toEqual([
      "hay un workflow de nocturna de integración: la rama de integración se retiró",
    ]);
  });

  it("violación inyectada: CLAUDE.md deja de decir que el schedule sale a media tarde (demora de GitHub)", () => {
    const sinAviso = CLAUDE.replace(
      "entre las 14:35 y las\n  18:09 UTC (media tarde)",
      "a las 06:17",
    );
    expect(problemas(CI, WORKFLOWS, sinAviso)).toEqual([
      "CLAUDE.md no dice que el schedule de GitHub sale a media tarde y no a las 06:17",
    ]);
  });

  it("violación inyectada: CLAUDE.md vuelve a hablar de la nocturna de la rama de integración", () => {
    const viejo = CLAUDE.replace(
      "la nocturna de `main` (`ci.yml`, `schedule` 06:17 UTC",
      "la nocturna",
    );
    expect(problemas(CI, WORKFLOWS, viejo)).toEqual([
      "CLAUDE.md no nombra la nocturna de `main` en «Parar la línea»",
    ]);
  });
});
