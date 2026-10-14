import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * El workflow que migra la base real corre con el secreto de la cadena de conexión y como el dueño de
 * la base. Estas son las propiedades que lo mantienen seguro; si alguien las quita, esta prueba se
 * pone roja. Es una lectura del texto del archivo (no hay un lector de YAML entre las dependencias).
 * `zizmor` (job «flujos» del CI) revisa el resto.
 */

const TEXTO = readFileSync(
  join(import.meta.dirname, "../../.github/workflows/migrar-base.yml"),
  "utf8",
);
const LINEAS = TEXTO.split("\n");

describe("workflow migrar-base.yml", () => {
  it("solo se dispara a mano: sin push, pull request, cron ni otro disparador", () => {
    expect(TEXTO).toMatch(/^on:\n {2}workflow_dispatch:/m);
    const disparadores =
      /^ {2}(push|pull_request|pull_request_target|schedule|workflow_run|release|issues|issue_comment|repository_dispatch):/m;
    expect(TEXTO).not.toMatch(disparadores);
    // Un único disparador en `on:`.
    const dentroDeOn = TEXTO.slice(TEXTO.indexOf("on:\n"), TEXTO.indexOf("\npermissions:"));
    expect(dentroDeOn.match(/^ {2}[a-z_]+:/gm)).toEqual(["  workflow_dispatch:"]);
  });

  it("solo corre desde main y no desde un fork, y lo verifica antes de entregar el secreto", () => {
    expect(TEXTO).toContain('[ "$REF" != "refs/heads/main" ]');
    expect(TEXTO).toContain("REF: ${{ github.ref }}");
    expect(TEXTO).toContain('[ "$ES_FORK" != "false" ]');
    expect(TEXTO).toContain("ES_FORK: ${{ github.event.repository.fork }}");
    // El job con el secreto espera al que valida.
    expect(TEXTO).toMatch(/\n {2}migrar:\n(?:.*\n)*? {4}needs: validar\n/);
  });

  it("aplicar exige la frase exacta de cada ambiente; ver no", () => {
    expect(TEXTO).toContain('preview) esperado="MIGRAR PREVIEW" ;;');
    expect(TEXTO).toContain('production) esperado="MIGRAR PRODUCCION" ;;');
    expect(TEXTO).toContain('[ "$CONFIRMACION" != "$esperado" ]');
    expect(TEXTO).toMatch(/aplicar\)\n\s+if \[ "\$CONFIRMACION"/);
  });

  it("ningún comando recibe una entrada interpolada: las expresiones solo van en env, nombres y claves", () => {
    const permitida =
      /^\s*(- )?([A-Z_]+|name|group|environment|ambiente|accion|outputs?|confirmacion|node-version):/;
    const conExpresion = LINEAS.filter((l) => l.includes("${{") && !l.trim().startsWith("#"));
    expect(conExpresion.length).toBeGreaterThan(0);
    for (const linea of conExpresion) expect(linea, linea).toMatch(permitida);
    // En particular, nunca una entrada del usuario dentro de un comando.
    expect(TEXTO).not.toMatch(/run:[^\n]*\$\{\{/);
    expect(TEXTO).toContain('run: npm run migrar -- "--$ACCION"');
  });

  it("permisos mínimos: solo lectura de contenido, y el job de validación sin ninguno", () => {
    expect(TEXTO).toMatch(/^permissions:\n {2}contents: read\n/m);
    expect(TEXTO).not.toMatch(/:\s*write\b/);
    expect(TEXTO).toMatch(/validar:(?:.*\n)*? {4}permissions: \{\}\n/);
  });

  it("el secreto sale de un Environment, está en un solo paso y no hay otro lugar donde se lea", () => {
    expect(TEXTO.match(/secrets\./g)).toHaveLength(1);
    expect(TEXTO).toContain("ZULUHUB_DB_MIGRACIONES: ${{ secrets.ZULUHUB_DB_MIGRACIONES }}");
    expect(TEXTO).toContain("environment: neon-${{ needs.validar.outputs.ambiente }}");
    expect(TEXTO).not.toContain("secrets: inherit");
  });

  it("dos migraciones a la vez no se pisan y la que está corriendo nunca se cancela", () => {
    expect(TEXTO).toContain("group: migrar-base-${{ inputs.ambiente }}");
    expect(TEXTO).toContain("cancel-in-progress: false");
  });

  it("todas las acciones están fijadas por el SHA de un commit, sin credenciales persistentes", () => {
    const usos = LINEAS.filter((l) => l.includes("uses:"));
    expect(usos.length).toBeGreaterThan(0);
    for (const uso of usos) expect(uso, uso).toMatch(/uses: [\w./-]+@[0-9a-f]{40} # v\d/);
    expect(TEXTO).toContain("persist-credentials: false");
  });

  it("instala solo lo de producción y sin scripts de instalación (el job tiene el secreto)", () => {
    expect(TEXTO).toContain("run: npm ci --omit=dev --ignore-scripts");
  });
});
