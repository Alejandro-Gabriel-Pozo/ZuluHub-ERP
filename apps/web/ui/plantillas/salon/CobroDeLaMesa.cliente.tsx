"use client";

import { useRouter } from "next/navigation";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { PantallaDeCobro } from "../cobrar/PantallaDeCobro.cliente";
import type { CobroPreparado, TicketAnulado, VentaCobrada } from "../cobrar/modelo-de-cobro";
import type { PapelDeTicket } from "../cobrar/PapelDelTicket.cliente";
import type { TextosDeCobrar } from "../cobrar/textos-de-cobrar";
import { RUTA_DEL_SALON, rutaDeLaCuentaDeMesa } from "./rutas-del-salon";

type Accion<R> = (pedido: unknown) => Promise<Respuesta<R>>;

export type PropsDeCobroDeLaMesa = Readonly<{
  mesaId: string;
  /** La cuenta de la mesa que se cobra (la que armó la ficha). */
  cuentaId: string;
  /** El total que vio quien cobra: es el `totalEsperado` (si cambió, el servidor no cobra). */
  total: Readonly<{ moneda: string; monto: string }>;
  /** Lo que la página resolvió en el servidor: la caja y las opciones, o por qué no se puede cobrar. */
  preparado: CobroPreparado;
  textos: TextosDeCobrar;
  /** Solo al cobrar una cuenta de una mesa dividida: sus textos y si es la última (la mesa queda libre y «Volver» lleva al salón). */
  deLaDivision?:
    Readonly<{ ultima: boolean; volverALasCuentas: string; mesaCobrada: string }> | undefined;
  acciones: Readonly<{
    cobrar: Accion<VentaCobrada>;
    anular: Accion<TicketAnulado>;
    imprimir: Accion<PapelDeTicket>;
  }>;
}>;

/**
 * «Cobrar la mesa» (SAL-D; S8): la hoja de cobro de la venta rápida en modo «cuenta existente» (DEC-1039: se reutiliza, no se duplica). El id de la cuenta es el de la mesa, el pedido no lleva líneas (las lee el servidor de la
 * cuenta) y la clave y el id del ejemplar los fija la hoja una vez por intento. «‹» vuelve a la ficha de la mesa (solo antes de cobrar); tras cobrar, «Volver» lleva al salón y la mesa ya está libre. No hay propina ni anular
 * acá (anular el ticket de una mesa es de SAL-C2). Sin textos propios: todos llegan resueltos.
 */
export function CobroDeLaMesa({
  mesaId,
  cuentaId,
  total,
  preparado,
  textos,
  deLaDivision,
  acciones,
}: PropsDeCobroDeLaMesa) {
  const router = useRouter();
  return (
    <PantallaDeCobro
      cuenta={[]}
      total={total}
      preparado={preparado}
      textos={textos}
      cobrar={acciones.cobrar}
      anular={acciones.anular}
      imprimir={acciones.imprimir}
      cuentaExistente={{ cuentaId }}
      deLaDivision={
        deLaDivision === undefined
          ? undefined
          : {
              rotuloDeVolver: deLaDivision.ultima ? textos.volver : deLaDivision.volverALasCuentas,
              mesaCobrada: deLaDivision.ultima ? deLaDivision.mesaCobrada : null,
            }
      }
      alVolver={() => {
        router.push(rutaDeLaCuentaDeMesa(mesaId));
      }}
      alNuevaVenta={() => {
        // La última cuenta deja la mesa libre: se vuelve al salón; si quedan cuentas, a la lista de cuentas de la mesa.
        router.push(
          deLaDivision !== undefined && !deLaDivision.ultima
            ? rutaDeLaCuentaDeMesa(mesaId)
            : RUTA_DEL_SALON,
        );
      }}
    />
  );
}
