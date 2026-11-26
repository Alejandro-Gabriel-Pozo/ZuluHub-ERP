import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import {
  validarConjuntoDeAcciones,
  type ProblemaDeConjunto,
} from "../../../capacidades/roles/validar-conjunto";
import type { PisosDeAcciones } from "../../../capacidades/roles/pisos";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { cargarEmpresas } from "./comun";
import type { TxDeIdentidad } from "./contrato";

/** El conjunto de acciones pedido para un rol no cumple el catálogo, el plan o los pisos: trae TODOS los problemas (la pantalla los muestra juntos). */
export type ConjuntoDeAccionesInvalido = Readonly<{
  codigo: "CONJUNTO_DE_ACCIONES_INVALIDO";
  problemas: readonly ProblemaDeConjunto[];
}>;

/** El guard con la acción del caso de uso y que la empresa opere: lo primero que hace todo caso de uso de roles (en ese orden). */
export async function permisoYEmpresaQueOpera(
  tx: TxDeIdentidad,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  accion: ClaveAccion,
): Promise<Resultado<null, MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAccion(reglas, accion, () => tx.autorizacion.delActor(contexto));
  if (!permiso.ok) return permiso;
  const { estados } = await cargarEmpresas(tx, [contexto.empresaId]);
  return comprobarQueOpera(contexto.empresaId, estados);
}

/** De qué módulo es cada acción del catálogo (`null` si el catálogo no la declara). */
export function moduloDeLaAccionDe(reglas: ReglasDeEmpresa): (accion: string) => string | null {
  const mapa = new Map<string, string>();
  for (const [modulo, definicion] of Object.entries(reglas.catalogo)) {
    for (const accion of Object.keys(definicion.acciones)) mapa.set(accion, modulo);
  }
  return (accion) => mapa.get(accion) ?? null;
}

/** El conjunto pedido, ordenado y sin repetidas si es válido contra el catálogo, el plan de la empresa y los pisos de la plataforma. */
export function conjuntoValido(
  acciones: readonly string[],
  reglas: ReglasDeEmpresa,
  modulosDelPlan: ReadonlySet<string>,
  pisos: PisosDeAcciones,
): Resultado<readonly string[], ConjuntoDeAccionesInvalido> {
  const validado = validarConjuntoDeAcciones(acciones, {
    moduloDeLaAccion: moduloDeLaAccionDe(reglas),
    modulosDelPlan,
    pisos,
  });
  return validado.ok
    ? ok(validado.valor)
    : err({ codigo: "CONJUNTO_DE_ACCIONES_INVALIDO", problemas: validado.error });
}
