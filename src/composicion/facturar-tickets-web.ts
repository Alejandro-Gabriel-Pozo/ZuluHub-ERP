import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import { accionDeWeb } from "./accion-de-web";
import {
  entradaDeEmitirDesdeTicket,
  entradaDePendientesDeFacturar,
  entradaDeTicketParaEmitir,
} from "./entradas-de-facturar-tickets";
import { traducirErrorFiscal } from "./errores-fiscales";
import type { Web } from "./web";

/**
 * Las acciones de la web para facturar un ticket cobrado (E1 §3.6): la lista de «Pendientes de facturar», el ticket que se va a facturar
 * y emitir su factura. Vive acá (no en `apps/web`) para probarse con la base real sin levantar Next, igual que `facturacion-web.ts`: la acción
 * del servidor resuelve el CONTEXTO (persona, empresa y marca, de la sesión) y se lo pasa; lo demás del pedido lo toma
 * `entradas-de-facturar-tickets.ts`, y cada caso de uso y consulta exige SU acción al guard adentro. Todo sale por `aRespuestaFiscal`
 * (ADR-016) con una lista blanca campo por campo: lo que se agregue después al caso de uso no sale a la pantalla sin decidirlo acá.
 *
 * Errores de ventas sin texto aprobado (`TICKET_NO_FACTURABLE`, `TICKET_NO_ENCONTRADO`, `FACTURACION_NO_DISPONIBLE`, un id mal formado):
 * salen como error inesperado con su referencia `PD-…`, como los otros códigos sin texto del facturador (`SIN_TEXTO_APROBADO`): la
 * pantalla solo ofrece tickets cobrados de la empresa, así que en el uso normal no ocurren. Pregunta pendiente al dueño si alguno debe
 * tener texto propio. Los errores que fiscal devuelve adentro de `FACTURACION_FALLIDA` se traducen con las mismas tablas de fiscal.
 */

export type DependenciasDeFacturarTicketsWeb = Readonly<{
  casosDeUso: () => ReturnType<Web["casosDeUsoDeVentas"]>;
  consultas: () => ReturnType<Web["consultasDeVentas"]>;
  respuesta: DependenciasDeRespuesta;
}>;

type ErrorDeVentasDeFacturar = Readonly<{ error: string; causa?: unknown }>;

const esFallida = (e: unknown): e is ErrorDeVentasDeFacturar & Readonly<{ causa: unknown }> =>
  typeof e === "object" &&
  e !== null &&
  (e as { error?: unknown }).error === "FACTURACION_FALLIDA" &&
  "causa" in e;

/**
 * Lo que fiscal contestó (`causa`) sale con las tablas de fiscal; el resto pasa igual y `aRespuesta` lo trata: el motivo del guard y la
 * empresa que no opera con su texto, lo demás como inesperado. `FACTURACION_FALLIDA` en sí no es un texto: la persona ve lo que fiscal dijo.
 */
function aErrorDeFacturar(error: unknown): unknown {
  return traducirErrorFiscal(esFallida(error) ? error.causa : error);
}

const esYaFacturado = (
  e: unknown,
): e is Readonly<{ error: "TICKET_YA_FACTURADO"; comprobanteId: string }> =>
  typeof e === "object" &&
  e !== null &&
  (e as { error?: unknown }).error === "TICKET_YA_FACTURADO" &&
  typeof (e as { comprobanteId?: unknown }).comprobanteId === "string";

const alResultado = <S>(r: Resultado<S, unknown>): Resultado<S, unknown> =>
  r.ok ? r : err(aErrorDeFacturar(r.error));

// ---------------------------------------------------------------------------------------------------------------
// Pendientes de facturar
// ---------------------------------------------------------------------------------------------------------------

export type PendienteDeFacturarParaLaPantalla = Readonly<{
  ticketId: string;
  numero: number;
  numeroDeCorreccion: number | null;
  sucursalId: string;
  fechaNegocio: string;
  /** Texto decimal (ADR-006). */
  total: Readonly<{ moneda: string; monto: string }>;
  cobradoEn: string;
  motivo: "SIN_COMPROBANTE" | "COMPROBANTE_ANULADO";
}>;

export type PendientesDeFacturarParaLaPantalla = Readonly<{
  tickets: readonly PendienteDeFacturarParaLaPantalla[];
  siguiente: Readonly<{ fechaNegocio: string; numero: number; sucursalId: string }> | null;
}>;

