import { exigirSucursal, type ErrorDeAlcance } from "../../../capacidades/permisos/alcance";
import type { MotivoDeRechazo } from "../../../capacidades/permisos/guard";
import type { ContextoOperativo } from "../../../contexto/contexto";
import type { EmpresaNoOpera } from "../../../contexto/estados";
import type { ImporteJson } from "../../../primitivas/dinero/importe";
import type { SucursalId } from "../../../primitivas/identificadores/marca";
import { err, ok, type Resultado } from "../../../primitivas/resultado/resultado";
import type { ErrorDePersistencia } from "../../../puertos/transacciones";
import { crearDirectorioDePartes } from "../../clientes/publico";
import { esUuid } from "../casos-de-uso/calculo";
import { previo } from "./consultas";
import type { DependenciasDeConsultasDeVentas, TxDeConsultasDeVentas } from "./contrato";

/**
 * «Ticket a cobrar» (CC-5 B2a): lo que hace falta para cobrar un ticket que se cargó a la cuenta corriente de un cliente y todavía no se cobró: el ticket con su número, su canal, su sucursal
 * y su fecha de negocio, el ejemplar VIGENTE con su total y el cliente al que se le cargó. Solo lee (`ventas.ver`) y valida el alcance de sucursales de quien pide: un ticket de otra empresa no existe y
 * uno de una sucursal fuera del alcance se rechaza. Un ticket que no está `EMITIDO` (ya cobrado o anulado) o que no se cargó a ningún cliente NO se cobra a cuenta (`TICKET_NO_COBRABLE`): nace cerrado.
 * El total sale siempre de acá (del ejemplar vigente), nunca de lo que mande el navegador. Previene: cobrar a cuenta un ticket que no es de cuenta, o con un total que no es el vigente.
 * Chequeo: `test/integracion/cobrar-a-cuenta-web.test.ts`.
 */

export type TicketACobrar = Readonly<{
  ticketId: string;
  numero: number;
  canal: "SALON" | "MOSTRADOR";
  sucursalId: string;
  fechaNegocio: string;
  estado: "EMITIDO" | "COBRADO";
  /** El ejemplar vigente: el que tiene que mandar el cobro (si el ticket se corrige mientras tanto, cobrar lo rechaza). */
  ejemplarId: string;
  total: ImporteJson;
  /** El cliente al que se le cargó la venta; `nombre` es `null` si no se ve desde la empresa o se anonimizó. */
  cliente: Readonly<{ id: string; nombre: string | null }>;
}>;

export type ErrorDeTicketACobrar =
  | MotivoDeRechazo
  | EmpresaNoOpera
  | ErrorDePersistencia
  | ErrorDeAlcance
  | "IDENTIFICADOR_INVALIDO"
  | "TICKET_NO_ENCONTRADO"
  | "TICKET_NO_COBRABLE";

const directorio = crearDirectorioDePartes();

async function ticketACobrar(
  tx: TxDeConsultasDeVentas,
  contexto: ContextoOperativo,
  alcance: "TODAS" | readonly SucursalId[],
  entrada: Readonly<{ ticketId: string }>,
): Promise<Resultado<TicketACobrar, ErrorDeTicketACobrar>> {
  if (!esUuid(entrada.ticketId)) return err("IDENTIFICADOR_INVALIDO");
  const ficha = await tx.lecturasDeVentas.fichaDeTicket(contexto.empresaId, entrada.ticketId);
  if (ficha === null) return err("TICKET_NO_ENCONTRADO");
  const t = ficha.ticket;
  const enAlcance = exigirSucursal(alcance, t.sucursalId);
  if (!enAlcance.ok) return enAlcance;
  // Lista de permitidos: solo un ticket emitido o ya cobrado, cargado a un cliente (anulado y cortesía no).
  if ((t.estado !== "EMITIDO" && t.estado !== "COBRADO") || t.cargadoAParteId === null) {
    return err("TICKET_NO_COBRABLE");
  }
  const vigente = ficha.ejemplares.find((e) => e.numeroDeEjemplar === t.ejemplarVigente);
  if (vigente === undefined) throw new Error("el ticket no tiene su ejemplar vigente");
  const cuenta = await tx.cuentas.obtener(contexto.empresaId, t.cuentaId);
  if (cuenta === null) throw new Error("el ticket no tiene su cuenta de consumo");
  const nombres = await directorio.nombresParaMostrar(tx, contexto.empresaId, [t.cargadoAParteId]);
  return ok({
    ticketId: t.id,
    numero: t.numero,
    canal: cuenta.ancla === null ? "MOSTRADOR" : "SALON",
    sucursalId: t.sucursalId,
    fechaNegocio: t.fechaNegocio,
    estado: t.estado,
    ejemplarId: vigente.id,
    total: { moneda: "ARS", monto: vigente.total },
    cliente: { id: t.cargadoAParteId, nombre: nombres.get(t.cargadoAParteId) ?? null },
  });
}

/**
 * La consulta «ticket a cobrar» como pieza propia (`ventas.ver`, el mismo guard, la misma exigencia de que la empresa opere y el mismo alcance de sucursales que el resto de las consultas de ventas: reusa su `previo`).
 * Vive aparte de `crearConsultasDeVentas` porque ese archivo está en su tope de líneas; la composición la arma junto con las lecturas del libro (`cobro-a-cuenta.ts`).
 */
export function crearTicketACobrar(dependencias: DependenciasDeConsultasDeVentas) {
  return {
    ticketACobrar: (
      contexto: ContextoOperativo,
      entrada: Readonly<{ ticketId: string }>,
    ): Promise<Resultado<TicketACobrar, ErrorDeTicketACobrar>> =>
      dependencias.transacciones.ejecutar(
        { contexto, aislamiento: "read committed", soloLectura: true },
        async (tx): Promise<Resultado<TicketACobrar, ErrorDeTicketACobrar>> => {
          const p = await previo(tx, contexto, dependencias);
          return p.ok ? ticketACobrar(tx, contexto, p.valor.alcance, entrada) : p;
        },
      ),
  };
}
