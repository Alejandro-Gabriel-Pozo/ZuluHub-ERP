import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import { esUuid } from "../../ventas/publico";
import { ERRORES_DE_SALON_POR_RESTRICCION } from "../persistencia/restricciones";
import type { TxDeSalon } from "./contrato";
import type { ErrorDeSalon } from "./errores";

type R<S> = Resultado<S, ErrorDeSalon>;

const ES_ERROR_DE_PERSISTENCIA = (error: unknown): error is ErrorDePersistencia =>
  typeof error === "object" && error !== null && "tipo" in error;

/**
 * Traducción de las restricciones de la base del salón a errores de negocio (ADR-004). Una restricción sin error de negocio (`NO_TRADUCIDA`) o que no
 * figura sale como el `ErrorDePersistencia` tipado que ya es: nunca se traga ni se disfraza.
 */
export function traducir<T>(resultado: R<T>): R<T> {
  if (resultado.ok || !ES_ERROR_DE_PERSISTENCIA(resultado.error)) return resultado;
  const error = resultado.error;
  if (
    (error.tipo !== "Unicidad" && error.tipo !== "Referencia" && error.tipo !== "Check") ||
    error.restriccion === null ||
    !Object.hasOwn(ERRORES_DE_SALON_POR_RESTRICCION, error.restriccion)
  ) {
    return resultado;
  }
  const codigo = ERRORES_DE_SALON_POR_RESTRICCION[error.restriccion];
  if (codigo === undefined || codigo === "NO_TRADUCIDA") return resultado;
  return err(codigo as ErrorDeSalon);
}

/**
 * Lo previo común a todo comando, en el orden de siempre (E7 §3.4): el guard con la(s) acción(es) que declara (la persona y los módulos se leen dentro
 * de la transacción, sin caché), que la empresa opere y la persona del contexto (sin persona no hay quién deje constancia: `SIN_PERMISO`). Nada viene
 * del frontend. Quien orquesta ventas pide TODAS las acciones que sus pasos usan por dentro: o puede con todas o no empieza.
 */
export async function prepararComando(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  acciones: readonly [ClaveAccion, ...ClaveAccion[]],
): Promise<Resultado<PersonaId, MotivoDeRechazo | EmpresaNoOpera>> {
  const permiso = await exigirAcciones(reglas, acciones, () => tx.autorizacion.delActor(contexto));
  if (!permiso.ok) return permiso;
  const opera = comprobarQueOpera(
    contexto.empresaId,
    await cargarEstadosDeLaEmpresa(tx, contexto.empresaId),
  );
  if (!opera.ok) return opera;
  return contexto.personaId === null ? err("SIN_PERMISO") : ok(contexto.personaId);
}

/** El alcance de sucursales de quien pide: el operador solo opera en las suyas (INTEGRIDAD, no un control: lo decide el servidor). */
export async function exigirAlcance(
  tx: TxDeSalon,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<Resultado<null, ErrorDeAlcance>> {
  return exigirSucursal(await tx.autorizacion.sucursalesDelActor(contexto), sucursal);
}

/** Un uuid que manda la aplicación: lo demás nunca puede ser el id de nada. */
export function exigirUuid(...ids: readonly string[]): Resultado<null, "IDENTIFICADOR_INVALIDO"> {
  return ids.every(esUuid) ? ok(null) : err("IDENTIFICADOR_INVALIDO");
}

/** Lista de permitidos de la clave de idempotencia: la genera la pantalla por intento (`^[A-Za-z0-9_-]{16,128}$`). */
const FORMA_DE_LA_CLAVE = /^[A-Za-z0-9_-]{16,128}$/;
export function exigirClave(clave: string): Resultado<null, "CLAVE_INVALIDA"> {
  return FORMA_DE_LA_CLAVE.test(clave) ? ok(null) : err("CLAVE_INVALIDA");
}
export type { MotivoDeRechazo };
