import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { DatosDelActor } from "../../../puertos/autorizacion";
import { claveDeJornada, type EntradaDeJornada, type ErrorDeClaveDeJornada } from "../comun";
import type { ClaveDeJornada } from "../persistencia/repositorio-de-jornadas";
import type { TxDeConsultasDeCierre } from "./contrato";

export type ErrorDeConsulta = MotivoDeRechazo | ErrorDeAlcance | ErrorDeClaveDeJornada;

export type ConsultaPreparada = Readonly<{ clave: ClaveDeJornada; datos: DatosDelActor }>;

/** El guard de una consulta: la acción que declara, pedida dentro de su transacción. Devuelve lo que se leyó del actor. */
export async function exigirPermisoDeConsulta(
  tx: TxDeConsultasDeCierre,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  accion: ClaveAccion,
): Promise<Resultado<DatosDelActor, MotivoDeRechazo>> {
  const cargado: { datos?: DatosDelActor } = {};
  const permiso = await exigirAccion(reglas, accion, async () => {
    cargado.datos = await tx.autorizacion.delActor(contexto);
    return cargado.datos;
  });
  if (!permiso.ok) return permiso;
  if (cargado.datos === undefined) return err("SIN_PERMISO");
  return ok(cargado.datos);
}

/**
 * El alcance de sucursal de una consulta. A diferencia de un caso de uso, incluye las sucursales cerradas que la persona tiene asignadas:
 * mirar el historial de una sucursal que se cerró es válido (D-37); operar en ella, no.
 */
export async function exigirAlcanceDeConsulta(
  tx: TxDeConsultasDeCierre,
  contexto: ContextoOperativo,
  sucursal: SucursalId,
): Promise<Resultado<null, ErrorDeAlcance>> {
  return exigirSucursal(
    await tx.autorizacion.sucursalesDelActor(contexto, { incluirDesactivadas: true }),
    sucursal,
  );
}

/**
 * Lo previo común a toda consulta de una jornada: el guard (la acción que declara la consulta), la validación de la entrada y el
 * alcance de sucursal, en ese orden.
 */
export async function prepararConsulta(
  tx: TxDeConsultasDeCierre,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  accion: ClaveAccion,
  entrada: EntradaDeJornada,
): Promise<Resultado<ConsultaPreparada, ErrorDeConsulta>> {
  const permiso = await exigirPermisoDeConsulta(tx, contexto, reglas, accion);
  if (!permiso.ok) return permiso;
  const clave = claveDeJornada(contexto.empresaId, entrada);
  if (!clave.ok) return clave;
  const alcance = await exigirAlcanceDeConsulta(tx, contexto, clave.valor.sucursal);
  if (!alcance.ok) return alcance;
  return ok({ clave: clave.valor, datos: permiso.valor });
}
