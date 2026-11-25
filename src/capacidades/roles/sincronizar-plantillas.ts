/**
 * SINCRONIZAR PLANTILLAS (H4b §6.3): qué hay que sumar a las plantillas cuando el código declara acciones nuevas. Puro y SIN imports a
 * propósito: lo carga el ejecutor de migraciones, que `npm run migrar` corre con Node directo (sin el cargador de `src/`).
 *
 * Reglas (solo aditivas e idempotentes):
 *  - Una acción «nueva» es la que el código declara y todavía no figura entre las `accion_introducida`.
 *  - Se suma a la plantilla `ADMINISTRADOR` u `OPERADOR` si el código dice que ese rol la tiene, salvo que ya la tenga o que la plataforma
 *    la haya reservado al gerente (el piso gana; el disparador de la base rechazaría la versión).
 *  - Se emite una versión nueva de una plantilla solo si aporta algo. Nunca se quita ni se repone nada que la plataforma haya cambiado.
 *  - Toda acción nueva queda marcada como introducida, también la que no entra a ninguna plantilla (por ejemplo, la solo del gerente).
 * Previene: que una acción nueva quede sin dueño en las plantillas, o que cada despliegue pise lo que la plataforma cambió. Chequeo:
 * `sincronizar-plantillas.test.ts` (mutación 100 %) y `test/integracion/sincronizar-plantillas.test.ts` (base real).
 */
export type RolDeLaDeclaracion = "GERENTE" | "ADMINISTRADOR" | "OPERADOR";
export type ClaveDePlantilla = "ADMINISTRADOR" | "OPERADOR";

/** Lo que el código declara: cada acción del catálogo con los roles que la tienen (`PERMISOS_DE_EMPRESA`). */
export type DeclaracionDeAcciones = Readonly<Record<string, readonly RolDeLaDeclaracion[]>>;

export type EstadoDeLasPlantillas = Readonly<{
  introducidas: ReadonlySet<string>;
  /** Las acciones de la versión vigente de cada plantilla. */
  vigentes: Readonly<Record<ClaveDePlantilla, readonly string[]>>;
  /** Las acciones con piso `SOLO_GERENTE`. */
  reservadasAlGerente: ReadonlySet<string>;
}>;

export type VersionNueva = Readonly<{
  clave: ClaveDePlantilla;
  /** La lista completa de la versión nueva, ordenada. */
  acciones: readonly string[];
  /** Lo que esta versión suma respecto de la vigente, ordenado. */
  agregadas: readonly string[];
}>;

export type PlanDeSincronizacion = Readonly<{
  /** Las acciones a marcar como introducidas, ordenadas. */
  nuevasIntroducidas: readonly string[];
  versiones: readonly VersionNueva[];
}>;

const CLAVES_DE_PLANTILLA: readonly ClaveDePlantilla[] = ["ADMINISTRADOR", "OPERADOR"];

export function planDeSincronizacion(
  declaracion: DeclaracionDeAcciones,
  estado: EstadoDeLasPlantillas,
): PlanDeSincronizacion {
  const candidatas = Object.entries(declaracion).filter(
    ([accion]) => !estado.introducidas.has(accion),
  );
  const versiones: VersionNueva[] = [];
  for (const clave of CLAVES_DE_PLANTILLA) {
    const vigente = estado.vigentes[clave];
    const agregadas = candidatas
      .filter(
        ([accion, roles]) =>
          roles.includes(clave) &&
          !estado.reservadasAlGerente.has(accion) &&
          !vigente.includes(accion),
      )
      .map(([accion]) => accion)
      .sort();
    if (agregadas.length > 0) {
      versiones.push({ clave, acciones: [...vigente, ...agregadas].sort(), agregadas });
    }
  }
  return { nuevasIntroducidas: candidatas.map(([accion]) => accion).sort(), versiones };
}

const ROLES_VALIDOS: readonly string[] = ["GERENTE", "ADMINISTRADOR", "OPERADOR"];
/** La misma forma que `clave_de_accion_valida` de la base (lista de permitidos). */
const CLAVE_DE_ACCION = /^[a-z][a-z0-9_]{0,39}\.[a-z][a-z0-9_]{0,39}$/;
export const FORMATO_DE_LA_DECLARACION = 1;

export type LecturaDeLaDeclaracion =
  | Readonly<{ ok: true; declaracion: DeclaracionDeAcciones }>
  | Readonly<{ ok: false; motivo: string }>;

const esObjeto = (valor: unknown): valor is Record<string, unknown> =>
  typeof valor === "object" && valor !== null && !Array.isArray(valor);

/**
 * Lee el archivo de la declaración (`migraciones/plantillas-declaradas.json`). Todo nace cerrado: forma distinta de la esperada, una
 * clave que la base no aceptaría, un rol desconocido o un rol repetido es un rechazo, nunca una corrección.
 */
export function declaracionDesdeTexto(texto: string): LecturaDeLaDeclaracion {
  let valor: unknown;
  try {
    valor = JSON.parse(texto);
  } catch {
    return { ok: false, motivo: "no es JSON" };
  }
  if (!esObjeto(valor) || Object.keys(valor).sort().join(",") !== "acciones,formato") {
    return { ok: false, motivo: "tiene que ser { formato, acciones }" };
  }
  if (valor["formato"] !== FORMATO_DE_LA_DECLARACION) {
    return { ok: false, motivo: `el formato tiene que ser ${FORMATO_DE_LA_DECLARACION}` };
  }
  const acciones = valor["acciones"];
  if (!esObjeto(acciones)) return { ok: false, motivo: "«acciones» tiene que ser un objeto" };
  const declaracion: Record<string, readonly RolDeLaDeclaracion[]> = {};
  for (const [accion, roles] of Object.entries(acciones)) {
    if (!CLAVE_DE_ACCION.test(accion)) return { ok: false, motivo: `clave inválida: ${accion}` };
    if (
      !Array.isArray(roles) ||
      roles.length === 0 ||
      new Set(roles).size !== roles.length ||
      roles.some((rol) => !ROLES_VALIDOS.includes(rol as string))
    ) {
      return { ok: false, motivo: `roles inválidos para ${accion}` };
    }
    declaracion[accion] = roles as RolDeLaDeclaracion[];
  }
  return { ok: true, declaracion };
}
