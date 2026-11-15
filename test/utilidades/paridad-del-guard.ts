import { clavesDe } from "../../src/capacidades/modulos/activos";
import { CATALOGO_DE_MODULOS, type ClaveAccion } from "../../src/capacidades/modulos/catalogo";
import { PERMISOS_DE_EMPRESA, type ReglasDeEmpresa } from "../../src/capacidades/permisos/empresa";
import type { ContextoOperativo } from "../../src/contexto/contexto";
import { empresaId, personaId } from "../../src/primitivas/identificadores/marca";
import type { CargaDeAutorizacion, DatosDelActor } from "../../src/puertos/autorizacion";
import { MARCA_PRINCIPAL_DE_PRUEBA } from "./marcas";

/**
 * Apoyo de la prueba de paridad declaración = guard (salón y comandas): la transacción VIGILADA solo responde la autorización y corta en cualquier otro acceso, y las reglas
 * le dan al OPERADOR exactamente las acciones que se le pasan (el resto de la matriz, vacío) con todos los módulos disponibles y activos.
 * Previene: la declaración de un caso de uso dice una cosa y su guard exige otra (D4 de la auditoría de salón).
 */

export const contextoDeParidad: ContextoOperativo = {
  tipo: "OPERATIVO",
  empresaId: empresaId("e-1"),
  personaId: personaId("p-1"),
  marcaDeEntrada: MARCA_PRINCIPAL_DE_PRUEBA,
  ahora: new Date(0),
};

/** El guard dejó pasar: la transacción vigilada corta en el primer acceso que no es la autorización. */
class AccesoFueraDelGuard extends Error {}

export type Vigilada<T> = Readonly<{ tx: T; accesos: string[] }>;

const MODULOS = clavesDe(CATALOGO_DE_MODULOS);

const ACTOR_OPERADOR: DatosDelActor = {
  rol: "OPERADOR",
  modulosActivados: MODULOS,
  modulosHabilitados: MODULOS,
};

export function vigilar<T extends object>(actor: DatosDelActor = ACTOR_OPERADOR): Vigilada<T> {
  const accesos: string[] = [];
  const autorizacion: CargaDeAutorizacion = {
    delActor: () => Promise.resolve(actor),
    sucursalesDelActor: () => Promise.resolve("TODAS"),
  };
  const tx = new Proxy({} as T, {
    get(_objetivo, propiedad) {
      accesos.push(String(propiedad));
      if (propiedad === "autorizacion") return autorizacion;
      throw new AccesoFueraDelGuard(String(propiedad));
    },
  });
  return { tx, accesos };
}

/** Las reglas con todos los módulos disponibles y la matriz en la que el OPERADOR puede SOLO `acciones`. */
export function reglasDondeElOperadorPuedeSolo(acciones: readonly ClaveAccion[]): ReglasDeEmpresa {
  const catalogo = Object.fromEntries(
    Object.entries(CATALOGO_DE_MODULOS).map(([clave, modulo]) => [
      clave,
      { ...modulo, estado: "disponible" },
    ]),
  ) as unknown as ReglasDeEmpresa["catalogo"];
  const permisos = Object.fromEntries(
    clavesDe(PERMISOS_DE_EMPRESA).map((accion) => [
      accion,
      acciones.includes(accion) ? ["OPERADOR"] : [],
    ]),
  ) as unknown as ReglasDeEmpresa["permisos"];
  return { catalogo, permisos };
}

/** ¿El caso de uso dejó pasar el guard? Sí si tocó otra cosa que la autorización; no si devolvió `SIN_PERMISO`. */
export async function guardDejoPasar(llamada: Promise<unknown>): Promise<boolean> {
  try {
    const resultado = await llamada;
    if (
      typeof resultado === "object" &&
      resultado !== null &&
      "ok" in resultado &&
      resultado.ok === false &&
      "error" in resultado &&
      resultado.error === "SIN_PERMISO"
    ) {
      return false;
    }
    return true;
  } catch (e) {
    if (e instanceof AccesoFueraDelGuard) return true;
    throw e;
  }
}
