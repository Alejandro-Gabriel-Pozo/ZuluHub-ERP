import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { DatosDelActor } from "../../../puertos/autorizacion";
import { claveDeJornada, type EntradaDeJornada, type ErrorDeClaveDeJornada } from "../comun";
import type { ClaveDeJornada } from "../persistencia/repositorio-de-jornadas";
import type { TxDeConsultasDeCierre } from "./contrato";

export type ErrorDeConsulta = MotivoDeRechazo | ErrorDeAlcance | ErrorDeClaveDeJornada;

export type ConsultaPreparada = Readonly<{ clave: ClaveDeJornada; datos: DatosDelActor }>;

/**
 * Lo previo común a toda consulta de una jornada: el guard (la acción que declara la consulta), la validación de la entrada y el
 * alcance de sucursal. A diferencia de un caso de uso, el alcance incluye las sucursales cerradas que la persona tiene asignadas: mirar
 * el historial de una sucursal que se cerró es válido (D-37); operar en ella, no.
 */
export async function prepararConsulta(
  tx: TxDeConsultasDeCierre,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  accion: ClaveAccion,
  entrada: EntradaDeJornada,
): Promise<Resultado<ConsultaPreparada, ErrorDeConsulta>> {
  const cargado: { datos?: DatosDelActor } = {};
  const permiso = await exigirAccion(reglas, accion, async () => {
    cargado.datos = await tx.autorizacion.delActor(contexto);
    return cargado.datos;
  });
  if (!permiso.ok) return permiso;
  if (cargado.datos === undefined) return err("SIN_PERMISO");
  const clave = claveDeJornada(contexto.empresaId, entrada);
  if (!clave.ok) return clave;
  const alcance = exigirSucursal(
    await tx.autorizacion.sucursalesDelActor(contexto, { incluirDesactivadas: true }),
    clave.valor.sucursal,
  );
  if (!alcance.ok) return alcance;
  return ok({ clave: clave.valor, datos: cargado.datos });
}