export function listarPendientesDeFacturar(
  d: DependenciasDeFacturarTicketsWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<PendientesDeFacturarParaLaPantalla>> {
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDePendientesDeFacturar,
    async (entrada) =>
      alResultado(await d.consultas().ticketsPendientesDeFacturar(contexto, entrada)),
    (pagina) => ({
      tickets: pagina.tickets.map((t) => ({
        ticketId: t.ticketId,
        numero: t.numero,
        numeroDeCorreccion: t.numeroDeCorreccion,
        sucursalId: t.sucursalId,
        fechaNegocio: t.fechaNegocio,
        total: { moneda: t.total.moneda, monto: t.total.monto },
        cobradoEn: t.cobradoEn.toISOString(),
        motivo: t.motivo,
      })),
      siguiente:
        pagina.siguiente === null
          ? null
          : {
              fechaNegocio: pagina.siguiente.fechaNegocio,
              numero: pagina.siguiente.numero,
              sucursalId: pagina.siguiente.sucursalId,
            },
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// El ticket que se va a facturar
// ---------------------------------------------------------------------------------------------------------------

export type TicketParaEmitirParaLaPantalla = Readonly<{
  ticketId: string;
  numero: number;
  numeroDeCorreccion: number | null;
  sucursalId: string;
  total: Readonly<{ moneda: string; monto: string }>;
  lineas: readonly Readonly<{
    descripcion: string;
    varianteNombre: string | null;
    opciones: readonly string[];
    cantidad: string;
    /** El símbolo que se imprime junto a la cantidad («kg»); `null` para la unidad base, que no se imprime. */
    unidad: string | null;
    precioUnitario: string;
    /** El código de la alícuota del renglón (`"21"`, `"10.5"`, `"EXENTO"`...): la pantalla lo muestra solo si la empresa discrimina IVA. */
    alicuota: string;
    importe: string;
  }>[];
}>;

export function ticketParaEmitir(
  d: DependenciasDeFacturarTicketsWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<TicketParaEmitirParaLaPantalla>> {
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDeTicketParaEmitir,
    async (entrada) => alResultado(await d.consultas().ticketParaFacturar(contexto, entrada)),
    (t) => ({
      ticketId: t.ticketId,
      numero: t.numero,
      numeroDeCorreccion: t.numeroDeCorreccion,
      sucursalId: t.sucursalId,
      total: { moneda: t.total.moneda, monto: t.total.monto },
      lineas: t.lineas.map((l) => ({
        descripcion: l.descripcion,
        varianteNombre: l.varianteNombre,
        opciones: l.opciones.map((o) => o.nombre),
        cantidad: l.cantidad,
        unidad: l.unidadImpresa,
        precioUnitario: l.precioUnitario,
        alicuota: l.alicuota,
        importe: l.importe,
      })),
    }),
  );
}

// ---------------------------------------------------------------------------------------------------------------
// Emitir desde un ticket
// ---------------------------------------------------------------------------------------------------------------

export type FacturaDeTicketParaLaPantalla = Readonly<{
  ticketId: string;
  comprobanteId: string;
  /** El estado del comprobante recién creado; `null` si ya existía (el vigente lo da el comprobante). */
  estado: string | null;
  /** `true`: ese ticket ya estaba facturado (la misma clave repetida, u otra persona lo facturó antes): no se escribió nada. */
  yaExistia: boolean;
}>;

/**
 * Factura un ticket cobrado. SUPUESTO (DEC-0022) (sin texto aprobado para «ya facturado»): si otra persona ya facturó el ticket (`TICKET_YA_FACTURADO`),
 * para quien lo pidió el resultado es el mismo que quería, que el ticket quede facturado: se le devuelve ese comprobante con `yaExistia`, sin
 * error. Costo de revertirlo: cambiar esta rama por un código con su texto, apenas el dueño lo apruebe.
 */
export function emitirDesdeTicket(
  d: DependenciasDeFacturarTicketsWeb,
  contexto: ContextoOperativo,
  crudo: unknown,
): Promise<Respuesta<FacturaDeTicketParaLaPantalla>> {
  return accionDeWeb(
    d.respuesta,
    crudo,
    entradaDeEmitirDesdeTicket,
    async (
      entrada,
    ): Promise<
      Resultado<
        Readonly<{
          ticketId: string;
          comprobanteId: string;
          estado: string | null;
          yaExistia: boolean;
        }>,
        unknown
      >
    > => {
      const r = await d.casosDeUso().emitirComprobanteDeTicket(contexto, entrada);
      if (!r.ok && esYaFacturado(r.error)) {
        return ok({
          ticketId: entrada.ticketId,
          comprobanteId: r.error.comprobanteId,
          estado: null,
          yaExistia: true,
        });
      }
      return alResultado(r);
    },
    (s) => ({
      ticketId: s.ticketId,
      comprobanteId: s.comprobanteId,
      estado: s.estado,
      yaExistia: s.yaExistia,
    }),
  );
}
