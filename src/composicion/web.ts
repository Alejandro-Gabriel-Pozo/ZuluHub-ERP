import { crearGeneradorDeCredenciales } from "../adaptadores/certificados/generador-pkijs";
import {
  crearLectorDeCertificados,
  type CadenasDeConfianza,
} from "../adaptadores/certificados/lector-x509";
import { REGLAS_DE_EMPRESA, type ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import { crearCasosDeUsoDeEmpresas, crearConsultasDeEmpresas } from "../modulos/empresas/publico";
import {
  crearCasosDeUsoDeCertificados,
  crearCasosDeUsoDeConfiguracionFiscal,
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
 * comprobantes y los puntos de venta de la sucursal) y `casosDeUsoDeConfiguracionFiscal` (D-43: datos fiscales y puntos de venta
 * del gerente, con las consultas de esa pantalla dentro de `consultasDeFacturacion`). Cada uno exige SU acción al guard dentro de la transacción: acá no se decide ningún permiso. Quedan
 * AFUERA, a propósito: la regla de emisor (no es uno de los tres temas de la pantalla), los dos trabajos de sistema (`validarComprobante` y `reconciliarComprobantes`, sin guard: son
 * de la cola), la numeración suelta (`reservarNumeroDeComprobante`...: la web entra solo por emitir, h7 §C), el modelo
 * de impresión (F9: falta la marca y la librería del QR). Las acciones de certificados (generar el pedido y cargar el certificado que
 * devolvió ARCA, `certificados.gestionar`) salen en `casosDeUsoDeCertificados`; su ESTADO, en `consultasDeFacturacion`. Las cadenas de
 * confianza de ARCA con las que se valida un certificado cargado NO están en el repositorio (su autenticidad la confirma el dueño
 * comparando huellas, D-F7): por defecto no hay ninguna y la carga falla cerrado (`CADENA_NO_CONFIABLE`). `consultasDeSesion` (la
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
  /**
   * Las autoridades (PEM) de ARCA contra las que cierra la cadena de un certificado cargado, por ambiente. Por defecto, ninguna: sin
   * autoridades la cadena no cierra y cargar un certificado falla cerrado. En pruebas, las que nacen en la propia prueba.
   */
  cadenasDeConfianza?: CadenasDeConfianza;
}>;

export function armarWeb(conexiones: Conexiones, opciones: OpcionesDeWeb = {}) {
  const reglas = opciones.reglas ?? REGLAS_DE_EMPRESA;
  const reloj = opciones.reloj ?? { ahora: () => new Date() };
  // Armarlo no lee ninguna variable: el proveedor pide la clave de los certificados recién al hablar con ARCA.
  const emision = opciones.emision ?? armarEmisionFiscal(conexiones, { reloj });
  const cadenasDeConfianza = opciones.cadenasDeConfianza ?? { HOMOLOGACION: [], PRODUCCION: [] };
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
    /**
     * La configuración fiscal del gerente (D-43): los datos fiscales (guardar a mano y confirmar) y los puntos de venta (crear, editar,
     * activar y desactivar), cada uno con su acción de `administracion`. La regla del emisor no sale: no es uno de los tres temas.
     */
    casosDeUsoDeConfiguracionFiscal: perezoso(() => {
      const casos = crearCasosDeUsoDeConfiguracionFiscal({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
      });
      return {
        guardarBorradorDeDatosFiscales: casos.guardarBorradorDeDatosFiscales,
        empezarCorreccionDeDatosFiscales: casos.empezarCorreccionDeDatosFiscales,
        confirmarDatosFiscales: casos.confirmarDatosFiscales,
        crearPuntoDeVenta: casos.crearPuntoDeVenta,
        editarPuntoDeVenta: casos.editarPuntoDeVenta,
        activarPuntoDeVenta: casos.activarPuntoDeVenta,
        desactivarPuntoDeVenta: casos.desactivarPuntoDeVenta,
      };
    }),
    /**
     * Las dos acciones del certificado de ARCA, solo del gerente (`certificados.gestionar`, cada una la exige al guard dentro de su
     * transacción): generar el pedido (la clave privada se genera y se guarda cifrada en el servidor, nunca sale) y cargar el
     * certificado que devolvió ARCA. Pide la clave de los certificados (`PEDERNAL_CLAVE_CERTIFICADOS`) recién al armarse, no antes.
     */
    casosDeUsoDeCertificados: perezoso(() => {
      const casos = crearCasosDeUsoDeCertificados({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        cifrador: conexiones.cifradorDeCertificados(),
        generador: crearGeneradorDeCredenciales(),
        lector: crearLectorDeCertificados(cadenasDeConfianza),
      });
      return {
        generarPedidoDeCertificado: casos.generarPedidoDeCertificado,
        cargarCertificado: casos.cargarCertificado,
      };
    }),
    /**
     * Listado y detalle de comprobantes y los puntos de venta de la sucursal para el filtro (todos `comprobantes.ver`); el modelo
     * de impresión es de F9 y no sale. Las dos de la pantalla de Emitir (si la empresa discrimina IVA y los puntos de venta activos de la
     * sucursal, D-86) son de `comprobantes.emitir_manual`. Y las de la pantalla de Configuración fiscal, solo del gerente: el estado de los
     * certificados de un emisor (`certificados.gestionar`), la lista de lo que falta, los datos fiscales y los puntos de venta de
     * un emisor (`datos_fiscales.editar` y `puntos_de_venta.editar`, de `administracion`).
     */
    consultasDeFacturacion: perezoso(() => {
      const consultas = crearConsultasDeFacturacion({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
      });
      return {
        listarComprobantes: consultas.listarComprobantes,
        listarPuntosDeVentaDeLaSucursal: consultas.listarPuntosDeVentaDeLaSucursal,
        discriminaIvaAlEmitir: consultas.discriminaIvaAlEmitir,
        listarPuntosDeVentaParaEmitir: consultas.listarPuntosDeVentaParaEmitir,
        verComprobante: consultas.verComprobante,
        estadoDeCertificados: consultas.estadoDeCertificados,
        estadoDeLaConfiguracionFiscal: consultas.estadoDeLaConfiguracionFiscal,
        datosFiscalesDelEmisor: consultas.datosFiscalesDelEmisor,
        puntosDeVentaDelEmisor: consultas.puntosDeVentaDelEmisor,
      };
    }),
    /** `personaDeLaSesion` y `empresasDeLaSesion`: contexto `SESION`, sin empresa ni guard (W3a). */
    consultasDeSesion: perezoso(() =>
      crearConsultasDeSesion({ transacciones: conexiones.transaccionesDeApp() }),
    ),
  };
}

export type Web = ReturnType<typeof armarWeb>;
