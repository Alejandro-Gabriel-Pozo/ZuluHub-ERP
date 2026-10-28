import {
  crearProcesadorDeTrabajos,
  type ProblemaDelProcesador,
  type ProcesadorDeTrabajos,
} from "../adaptadores/trabajos/procesador";
import { REGLAS_DE_EMPRESA } from "../capacidades/permisos/empresa";
import {
  TRABAJO_RECONCILIAR,
  TRABAJO_VALIDAR_COMPROBANTE,
  contextoDeSistema,
  crearManejadorDeReconciliar,
  crearManejadorDeValidarComprobante,
  type ProveedorDeEmision,
} from "../modulos/fiscal/publico";
import { empresaId, type EmpresaId } from "../primitivas/identificadores/marca";
import { ok } from "../primitivas/resultado/resultado";
import {
  TRABAJO_ENVIAR_INVITACION,
  TRABAJO_REVOCAR_SESIONES,
  crearManejadorDeEnviarInvitacion,
  crearManejadorDeRevocarSesiones,
} from "../modulos/identidad/publico";
import type { ManejadorDeTrabajo } from "../puertos/cola-de-trabajos";
import type { Conexiones } from "./conexiones";
import { armarEmisionFiscal } from "./emision-fiscal";
import { perezoso } from "./perezoso";
import { LIMITE_DE_TRABAJOS_POR_PASADA } from "./rutas-de-sistema";
import { tipoDeFalla } from "./tipo-de-falla";

/**
 * Cuánto hacia atrás mira el cron para saber qué empresas facturan: las que encolaron una validación en los últimos 30
 * días. ASUMIDO: un comprobante en vuelo (`INCIERTO`) se resuelve en minutos u horas; esto cubre el caso de una consulta a
 * ARCA que falla por semanas. Una empresa sin validaciones en esa ventana no tiene qué reconciliar.
 */
export const VENTANA_DE_ACTIVIDAD_FISCAL_EN_MS = 30 * 24 * 3_600_000;
/**
 * Cuántas empresas encola una pasada del cron: no más de los trabajos que esa misma pasada despacha
 * (`LIMITE_DE_TRABAJOS_POR_PASADA`), para que lo encolado no se acumule sin que alcance a procesarse. Las que no entran
 * van en la pasada siguiente: se atiende primero a las que hace más que no se reconcilian, así que todas se recorren.
 */
export const EMPRESAS_POR_PASADA_DE_RECONCILIACION = LIMITE_DE_TRABAJOS_POR_PASADA;

/**
 * La clave de idempotencia de la reconciliación de una empresa: UNA por hora (UTC). Dos pasadas del cron en la misma
 * hora no encolan dos veces (`YA_ENCOLADO`) y, con el cron diario de hoy, es una por día.
 */
export const claveDeReconciliacion = (empresa: EmpresaId, ahora: Date): string =>
  `fiscal.reconciliar:${empresa}:${ahora.toISOString().slice(0, 13)}`;

export type ResumenDeReconciliaciones = Readonly<{
  empresas: number;
  encoladas: number;
  yaEncoladas: number;
}>;

export type OpcionesDeTrabajos = Readonly<{
  /** Para registrar lo que el procesador no pudo guardar en la cola (llega sin secretos). */
  alRegistrarProblema?: (problema: ProblemaDelProcesador) => void;
  /** Quién habla con ARCA; por defecto, el real por (emisor, ambiente). En pruebas, el falso. */
  emision?: ProveedorDeEmision;
  /** La hora de lo que sigue a una llamada a ARCA; por defecto, el reloj del sistema. */
  reloj?: Readonly<{ ahora(): Date }>;
}>;

