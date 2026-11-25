import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import type { RegistrarLaCompra } from "../nueva/useEnvioDeLaCompra.cliente";

/**
 * Adapta la acción de «Cargar factura» o de «Confirmar conciliación» al envío con clave de «Nueva compra» (`useEnvioDeLaCompra`): el envío espera el id de lo creado en `recepcionId`; acá viaja el de la factura o
 * el de la conciliación. Lo llaman las pantallas de cliente (a un componente de cliente no puede pasarse una función desde el servidor, salvo una acción). Una sola forma de envío idempotente para las tres pantallas (una regla, un lugar).
 */
export const comoRegistro =
  <D extends Readonly<{ yaExistia: boolean }>>(
    accion: (entrada: unknown) => Promise<Respuesta<D>>,
    idDe: (dato: D) => string,
  ): RegistrarLaCompra =>
  async (entrada) => {
    const respuesta = await accion(entrada);
    return respuesta.ok
      ? {
          ok: true,
          dato: { recepcionId: idDe(respuesta.dato), yaExistia: respuesta.dato.yaExistia },
        }
      : respuesta;
  };
