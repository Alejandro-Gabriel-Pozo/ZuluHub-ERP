import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * `.github/workflows/migrar.yml` (web-armazon §5.7): la única forma en que las migraciones llegan a una base
 * real. Corre con secretos de la base y como el dueño de la base, así que estas propiedades lo mantienen
 * seguro; si alguien las quita, esta prueba se pone roja. Es una lectura del texto del archivo (no hay un lector
 * de YAML entre las dependencias); `zizmor` (job «flujos» del CI) revisa el resto. Complementa a
 * `workflow-migrar-base.test.ts`, que cuida el workflow anterior.
 */

const TEXTO = readFileSync(join(import.meta.dirname, "../../.github/workflows/migrar.yml"), "utf8");
const LINEAS = TEXTO.split("\n");
const SIN_COMENTARIOS = LINEAS.filter((l) => !l.trim().startsWith("#")).join("\n");

/** Los pasos del job `migrar`, en orden: nombre y texto. */
function pasos(): { nombre: string; texto: string }[] {
  const desde = TEXTO.indexOf("\n  migrar:\n");
  const resto = TEXTO.slice(desde);
  return resto
    .split(/\n {6}- /)
    .slice(1)
    .map((bloque) => {
      const nombre = /name: (.+)/.exec(bloque)?.[1] ?? /uses: (\S+)/.exec(bloque)?.[1] ?? "";
      return { nombre, texto: bloque };
    });
}
const paso = (parte: string) => {
  const encontrado = pasos().find((p) => p.nombre.includes(parte));
  if (encontrado === undefined) throw new Error(`no hay un paso que diga «${parte}»`);
  return encontrado;
};

