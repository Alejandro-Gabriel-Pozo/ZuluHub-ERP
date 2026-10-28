import { REGLAS_DE_EMPRESA, type ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import { crearCasosDeUsoDeEmpresas, crearConsultasDeEmpresas } from "../modulos/empresas/publico";
import {
  crearCasosDeUsoDeFacturacion,
  crearConsultasDeFacturacion,
  type ProveedorDeEmision,
} from "../modulos/fiscal/publico";
import {
  crearCasosDeUsoDeIdentidad,
  crearConsultasDeIdentidad,
  crearConsultasDeSesion,
} from "../modulos/identidad/publico";
import type { Conexiones } from "./conexiones";
import { armarEmisionFiscal } from "./emision-fiscal";
import { perezoso } from "./perezoso";

/**
 * Lo que ofrece la composición a la aplicación web: los casos de uso y las consultas de empresas e
 * identidad que ya existen, armados a mano (sin contenedor de inyección) sobre las conexiones. Cada
 * grupo se arma la primera vez que se pide; hasta entonces no se lee ninguna variable.
 *
 * La resolución de un host a su dueño y su marca (`resolucionDeHost`, M4) es la puerta pública: sin
 * sesión, solo lectura, con su propia conexión. Devuelve el host servible o nada. Cómo se pinta su marca
 * (`configuracionPublicaDeHost`, M4b: nombre, tema validado y host canónico) sale por la misma puerta;
 * el logo y el vocabulario llegan con la puerta web (M9).
 *
 * Fiscal (H7): `casosDeUsoDeFacturacion` (emitir factura, nota de crédito y de débito, descartar, reintentar,
 * resincronizar una serie y cambiar el ambiente de un punto de venta) y `consultasDeFacturacion` (listado y detalle de
 * comprobantes). Cada uno exige SU acción al guard dentro de la transacción: acá no se decide ningún permiso. Quedan
 * AFUERA, a propósito: la configuración fiscal (datos fiscales, puntos de venta y regla de emisor: ninguna acción la usa
 * todavía; se suma con su pantalla), los dos trabajos de sistema (`validarComprobante` y `reconciliarComprobantes`, sin guard: son
 * de la cola), la numeración suelta (`reservarNumeroDeComprobante`...: la web entra solo por emitir, h7 §C), el modelo
 * de impresión (F9: falta la marca y la librería del QR) y los certificados (faltan las cadenas de confianza de
 * ARCA, D-F7). `consultasDeSesion` (la
 * persona del usuario y sus empresas, puerta `SESION`) llegó con W3a. La autenticación (W3b) es otra
 * puerta: `autenticacion()` dice QUIÉN es (usuario y email verificado, por host) y `barridoDeAutenticacion()`
 * es lo que llama el cron; la persona y las empresas salen después, con el contexto `SESION`.
 */
export type OpcionesDeWeb = Readonly<{
  /** El catálogo y la matriz con los que el guard autoriza; por defecto, los reales. En pruebas, uno con `facturacion` disponible. */
  reglas?: ReglasDeEmpresa;
  /** Quién habla con ARCA; por defecto, el real por (emisor, ambiente). En pruebas, el falso. */
  emision?: ProveedorDeEmision;
  /** La hora de lo que sigue a una llamada a ARCA; por defecto, el reloj del sistema. */
  reloj?: Readonly<{ ahora(): Date }>;
}>;

export function armarWeb(conexiones: Conexiones, opciones: OpcionesDeWeb = {}) {
  const reglas = opciones.reglas ?? REGLAS_DE_EMPRESA;
  const reloj = opciones.reloj ?? { ahora: () => new Date() };
  // Armarlo no lee ninguna variable: el proveedor pide la clave de los certificados recién al hablar con ARCA.
  const emision = opciones.emision ?? armarEmisionFiscal(conexiones, { reloj });
  return {
    resolucionDeHost: () => conexiones.resolucionDeHost(),
    configuracionPublicaDeHost: () => conexiones.configuracionPublicaDeHost(),
    autenticacion: () => conexiones.autenticacion(),
    barridoDeAutenticacion: () => conexiones.barridoDeAutenticacion(),
    casosDeUsoDeEmpresas: perezoso(() =>
      crearCasosDeUsoDeEmpresas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeEmpresas: perezoso(() =>
      crearConsultasDeEmpresas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    casosDeUsoDeIdentidad: perezoso(() =>
      crearCasosDeUsoDeIdentidad({
        transacciones: conexiones.transaccionesDeApp(),
        tokens: conexiones.tokens(),
        reglas,
      }),
    ),
    consultasDeIdentidad: perezoso(() =>
      crearConsultasDeIdentidad({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /** Las siete acciones de facturación que dispara una persona; los trabajos de sistema NO salen por acá. */
    casosDeUsoDeFacturacion: perezoso(() => {
      const casos = crearCasosDeUsoDeFacturacion({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        emision,
        reloj,
      });
      return {
        emitirComprobanteManual: casos.emitirComprobanteManual,
        emitirNotaDeCredito: casos.emitirNotaDeCredito,
        emitirNotaDeDebito: casos.emitirNotaDeDebito,
        descartarComprobante: casos.descartarComprobante,
        reintentarComprobante: casos.reintentarComprobante,
        resincronizarSerie: casos.resincronizarSerie,
        cambiarAmbienteDePuntoDeVenta: casos.cambiarAmbienteDePuntoDeVenta,
      };
    }),
    /** Listado y detalle de comprobantes (`comprobantes.ver`); el modelo de impresión es de F9 y no sale. */
    consultasDeFacturacion: perezoso(() => {
      const consultas = crearConsultasDeFacturacion({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
      });
      return {
        listarComprobantes: consultas.listarComprobantes,
        verComprobante: consultas.verComprobante,
      };
    }),
    /** `personaDeLaSesion` y `empresasDeLaSesion`: contexto `SESION`, sin empresa ni guard (W3a). */
    consultasDeSesion: perezoso(() =>
      crearConsultasDeSesion({ transacciones: conexiones.transaccionesDeApp() }),
    ),
  };
}

export type Web = ReturnType<typeof armarWeb>;
