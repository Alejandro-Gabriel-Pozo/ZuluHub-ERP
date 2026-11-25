import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { checksumDeMigracion, PATRON_DE_ARCHIVO } from "../src/adaptadores/postgres/migraciones.ts";

/**
 * SELLA migraciones ya aplicadas: guarda en `migraciones/selladas.json` el SHA-256 de cada una (el mismo `checksumDeMigracion` del ejecutor).
 * Una prueba de arquitectura (`test/arquitectura/migraciones-selladas.test.ts`) falla si el archivo de una migración sellada cambia.
 * Previene: editar una migración que ya corrió en una base (el ejecutor lo detecta recién en el siguiente migrar de ESA base).
 *
 *     npm run sellar:migraciones -- --hasta 0093      sella todas las migraciones con número <= 0093 que falten
 *     npm run sellar:migraciones -- 0094_permisos_configurables.sql      sella esa (el mismo día de su primer apply, en cualquier base)
 *
 * Nunca pisa un sello existente con otro hash: si difiere, falla (el archivo se editó después de sellado).
 */
const CARPETA = join(import.meta.dirname, "..", "migraciones");
const ARCHIVO = join(CARPETA, "selladas.json");

function principal(argumentos: readonly string[]): number {
  const existentes = readdirSync(CARPETA).filter((n) => PATRON_DE_ARCHIVO.test(n));
  const pedidas: string[] = [];
  const hasta = argumentos.indexOf("--hasta");
  if (hasta >= 0) {
    const tope = argumentos[hasta + 1] ?? "";
    if (!/^\d{4}$/.test(tope)) {
      console.error("`--hasta` lleva un número de cuatro dígitos (por ejemplo 0093).");
      return 1;
    }
    pedidas.push(...existentes.filter((n) => n.slice(0, 4) <= tope));
  } else {
    pedidas.push(...argumentos);
  }
  if (pedidas.length === 0) {
    console.error("Indicá `--hasta NNNN` o los nombres de las migraciones a sellar.");
    return 1;
  }
  const sellos = JSON.parse(readFileSync(ARCHIVO, "utf8")) as Record<string, string>;
  for (const nombre of pedidas) {
    if (!existentes.includes(nombre)) {
      console.error(`No existe la migración ${nombre}.`);
      return 1;
    }
    const hash = checksumDeMigracion(readFileSync(join(CARPETA, nombre), "utf8"));
    if (sellos[nombre] !== undefined && sellos[nombre] !== hash) {
      console.error(`${nombre} ya estaba sellada con otro contenido: se editó después de sellada.`);
      return 1;
    }
    sellos[nombre] = hash;
  }
  const ordenado = Object.fromEntries(Object.entries(sellos).sort(([a], [b]) => (a < b ? -1 : 1)));
  writeFileSync(ARCHIVO, `${JSON.stringify(ordenado, null, 2)}\n`);
  return 0;
}

process.exitCode = principal(process.argv.slice(2));
