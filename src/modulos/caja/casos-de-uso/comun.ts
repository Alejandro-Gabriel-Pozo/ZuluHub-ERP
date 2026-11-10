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
import { cargarEstadosDeLaEmpresa } from "../../empresas/publico";
import type { TxDeCaja } from "./contrato";

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
  entidad: "caja" | "medio_de_pago" | "cuenta_de_cobro";
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
