import "server-only";
import { revalidatePath } from "next/cache";
import type { Respuesta } from "../../../src/capacidades/experiencia/respuesta";
import {
  crearUnaSucursal,
  listarLasSucursales,
  type DependenciasDeSucursalesWeb,
  type SucursalParaLaLista,
} from "../../../src/composicion/sucursales-web";
import type { ContextoOperativo } from "../../../src/contexto/contexto";
import { RUTAS_DE_CUENTA } from "../ui/plantillas/sesion/rutas-de-cuenta";
import type { ResultadoDeAccion } from "./acciones";
import { web } from "./composicion";
import { conLaEmpresa } from "./con-la-empresa";
import { ofertaDe, permisosDeLaPersona } from "./permisos-de-la-persona";
import { dependenciasDeSesion } from "./sesion";

/**
 * La pantalla «Sucursales» de /cuenta: la lista y el alta. Finas a propósito (ADR-015, punto 2): reciben el contexto que ya resolvió la página (la empresa y la persona salen de la SESIÓN, nunca de la dirección ni de un
 * formulario) y llaman a `src/composicion/sucursales-web.ts`, donde se prueba el resto. El permiso lo decide el servidor dentro de la consulta o del caso de uso: la pantalla no valida nada.
 * Cómo se repite el alta sin duplicar: el caso de uso es idempotente por nombre (un doble toque o un reintento devuelven la misma sucursal). Chequeo: `test/integracion/sucursales-web.test.ts`.
 */

const dependencias: DependenciasDeSucursalesWeb = {
  casosDeUso: web.casosDeUsoDeEmpresas,
  consultas: web.consultasDeEmpresas,
  respuesta: dependenciasDeSesion.respuesta,
};

/** Las sucursales activas de la empresa. */
export function cargarLasSucursales(
  contexto: ContextoOperativo,
): Promise<Respuesta<readonly SucursalParaLaLista[]>> {
  return listarLasSucursales(dependencias, contexto);
}

/**
 * ¿La persona puede crear sucursales? Es la oferta de `sucursales.crear` que el servidor calcula con `ofertaDe`. Si no se pudieron leer los permisos, `false` (cierra, no abre). Ocultar no es autorizar: el caso de uso
 * vuelve a pasar por el guard dentro de su transacción.
 */
export async function ofertaDeCrearSucursales(contexto: ContextoOperativo): Promise<boolean> {
  const permisos = await permisosDeLaPersona(contexto);
  return permisos !== null && ofertaDe("sucursales.crear", permisos).permitida;
}

/** Crear una sucursal. Del formulario solo se toma el nombre. Devuelve si quedó (la nueva o, en un doble toque, la que ya había) o el error ya traducido. Vuelve a pedir la lista en cualquier caso. */
export async function crearUnaSucursalNueva(
  datos: unknown,
): Promise<Readonly<{ error: ResultadoDeAccion["error"]; creada: boolean }>> {
  const nombre =
    datos instanceof FormData && typeof datos.get("nombre") === "string"
      ? (datos.get("nombre") as string)
      : undefined;
  const respuesta = await conLaEmpresa((contexto) =>
    crearUnaSucursal(dependencias, contexto, { nombre }),
  );
  revalidatePath(RUTAS_DE_CUENTA.sucursales);
  return respuesta.ok ? { error: null, creada: true } : { error: respuesta.error, creada: false };
}
