import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { comprobarQueOpera, type EmpresaNoOpera } from "../../../contexto/estados";
import type { PersonaId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { Dato } from "../../../puertos/sin-secretos";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import type { TxDeCuentaCorriente } from "./contrato";

export type ErrorPrevio = MotivoDeRechazo | EmpresaNoOpera;

/**
 * Lo previo común a todo caso de uso de la ficha, en el orden de siempre: el guard (la acción que declara el caso; el libro de saldos NO autoriza, autoriza este
 * módulo), que la empresa opere y la persona del contexto (sin persona no hay quién deje constancia: `SIN_PERMISO`). Lo que sigue (la validación, la
 * idempotencia y las reglas) lo hace cada caso.
 */
export async function prepararCaso(
  tx: TxDeCuentaCorriente,
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

type Constancia = Readonly<{
  accion: string;
  entidadId: string;
  antes?: Readonly<Record<string, Dato>>;
  despues?: Readonly<Record<string, Dato>>;
}>;

/** La constancia del cambio (quién, cuándo —lo fija la base— y de qué valor a cuál), en la misma transacción. Nunca lleva la clave ni la huella. */
export async function dejarConstancia(
  tx: TxDeCuentaCorriente,
  contexto: ContextoOperativo,
  persona: PersonaId,
  constancia: Constancia,
): Promise<void> {
  await tx.auditoria.registrar({
    empresaId: contexto.empresaId,
    actorPersonaId: persona,
    entidad: "cuenta_del_cliente",
    ...constancia,
  });
}

/**
 * Dos pedidos iguales a la vez (el doble clic, dos pestañas) pueden chocar en una restricción única de la base (la clave o el cliente) en vez de verse como
 * conflicto de serialización. Lo que corresponde es lo mismo: el otro pedido ya ganó, así que se vuelve a correr UNA vez el caso completo, que ahora ve lo hecho
 * (`yaExistia`, `YA_HABILITADA`, `CLAVE_REUTILIZADA`). Una segunda unicidad no se vuelve a repetir: sale como el error tipado que es. Previene que el doble clic
 * devuelva un error de persistencia en vez de «ya estaba». Chequeo: `test/integracion/cuenta-corriente-casos-de-uso.test.ts` (dos habilitaciones a la vez).
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

/** Las restricciones únicas con las que chocan dos habilitaciones del mismo cliente o con la misma clave. */
export const UNICAS_DE_LA_HABILITACION = [
  "cuenta_cliente_parte_uk",
  "cuenta_cliente_clave_uk",
] as const;
