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
 *  - Lo que el archivo declara es exactamente lo justificado en PRIMER-DESPLIEGUE.md: ni un campo más.
 *  - `installCommand` (hecho real del primer despliegue, 2026-11-05): con Root Directory `apps/web` Vercel instaló
 *    SOLO las dependencias del workspace («added 33 packages») y `next build` falló con «Module not found»
 *    (asn1js, better-auth, kysely, pg, pkijs, zod, qrcode-generator, fast-xml-parser viven en la raíz). El dueño
 *    lo arregló a mano en el panel y compiló; acá queda en el repositorio para que no dependa de un campo
 *    escondido. Fuente: https://vercel.com/docs/project-configuration/vercel-json — `installCommand` «overrides
 *    the Install Command in Project Settings». `--ignore-scripts`: ninguna dependencia necesaria para compilar
 *    tiene script de instalación (en el lockfile solo `fsevents`, opcional de desarrollo para macOS).
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

/** Instala desde la raíz del repositorio (workspaces) y sin scripts de instalación de terceros. */
const COMANDO_DE_INSTALACION = "cd ../.. && npm ci --ignore-scripts";

const RAIZ = join(import.meta.dirname, "../..");
const ARCHIVO = join(RAIZ, "apps/web/vercel.json");
const configuracion = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Record<string, unknown>;

type Cron = Readonly<{ path: string; schedule: string }>;

const RUTA_DEL_CRON = "/api/trabajos/cron";

/** Los crons aprobados por el dueño (25/11/2026), en UTC. Cambiarlos es una decisión del dueño: se cambia acá a propósito, en el mismo cambio que `vercel.json`. */
const CRONS_APROBADOS_POR_EL_DUENO: readonly Cron[] = [
  { path: RUTA_DEL_CRON, schedule: "*/15 10-16 * * *" },
  { path: RUTA_DEL_CRON, schedule: "0 0,2,4,6,8,17,19,21,23 * * *" },
];

const comoTexto = (c: Cron): string => `${c.path} ${c.schedule}`;

/** Lo que no coincide con los crons aprobados: falta uno, sobra uno, o lo declarado no tiene la forma de `{ path, schedule }`. Lista vacía = bien. Lo que no se puede leer cuenta como problema. */
function problemasDeLosCrons(declarados: unknown): string[] {
  if (!Array.isArray(declarados)) return ["`crons` tiene que ser una lista"];
  const leidos: Cron[] = [];
  const problemas: string[] = [];
  for (const [i, c] of declarados.entries()) {
    const entrada = c as Partial<Cron> | null;
    if (typeof entrada?.path !== "string" || typeof entrada.schedule !== "string") {
      problemas.push(`la entrada ${i} no tiene la forma { path, schedule }`);
      continue;
    }
    leidos.push({ path: entrada.path, schedule: entrada.schedule });
  }
  const declaradas = leidos.map(comoTexto);
  const aprobadas = CRONS_APROBADOS_POR_EL_DUENO.map(comoTexto);
  for (const falta of aprobadas.filter((a) => !declaradas.includes(a))) {
    problemas.push(`falta el cron aprobado «${falta}»`);
  }
  for (const sobra of declaradas.filter((d) => !aprobadas.includes(d))) {
    problemas.push(`sobra o cambió el cron «${sobra}» (no es uno de los aprobados)`);
  }
  if (declaradas.length !== new Set(declaradas).size) problemas.push("hay un cron repetido");
  return problemas;
}

const [CRON_DE_LA_VENTANA, CRON_DEL_RESTO] = CRONS_APROBADOS_POR_EL_DUENO as [Cron, Cron];

