import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `apps/web/vercel.json` (web-armazon §5.5): la carpeta raíz del proyecto en Vercel es `apps/web`, y
 * Vercel lee el archivo de ahí. Lo que esta prueba cuida:
 *
 *  - El despliegue automático NO se enciende solo. Encenderlo es una decisión del dueño (CLAUDE.md,
 *    «Infraestructura»), no del código: para encender cualquier rama más hay que cambiar a propósito la
 *    constante de acá abajo, en el mismo cambio, y ese cambio lo revisa una persona. Falla que previene:
 *    un cambio de configuración «de paso» que publica la aplicación (p. ej. producción desde `main`) sin
 *    el visto bueno.
 *  - Decisión del dueño, 2026-11-05 (respuesta directa): despliegue automático encendido SOLO para la rama
 *    de Git `preview`; `main` (producción) y cualquier otra rama quedan apagadas. Fuente de la sintaxis:
 *    https://vercel.com/docs/project-configuration/git-configuration — `deploymentEnabled` acepta un objeto
 *    rama→booleano con globs (minimatch); una rama que no figura se despliega (por defecto es `true`) y,
 *    si coincide con varias reglas, se despliega si AL MENOS UNA es `true`. Por eso lo no declarado se apaga
 *    con la regla `"**": false` y `preview` la supera con su regla exacta `true`.
 *  - El archivo no vuelve a la raíz del repositorio (Vercel lo ignoraría y quedaría una segunda fuente).
 *  - Lo que el archivo declara es exactamente lo justificado en PRIMER-DESPLIEGUE.md: ni un campo más
 *    (por ejemplo, un `installCommand` inventado sin haberlo probado en Vercel).
 */

/** Ramas con el despliegue automático aprobado por el dueño (2026-11-05): solo `preview`. Nombres exactos, sin globs. */
const RAMAS_CON_DESPLIEGUE_APROBADO_POR_EL_DUENO: readonly string[] = ["preview"];

/** Regla que apaga todo lo que no está aprobado (sin ella, Vercel despliega las ramas no listadas). */
const REGLA_APAGAR_TODO = "**";

/** Como Vercel: sin regla que coincida se despliega; con varias, alcanza una `true`. Solo `**` y nombres exactos. */
function seDespliega(rama: string, reglas: Record<string, boolean>): boolean {
  const coinciden = Object.entries(reglas).filter(
    ([clave]) => clave === REGLA_APAGAR_TODO || clave === rama,
  );
  return coinciden.length === 0 || coinciden.some(([, valor]) => valor);
}

const RAIZ = join(import.meta.dirname, "../..");
const ARCHIVO = join(RAIZ, "apps/web/vercel.json");
const configuracion = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Record<string, unknown>;

describe("apps/web/vercel.json", () => {
  it("el despliegue automático coincide con el visto bueno del dueño (hoy: solo la rama preview)", () => {
    const esperado = {
      [REGLA_APAGAR_TODO]: false,
      ...Object.fromEntries(RAMAS_CON_DESPLIEGUE_APROBADO_POR_EL_DUENO.map((rama) => [rama, true])),
    };
    expect(configuracion["git"]).toEqual({ deploymentEnabled: esperado });
  });

  it("main, producción y cualquier otra rama no se despliegan; solo las aprobadas sí", () => {
    const git = configuracion["git"] as { deploymentEnabled: Record<string, boolean> };
    for (const rama of [
      "main",
      "master",
      "production",
      "produccion",
      "feature/x",
      "preview-2",
      "Preview",
    ]) {
      expect(seDespliega(rama, git.deploymentEnabled), rama).toBe(false);
    }
    for (const rama of RAMAS_CON_DESPLIEGUE_APROBADO_POR_EL_DUENO) {
      expect(seDespliega(rama, git.deploymentEnabled), rama).toBe(true);
    }
  });

  it("vive en apps/web (la carpeta raíz del proyecto) y no hay otro en la raíz del repositorio", () => {
    expect(existsSync(join(RAIZ, "vercel.json"))).toBe(false);
    expect(existsSync(ARCHIVO)).toBe(true);
  });

  it("declara solo esquema, región, git y crons: nada de comandos de instalación o de compilación", () => {
    expect(Object.keys(configuracion).sort()).toEqual(["$schema", "crons", "git", "regions"]);
    expect(configuracion["$schema"]).toBe("https://openapi.vercel.sh/vercel.json");
  });

  it("las funciones corren en São Paulo (gru1), y solo ahí", () => {
    expect(configuracion["regions"]).toEqual(["gru1"]);
  });

  it("un solo cron, una vez por día (mientras sea Hobby), contra la ruta autorizada con CRON_SECRET", () => {
    const crons = configuracion["crons"] as { path: string; schedule: string }[];
    expect(crons).toEqual([{ path: "/api/trabajos/cron", schedule: "17 6 * * *" }]);
    // Cinco campos y los de día, mes y día de la semana fijos «*» salvo la hora y el minuto: una vez por día.
    const [minuto, hora, dia, mes, semana] = (crons[0]?.schedule ?? "").split(" ");
    expect([dia, mes, semana]).toEqual(["*", "*", "*"]);
    expect(minuto).toMatch(/^\d+$/);
    expect(hora).toMatch(/^\d+$/);
  });

  it("la ruta del cron existe en la aplicación", () => {
    expect(existsSync(join(RAIZ, "apps/web/app/api/trabajos/cron/route.ts"))).toBe(true);
  });
});
