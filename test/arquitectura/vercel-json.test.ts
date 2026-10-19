import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `apps/web/vercel.json` (web-armazon §5.5): la carpeta raíz del proyecto en Vercel es `apps/web`, y
 * Vercel lee el archivo de ahí. Lo que esta prueba cuida:
 *
 *  - El despliegue automático NO se enciende solo. Encenderlo es una decisión del dueño (CLAUDE.md,
 *    «Infraestructura»), no del código: para cambiar `git.deploymentEnabled` a `true` hay que cambiar a
 *    propósito la constante de acá abajo, en el mismo cambio, y ese cambio lo revisa una persona. Falla
 *    que previene: un cambio de configuración «de paso» que publica la aplicación sin el visto bueno.
 *  - El archivo no vuelve a la raíz del repositorio (Vercel lo ignoraría y quedaría una segunda fuente).
 *  - Lo que el archivo declara es exactamente lo justificado en PRIMER-DESPLIEGUE.md: ni un campo más
 *    (por ejemplo, un `installCommand` inventado sin haberlo probado en Vercel).
 */

/** El dueño dio (o no) el visto bueno al primer despliegue. Sigue en `false` hasta que él lo apruebe. */
const DESPLIEGUE_APROBADO_POR_EL_DUENO = false;

const RAIZ = join(import.meta.dirname, "../..");
const ARCHIVO = join(RAIZ, "apps/web/vercel.json");
const configuracion = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Record<string, unknown>;

describe("apps/web/vercel.json", () => {
  it("el despliegue automático coincide con el visto bueno del dueño (hoy: apagado)", () => {
    expect(DESPLIEGUE_APROBADO_POR_EL_DUENO).toBe(false);
    expect(configuracion["git"]).toEqual({ deploymentEnabled: DESPLIEGUE_APROBADO_POR_EL_DUENO });
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
