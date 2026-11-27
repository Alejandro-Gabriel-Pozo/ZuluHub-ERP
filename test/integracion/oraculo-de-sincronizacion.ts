import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ARCHIVO_DE_LA_DECLARACION } from "../../src/adaptadores/postgres/migraciones";

/**
 * Lo que la sincronización de plantillas (H4b §6.3) TIENE que hacer, calculado aparte del código que la hace, para las pruebas de integración. Existe porque la semilla de la 0094 queda SELLADA (congelada) y toda
 * acción que el código declare después llega a las plantillas por la sincronización: «el catálogo de hoy == la semilla» deja de valer, y las pruebas no pueden escribir a mano un número de acciones ni de versiones.
 * Se calcula siempre a partir de la semilla que de verdad dejaron las migraciones (una base migrada SIN sincronizar) y de lo que el código declara; así pasa igual con hoy (nada que sincronizar) y con una acción más.
 *
 * Las reglas son las del diseño, escritas de nuevo y a propósito sin importar `src/capacidades/roles/sincronizar-plantillas.ts`: si fueran la misma función, la prueba daría siempre la razón.
 *  - Nueva = declarada y que no está entre las introducidas de la semilla.
 *  - Una nueva solo del gerente y sin piso `SOLO_GERENTE` NO se marca (se avisa): sin el piso un rol propio la podría recibir.
 *  - Una nueva con piso `SOLO_GERENTE` no entra a ninguna plantilla (el piso gana) pero queda marcada.
 *  - Entra a ADMINISTRADOR u OPERADOR si el código dice que ese rol la tiene; una plantilla recibe versión nueva solo si aporta algo.
 */
type Declaracion = Readonly<Record<string, readonly string[]>>;

export type EsperadoDeLaSincronizacion = Readonly<{
  /** Las acciones que se marcan como introducidas, ordenadas. */
  accionesIntroducidas: readonly string[];
  /** Las solo-gerente sin piso: se avisan y no se marcan, ordenadas. */
  sinSincronizar: readonly string[];
  /** Las versiones nuevas: la plantilla y lo que suma, ordenado. */
  versiones: readonly Readonly<{
    clave: "ADMINISTRADOR" | "OPERADOR";
    agregadas: readonly string[];
  }>[];
}>;

/** La declaración REAL del repositorio (`migraciones/plantillas-declaradas.json`), la que el ejecutor lee. */
export async function declaracionReal(): Promise<Declaracion> {
  const texto = await readFile(
    join(import.meta.dirname, "../../migraciones", ARCHIVO_DE_LA_DECLARACION),
    "utf8",
  );
  return (JSON.parse(texto) as { acciones: Declaracion }).acciones;
}

export function esperadoDeLaSincronizacion(
  declaracion: Declaracion,
  /** Las acciones ya introducidas (la semilla). */
  introducidas: ReadonlySet<string>,
  /** Las acciones con piso SOLO_GERENTE. */
  reservadasAlGerente: ReadonlySet<string>,
  /** Las acciones que ya tiene cada plantilla (la versión vigente de la semilla). */
  vigentes: Readonly<Record<"ADMINISTRADOR" | "OPERADOR", readonly string[]>>,
): EsperadoDeLaSincronizacion {
  const nuevas = Object.entries(declaracion).filter(([accion]) => !introducidas.has(accion));
  const soloGerente = (roles: readonly string[]) => roles.length === 1 && roles[0] === "GERENTE";
  const sinSincronizar = nuevas
    .filter(([accion, roles]) => soloGerente(roles) && !reservadasAlGerente.has(accion))
    .map(([accion]) => accion)
    .sort();
  const marcadas = nuevas.filter(([accion]) => !sinSincronizar.includes(accion));
  const versiones: { clave: "ADMINISTRADOR" | "OPERADOR"; agregadas: string[] }[] = [];
  for (const clave of ["ADMINISTRADOR", "OPERADOR"] as const) {
    const agregadas = marcadas
      .filter(
        ([accion, roles]) =>
          roles.includes(clave) &&
          !reservadasAlGerente.has(accion) &&
          !vigentes[clave].includes(accion),
      )
      .map(([accion]) => accion)
      .sort();
    if (agregadas.length > 0) versiones.push({ clave, agregadas });
  }
  return {
    accionesIntroducidas: marcadas.map(([accion]) => accion).sort(),
    sinSincronizar,
    versiones,
  };
}
