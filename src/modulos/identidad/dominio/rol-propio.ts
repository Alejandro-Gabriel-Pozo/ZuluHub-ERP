import { claveDeNombreDeRol } from "../../../primitivas/texto/nombre-de-rol";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";

/**
 * Reglas de los roles propios de una empresa (H4b T4). Puras: lo que se leyó de la base llega por parámetro y se devuelve QUÉ HAY QUE HACER; el caso de uso escribe.
 * Previene: dos roles con el mismo nombre en una empresa, archivar un rol que todavía tienen personas activas, pasarse del tope técnico de roles, repetir un alta o un
 * archivado y que la repetición escriba otra vez. Chequeo: `rol-propio.test.ts`.
 */

/** Tope técnico de roles propios ACTIVOS por empresa (DEC de T4: «sin límite» comercial no es infinito). Lo valida el servidor; no hay columna ni CHECK que lo repita. */
export const MAXIMO_DE_ROLES_PROPIOS_ACTIVOS_POR_EMPRESA = 100;

/** Lo mínimo de un rol propio que las decisiones necesitan (el caso de uso pasa el `RolPropio` entero del repositorio). */
export type RolParaDecidir = Readonly<{
  id: string;
  nombre: string;
  activo: boolean;
  acciones: readonly string[];
}>;

export type ErrorDeRolPropio =
  | "ROL_NO_ENCONTRADO"
  | "ROL_ARCHIVADO"
  | "ROL_INACTIVO_CON_ESE_NOMBRE"
  | "ID_DE_ROL_EN_USO"
  | "NOMBRE_DE_ROL_EN_USO"
  | "ROL_CON_PERSONAS"
  | "LIMITE_TECNICO_DE_ROLES";

export type DecisionDeAltaDeRol =
  Readonly<{ tipo: "CREAR" }> | Readonly<{ tipo: "YA_EXISTIA"; rolId: string }>;

/**
 * El alta de un rol. El id lo manda quien llama (es la idempotencia del alta): si ya hay un rol con ese id y es el mismo nombre, es el mismo pedido repetido (`YA_EXISTIA`); con otro
 * nombre, el id está en uso (`ID_DE_ROL_EN_USO`). Si no hay rol con ese id pero hay uno con ese nombre (sin distinguir mayúsculas): activo, `YA_EXISTIA` con el de ese nombre (doble clic desde
 * dos pantallas); archivado, `ROL_INACTIVO_CON_ESE_NOMBRE` (se lo reactiva, no se crea otro).
 */
export function decidirAltaDeRol(datos: {
  nombreClave: string;
  porId: RolParaDecidir | null;
  porNombre: RolParaDecidir | null;
}): Resultado<DecisionDeAltaDeRol, ErrorDeRolPropio> {
  const { nombreClave, porId, porNombre } = datos;
  if (porId !== null) {
    return claveDeNombreDeRol(porId.nombre) === nombreClave
      ? ok({ tipo: "YA_EXISTIA", rolId: porId.id })
      : err("ID_DE_ROL_EN_USO");
  }
  if (porNombre === null) return ok({ tipo: "CREAR" });
  return porNombre.activo
    ? ok({ tipo: "YA_EXISTIA", rolId: porNombre.id })
    : err("ROL_INACTIVO_CON_ESE_NOMBRE");
}

/** El tope técnico: con `activos` ya en el máximo, no entra otro (alta ni reactivación). */
export function decidirTopeTecnicoDeRoles(activos: number): Resultado<null, ErrorDeRolPropio> {
  return activos >= MAXIMO_DE_ROLES_PROPIOS_ACTIVOS_POR_EMPRESA
    ? err("LIMITE_TECNICO_DE_ROLES")
    : ok(null);
}

export type DecisionDeEdicion = Readonly<{ cambiaElNombre: boolean; cambiaLasAcciones: boolean }>;

const mismasAcciones = (a: readonly string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every((accion, i) => accion === b[i]);

/**
 * La edición de un rol ACTIVO: qué cambia de verdad. Un nombre igual (mismo texto) y un conjunto igual (mismas acciones, ya ordenadas y sin repetidas) no escriben nada: repetir una
 * edición es inocuo. Cambiar el nombre a uno que otro rol de la empresa ya tiene (por su clave) es `NOMBRE_DE_ROL_EN_USO`.
 */
export function decidirEdicionDeRol(datos: {
  rol: RolParaDecidir | null;
  nombre?: string | undefined;
  /** El rol de la empresa que ya tiene la clave del nombre pedido, si hay. */
  conEseNombre: RolParaDecidir | null;
  acciones?: readonly string[] | undefined;
}): Resultado<DecisionDeEdicion, ErrorDeRolPropio> {
  const { rol, nombre, conEseNombre, acciones } = datos;
  if (rol === null) return err("ROL_NO_ENCONTRADO");
  if (!rol.activo) return err("ROL_ARCHIVADO");
  const cambiaElNombre = nombre !== undefined && nombre !== rol.nombre;
  if (cambiaElNombre && conEseNombre !== null && conEseNombre.id !== rol.id) {
    return err("NOMBRE_DE_ROL_EN_USO");
  }
  const cambiaLasAcciones = acciones !== undefined && !mismasAcciones(acciones, rol.acciones);
  return ok({ cambiaElNombre, cambiaLasAcciones });
}

/** Archivar: un rol con personas activas no se archiva (primero se las reasigna); archivado ya, es inocuo (`YA_ARCHIVADO`). */
export function decidirArchivadoDeRol(
  rol: RolParaDecidir | null,
  personasActivas: number,
): Resultado<"ARCHIVAR" | "YA_ARCHIVADO", ErrorDeRolPropio> {
  if (rol === null) return err("ROL_NO_ENCONTRADO");
  if (!rol.activo) return ok("YA_ARCHIVADO");
  return personasActivas > 0 ? err("ROL_CON_PERSONAS") : ok("ARCHIVAR");
}

/** Reactivar: ya activo es inocuo (`YA_ACTIVO`). El tope (técnico y comercial) lo comprueba el caso de uso antes de escribir. */
export function decidirReactivacionDeRol(
  rol: RolParaDecidir | null,
): Resultado<"REACTIVAR" | "YA_ACTIVO", ErrorDeRolPropio> {
  if (rol === null) return err("ROL_NO_ENCONTRADO");
  return rol.activo ? ok("YA_ACTIVO") : ok("REACTIVAR");
}