/** Un manejador que se arma la primera vez que corre (y se vuelve a intentar armar si lanzó). */
function diferido(armar: () => ManejadorDeTrabajo): ManejadorDeTrabajo {
  const manejador = perezoso(armar);
  return (trabajo, ahora) => manejador()(trabajo, ahora);
}

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
    /**
     * Encola `fiscal.reconciliar` por cada empresa que facturó hace poco (H7 facturación §B.4.7): el productor del
     * trabajo de reconciliación, que llama el cron antes de despachar. Qué empresas hay lo dice la propia cola (el cron
     * no puede leer comprobantes de todas las empresas: la base los aísla por empresa); encolar es una transacción por
     * empresa, con su contexto de sistema, y repetirlo en la misma hora no duplica nada. Si falla alguna empresa, sigue
     * con las demás y al final avisa cuántas fallaron (sin datos de ninguna); la próxima pasada las reintenta. Cada
     * pasada encola a lo sumo `EMPRESAS_POR_PASADA_DE_RECONCILIACION` empresas, las que hace más que no se reconcilian.
     *
     * Escribe en `trabajo` sin auditoría a propósito: es infraestructura de la cola, sin dato de negocio (no toca
     * comprobantes, series ni importes). La reconciliación sí audita cada comprobante que resuelve, en su transacción.
     */
    async encolarReconciliaciones(ahora: Date): Promise<ResumenDeReconciliaciones> {
      const desde = new Date(ahora.getTime() - VENTANA_DE_ACTIVIDAD_FISCAL_EN_MS);
      const leidas = await conexiones.transaccionesDeTrabajos().ejecutar(
        {
          contexto: { tipo: "TRABAJOS", ahora },
          aislamiento: "read committed",
          soloLectura: true,
        },
        async ({ cola }) =>
          ok(
            await cola.empresasConTrabajosDe(
              TRABAJO_VALIDAR_COMPROBANTE,
              desde,
              EMPRESAS_POR_PASADA_DE_RECONCILIACION,
              TRABAJO_RECONCILIAR,
            ),
          ),
      );
      if (!leidas.ok) throw new Error(`la cola de trabajos falló: ${leidas.error.tipo}`);
      let encoladas = 0;
      let yaEncoladas = 0;
      /** De qué tipo fue cada falla (nunca el mensaje ni la empresa): lo único que va al aviso del cron. */
      const fallas: string[] = [];
      for (const empresa of leidas.valor) {
        try {
          const encolado = await conexiones
            .transaccionesDeApp()
            .ejecutar({ contexto: contextoDeSistema(empresaId(empresa), ahora) }, async (tx) =>
              ok(
                await tx.trabajos.encolar({
                  empresaId: empresa,
                  tipo: TRABAJO_RECONCILIAR,
                  datos: {},
                  claveDeIdempotencia: claveDeReconciliacion(empresa, ahora),
                }),
              ),
            );
          if (!encolado.ok) fallas.push(encolado.error.tipo);
          else if (encolado.valor === "ENCOLADO") encoladas += 1;
          else yaEncoladas += 1;
        } catch (error) {
          fallas.push(tipoDeFalla(error));
        }
      }
      if (fallas.length > 0) {
        throw new Error(
          `no se pudo encolar la reconciliación de ${fallas.length} de ${leidas.valor.length} empresas (${[...new Set(fallas)].sort().join(", ")})`,
        );
      }
      return { empresas: leidas.valor.length, encoladas, yaEncoladas };
    },

    procesador: perezoso((): ProcesadorDeTrabajos => {
      // Cada manejador se arma recién al ejecutar un trabajo de su tipo: así los de fiscal no dependen de la
      // configuración del correo (Resend, URL base) y una variable que falta rompe solo al tipo que la necesita; ese
      // trabajo falla (con reintento) y los demás siguen. Lo que se arma bien se guarda; lo que lanza se vuelve a intentar.
      const manejadorDeInvitaciones = diferido(() => {
        const { urlBase, nombreDeMarca } = conexiones.configuracionDeCorreo();
        return crearManejadorDeEnviarInvitacion({
          // El envío corre con el contexto OPERATIVO de la empresa del trabajo: por la puerta de la aplicación.
          transacciones: conexiones.transaccionesDeApp(),
          tokens: conexiones.tokens(),
          correo: conexiones.correo(),
          urlBase,
          marca: { nombre: nombreDeMarca },
        });
      });
      const dependenciasDeFacturacion = perezoso(() => ({
        transacciones: conexiones.transaccionesDeApp(),
        reglas: REGLAS_DE_EMPRESA,
        emision:
          opciones.emision ?? armarEmisionFiscal(conexiones, reloj === undefined ? {} : { reloj }),
        reloj: reloj ?? { ahora: () => new Date() },
      }));
      return crearProcesadorDeTrabajos({
        transacciones: conexiones.transaccionesDeTrabajos(),
        manejadores: new Map([
          [TRABAJO_ENVIAR_INVITACION, manejadorDeInvitaciones],
          [
            TRABAJO_VALIDAR_COMPROBANTE,
            diferido(() => crearManejadorDeValidarComprobante(dependenciasDeFacturacion())),
          ],
          [
            TRABAJO_RECONCILIAR,
            diferido(() => crearManejadorDeReconciliar(dependenciasDeFacturacion())),
          ],
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
