import type { ContextoOperativo } from "../../../contexto/contexto";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import { fechaCivilDesdeTexto, type FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import { alcanceParaMirar, sucursalElegida, type ErrorDeConsulta } from "./comun";
import type { TxDeConsultasDeCaja } from "./contrato";

/**
 * Lo común a las consultas del cierre del día de caja (e3b §4.5): la jornada que se mira es `(sucursal, fecha de negocio)`, como la manda la
 * pantalla, validada acá. Nunca se asume «todas las sucursales»: la sucursal es obligatoria y tiene que estar dentro del alcance de quien mira.
 */
export type EntradaDeJornadaDeCaja = Readonly<{
  sucursalId: string;
  /** `YYYY-MM-DD`: la fecha de negocio sellada en las sesiones. */
  fechaDeNegocio: string;
}>;

export type ErrorDeConsultaDeJornada = ErrorDeConsulta | "FECHA_INVALIDA";

export type JornadaElegida = Readonly<{ sucursal: SucursalId; fecha: FechaCivil }>;

/** La sucursal (UUID canónico, del alcance de quien mira) y la fecha civil de la entrada; si no, el error con nombre y sin tocar más datos. */
export async function jornadaParaMirar(
  tx: TxDeConsultasDeCaja,
  contexto: ContextoOperativo,
  entrada: EntradaDeJornadaDeCaja,
): Promise<Resultado<JornadaElegida, ErrorDeConsultaDeJornada>> {
  const sucursal = sucursalElegida(await alcanceParaMirar(tx, contexto), entrada.sucursalId);
  if (!sucursal.ok) return sucursal;
  const fecha = fechaCivilDesdeTexto(entrada.fechaDeNegocio);
  if (!fecha.ok) return err("FECHA_INVALIDA");
  return ok({ sucursal: sucursal.valor, fecha: fecha.valor });
}
