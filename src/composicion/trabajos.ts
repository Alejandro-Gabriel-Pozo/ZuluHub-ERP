import {
  crearProcesadorDeTrabajos,
  type ProblemaDelProcesador,
  type ProcesadorDeTrabajos,
} from "../adaptadores/trabajos/procesador";
import { REGLAS_DE_EMPRESA } from "../capacidades/permisos/empresa";
import {
  TRABAJO_RECONCILIAR,
  TRABAJO_VALIDAR_COMPROBANTE,
  crearManejadorDeReconciliar,
  crearManejadorDeValidarComprobante,
  type ProveedorDeEmision,
} from "../modulos/fiscal/publico";
import {
  TRABAJO_ENVIAR_INVITACION,
  TRABAJO_REVOCAR_SESIONES,
  crearManejadorDeEnviarInvitacion,
  crearManejadorDeRevocarSesiones,
} from "../modulos/identidad/publico";
import type { Conexiones } from "./conexiones";
import { armarEmisionFiscal } from "./emision-fiscal";
import { perezoso } from "./perezoso";

export type OpcionesDeTrabajos = Readonly<{
  /** Para registrar lo que el procesador no pudo guardar en la cola (llega sin secretos). */
  alRegistrarProblema?: (problema: ProblemaDelProcesador) => void;
  /** Quién habla con ARCA; por defecto, el real por (emisor, ambiente). En pruebas, el falso. */
  emision?: ProveedorDeEmision;
  /** La hora de lo que sigue a una llamada a ARCA; por defecto, el reloj del sistema. */
  reloj?: Readonly<{ ahora(): Date }>;
}>;

/**
 * El procesador de la cola y los manejadores de los tipos de trabajo que existen. Hoy `enviar_invitacion`,
 * `revocar_sesiones` (h5-p8 §2.5: la suspensión de una persona lo encola y se borran sus sesiones con el rol de
 * autenticación; la conexión de autenticación se pide recién al ejecutar el trabajo) y los dos de fiscal:
 * `fiscal.validar_comprobante` (lleva un comprobante `PENDIENTE` a ARCA) y `fiscal.reconciliar` (resuelve consultando
 * los que quedaron en vuelo de una empresa). Los de fiscal corren sin persona (ADR-007) con la transacción de la
 * aplicación y el proveedor de emisión, que pide la clave de los certificados recién al hablar con ARCA: sin ella el
 * procesador se arma igual y el comprobante vuelve a `PENDIENTE`. Los avisos del traspaso de gerencia se encolan pero
 * todavía no tienen manejador (queda para quien los envíe). El cron y el despacho inmediato (`after()`) son de W6;
 * acá solo se arma el procesador. Se crea la primera vez que se pide.
 */
export function armarTrabajos(conexiones: Conexiones, opciones: OpcionesDeTrabajos = {}) {
  const { reloj } = opciones;
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
      const dependenciasDeFacturacion = {
        transacciones: conexiones.transaccionesDeApp(),
        reglas: REGLAS_DE_EMPRESA,
        emision:
          opciones.emision ?? armarEmisionFiscal(conexiones, reloj === undefined ? {} : { reloj }),
        reloj: reloj ?? { ahora: () => new Date() },
      };
      return crearProcesadorDeTrabajos({
        transacciones: conexiones.transaccionesDeTrabajos(),
        manejadores: new Map([
          [TRABAJO_ENVIAR_INVITACION, manejadorDeInvitaciones],
          [
            TRABAJO_VALIDAR_COMPROBANTE,
            crearManejadorDeValidarComprobante(dependenciasDeFacturacion),
          ],
          [TRABAJO_RECONCILIAR, crearManejadorDeReconciliar(dependenciasDeFacturacion)],
          [
            TRABAJO_REVOCAR_SESIONES,
            crearManejadorDeRevocarSesiones({
              revocacion: () => conexiones.revocacionDeSesiones(),
            }),
          ],
        ]),
        ...(opciones.alRegistrarProblema === undefined
          ? {}
          : { alRegistrarProblema: opciones.alRegistrarProblema }),
      });
    }),
  };
}

export type Trabajos = ReturnType<typeof armarTrabajos>;
