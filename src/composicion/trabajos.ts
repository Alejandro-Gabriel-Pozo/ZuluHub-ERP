import {
  crearProcesadorDeTrabajos,
  type ProblemaDelProcesador,
  type ProcesadorDeTrabajos,
} from "../adaptadores/trabajos/procesador";
import {
  TRABAJO_ENVIAR_INVITACION,
  crearManejadorDeEnviarInvitacion,
} from "../modulos/identidad/publico";
import type { Conexiones } from "./conexiones";
import { perezoso } from "./perezoso";

export type OpcionesDeTrabajos = Readonly<{
  /** Para registrar lo que el procesador no pudo guardar en la cola (llega sin secretos). */
  alRegistrarProblema?: (problema: ProblemaDelProcesador) => void;
}>;

/**
 * El procesador de la cola y los manejadores de los tipos de trabajo que existen. Hoy solo
 * `enviar_invitacion`: los avisos del traspaso de gerencia se encolan pero todavía no tienen
 * manejador (queda para quien los envíe). El cron y el despacho inmediato (`after()`) son de W6;
 * acá solo se arma el procesador. Se crea la primera vez que se pide.
 */
export function armarTrabajos(conexiones: Conexiones, opciones: OpcionesDeTrabajos = {}) {
  return {
    procesador: perezoso((): ProcesadorDeTrabajos => {
      const { urlBase, nombreDeMarca } = conexiones.configuracionDeCorreo();
      const manejadorDeInvitaciones = crearManejadorDeEnviarInvitacion({
        // El envío corre con el contexto OPERATIVO de la empresa del trabajo: por la puerta de la aplicación.
        transacciones: conexiones.transaccionesDeApp(),
        tokens: conexiones.tokens(),
        correo: conexiones.correo(),
        urlBase,
        marca: { nombre: nombreDeMarca },
      });
      return crearProcesadorDeTrabajos({
        transacciones: conexiones.transaccionesDeTrabajos(),
        manejadores: new Map([[TRABAJO_ENVIAR_INVITACION, manejadorDeInvitaciones]]),
        ...(opciones.alRegistrarProblema === undefined
          ? {}
          : { alRegistrarProblema: opciones.alRegistrarProblema }),
      });
    }),
  };
}

export type Trabajos = ReturnType<typeof armarTrabajos>;
