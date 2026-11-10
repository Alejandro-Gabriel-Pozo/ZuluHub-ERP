import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAcciones } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { PersonaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaDeNegocio } from "../../../primitivas/tiempo/fecha-de-negocio";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { jornadaDeSucursal } from "../../cierre/publico";
import { cargarEstadosDeLaEmpresa, datosDeJornada } from "../../empresas/publico";
import { esUuid } from "../dominio/identificadores";
import { ERRORES_DE_VENTAS_POR_RESTRICCION } from "../persistencia/esquema";
import type { TxDeVentas } from "./contrato";
import type { ErrorDeVentas } from "./errores";

type R<S> = Resultado<S, ErrorDeVentas>;

const ES_ERROR_DE_PERSISTENCIA = (error: unknown): error is ErrorDePersistencia =>
  typeof error === "object" && error !== null && "tipo" in error;

/**
 * Traducción de las restricciones de la base a errores de negocio (ADR-004). Una restricción sin error de negocio (`NO_TRADUCIDA`) o que
 * no figura sale como el `ErrorDePersistencia` tipado que ya es: nunca se traga ni se disfraza.
 */
export function traducir<T>(resultado: R<T>): R<T> {
  if (resultado.ok || !ES_ERROR_DE_PERSISTENCIA(resultado.error)) return resultado;
  const error = resultado.error;
  if (
    (error.tipo !== "Unicidad" && error.tipo !== "Referencia" && error.tipo !== "Check") ||
    error.restriccion === null ||
    !Object.hasOwn(ERRORES_DE_VENTAS_POR_RESTRICCION, error.restriccion)
  ) {
    return resultado;
  }
  const codigo = ERRORES_DE_VENTAS_POR_RESTRICCION[error.restriccion];
  if (codigo === undefined || codigo === "NO_TRADUCIDA") return resultado;
  return err(codigo as ErrorDeVentas);
}

/**
 * Lo previo común a todo comando, en el orden de siempre (E4 §3.4): el guard con la(s) acción(es) que declara (la persona y los módulos se
 * leen dentro de la transacción, sin caché), que la empresa opere y la persona del contexto (sin persona no hay quién deje constancia:
 * `SIN_PERMISO`, como en el cierre). Nada viene del frontend.
 */
export async function prepararComando(
  tx: TxDeVentas,
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
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<Resultado<null, ErrorDeAlcance>> {
  return exigirSucursal(await tx.autorizacion.sucursalesDelActor(contexto), sucursal);
}

/**
 * La fecha de negocio POR RELOJ de este instante en esa sucursal (zona de la empresa y hora de corte): la jornada en que cae la
 * operación (E4 §3.2 y §3.15). Una zona u hora de corte inválidas son una configuración rota (la base las valida al guardarlas): se frena
 * con un error claro y no se vende en una jornada inventada.
 */
export async function jornadaPorReloj(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<Resultado<FechaCivil, "SUCURSAL_NO_ENCONTRADA">> {
  const datos = await datosDeJornada(tx, sucursal);
  if (!datos.ok) return datos;
  const fecha = fechaDeNegocio(contexto.ahora, datos.valor.zonaHoraria, datos.valor.horaDeCorte);
  if (!fecha.ok) throw new Error(`la sucursal ${sucursal} no se puede fechar: ${fecha.error}`);
  return ok(fecha.valor);
}

/**
 * La jornada de la sucursal tiene que estar ABIERTA para abrir cuentas, agregar líneas y cerrar (E4 §3.15): se toma con `FOR SHARE` hasta
 * el fin de la transacción, así que iniciar la auditoría a la vez espera o se rechaza esta operación; nunca queda un ticket en una
 * jornada que ya se está cerrando. `JORNADA_EN_AUDITORIA` y `JORNADA_CERRADA` salen ANTES de escribir nada de ventas.
 */
export async function exigirJornadaAbierta(
  tx: TxDeVentas,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<R<null>> {
  const fecha = await jornadaPorReloj(tx, contexto, sucursal);
  if (!fecha.ok) return fecha;
  return jornadaDeSucursal.asegurarAbiertaEnTx(tx, contexto.empresaId, sucursal, fecha.valor);
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
