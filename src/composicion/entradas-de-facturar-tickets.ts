import { z } from "zod";
import { err, ok, type Resultado } from "../primitivas/resultado/resultado";
import {
  entero,
  identificador,
  leer,
  receptorDeEntrada,
  type ErrorDeEntrada,
} from "./entradas-de-facturacion";

/**
 * La frontera de las acciones de facturar un ticket (E1 §3.6): de lo que manda el navegador a la entrada de los casos de uso y consultas de
 * ventas. Misma regla que `entradas-de-facturacion.ts`: la empresa y la persona salen del contexto del servidor, nada más se toma del pedido
 * (el esquema no declara otra clave) y esta capa solo dice si el dato tiene la FORMA pedida; el negocio lo decide el caso de uso.
 */

const formaDeEmitir = z.object({
  ticketId: identificador,
  puntoDeVentaId: identificador,
  /** Un uuid por intento de la pantalla (idempotencia). */
  clave: identificador,
  receptor: z.unknown(),
});

export type EntradaWebDeEmitirDesdeTicket = Readonly<{
  ticketId: string;
  puntoDeVentaId: string;
  clave: string;
  receptor: Readonly<Record<string, unknown>>;
}>;

export function entradaDeEmitirDesdeTicket(
  crudo: unknown,
): Resultado<EntradaWebDeEmitirDesdeTicket, ErrorDeEntrada> {
  const forma = leer(formaDeEmitir, crudo);
  if (!forma.ok) return forma;
  const receptor = receptorDeEntrada(forma.valor.receptor);
  if (!receptor.ok) return err({ codigo: "FISCAL_DATOS_INVALIDOS", campo: "receptor" });
  return ok({
    ticketId: forma.valor.ticketId,
    puntoDeVentaId: forma.valor.puntoDeVentaId,
    clave: forma.valor.clave,
    receptor: receptor.valor,
  });
}

const formaDeTicket = z.object({ ticketId: identificador });

export function entradaDeTicketParaEmitir(
  crudo: unknown,
): Resultado<Readonly<{ ticketId: string }>, ErrorDeEntrada> {
  return leer(formaDeTicket, crudo);
}

const formaDePendientes = z.object({
  sucursalId: identificador.optional(),
  fechaDesde: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  fechaHasta: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/)
    .optional(),
  motivo: z.enum(["SIN_COMPROBANTE", "COMPROBANTE_ANULADO"]).optional(),
  limite: entero.optional(),
  despuesDe: z
    .object({
      fechaNegocio: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      numero: entero,
      sucursalId: identificador,
    })
    .optional(),
});

export type EntradaWebDePendientes = z.output<typeof formaDePendientes>;

export function entradaDePendientesDeFacturar(
  crudo: unknown,
): Resultado<EntradaWebDePendientes, ErrorDeEntrada> {
  // Sin pedido (la primera vez que se abre la lista): los valores por defecto.
  return leer(formaDePendientes, crudo ?? {});
}
