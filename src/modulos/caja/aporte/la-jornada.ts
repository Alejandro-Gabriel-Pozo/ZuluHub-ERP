import type { Importe } from "../../../primitivas/dinero/importe";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { FechaCivil } from "../../../primitivas/tiempo/fecha-civil";
import {
  ORIGEN_DE_COBRANZA_DE_TICKET,
  compararContraTickets,
  type DiferenciaDeTicket,
} from "../dominio/cobrado-contra-ticket";
import {
  conciliarJornada,
  type CierreDeCajaDelPar,
  type LineaDeConciliacion,
} from "../dominio/conciliacion";
import type { DatosParaLosControles } from "../dominio/controles-del-dia";
import type { ArqueoDeLaJornada, AjusteConEnlace } from "../persistencia/repositorio-de-la-jornada";
import type { CorreccionDeLaJornada } from "../persistencia/repositorio-de-correcciones";
import type { SesionGuardada } from "../persistencia/repositorio-de-sesiones";
import type { TxDeLecturaDeLaJornada } from "./contrato";
import type { TicketsPorCobranza } from "./tickets-por-cobranza";

/**
 * La jornada de caja LEÍDA y calculada en la transacción de quien llama (el cierre, que congela, o una consulta, que muestra): la UNA
 * regla de lo que caja ve de un día. El aporte la usa para sus controles y para congelar, y la consulta de la conciliación para mostrarla en
 * vivo; si cada uno la calculara por su lado, lo que se muestra y lo que se cierra podrían diferir. Todo el cálculo es del dominio
 * (`conciliarJornada`, `compararContraTickets`); acá solo se lee y se junta. Sin reloj ni azar: con los mismos datos, lo mismo.
 */
export type LaJornadaDeCaja = Readonly<{
  sesiones: readonly SesionGuardada[];
  arqueos: readonly ArqueoDeLaJornada[];
  lineas: readonly LineaDeConciliacion[];
  diferenciasDeTicket: readonly DiferenciaDeTicket[];
  correcciones: readonly CorreccionDeLaJornada[];
  ajustes: readonly AjusteConEnlace[];
}>;

export type ErrorAlLeerLaJornada = "APORTE_NO_DISPONIBLE";

/**
 * Las líneas de arqueo como las ve la conciliación. Una línea contada sin importe, o conforme sin quién y cuándo, rompe la invariante de
 * la base (`arqueo_caja_conforme_ck`): el dato no se puede leer y el día no se cierra.
 */
function cierresDelArqueo(
  arqueos: readonly ArqueoDeLaJornada[],
): readonly CierreDeCajaDelPar[] | null {
  const cierres: CierreDeCajaDelPar[] = [];
  for (const a of arqueos) {
    const par = { medioDePagoId: a.medioDePagoId, cuentaDeCobroId: a.cuentaDeCobroId };
    if (a.conforme) {
      if (a.conformePor === null || a.conformeEn === null) return null;
      cierres.push({
        ...par,
        conforme: true,
        conformePor: a.conformePor,
        conformeEn: a.conformeEn,
      });
    } else {
      if (a.contado === null) return null;
      cierres.push({ ...par, conforme: false, contado: a.contado });
    }
  }
  return cierres;
}

/** Los cobros con origen de ventas de la jornada contra el total vigente de su ticket; si no hay ninguno, no se le pregunta nada a ventas. */
async function diferenciasContraLosTickets(
  tx: TxDeLecturaDeLaJornada,
  tickets: TicketsPorCobranza,
  cobrado: readonly Readonly<{
    origen: Readonly<{ tipo: string; id: string }>;
    importe: Importe;
  }>[],
): Promise<readonly DiferenciaDeTicket[] | null> {
  const cobranzaIds = cobrado
    .filter((c) => c.origen.tipo === ORIGEN_DE_COBRANZA_DE_TICKET)
    .map((c) => c.origen.id);
  if (cobranzaIds.length === 0) return [];
  let informados;
  try {
    informados = await tickets.ticketsPorCobranza(tx, cobranzaIds);
  } catch {
    // Ventas no responde (o todavía no hay quien lo implemente): el día no se cierra con un dato que no se pudo leer.
    return null;
  }
  const comparadas = compararContraTickets(cobrado, informados);
  return comparadas.ok ? comparadas.valor : null;
}

export async function leerLaJornada(
  tx: TxDeLecturaDeLaJornada,
  empresa: EmpresaId,
  sucursal: SucursalId,
  fecha: FechaCivil,
  tickets: TicketsPorCobranza,
): Promise<Resultado<LaJornadaDeCaja, ErrorAlLeerLaJornada>> {
  const sesiones = await tx.sesiones.deLaJornada(empresa, sucursal, fecha);
  const arqueos = await tx.laJornada.arqueosDeLaJornada(empresa, sucursal, fecha);
  const efectivo = await tx.mediosDePago.obtenerEfectivo(empresa);
  // Una sesión siempre nace con su fondo en efectivo: sin el medio no hay cómo contar la jornada.
  if (efectivo === null && sesiones.length > 0) return err("APORTE_NO_DISPONIBLE");
  const cierres = cierresDelArqueo(arqueos);
  if (cierres === null) return err("APORTE_NO_DISPONIBLE");
  const correcciones = await tx.correcciones.deLaJornada(empresa, sucursal, fecha);
  const conforme = await tx.declaraciones.conformeDeLaJornada(empresa, sucursal, fecha);
  const lineas = conciliarJornada({
    efectivoId: efectivo?.id ?? "",
    movimientos: await tx.laJornada.registradoPorPar(empresa, sucursal, fecha),
    correcciones: correcciones.map((c) => ({
      importe: c.importe,
      antes: c.antes,
      despues: c.despues,
    })),
    declaraciones: await tx.declaraciones.declaracionesDeLaJornada(empresa, sucursal, fecha),
    conformeGeneral: conforme === null ? null : { por: conforme.por, en: conforme.en },
    cierres,
  });
  const cobrado = await tx.laJornada.cobradoPorOrigen(empresa, sucursal, fecha, null, null);
  const diferenciasDeTicket = await diferenciasContraLosTickets(
    tx,
    tickets,
    cobrado.map((c) => ({ origen: c.origen, importe: c.cobrado })),
  );
  if (diferenciasDeTicket === null) return err("APORTE_NO_DISPONIBLE");
  return ok({
    sesiones,
    arqueos,
    lineas,
    diferenciasDeTicket,
    correcciones,
    ajustes: await tx.laJornada.ajustesQueCorrigen(empresa, sucursal, fecha),
  });
}

/** Lo que el dominio necesita para armar los controles (`controlesDeCaja`). */
export function datosParaLosControles(jornada: LaJornadaDeCaja): DatosParaLosControles {
  return {
    sesiones: jornada.sesiones.map((s) => ({
      id: s.id,
      estado: s.estado,
      arqueo: jornada.arqueos.filter((a) => a.sesionId === s.id),
    })),
    conciliacion: jornada.lineas,
    diferenciasDeTicket: jornada.diferenciasDeTicket,
    correcciones: jornada.correcciones,
    ajustes: jornada.ajustes.map((a) => ({
      id: a.id,
      corrigeJornada: a.corrigeJornada,
      importe: a.importe,
      medioDePagoId: a.medioDePagoId,
      cuentaDeCobroId: a.cuentaDeCobroId,
    })),
  };
}
