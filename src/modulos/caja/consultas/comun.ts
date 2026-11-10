import type { ClaveAccion } from "../../../capacidades/modulos/catalogo";
import type { AlcanceDeSucursales, ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import { exigirSucursal } from "../../../capacidades/permisos/alcance";
import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import { exigirAccion } from "../../../capacidades/permisos/exigir";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import {
  esUuidCanonico,
  sucursalId,
  type SucursalId,
} from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { SesionGuardada } from "../persistencia/repositorio-de-sesiones";
import type { TxDeConsultasDeCaja } from "./contrato";

export type ErrorDeConsulta = MotivoDeRechazo | ErrorDeAlcance | "SUCURSAL_NO_ENCONTRADA";

/** El guard (la acción que declara la consulta) es lo primero: sin permiso no se lee nada más. Nada se guarda entre pedidos. */
export async function exigirPermisoDeConsulta(
  tx: TxDeConsultasDeCaja,
  contexto: ContextoOperativo,
  reglas: ReglasDeEmpresa,
  accion: ClaveAccion,
): Promise<Resultado<null, MotivoDeRechazo>> {
  return exigirAccion(reglas, accion, () => tx.autorizacion.delActor(contexto));
}

/**
 * Las sucursales en las que la persona puede MIRAR: a diferencia de un caso de uso, incluye las cerradas que tiene asignadas (el historial
 * de una sucursal que se cerró es válido, D-37; operar en ella, no).
 */
export function alcanceParaMirar(
  tx: TxDeConsultasDeCaja,
  contexto: ContextoOperativo,
): Promise<AlcanceDeSucursales> {
  return tx.autorizacion.sucursalesDelActor(contexto, { incluirDesactivadas: true });
}

/**
 * Una sucursal elegida en la pantalla: tiene que ser un UUID canónico (si no, no puede existir: `SUCURSAL_NO_ENCONTRADA`) y estar dentro del
 * alcance de quien mira (`SUCURSAL_FUERA_DE_ALCANCE`). Nunca se asume «todas» cuando no se eligió ninguna.
 */
export function sucursalElegida(
  alcance: AlcanceDeSucursales,
  texto: string,
): Resultado<SucursalId, ErrorDeConsulta> {
  if (!esUuidCanonico(texto)) return err("SUCURSAL_NO_ENCONTRADA");
  const sucursal = sucursalId(texto);
  const dentro = exigirSucursal(alcance, sucursal);
  return dentro.ok ? ok(sucursal) : dentro;
}

export type ErrorDeConsultaDeSesion = ErrorDeConsulta | "SESION_NO_ENCONTRADA";

/**
 * La sesión elegida en la pantalla, para MIRAR: existe (si no, o si es de otra empresa, `SESION_NO_ENCONTRADA`) y su sucursal es del
 * alcance de quien mira (`SUCURSAL_FUERA_DE_ALCANCE`). La sucursal sale de la caja de la sesión, nunca de un dato de la pantalla.
 */
export async function sesionParaMirar(
  tx: TxDeConsultasDeCaja,
  contexto: ContextoOperativo,
  id: string,
): Promise<Resultado<SesionGuardada, ErrorDeConsultaDeSesion>> {
  const sesion = await tx.sesiones.obtener(contexto.empresaId, id);
  if (sesion === null) return err("SESION_NO_ENCONTRADA");
  const dentro = exigirSucursal(await alcanceParaMirar(tx, contexto), sesion.sucursalId);
  return dentro.ok ? ok(sesion) : dentro;
}

/** Los datos de una sesión tal como los muestran las consultas: fechas en ISO UTC con la zona con que se abrió. */
export type SesionDeConsulta = Readonly<{
  id: string;
  cajaId: string;
  cajaNombre: string;
  sucursalId: string;
  estado: SesionGuardada["estado"];
  fechaDeNegocio: string;
  zonaHoraria: string;
  abiertaEn: string;
  abiertaPor: string;
  cerradaEn: string | null;
  cerradaPor: string | null;
}>;

export function sesionDeConsulta(sesion: SesionGuardada): SesionDeConsulta {
  return {
    id: sesion.id,
    cajaId: sesion.cajaId,
    cajaNombre: sesion.cajaNombre,
    sucursalId: sesion.sucursalId,
    estado: sesion.estado,
    fechaDeNegocio: sesion.fechaDeNegocio,
    zonaHoraria: sesion.zonaHoraria,
    abiertaEn: sesion.abiertaEn.toISOString(),
    abiertaPor: sesion.abiertaPor,
    cerradaEn: sesion.cerradaEn === null ? null : sesion.cerradaEn.toISOString(),
    cerradaPor: sesion.cerradaPor,
  };
}
