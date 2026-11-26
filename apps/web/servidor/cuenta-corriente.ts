import "server-only";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  fichaDeLaCuenta,
  listarLasCuentas,
  type DependenciasDeCuentaCorrienteWeb,
  type FichaDeCuentaParaLaPantalla,
  type ListaDeCuentasParaLaPantalla,
} from "../../../src/composicion/cuenta-corriente-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { web } from "./composicion";
import { dependenciasDeSesion } from "./sesion";

/**
 * La cuenta corriente de clientes (CC-5, A1): las lecturas para las páginas del listado y de la ficha. Finas a propósito (ADR-015, punto 2): resuelven QUIÉN actúa (la empresa y la persona salen de la SESIÓN, nunca de
 * la dirección) y llaman a `src/composicion/cuenta-corriente-web.ts`, donde se prueba todo lo demás. El permiso (`cuenta_corriente.ver`), el aislamiento por empresa y toda cuenta los decide el servidor dentro de su
 * transacción; con el módulo todavía «en desarrollo» todo sale como el genérico.
 */
export type { FichaDeCuentaParaLaPantalla, ListaDeCuentasParaLaPantalla };

const dependencias: DependenciasDeCuentaCorrienteWeb = {
  consultas: web.consultasDeCuentaCorriente,
  respuesta: dependenciasDeSesion.respuesta,
};

/**
 * Los clientes con cuenta corriente. De la dirección se toma SOLO `orden` (si viene como texto): cualquier otro parámetro se ignora acá, y el valor de `orden` lo valida el servidor contra la lista cerrada
 * (uno que no existe es el genérico).
 */
export function cargarLaListaDeCuentas(
  contexto: ContextoOperativo,
  parametros: Readonly<Record<string, string | string[] | undefined>>,
): Promise<Respuesta<ListaDeCuentasParaLaPantalla>> {
  const orden = parametros["orden"];
  return listarLasCuentas(dependencias, contexto, typeof orden === "string" ? { orden } : {});
}

/** La ficha de un cliente; un id que no es de un cliente con cuenta de la empresa es indistinguible de uno que no existe. */
export function cargarLaFichaDeLaCuenta(
  contexto: ContextoOperativo,
  parteId: string,
): Promise<Respuesta<FichaDeCuentaParaLaPantalla>> {
  return fichaDeLaCuenta(dependencias, contexto, { parteId });
}
