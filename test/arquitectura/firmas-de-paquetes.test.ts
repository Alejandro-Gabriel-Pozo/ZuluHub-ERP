import { spawnSync } from "node:child_process";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

/**
 * El paso «Firmas de los paquetes» del job «Seguridad» (`.github/workflows/ci.yml`) repite `npm audit signatures` SOLO cuando el registro de npm contesta mal
 * (`FETCH_ERROR`), UNA sola vez (dueño, 27/11/2026, «Apruebo a y c»). Previene: dejar rojo a todo PR por un error pasajero del registro (23/11/2026: «OK» en vez de JSON, 3 de 5 corridas del día,
 * con `main` verde) SIN aflojar el chequeo: una firma inválida o cualquier otro error sigue fallando de inmediato, y agotados los intentos también falla.
 * La prueba corre el bloque `run:` real del workflow con un `npm` y un `sleep` simulados.
 */

const RAIZ = join(import.meta.dirname, "../..");
const ci = readFileSync(join(RAIZ, ".github/workflows/ci.yml"), "utf8");

/** El texto del `run: |` del paso «Firmas de los paquetes», sin la sangría del YAML. */
function bloqueDelPaso(): string {
  const lineas = ci.split("\n");
  const inicio = lineas.findIndex((linea) => linea.includes("- name: Firmas de los paquetes"));
  expect(inicio).toBeGreaterThanOrEqual(0);
  const corrida = lineas.findIndex((linea, i) => i > inicio && /^\s+run: \|\s*$/.test(linea));
  expect(corrida).toBeGreaterThan(inicio);
  const sangria = (lineas[corrida + 1] ?? "").match(/^\s*/)?.[0].length ?? 0;
  expect(sangria).toBeGreaterThan(0);
  const cuerpo: string[] = [];
  for (const linea of lineas.slice(corrida + 1)) {
    if (linea.trim() !== "" && !linea.startsWith(" ".repeat(sangria))) break;
    cuerpo.push(linea.slice(sangria));
  }
  return cuerpo.join("\n");
}

const carpetas: string[] = [];
afterEach(() => {
  for (const carpeta of carpetas.splice(0)) rmSync(carpeta, { recursive: true, force: true });
});

type Respuesta = { codigo: number; texto: string };

/** Corre el bloque con un `npm` que responde `respuestas` en orden (la última se repite) y cuenta sus llamadas. */
function correr(respuestas: Respuesta[]): {
  codigo: number | null;
  llamadas: number;
  argumentos: string[];
  salida: string;
} {
  const carpeta = mkdtempSync(join(tmpdir(), "firmas-"));
  carpetas.push(carpeta);
  const bin = join(carpeta, "bin");
  mkdirSync(bin);
  respuestas.forEach((r, i) => {
    writeFileSync(join(carpeta, `r${i}.txt`), r.texto);
    writeFileSync(join(carpeta, `c${i}`), String(r.codigo));
  });
  writeFileSync(
    join(bin, "npm"),
    `#!/bin/bash
cuenta="${carpeta}/cuenta"
n=$(cat "$cuenta" 2>/dev/null || echo 0)
echo $((n + 1)) > "$cuenta"
echo "$@" >> "${carpeta}/argumentos"
i=$n
if [ "$i" -ge ${respuestas.length} ]; then i=${respuestas.length - 1}; fi
cat "${carpeta}/r$i.txt"
exit "$(cat "${carpeta}/c$i")"
`,
  );
  writeFileSync(join(bin, "sleep"), "#!/bin/bash\nexit 0\n");
  chmodSync(join(bin, "npm"), 0o755);
  chmodSync(join(bin, "sleep"), 0o755);
  const guion = join(carpeta, "paso.sh");
  writeFileSync(guion, bloqueDelPaso());
  const resultado = spawnSync("bash", ["-e", guion], {
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}`, RUNNER_TEMP: carpeta },
  });
  let llamadas: number;
  try {
    llamadas = Number(readFileSync(join(carpeta, "cuenta"), "utf8"));
  } catch {
    llamadas = 0;
  }
  let argumentos: string[];
  try {
    argumentos = readFileSync(join(carpeta, "argumentos"), "utf8").trim().split("\n");
  } catch {
    argumentos = [];
  }
  return {
    codigo: resultado.status,
    llamadas,
    argumentos,
    salida: resultado.stdout + resultado.stderr,
  };
}

const BIEN: Respuesta = { codigo: 0, texto: "audited 495 packages\n" };
const ERROR_DE_RED: Respuesta = {
  codigo: 1,
  texto:
    'npm error code FETCH_ERROR\nnpm error invalid json response body ... "OK\n" is not valid JSON\n',
};
const FIRMA_INVALIDA: Respuesta = {
  codigo: 1,
  texto: "1 package has an invalid registry signature:\n  evil@1.0.0\n",
};

describe("firmas de los paquetes: reintento solo del error de red", () => {
  it("sin error: una sola llamada y pasa", () => {
    const r = correr([BIEN]);
    expect(r.codigo).toBe(0);
    expect(r.llamadas).toBe(1);
  });

  it("un error de red pasajero se repite una vez y después pasa", () => {
    const r = correr([ERROR_DE_RED, BIEN]);
    expect(r.codigo).toBe(0);
    expect(r.llamadas).toBe(2);
  });

  it("un error de red que no se va falla tras exactamente 2 intentos (un solo reintento)", () => {
    const r = correr([ERROR_DE_RED]);
    expect(r.codigo).not.toBe(0);
    expect(r.llamadas).toBe(2);
  });

  it("cada intento usa una caché de npm distinta y limpia (la misma respuesta mala no se vuelve a leer)", () => {
    const r = correr([ERROR_DE_RED]);
    expect(r.argumentos).toHaveLength(2);
    const caches = r.argumentos.map((a) => a.match(/--cache (\S+)/)?.[1]);
    expect(caches.every((c) => typeof c === "string")).toBe(true);
    expect(new Set(caches).size).toBe(2);
    expect(r.argumentos.every((a) => a.startsWith("audit signatures"))).toBe(true);
  });

  it("una firma inválida falla de inmediato, sin repetir", () => {
    const r = correr([FIRMA_INVALIDA, BIEN]);
    expect(r.codigo).not.toBe(0);
    expect(r.llamadas).toBe(1);
    expect(r.salida).toContain("invalid registry signature");
  });

  it("un error de red seguido de una firma inválida falla en la segunda llamada, sin un tercer intento", () => {
    const r = correr([ERROR_DE_RED, FIRMA_INVALIDA, BIEN]);
    expect(r.codigo).not.toBe(0);
    expect(r.llamadas).toBe(2);
  });
});