describe("workflow migrar.yml", () => {
  it("solo se dispara a mano: sin push, pull request, cron ni otro disparador", () => {
    expect(TEXTO).toMatch(/^on:\n {2}workflow_dispatch:/m);
    const disparadores =
      /^ {2}(push|pull_request|pull_request_target|schedule|workflow_run|release|issues|issue_comment|repository_dispatch):/m;
    expect(TEXTO).not.toMatch(disparadores);
    const dentroDeOn = TEXTO.slice(TEXTO.indexOf("on:\n"), TEXTO.indexOf("\npermissions:"));
    expect(dentroDeOn.match(/^ {2}[a-z_]+:/gm)).toEqual(["  workflow_dispatch:"]);
  });

  it("los ambientes son exactamente preview y produccion", () => {
    const opciones = TEXTO.slice(TEXTO.indexOf("      ambiente:"), TEXTO.indexOf("      accion:"));
    expect(opciones.match(/^ {10}- (\w+)$/gm)).toEqual([
      "          - preview",
      "          - produccion",
    ]);
  });

  it("solo corre desde main, y lo verifica ANTES de entregar los secretos", () => {
    expect(TEXTO).toContain('[ "$REF" != "refs/heads/main" ]');
    expect(TEXTO).toContain("REF: ${{ github.ref }}");
    // `github.event.repository.fork` dice si ESTE repositorio es un fork, no quién corre: no protege nada.
    // La protección de fondo es «Deployment branches: solo main» en los Environments (PRIMER-DESPLIEGUE.md, B.1).
    expect(TEXTO).not.toContain("repository.fork");
    expect(TEXTO).not.toContain("ES_FORK");
    // El job con los secretos espera al que valida, y no hay otro job.
    expect(TEXTO).toMatch(/\n {2}migrar:\n(?:.*\n)*? {4}needs: validar\n/);
    expect(TEXTO.match(/^ {2}[a-z]+:$/gm)).toEqual(["  validar:", "  migrar:"]);
  });

  it("aplicar exige la frase exacta de cada ambiente; ver no", () => {
    expect(TEXTO).toContain('preview) esperado="MIGRAR PREVIEW" ;;');
    expect(TEXTO).toContain('produccion) esperado="MIGRAR PRODUCCION" ;;');
    expect(TEXTO).toContain('[ "$CONFIRMACION" != "$esperado" ]');
    expect(TEXTO).toMatch(/aplicar\)\n\s+if \[ "\$CONFIRMACION"/);
    expect(TEXTO).toContain(
      '*) echo "::error::Ambiente no permitido (preview o produccion)."; exit 1 ;;',
    );
  });

  it("el Environment sale solo de la salida YA validada (un preview no puede apuntar a producción)", () => {
    expect(TEXTO).toContain("environment: ${{ needs.validar.outputs.ambiente }}");
    // Ningún paso mira las entradas del usuario: solo `validar` (en env) y el grupo de concurrencia.
    const fuera = LINEAS.filter((l) => l.includes("inputs.") && !l.trim().startsWith("#"));
    expect(fuera.map((l) => l.trim())).toEqual([
      "group: migrar-${{ inputs.ambiente }}",
      "AMBIENTE: ${{ inputs.ambiente }}",
      "ACCION: ${{ inputs.accion }}",
      "CONFIRMACION: ${{ inputs.confirmacion }}",
    ]);
  });

  it("ningún comando recibe una expresión interpolada: van en env, nombres, condiciones y claves", () => {
    const permitida =
      /^\s*(- )?([A-Z_]+|name|group|environment|ambiente|accion|outputs?|confirmacion|node-version|if):/;
    const conExpresion = LINEAS.filter((l) => l.includes("${{") && !l.trim().startsWith("#"));
    expect(conExpresion.length).toBeGreaterThan(0);
    for (const linea of conExpresion) expect(linea, linea).toMatch(permitida);
    expect(TEXTO).not.toMatch(/run:[^\n]*\$\{\{/);
    // Y dentro de los bloques `run: |` tampoco.
    for (const { texto } of pasos()) {
      const run = texto.includes("run: |")
        ? texto.slice(texto.indexOf("run: |"), texto.indexOf("\n        env:"))
        : "";
      expect(run).not.toContain("${{");
    }
  });

  it("permisos mínimos: solo lectura de contenido, y el job de validación sin ninguno", () => {
    expect(TEXTO).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(TEXTO).not.toMatch(/:\s*write\b/);
    expect(TEXTO).toMatch(/validar:(?:.*\n)*? {4}permissions: \{\}\n/);
  });

  it("los secretos son solo los declarados, salen del Environment, van únicamente en `env` y nunca en claro", () => {
    const usados = [...SIN_COMENTARIOS.matchAll(/secrets\.([A-Z_]+)/g)].map((m) => m[1]);
    expect([...new Set(usados)].sort()).toEqual([
      "NEON_API_KEY",
      "NEON_PROJECT_ID",
      "ZULUHUB_CLAVE_CONTEXTO",
      "ZULUHUB_DB_DUENO_DIRECTA",
    ]);
    for (const linea of LINEAS.filter((l) => l.includes("secrets.") && !l.trim().startsWith("#"))) {
      expect(linea.trim(), linea).toMatch(/^[A-Z_]+: \$\{\{ secrets\.[A-Z_]+ \}\}$/);
    }
    expect(TEXTO).not.toContain("secrets: inherit");
    expect(TEXTO).not.toContain("toJSON(secrets)");
    // Ningún valor en claro: ni una cadena de conexión con usuario y clave, ni tiras largas de claves o tokens.
    expect(SIN_COMENTARIOS).not.toMatch(/postgres(ql)?:\/\/[^\s$]*:[^\s$@]+@/);
    expect(SIN_COMENTARIOS).not.toMatch(/\b[0-9a-fA-F]{40,}\b(?! #)/);
    expect(SIN_COMENTARIOS).not.toMatch(/\bnapi_[A-Za-z0-9]{10,}/);
    expect(SIN_COMENTARIOS).not.toMatch(/Bearer [A-Za-z0-9_-]{16,}/);
  });

  it("la base se alimenta con el secreto de la cadena DIRECTA del dueño, solo en los pasos que migran", () => {
    const conLaBase = pasos().filter((p) => p.texto.includes("secrets.ZULUHUB_DB_DUENO_DIRECTA"));
    expect(conLaBase.map((p) => p.nombre)).toEqual([
      "Ver qué falta aplicar",
      "Aplicar las migraciones",
      "Instalar la clave de contexto (si el Environment la tiene)",
    ]);
    for (const p of conLaBase) {
      expect(p.texto).toContain("ZULUHUB_DB_MIGRACIONES: ${{ secrets.ZULUHUB_DB_DUENO_DIRECTA }}");
    }
    // Nunca la cadena del pooler ni la de la aplicación, y nada de Vercel.
    expect(SIN_COMENTARIOS).not.toMatch(/pooler|ZULUHUB_DB_APP|ZULUHUB_DB_TRABAJOS|VERCEL/i);
  });

  it("los pasos que ven la base no tienen los secretos de Neon, y el de Neon no ve la base", () => {
    const respaldo = paso("Rama de respaldo");
    expect(respaldo.texto).not.toContain("ZULUHUB_DB_DUENO_DIRECTA");
    expect(respaldo.texto).not.toContain("ZULUHUB_CLAVE_CONTEXTO");
    for (const nombre of ["Ver qué falta", "Aplicar las migraciones", "Instalar la clave"]) {
      expect(paso(nombre).texto).not.toContain("NEON_");
    }
    expect(paso("Aplicar las migraciones").texto).not.toContain("ZULUHUB_CLAVE_CONTEXTO");
    expect(paso("Ver qué falta").texto).not.toContain("ZULUHUB_CLAVE_CONTEXTO");
  });

  it("el orden es: ver, respaldo, aplicar, clave de contexto", () => {
    const nombres = pasos().map((p) => p.nombre);
    const posicion = (parte: string) => nombres.findIndex((n) => n.includes(parte));
    expect(posicion("Ver qué falta")).toBeLessThan(posicion("Rama de respaldo"));
    expect(posicion("Rama de respaldo")).toBeLessThan(posicion("Aplicar las migraciones"));
    expect(posicion("Aplicar las migraciones")).toBeLessThan(posicion("Instalar la clave"));
    expect(posicion("Dependencias")).toBeLessThan(posicion("Ver qué falta"));
  });

  it("aplicar y la clave solo corren con la acción «aplicar»", () => {
    for (const nombre of ["Aplicar las migraciones", "Instalar la clave", "Rama de respaldo"]) {
      expect(paso(nombre).texto).toContain("needs.validar.outputs.accion == 'aplicar'");
    }
    expect(paso("Aplicar las migraciones").texto).toContain("run: npm run migrar -- --aplicar");
    expect(paso("Ver qué falta").texto).toContain("npm run migrar -- --ver");
    expect(paso("Ver qué falta").texto).not.toContain("--aplicar");
  });

  it("el respaldo: solo producción, solo con algo para aplicar, por el nombre de la rama, y si se pide y falla NO se migra", () => {
    const { texto } = paso("Rama de respaldo");
    expect(texto).toContain("needs.validar.outputs.ambiente == 'produccion'");
    expect(texto).toContain('grep -q "faltan aplicar"');
    expect(texto).toContain('nombre="antes-de-$ultima"');
    expect(texto).toContain('select(.name == "production")');
    expect(texto).toContain("https://console.neon.tech/api/v2/projects/$NEON_PROJECT_ID/branches");
    // Sin las dos variables se migra sin respaldo, pero avisando.
    expect(texto).toContain("::warning::Sin NEON_API_KEY y NEON_PROJECT_ID");
    // Cada falla del respaldo corta el paso con error (el job no sigue a «Aplicar»).
    expect(texto.match(/exit 1/g)?.length).toBeGreaterThanOrEqual(4);
    expect(texto).toContain("No se migra.");
    // Nunca se imprime una respuesta de la API ni la clave: solo códigos HTTP.
    expect(texto).toContain("-o /dev/null -w '%{http_code}'");
    expect(texto).not.toMatch(/cat |echo "\$NEON|set -x|-v\b/);
    // El identificador del proyecto se valida antes de armar la URL.
    expect(texto).toContain('*[!a-z0-9-]*|"") echo "::error::NEON_PROJECT_ID');
  });

  it("la clave de contexto se instala solo si el Environment la tiene, con el mismo script del dueño", () => {
    const { texto } = paso("Instalar la clave");
    expect(texto).toContain('[ -z "${ZULUHUB_CLAVE_CONTEXTO:-}" ]');
    expect(texto).toContain("npm run instalar-clave");
    expect(texto).toContain("ZULUHUB_CLAVE_CONTEXTO: ${{ secrets.ZULUHUB_CLAVE_CONTEXTO }}");
  });

  it("`--ver` falla el paso si el script falla (pipefail) y los pasos con tuberías usan bash", () => {
    expect(paso("Ver qué falta").texto).toContain("shell: bash");
    expect(paso("Rama de respaldo").texto).toContain("shell: bash");
  });

  it("dos migraciones a la vez no se pisan y la que está corriendo nunca se cancela", () => {
    expect(TEXTO).toContain("group: migrar-${{ inputs.ambiente }}");
    expect(TEXTO).toContain("cancel-in-progress: false");
  });

  it("todas las acciones están fijadas por el SHA de un commit, sin credenciales persistentes", () => {
    const usos = LINEAS.filter((l) => l.includes("uses:") && !l.trim().startsWith("#"));
    expect(usos.length).toBe(2);
    for (const uso of usos) expect(uso, uso).toMatch(/uses: [\w./-]+@[0-9a-f]{40} # v\d/);
    expect(TEXTO).toContain("persist-credentials: false");
  });

  it("instala solo lo de producción y sin scripts de instalación (el job tiene los secretos)", () => {
    expect(TEXTO).toContain("run: npm ci --omit=dev --ignore-scripts");
    expect(TEXTO).not.toMatch(/cache:\s*npm/);
  });
});
