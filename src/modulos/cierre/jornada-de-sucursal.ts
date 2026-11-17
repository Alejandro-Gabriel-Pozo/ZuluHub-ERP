import type { EmpresaId, SucursalId } from "../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../primitivas/tiempo/fecha-civil";
import type { EstadoConsultado } from "./dominio/jornada";
import type { RepositorioDeJornadas } from "./persistencia/repositorio-de-jornadas";

/**
 * LO QUE OFRECE `cierre` A LOS MÓDULOS QUE TIENEN ACTIVIDAD EN LA SUCURSAL (E3b §3.4): preguntar y proteger el estado de la jornada. Corre en
 * la transacción de quien llama (el `tx` de su caso de uso, que tiene `jornadas` sobre la misma conexión), SIN guard propio (no
 * autoriza: lo autorizó el caso que lo llama). La empresa va explícita, como en todo repositorio.
 *
 * Por qué hace falta: quien registra actividad (caja al abrir una sesión, ventas al emitir un ticket) y quien cierra el día tienen que
 * serializarse. `asegurarAbiertaEnTx` toma la jornada con `FOR SHARE` (crea la fila si es la primera actividad); `iniciarAuditoria` la
 * toma con `FOR UPDATE`. O la actividad entra antes —y `iniciarAuditoria` la ve como impedimento— o se rechaza con
 * `JORNADA_EN_AUDITORIA` y quien llama NO escribe. Bajo `SERIALIZABLE` la lectura participa de la verificación de conflictos.
 * Previene: una sesión abierta o un cobro dentro de una jornada que ya se está cerrando. Chequeo: la carrera de las dos órdenes en
 * `test/integracion/cierre-concurrencia.test.ts`.
 */
export type TxDeJornadas = Readonly<{
  jornadas: Pick<
    RepositorioDeJornadas,
    "asegurarYBloquearCompartida" | "bloquearCompartida" | "obtener"
  >;
}>;

export type ErrorDeJornadaNoAbierta = "JORNADA_EN_AUDITORIA" | "JORNADA_CERRADA";
export type ErrorDeJornadaNoEnAuditoria =
  "JORNADA_NO_EN_AUDITORIA" | "JORNADA_CERRADA" | "JORNADA_NO_ENCONTRADA";

/**
 * La jornada existe (se crea si es la primera actividad) y está `ABIERTA`: queda tomada con `FOR SHARE` hasta que termine la transacción
 * de quien llama. En auditoría o cerrada devuelve el error y quien llama no escribe.
 */
async function asegurarAbiertaEnTx(
  tx: TxDeJornadas,
  empresa: EmpresaId,
  sucursal: SucursalId,
  fechaDeNegocio: FechaCivil,
): Promise<Resultado<null, ErrorDeJornadaNoAbierta>> {
  const jornada = await tx.jornadas.asegurarYBloquearCompartida({
    empresa,
    sucursal,
    fecha: fechaDeNegocio,
  });
  if (jornada.estado === "ABIERTA") return ok(null);
  return err(jornada.estado === "EN_AUDITORIA" ? "JORNADA_EN_AUDITORIA" : "JORNADA_CERRADA");
}

/**
 * Para las acciones que SOLO valen durante el cierre (corregir un medio de cobro, declarar totales): la jornada existe y está
 * `EN_AUDITORIA`, tomada con `FOR SHARE` hasta el final de la transacción (el cierre concurrente espera o la serializable repite).
 */
async function exigirEnAuditoriaEnTx(
  tx: TxDeJornadas,
  empresa: EmpresaId,
  sucursal: SucursalId,
  fechaDeNegocio: FechaCivil,
): Promise<Resultado<null, ErrorDeJornadaNoEnAuditoria>> {
  const jornada = await tx.jornadas.bloquearCompartida({
    empresa,
    sucursal,
    fecha: fechaDeNegocio,
  });
  if (jornada === null) return err("JORNADA_NO_ENCONTRADA");
  if (jornada.estado === "EN_AUDITORIA") return ok(null);
  return err(jornada.estado === "ABIERTA" ? "JORNADA_NO_EN_AUDITORIA" : "JORNADA_CERRADA");
}

/**
 * El estado de la jornada, SIN bloquearla (para mostrar o decidir sin proteger nada): `SIN_ACTIVIDAD` si todavía no existe. Quien
 * necesita que el estado no cambie hasta el final de su transacción usa `asegurarAbiertaEnTx` o `exigirEnAuditoriaEnTx`.
 */
async function estadoDeJornada(
  tx: TxDeJornadas,
  empresa: EmpresaId,
  sucursal: SucursalId,
  fechaDeNegocio: FechaCivil,
): Promise<EstadoConsultado> {
  const jornada = await tx.jornadas.obtener({ empresa, sucursal, fecha: fechaDeNegocio });
  return jornada === null ? "SIN_ACTIVIDAD" : jornada.estado;
}

export interface JornadaDeSucursal {
  asegurarAbiertaEnTx: typeof asegurarAbiertaEnTx;
  exigirEnAuditoriaEnTx: typeof exigirEnAuditoriaEnTx;
  estadoDeJornada: typeof estadoDeJornada;
}

export const jornadaDeSucursal: JornadaDeSucursal = {
  asegurarAbiertaEnTx,
  exigirEnAuditoriaEnTx,
  estadoDeJornada,
};
