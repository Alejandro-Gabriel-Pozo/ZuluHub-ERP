import { errorDeCodigo, type Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import { aRespuesta, aRespuestaDeExcepcion, type DependenciasDeRespuesta } from "./a-respuesta";
import type { CajasParaCobrarParaLaPantalla } from "./cobrar-web";
import { presentarLasCajas, sinAusentes } from "./cobrar-web";
import type { crearCobroACuenta } from "./cobro-a-cuenta";
import { entradaDeCobrarACuenta, entradaDelTicketACobrar } from "./entradas-de-cobrar-a-cuenta";
import { traducirErrorDeCobrar } from "./errores-de-cobrar";
import type { Web } from "./web";

/**
 * Las acciones de la web de «Cobrar un ticket a cuenta» (CC-5 B2a): la hoja que se abre desde la ficha del cliente (el cargo pendiente más antiguo, su ticket, su total y las cajas de su sucursal) y el
 * cobro mismo. Vive acá (no en `apps/web`) para probarse con la base real sin levantar Next. La acción del servidor resuelve el CONTEXTO (persona y empresa); la SUCURSAL es la del ticket (se valida
 * contra el alcance de quien cobra, en la lectura y en el cobro). Del pedido solo viene lo que declara `entradas-de-cobrar-a-cuenta.ts`: NINGÚN importe (el total sale del ticket).
 *
 * Idempotencia: la clave y el ejemplar los genera la pantalla al abrir la hoja y se repiten tal cual en cada reintento (clic doble, corte de red): repetir devuelve lo hecho (`yaExistia`), sin duplicar
 * cobro de caja ni cobranza del libro; la misma clave con otro pedido es un error (genérico). Permisos: `ventas.ver` (leer el ticket y las cajas) y `tickets.cobrar` (el caso); el saldo de después se lee con
 * `cuenta_corriente.ver` y, sin ese permiso, sale vacío sin esconder el cobro. Los errores salen como los de cobrar en el mostrador (`errores-de-cobrar.ts`): genérico, salvo los avisos aprobados de la jornada.
 * Previene: cobrar con un total que no es el del ticket, cobrar dos veces el mismo ticket y un error de caja crudo en la pantalla. Chequeo: `test/integracion/cobrar-a-cuenta-web.test.ts`.
 */

type Importe = Readonly<{ moneda: string; monto: string }>;

export type DependenciasDeCobrarACuentaWeb = Readonly<{
  cobro: () => ReturnType<typeof crearCobroACuenta>;
  casosDeUso: () => Pick<ReturnType<Web["casosDeUsoDeVentas"]>, "cobrar">;
  consultas: () => Pick<
    ReturnType<Web["consultasDeVentas"]>,
    "ticketACobrar" | "estadoDeCajasParaCobrar"
  >;
  respuesta: DependenciasDeRespuesta;
}>;

const GENERICO = errorDeCodigo("CAJA_ACCION_NO_PERMITIDA");

/** Corre el trabajo, traduce el error como el de cobrar en el mostrador y convierte una excepción en un error con referencia y sin detalle. */
async function conTraduccion<T>(
  d: DependenciasDeCobrarACuentaWeb,
  trabajo: () => Promise<Resultado<T, unknown>>,
): Promise<Respuesta<T>> {
  try {
    const r = await trabajo();
    return aRespuesta(r.ok ? r : err(traducirErrorDeCobrar(r.error)), d.respuesta, (x) => x);
  } catch (excepcion) {
    return aRespuestaDeExcepcion(excepcion, d.respuesta);
  }
}

export type TicketACobrarParaLaPantalla = Readonly<{
  cliente: Readonly<{ id: string; nombre: string | null }>;
  ticket: Readonly<{
    ticketId: string;
    numero: number;
    canal: "SALON" | "MOSTRADOR";
    sucursalId: string;
    fechaNegocio: string;
    /** El ejemplar vigente: la pantalla lo repite al cobrar. */
    ejemplarId: string;
    total: Importe;
    venceEl: string | null;
    vencida: boolean;
  }>;
  cajas: CajasParaCobrarParaLaPantalla["cajas"];
  jornadaActual: CajasParaCobrarParaLaPantalla["jornadaActual"];
}>;

/**
 * La hoja de «Cobrar un ticket a cuenta»: el cargo pendiente MÁS ANTIGUO del cliente (o el ticket pedido), su ticket y las cajas de la sucursal del ticket. `null` si el cliente no tiene nada para cobrar (o no es de
 * la empresa). Son LECTURAS: no escriben ni auditan. Cualquier incoherencia entre el libro y el ticket (otro cliente, otro total, ya cobrado) es el genérico: nunca se muestra algo que no se pueda cobrar.
 */
export async function ticketACobrarDelCliente(
  d: DependenciasDeCobrarACuentaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<TicketACobrarParaLaPantalla | null>> {
  const entrada = entradaDelTicketACobrar(crudo);
  if (!entrada.ok) return { ok: false, error: GENERICO };
  return conTraduccion(d, async () => {
    const cargo = await d.cobro().cargoACobrarDelCliente(contexto, entrada.valor);
    if (!cargo.ok) return cargo;
    if (cargo.valor === null) return ok(null);
    const ticket = await d.consultas().ticketACobrar(contexto, { ticketId: cargo.valor.ticketId });
    if (!ticket.ok) return ticket;
    const t = ticket.valor;
    // El cargo del libro y el ticket tienen que contar lo mismo: del mismo cliente, por el mismo total y todavía sin cobrar.
    if (
      t.estado !== "EMITIDO" ||
      t.cliente.id !== cargo.valor.cliente.id ||
      t.total.monto !== cargo.valor.pendiente.monto
    ) {
      return err("TICKET_NO_COBRABLE");
    }
    const cajas = await d.consultas().estadoDeCajasParaCobrar(contexto, {
      sucursalId: t.sucursalId,
    });
    if (!cajas.ok) return cajas;
    const presentadas = presentarLasCajas(cajas.valor);
    return ok({
      cliente: { id: t.cliente.id, nombre: cargo.valor.cliente.nombre ?? t.cliente.nombre },
      ticket: {
        ticketId: t.ticketId,
        numero: t.numero,
        canal: t.canal,
        sucursalId: t.sucursalId,
        fechaNegocio: t.fechaNegocio,
        ejemplarId: t.ejemplarId,
        total: { moneda: t.total.moneda, monto: t.total.monto },
        venceEl: cargo.valor.venceEl,
        vencida: cargo.valor.vencida,
      },
      cajas: presentadas.cajas,
      jornadaActual: presentadas.jornadaActual,
    });
  });
}

export type TicketCobradoACuentaParaLaPantalla = Readonly<{
  ticketId: string;
  numero: number;
  cobranzaId: string;
  cliente: Readonly<{ id: string; nombre: string | null }>;
  total: Importe;
  /** La fecha de la jornada de la caja donde cayó el cobro («Este cobro entra en la caja del {fecha}»). */
  fechaDeCobro: string;
  jornadaVencida: boolean;
  /** El saldo del cliente DESPUÉS del cobro, leído del libro; `null` si quien cobra no puede ver la cuenta corriente. */
  saldoDelCliente: Importe | null;
  /** `true` si esta clave ya había cobrado: la pantalla muestra lo hecho, no un segundo cobro. */
  yaExistia: boolean;
}>;

/**
 * Cobra el ticket a cuenta: UN cobro por el total del ticket (el del ejemplar vigente, que pone el servidor), con el medio y la caja elegidos. Todo o nada en la transacción de `cobrar` (cobro de caja,
 * cobranza del ticket y cobranza imputada del libro): si el libro falla, no queda cobro en la caja. Rechaza un ticket que no se cargó a un cliente (`TICKET_NO_COBRABLE`): esta acción no cobra tickets comunes.
 */
export async function cobrarUnTicketACuenta(
  d: DependenciasDeCobrarACuentaWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<TicketCobradoACuentaParaLaPantalla>> {
  const entrada = entradaDeCobrarACuenta(crudo);
  if (!entrada.ok) return { ok: false, error: GENERICO };
  const e = entrada.valor;
  return conTraduccion(d, async () => {
    const ticket = await d.consultas().ticketACobrar(contexto, { ticketId: e.ticketId });
    if (!ticket.ok) return ticket;
    const t = ticket.valor;
    const cobrado = await d.casosDeUso().cobrar(contexto, {
      claveIdempotencia: e.claveIdempotencia,
      ticketId: e.ticketId,
      ejemplarId: e.ejemplarId,
      cajaId: e.cajaId,
      cobros: [
        {
          medioDePagoId: e.medioDePagoId,
          cuentaDeCobroId: e.cuentaDeCobroId,
          // El importe lo pone el servidor: el total del ejemplar vigente. Nunca el del navegador.
          importe: { moneda: t.total.moneda, monto: t.total.monto },
          ...(e.datos === undefined ? {} : { datos: sinAusentes(e.datos) }),
        },
      ],
    });
    if (!cobrado.ok) return cobrado;
    // El saldo de después es informativo: si no se puede leer (sin permiso, base), el cobro ya hecho NO se esconde.
    const saldo = await d.cobro().saldoDelClienteACuenta(contexto, { clienteId: t.cliente.id });
    return ok({
      ticketId: t.ticketId,
      numero: t.numero,
      cobranzaId: cobrado.valor.cobranzaId,
      cliente: t.cliente,
      total: {
        moneda: cobrado.valor.total.moneda,
        monto: cobrado.valor.total.monto,
      },
      fechaDeCobro: cobrado.valor.fechaDeCobro,
      jornadaVencida: cobrado.valor.jornadaVencida,
      saldoDelCliente: saldo.ok ? saldo.valor : null,
      yaExistia: cobrado.valor.yaExistia,
    });
  });
}
