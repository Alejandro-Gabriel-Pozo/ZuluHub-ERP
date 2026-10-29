import { crearEmisionArca } from "../adaptadores/arca/adaptador-arca";
import type { Transporte } from "../adaptadores/arca/tipos";
import { crearTransporteHttp } from "../adaptadores/arca/transporte-http";
import { crearAlmacenDeTickets } from "../adaptadores/certificados/almacen-de-tickets";
import { crearCredencialesDeEmisor } from "../adaptadores/certificados/credenciales-de-emisor";
import { crearVerificacionDeAutorizacion } from "../adaptadores/certificados/verificacion-de-autorizacion";
import type {
  EmisionElectronica,
  ErrorDeEmision,
  ProveedorDeEmision,
  ResultadoDeAutorizacionArca,
  ResultadoDeConsulta,
} from "../modulos/fiscal/publico";
import { err, type Resultado } from "../primitivas/resultado/resultado";
import type { Conexiones } from "./conexiones";
import { perezoso } from "./perezoso";
import { tipoDeFalla } from "./tipo-de-falla";

/**
 * El proveedor de emisión de la web y de los trabajos (spec H7 facturación §B.5.2, §B.5.3 y §B.6.3): dado una
 * empresa, un emisor y un ambiente, el cliente de ARCA de ESE par, con las credenciales descifradas de ESE emisor
 * y el ticket de acceso de ESE (emisor, ambiente). Lo usan los casos de uso de facturación (`emision.para(...)`)
 * siempre FUERA de una transacción (ADR-007).
 *
 * Reglas, cada una con su chequeo en `emision-fiscal.test.ts` y `test/integracion/fiscal-cableado-emision.test.ts`:
 *  - **Nada se mezcla.** El cliente se arma por llamada con la empresa, el emisor y el ambiente EXACTOS que se
 *    pidieron, y no se memoiza nada por par: lo único compartido son las piezas sin estado (el cifrador, las
 *    transacciones y el transporte). El ticket y la credencial se buscan en la base por (empresa, emisor,
 *    ambiente) y el certificado `VIGENTE` de ese par: un ticket de homologación no existe para producción.
 *    Previene: emitir con el certificado de otro emisor o con el ticket del otro ambiente.
 *  - **Perezoso.** Armar el proveedor no lee ninguna variable (P-12): la clave de los certificados se pide la primera
 *    vez que un cliente hace falta, y si falta o no sirve no se memoiza el fallo (se corrige en Vercel y sigue).
 *  - **`para` nunca lanza.** Sin la clave no hay cómo descifrar: el cliente que devuelve contesta con fallas
 *    seguras (`NO_ENVIADO`, `CONSULTA_FALLIDA`, `SERVICIO_NO_DISPONIBLE`), no con una excepción. Una excepción
 *    DESPUÉS de reservar el número (el caso de uso llama a `para` con el comprobante ya `EN_VALIDACION`) dejaría
 *    el número reservado hasta que lo levante la reconciliación; `NO_ENVIADO` lo devuelve a `PENDIENTE` y libera
 *    la serie. La causa va al registro del servidor, con el NOMBRE de la variable y nunca su valor.
 */

export type OpcionesDeEmisionFiscal = Readonly<{
  /** Cómo se habla con ARCA; por defecto, HTTPS real. En pruebas, un transporte en memoria. */
  transporte?: Transporte;
  /** La hora (vigencia del certificado y del ticket, TRA); por defecto, el reloj del sistema. */
  reloj?: Readonly<{ ahora(): Date }>;
  /** Espera `ms`; por defecto, un temporizador real. En pruebas, instantánea. */
  esperar?: (ms: number) => Promise<void>;
  /** Registro del servidor: recibe la causa (sin secretos) de un cliente que no se pudo armar. */
  registrar?: (detalle: string) => void;
}>;

const esperarDeVerdad = (ms: number): Promise<void> =>
  new Promise((resolver) => setTimeout(resolver, ms));

const SIN_CLIENTE = "la configuración de ARCA no está disponible";

/**
 * Un servicio de emisión que no pudo armarse: cada operación falla con un valor del puerto y sin tocar la red.
 * `NO_ENVIADO` es seguro por construcción (no se armó nada que pudiera salir).
 */
function emisionSinCliente(): EmisionElectronica {
  return {
    ultimoAutorizado: (): Promise<Resultado<bigint, ErrorDeEmision>> =>
      Promise.resolve(err({ codigo: "SERVICIO_NO_DISPONIBLE", detalle: SIN_CLIENTE })),
    autorizar: (): Promise<ResultadoDeAutorizacionArca> =>
      Promise.resolve({ tipo: "NO_ENVIADO", motivo: SIN_CLIENTE }),
    consultar: (): Promise<ResultadoDeConsulta> =>
      Promise.resolve({ tipo: "CONSULTA_FALLIDA", detalle: SIN_CLIENTE }),
  };
}

export function armarEmisionFiscal(
  conexiones: Conexiones,
  opciones: OpcionesDeEmisionFiscal = {},
): ProveedorDeEmision {
  const reloj = opciones.reloj ?? { ahora: () => new Date() };
  const registrar = opciones.registrar ?? (() => undefined);
  const transporte = opciones.transporte ?? crearTransporteHttp();
  const esperar = opciones.esperar ?? esperarDeVerdad;

  /** Las piezas sin estado que comparten todos los clientes; se piden (y validan) la primera vez. */
  const compartidas = perezoso(() => {
    const transacciones = conexiones.transaccionesDeApp();
    const cifrador = conexiones.cifradorDeCertificados();
    return {
      credenciales: crearCredencialesDeEmisor({ transacciones, cifrador, reloj }),
      tickets: crearAlmacenDeTickets({ transacciones, cifrador, reloj }),
      verificacion: crearVerificacionDeAutorizacion({ transacciones, reloj }),
      transporte,
      reloj,
      esperar,
    };
  });

  return {
    para(empresa, emisor, ambiente) {
      try {
        return crearEmisionArca(compartidas(), empresa, emisor, ambiente);
      } catch (error) {
        // El detalle de un fallo de entorno ya lo registró la composición (con el nombre de la variable); acá va
        // solo el tipo, nunca el mensaje.
        try {
          registrar(`[fiscal] no se pudo armar el cliente de ARCA (${tipoDeFalla(error)})`);
        } catch {
          // Un registro que falla no cambia lo que se devuelve.
        }
        return emisionSinCliente();
      }
    },
  };
}
