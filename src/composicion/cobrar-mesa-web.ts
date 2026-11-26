import type { Respuesta } from "../capacidades/experiencia/respuesta";
import type { ContextoOperativo } from "../contexto/contexto";
import type { CasosDeUsoDeSalon } from "../modulos/salon/publico";
import type { DependenciasDeRespuesta } from "./a-respuesta";
import {
  presentarLaVentaCobrada,
  sinAusentes,
  type VentaCobradaParaLaPantalla,
} from "./cobrar-web";
import { entradaDeCobrarLaMesa } from "./entradas-de-cobrar";
import { accionDeCobrar } from "./errores-de-cobrar";

/**
 * La acción web de COBRAR LA MESA (SAL-D; `cobrarMesa` del salón, E7 §3.7): cobra la cuenta que ya existe (la de la mesa, o una cuenta hija de una mesa dividida) en UNA transacción serializable y deja la mesa libre.
 * Vive acá (no en `apps/web`) para probarse con la base real sin levantar Next. Misma frontera y mismo traductor de errores que cobrar en el mostrador (`entradas-de-cobrar.ts`, `errores-de-cobrar.ts`): lista blanca de lo
 * que sale, importes como texto decimal con moneda (ADR-006), y todo rechazo de negocio (platos sin enviar, total que cambió, cobro que no cuadra, caja sin sesión, cuenta de reserva o unida…) como el genérico aprobado.
 *
 * Reglas (cada una con su prueba en `test/integracion/cobrar-mesa-web.test.ts`):
 *  - **Repetir no duplica.** La clave, el id del ejemplar y la cuenta los fija la pantalla por intento: repetir devuelve lo cobrado (`yaExistia`); la misma clave con otro importe es el genérico y no cobra.
 *  - **Dos cobros a la vez (claves distintas) dejan UN ticket:** uno cobra, el otro recibe el genérico.
 *  - **La sucursal la fija el servidor** (`sucursalDeTrabajo`): una cuenta de otra sucursal o empresa es el genérico, sin cobro ni número de ticket consumido. Sin sucursal (`""`) cierra.
 *  - **Sin propina y sin líneas en el pedido:** las líneas las lee el servidor de la cuenta; una clave de más rechaza el pedido entero.
 *  - **El permiso lo decide el servidor** (`mesas.ver` no alcanza: `cuentas.cerrar`, `tickets.cobrar` y `cuentas.anular`, todas, adentro del caso de uso).
 */

export type DependenciasDeCobrarMesaWeb = Readonly<{
  casosDeUso: () => Pick<CasosDeUsoDeSalon, "cobrarMesa">;
  respuesta: DependenciasDeRespuesta;
}>;

/** Cobra la mesa (`{ claveIdempotencia, cuentaId, ejemplarId, totalEsperado, confirmaciones?, cajaId, cobros }`). La sucursal llega ya resuelta por el servidor, nunca del pedido; vacía cierra con el genérico. */
export function cobrarLaMesa(
  d: DependenciasDeCobrarMesaWeb,
  contexto: ContextoOperativo,
  sucursalId: string,
  crudo: unknown,
): Promise<Respuesta<VentaCobradaParaLaPantalla>> {
  return accionDeCobrar(
    d.respuesta,
    sucursalId === "" ? null : crudo,
    entradaDeCobrarLaMesa,
    (entrada) =>
      d.casosDeUso().cobrarMesa(contexto, {
        claveIdempotencia: entrada.claveIdempotencia,
        cuentaId: entrada.cuentaId,
        ejemplarId: entrada.ejemplarId,
        totalEsperado: entrada.totalEsperado,
        confirmaciones: entrada.confirmaciones,
        sucursalDeTrabajo: sucursalId,
        cobro: {
          cajaId: entrada.cajaId,
          cobros: entrada.cobros.map((c) => ({
            medioDePagoId: c.medioDePagoId,
            cuentaDeCobroId: c.cuentaDeCobroId,
            importe: c.importe,
            ...(c.datos === undefined ? {} : { datos: sinAusentes(c.datos) }),
          })),
        },
      }),
    presentarLaVentaCobrada,
  );
}
