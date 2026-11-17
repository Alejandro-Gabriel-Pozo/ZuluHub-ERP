import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import {
  esUuidCanonico,
  sucursalId,
  type PersonaId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import type { SesionGuardada } from "../persistencia/repositorio-de-sesiones";
import type { TxDeCaja } from "./contrato";

/**
 * Los reintentos ante un conflicto de serialización en lo que escribe sobre una SESIÓN de caja (abrir, mover, ajustar, anular, cerrar):
 * todos los puestos de la sucursal chocan sobre la misma fila y solo una transacción confirma por ronda, así que con el default (6) la
 * séptima que llega a la vez agota los reintentos y la persona ve un error evitable. Igual que el cobro de ventas (`REINTENTOS_AL_COBRAR`, 20).
 * Es seguro: cada operación lleva su clave de idempotencia. Previene: `ConcurrenciaAgotada` con ~14 operaciones simultáneas sobre una sola sesión
 * (medido en 3,75 % con 16). Chequeo: `test/integracion/caja-sesion-reintentos.test.ts`.
 */
export const REINTENTOS_EN_LA_SESION_DE_CAJA = 20;

export type ErrorPrevio = MotivoDeRechazo | EmpresaNoOpera;

/**
 * Lo previo común a todo caso de uso de la configuración de caja, en el orden de siempre (e3 §3.2): el guard (la acción que declara el
 * caso), que la empresa opere y la persona del contexto (sin persona no hay quién deje constancia: `SIN_PERMISO`). Lo que sigue (el
 * alcance de sucursal, la validación, la idempotencia y las reglas) lo hace cada caso.
 */
export async function prepararCaso(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  accion: ClaveAccion,
): Promise<Resultado<Readonly<{ persona: PersonaId }>, ErrorPrevio>> {
  const permiso = await exigirAccion(reglas, accion, () => tx.autorizacion.delActor(contexto));
  if (!permiso.ok) return permiso;
  const opera = comprobarQueOpera(
    contexto.empresaId,
    await cargarEstadosDeLaEmpresa(tx, contexto.empresaId),
  );
  if (!opera.ok) return opera;
  if (contexto.personaId === null) return err("SIN_PERMISO");
  return ok({ persona: contexto.personaId });
}

/** Una sucursal que no es un UUID canónico (minúsculas, como lo guarda la base) no puede existir: `SUCURSAL_NO_ENCONTRADA`, sin tocar la base. */
export function sucursalDeLaEntrada(
  texto: string,
): Resultado<SucursalId, "SUCURSAL_NO_ENCONTRADA"> {
  return esUuidCanonico(texto) ? ok(sucursalId(texto)) : err("SUCURSAL_NO_ENCONTRADA");
}

/** El operador solo opera en las sucursales que tiene asignadas (el gerente y el administrador, en todas). Se lee sin caché. */
export async function exigirAlcance(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<Resultado<null, ErrorDeAlcance>> {
  return exigirSucursal(await tx.autorizacion.sucursalesDelActor(contexto), sucursal);
}

type Constancia = Readonly<{
  accion: string;
  entidad:
    | "caja"
    | "medio_de_pago"
    | "cuenta_de_cobro"
    | "sesion_caja"
    | "movimiento_caja"
    | "correccion_de_medio"
    | "declaracion_de_total"
    | "conforme_de_jornada";
  entidadId: string;
  antes?: Readonly<Record<string, Dato>>;
  despues?: Readonly<Record<string, Dato>>;
}>;

/** La constancia del cambio, en la misma transacción. Nunca lleva claves, DNI, cupones ni el identificador de una cuenta. */
export async function dejarConstancia(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  persona: PersonaId,
  constancia: Constancia,
): Promise<void> {
  await tx.auditoria.registrar({
    empresaId: contexto.empresaId,
    actorPersonaId: persona,
    ...constancia,
  });
}

/**
 * La sesión de la entrada, ya dentro del alcance de la persona: no existe (o es de otra empresa) → `SESION_NO_ENCONTRADA`; es de una
 * sucursal que el operador no tiene asignada → `SUCURSAL_FUERA_DE_ALCANCE`. La sucursal sale de la caja de la sesión, nunca de un dato
 * que mande la pantalla.
 */
export async function cargarSesion(
  tx: TxDeCaja,
  contexto: ContextoOperativo,
  id: string,
): Promise<Resultado<SesionGuardada, "SESION_NO_ENCONTRADA" | ErrorDeAlcance>> {
  const sesion = await tx.sesiones.obtener(contexto.empresaId, id);
  if (sesion === null) return err("SESION_NO_ENCONTRADA");
  const alcance = await exigirAlcance(tx, contexto, sesion.sucursalId);
  return alcance.ok ? ok(sesion) : alcance;
}

/**
 * Dos pedidos iguales a la vez (el doble clic, dos pestañas) chocan en una restricción única de la base: la clave de idempotencia, una
 * sola sesión sin cerrar por caja, una sola anulación por movimiento. Bajo `SERIALIZABLE` la base lo informa como conflicto de
 * serialización (y el adaptador repite todo) cuando la transacción había LEÍDO esa clave por un índice; con una tabla chica el plan lee
 * la tabla entera, no el índice, y el choque sale como un error de unicidad. En los dos casos lo que corresponde es lo mismo: el otro
 * pedido ya ganó, así que se vuelve a correr UNA vez el caso completo, que ahora ve lo hecho (`yaExistia`, `CAJA_YA_ABIERTA`,
 * `MOVIMIENTO_YA_ANULADO`, `CLAVE_REUTILIZADA`). Una segunda unicidad no se vuelve a repetir: sale como el error tipado que es.
 * Previene que el doble clic devuelva un error de persistencia en vez de «ya estaba» (caso real: lo midió la prueba de dos ingresos con la
 * misma clave a la vez). Chequeo: `test/integracion/caja-operacion-concurrencia.test.ts`.
 */
export async function repetirSiOtroGano<T, E>(
  correr: () => Promise<Resultado<T, E | ErrorDePersistencia>>,
  restricciones: readonly string[],
): Promise<Resultado<T, E | ErrorDePersistencia>> {
  const primera = await correr();
  if (primera.ok) return primera;
  const error = primera.error as ErrorDePersistencia;
  const chocoConOtro =
    typeof error === "object" &&
    "tipo" in error &&
    error.tipo === "Unicidad" &&
    error.restriccion !== null &&
    restricciones.includes(error.restriccion);
  return chocoConOtro ? correr() : primera;
}

/** Las restricciones únicas con las que chocan dos aperturas de la misma caja o con la misma clave. */
export const UNICAS_DE_LA_APERTURA = ["sesion_caja_clave_uk", "sesion_caja_vigente_uk"] as const;
/** Y las de un movimiento: la clave y, en la anulación, el movimiento que se anula (una sola vez). */
export const UNICAS_DEL_MOVIMIENTO = ["movimiento_caja_clave_uk"] as const;
export const UNICAS_DE_LA_ANULACION = [
  "movimiento_caja_clave_uk",
  "movimiento_caja_anula_uk",
] as const;
/** Las restricciones únicas con las que chocan dos correcciones del mismo cobro (la clave primaria `(cobro, secuencia)`) o con la misma clave. */
export const UNICAS_DE_LA_CORRECCION = [
  "correccion_de_medio_clave_uk",
  "correccion_de_medio_pkey",
] as const;
/** Y las de una declaración (el mismo par y secuencia, o la misma clave) y del conforme (una sola por jornada, o la misma clave). */
export const UNICAS_DE_LA_DECLARACION = [
  "declaracion_de_total_clave_uk",
  "declaracion_de_total_par_uk",
] as const;
export const UNICAS_DEL_CONFORME = [
  "conforme_de_jornada_clave_uk",
  "conforme_de_jornada_pkey",
] as const;