/** Cada caso rompe una cosa distinta: sin ellos, la prueba de arriba podría no detectar nada. */
const VIOLACIONES_INYECTADAS: readonly { nombre: string; crons: unknown; contiene: string }[] = [
  { nombre: "sin ningún cron", crons: [], contiene: "falta el cron aprobado" },
  {
    nombre: "se quita el de la ventana",
    crons: [CRON_DEL_RESTO],
    contiene: CRON_DE_LA_VENTANA.schedule,
  },
  {
    nombre: "se quita el de cada 2 horas",
    crons: [CRON_DE_LA_VENTANA],
    contiene: CRON_DEL_RESTO.schedule,
  },
  {
    nombre: "vuelve el cron de cada 5 minutos",
    crons: [{ path: RUTA_DEL_CRON, schedule: "*/5 * * * *" }],
    contiene: "sobra o cambió",
  },
  {
    nombre: "se cambia el path de uno",
    crons: [{ ...CRON_DE_LA_VENTANA, path: "/api/otro" }, CRON_DEL_RESTO],
    contiene: "/api/otro",
  },
  {
    nombre: "se estira la ventana a cada 30 minutos",
    crons: [{ ...CRON_DE_LA_VENTANA, schedule: "*/30 10-16 * * *" }, CRON_DEL_RESTO],
    contiene: "*/30 10-16",
  },
  {
    nombre: "un cron de más",
    crons: [...CRONS_APROBADOS_POR_EL_DUENO, { path: RUTA_DEL_CRON, schedule: "0 12 * * *" }],
    contiene: "0 12 * * *",
  },
  {
    nombre: "un cron repetido",
    crons: [...CRONS_APROBADOS_POR_EL_DUENO, CRON_DE_LA_VENTANA],
    contiene: "repetido",
  },
  {
    nombre: "una entrada sin la forma pedida",
    crons: [CRON_DE_LA_VENTANA, "texto"],
    contiene: "forma",
  },
  { nombre: "crons que no es una lista", crons: { path: RUTA_DEL_CRON }, contiene: "lista" },
];

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

  it("instala desde la raíz del repositorio: sin esto Vercel solo instala el workspace y la compilación falla", () => {
    expect(configuracion["installCommand"]).toBe(COMANDO_DE_INSTALACION);
  });

  it("declara solo esquema, instalación, región, git y crons: ningún comando de compilación", () => {
    expect(Object.keys(configuracion).sort()).toEqual([
      "$schema",
      "crons",
      "git",
      "installCommand",
      "regions",
    ]);
    expect(configuracion["$schema"]).toBe("https://openapi.vercel.sh/vercel.json");
  });

  it("las funciones corren en São Paulo (gru1), y solo ahí", () => {
    expect(configuracion["regions"]).toEqual(["gru1"]);
  });

  // Decisión del dueño, 25/11/2026 (alternativa B del análisis `apps/web/ANALISIS-DEL-CRON.md`; plan Vercel Pro, que admite hasta una vez por minuto): los clientes trabajan de 07:00 a 14:00 de
  // Argentina y, siendo generosos, de 06:00 a 18:00. Los crons de Vercel corren en UTC y Argentina es UTC-3 todo el año, así que la ventana de trabajo (07:00 a 13:45 AR) es 10:00 a 16:45 UTC y el resto
  // del día hay una pasada cada 2 horas (incluida la de las 14:00 AR, 17:00 UTC). Dos entradas al mismo path es lo que documenta Vercel («Managing Cron Jobs»). Previene: que un cambio «de paso» vuelva
  // al cron de cada 5 minutos (que mantiene la base de Neon despierta todo el día), lo estire de modo que un comprobante «Confirmando» espere más de lo decidido (15 minutos en horario de trabajo), o
  // deje un hueco de más de 2 horas sin ninguna pasada. De noche cada pasada gasta un intento de los trabajos que fallan: cinco intentos con pasadas cada 2 horas son ~10 horas hasta darlo por fallido.
  it("dos crons contra la ruta autorizada con CRON_SECRET: cada 15 minutos de 10 a 16 UTC y cada 2 horas el resto del día", () => {
    expect(problemasDeLosCrons(configuracion["crons"])).toEqual([]);
    expect(configuracion["crons"]).toEqual(CRONS_APROBADOS_POR_EL_DUENO);
  });

  it.each(VIOLACIONES_INYECTADAS)(
    "la prueba de los crons detecta: $nombre",
    ({ crons, contiene }) => {
      const problemas = problemasDeLosCrons(crons);
      expect(problemas.length).toBeGreaterThan(0);
      expect(problemas.join("\n")).toContain(contiene);
    },
  );

  it("la ruta del cron existe en la aplicación", () => {
    expect(existsSync(join(RAIZ, "apps/web/app/api/trabajos/cron/route.ts"))).toBe(true);
  });
});
