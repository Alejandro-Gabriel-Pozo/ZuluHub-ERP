import type { SucursalId } from "../../../primitivas/identificadores/marca";
import type { EstadoDeTicket } from "../dominio/estados";
import type { Ejemplar, Ticket } from "./repositorio-de-tickets";

/** Las filas planas que devuelven las lecturas de ventas (E4 §3.12, §3.13 y §3.15): importes y cantidades como TEXTO decimal exacto. */
export type TicketDeJornada = Readonly<{
  ticketId: string;
  numero: number;
  estado: EstadoDeTicket;
  ejemplarVigente: number;
  ejemplarVigenteId: string;
  totalOriginal: string;
  /** El total del ejemplar vigente; 0 si el ticket está anulado. */
  totalVigente: string;
  totalCobrado: string;
  /** `totalCobrado − totalVigente`: distinto de 0 solo si el ticket se anuló o se corrigió a la baja después de cobrarlo. */
  diferencia: string;
  cobranzaId: string | null;
  cobros: readonly Readonly<{ cobroId: string; origenOrden: number; importe: string }>[];
  emitidoPor: string;
  emitidoEn: Date;
}>;

export type TicketPorCobranza = Readonly<{
  cobranzaId: string;
  ticketId: string;
  numero: number;
  estado: EstadoDeTicket;
  ejemplarVigente: number;
  ejemplarVigenteId: string;
  totalVigente: string;
  totalCobrado: string;
}>;

export type AnulacionDeLaJornada = Readonly<{
  tipo: "CUENTA" | "LINEA";
  cuentaId: string;
  lineaId: string | null;
  producto: string | null;
  importe: string;
  motivo: string;
  quien: string;
  cuando: Date;
}>;

export type CorreccionDeLaJornada = Readonly<{
  ticketId: string;
  numero: number;
  ejemplarVigente: number;
  tipo: "ANULACION" | "CORRECCION";
  motivo: string;
  diferencia: string;
  quien: string;
  cuando: Date;
}>;

export type CortesiaDeLaJornada = Readonly<{
  ticketId: string;
  numero: number;
  ejemplarVigente: number;
  tipo: "TOTAL" | "PARCIAL";
  lineas: readonly string[];
  quien: string;
  cuando: Date;
}>;

export type CuentaAbierta = Readonly<{
  cuentaId: string;
  etiqueta: string | null;
  totalProvisorio: string;
  abiertaEn: Date;
}>;

export type ResumenDeVentas = Readonly<{
  emitidos: Readonly<{ cantidad: number; total: string }>;
  cobrados: Readonly<{ cantidad: number; total: string }>;
  cortesias: Readonly<{ cantidad: number; total: string }>;
  anulados: Readonly<{ cantidad: number; total: string }>;
  ticketsConLineaACero: number;
  cuentasAnuladas: number;
  lineasAnuladas: number;
  correcciones: number;
  totalCobradoPorTickets: string;
}>;

export type TicketPendienteDeFacturar = Readonly<{
  ticketId: string;
  numero: number;
  sucursalId: string;
  fechaNegocio: string;
  ejemplarVigente: number;
  total: string;
  cobradoEn: Date;
}>;

export type CursorDePendientes = Readonly<{
  fechaNegocio: string;
  numero: number;
  sucursalId: string;
}>;

export type FiltroDePendientes = Readonly<{
  /** `null`: todas las sucursales (solo cuando el alcance de quien pide es TODAS). */
  sucursales: readonly SucursalId[] | null;
  fechaDesde: string | null;
  fechaHasta: string | null;
  /** Solo `SIN_COMPROBANTE` existe hasta que E1 cree los documentos fiscales; con `COMPROBANTE_ANULADO` no hay nada. */
  despuesDe: CursorDePendientes | null;
  limite: number;
}>;

export type RenglonParaFacturar = Readonly<{
  lineaCuentaId: string;
  descripcion: string;
  varianteNombre: string | null;
  opciones: readonly Readonly<{ grupo: string; nombre: string; recargo: string }>[];
  cantidad: string;
  unidadDeVenta: string;
  /** El símbolo de la unidad de venta (`unidad_de_medida.simbolo`, E2): lo que imprime el facturador. */
  unidadSimbolo: string;
  precioUnitario: string;
  alicuota: string;
  importe: string;
}>;

export type TicketParaFacturar = Readonly<{
  ticket: Ticket;
  ejemplarVigenteId: string;
  total: string;
  renglones: readonly RenglonParaFacturar[];
}>;

export type FichaDeTicketLeida = Readonly<{
  ticket: Ticket;
  /** Del más reciente al más antiguo; el primero es el vigente. */
  ejemplares: readonly Ejemplar[];
  renglonesDelVigente: readonly RenglonParaFacturar[];
  cobranza: Readonly<{
    id: string;
    cajaId: string;
    creadaEn: Date;
    aplicaciones: readonly Readonly<{
      orden: number;
      cobroId: string;
      cuentaDeCobroId: string | null;
      importe: string;
    }>[];
  }> | null;
}>;
