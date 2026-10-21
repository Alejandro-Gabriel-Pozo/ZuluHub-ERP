import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import { realpathSync } from "node:fs";
import { join } from "node:path";
import { carpetaTemporal, escribirEn, repoSanoEnDisco } from "./guardian-apoyo";

/**
 * Apoyo de las pruebas del núcleo del guardián que necesitan un repositorio git de verdad (el CLI y
 * `cargarDelRepo`): un repositorio sintético en una carpeta temporal, nunca el repositorio real ni `.git`.
 * Así corren igual en el sandbox de Stryker, que es una copia sin `.git`.
 */

/** Sin la configuración global del usuario: la salida de git no depende de quién corre las pruebas. */
const ENTORNO = { ...process.env, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1" };

export function git(carpeta: string, ...argumentos: string[]): void {
  const corrida = spawnSync("git", argumentos, { cwd: carpeta, env: ENTORNO, encoding: "utf8" });
  if (corrida.status !== 0) throw new Error(`git ${argumentos.join(" ")} falló: ${corrida.stderr}`);
}

/** Un repositorio git (vacío de commits) con esos archivos escritos, sin agregar ninguno al índice. */
export function repoConArchivos(archivos: Record<string, string>): string {
  const carpeta = realpathSync(carpetaTemporal("guardian-b-"));
  git(carpeta, "init", "-q");
  for (const [ruta, texto] of Object.entries(archivos)) escribirEn(carpeta, ruta, texto);
  return carpeta;
}

/** El repositorio sano del apoyo común (el guardián real copiado + `BASE`), con la ruta real de la carpeta. */
export function repoSano(): string {
  return realpathSync(repoSanoEnDisco());
}

const GUARDIAN_EN = "arquitectura/contratos/guardian.cjs";

export type Corrida = SpawnSyncReturns<string>;

/** Corre el CLI del guardián que vive en `repo` (con `repo` como carpeta de trabajo). */
export function correrCli(repo: string, argumentos: string[] = []): Corrida {
  return spawnSync(process.execPath, [join(repo, GUARDIAN_EN), ...argumentos], {
    cwd: repo,
    env: ENTORNO,
    encoding: "utf8",
  });
}

/** Corre un programa de Node en `repo` (para probar el módulo del guardián sin ejecutarlo como CLI). */
export function correrNodeEn(repo: string, programa: string): Corrida {
  return spawnSync(process.execPath, ["-e", programa], {
    cwd: repo,
    env: ENTORNO,
    encoding: "utf8",
  });
}
