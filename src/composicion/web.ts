import { crearGeneradorDeCredenciales } from "../adaptadores/certificados/generador-pkijs";
import {
  crearLectorDeCertificados,
  type CadenasDeConfianza,
} from "../adaptadores/certificados/lector-x509";
import { CADENAS_DE_CONFIANZA_DE_ARCA } from "./cadenas-de-confianza-de-arca";
import { crearEgresoDeCaja } from "./egreso-de-caja";
import { crearIvaDeLaEmpresa } from "./iva-de-la-empresa";
import { REGLAS_DE_EMPRESA, type ReglasDeEmpresa } from "../capacidades/permisos/empresa";
import {
  crearCasosDeUsoDeCaja,
  crearConsultasDeCaja,
  ganchoDeSucursalDeCaja,
} from "../modulos/caja/publico";
import { crearCasosDeUsoDeCatalogo, crearConsultasDeCatalogo } from "../modulos/catalogo/publico";
import { crearCasosDeUsoDeComandas, crearConsultasDeComandas } from "../modulos/comandas/publico";
import { crearCasosDeUsoDeSalon, crearConsultasDeSalon } from "../modulos/salon/publico";
import { crearCasosDeUsoDeClientes, crearConsultasDeClientes } from "../modulos/clientes/publico";
import { crearCasosDeUsoDeCompras, crearConsultasDeCompras } from "../modulos/compras/publico";
import {
  crearCasosDeUsoDeProduccion,
  crearConsultasDeProduccion,
} from "../modulos/produccion/publico";
import {
  crearCasosDeUsoDeStock,
  crearConsultasDeStock,
  crearPuertosDeStock,
} from "../modulos/stock/publico";
import { crearCasosDeUsoDeVentas, crearConsultasDeVentas } from "../modulos/ventas/publico";
import { crearFacturadorDeTickets } from "./facturacion-de-tickets";
import { crearExistenciasDeCatalogo, generarCodigoDeCarta } from "./existencias-de-catalogo";
import { crearStockDeVentas } from "./stock-de-ventas";
import {
  crearCasosDeUsoDeCierre,
  crearConsultasDeCierre,
  crearGanchoDeCierreAlDesactivar,
} from "../modulos/cierre/publico";
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
import type { LecturasCompartidas } from "../puertos/transacciones";
import { APORTES_AL_CIERRE } from "./aportes-al-cierre";
import { ticketsPorCobranzaDeLaComposicion } from "./cierre-de-caja";
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
 * de la cola), la numeración suelta (`reservarNumeroDeComprobante`...: la web entra solo por emitir, h7 §C). El modelo
 * de impresión sale en `consultasDeFacturacion` (`comprobantes.ver`) con la marca vacía de la primera entrega
 * (`conexiones.ts`, `MARCA_DE_IMPRESION_VACIA`, D-112). Las acciones de certificados (generar el pedido y cargar el certificado que
 * devolvió ARCA, `certificados.gestionar`) salen en `casosDeUsoDeCertificados`; su ESTADO, en `consultasDeFacturacion`. Las cadenas de
 * confianza de ARCA con las que se valida un certificado cargado salen de `cadenas-de-confianza-de-arca.ts`: solo la de
 * HOMOLOGACIÓN (verificada por el dueño); la de PRODUCCIÓN está vacía y la carga falla cerrado (`CADENA_NO_CONFIABLE`). `consultasDeSesion` (la
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
   * Las autoridades (PEM) de ARCA contra las que cierra la cadena de un certificado cargado, por ambiente. Por defecto, las verificadas de
   * `cadenas-de-confianza-de-arca.ts` (homologación; producción vacía y falla cerrado). En pruebas, las que nacen en la propia prueba.
   */
  cadenasDeConfianza?: CadenasDeConfianza;
}>;

export function armarWeb(conexiones: Conexiones, opciones: OpcionesDeWeb = {}) {
  const reglas = opciones.reglas ?? REGLAS_DE_EMPRESA;
  const reloj = opciones.reloj ?? { ahora: () => new Date() };
  // Armarlo no lee ninguna variable: el proveedor pide la clave de los certificados recién al hablar con ARCA.
  const emision = opciones.emision ?? armarEmisionFiscal(conexiones, { reloj });
  const cadenasDeConfianza = opciones.cadenasDeConfianza ?? CADENAS_DE_CONFIANZA_DE_ARCA;
  return {
    resolucionDeHost: () => conexiones.resolucionDeHost(),
    configuracionPublicaDeHost: () => conexiones.configuracionPublicaDeHost(),
    autenticacion: () => conexiones.autenticacion(),
    barridoDeAutenticacion: () => conexiones.barridoDeAutenticacion(),
    /** Las lecturas de un pedido que comparten una transacción (ver `LecturasCompartidas`): la misma conexión que usan las consultas. */
    lecturasCompartidas: (): LecturasCompartidas => conexiones.transaccionesDeApp(),
    casosDeUsoDeEmpresas: perezoso(() =>
      crearCasosDeUsoDeEmpresas({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        // Lo que nace con cada sucursal (decisión 165): «Caja 1», en la misma transacción que la sucursal.
        ganchosDeSucursal: [ganchoDeSucursalDeCaja],
        // Desactivar una sucursal (decisión 178): no con la jornada en auditoría; abierta sin movimiento se cierra sola; con movimiento
        // se pide el cierre del día. Pregunta a los mismos aportes que el cierre (hoy, caja; ventas lo suma E4).
        ganchosAlDesactivarSucursal: [
          crearGanchoDeCierreAlDesactivar({ reglas, aportes: APORTES_AL_CIERRE }),
        ],
      }),
    ),
    consultasDeEmpresas: perezoso(() =>
      crearConsultasDeEmpresas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /**
     * El catálogo (E2 mínimo): productos, forma de venta, precios, opciones, consumo, copia y secciones de la carta, y sus consultas. Cada
     * uno exige SU acción al guard dentro de la transacción. El módulo `catalogo` sigue `en_desarrollo`: el guard rechaza todo con
     * `MODULO_EN_DESARROLLO` hasta que el dueño lo pase a disponible. `cotizarParaVender` no sale por acá: es el puerto de ventas.
     */
    casosDeUsoDeCatalogo: perezoso(() =>
      crearCasosDeUsoDeCatalogo({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        existencias: crearExistenciasDeCatalogo(),
        generarCodigoDeCarta,
      }),
    ),
    consultasDeCatalogo: perezoso(() =>
      crearConsultasDeCatalogo({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /**
     * El cierre del día (E3b): iniciar y cancelar la auditoría y cerrar la jornada, cada uno con su acción de `cierre`. Los aportes de los
     * módulos que tienen algo que revisar los registra cada etapa en `aportes`: hoy el de caja (E3, tramo 8; solo cuenta si la empresa tiene
     * `caja` activo); el de ventas lo suma E4.
     */
    casosDeUsoDeCierre: perezoso(() =>
      crearCasosDeUsoDeCierre({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        aportes: APORTES_AL_CIERRE,
      }),
    ),
    consultasDeCierre: perezoso(() =>
      crearConsultasDeCierre({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        aportes: APORTES_AL_CIERRE,
      }),
    ),
    /**
     * La configuración de caja (E3): cajas, medios de pago y cuentas de cobro, cada caso con su acción de `caja`. El módulo sigue «en
     * desarrollo» en el catálogo: el guard lo rechaza con `MODULO_EN_DESARROLLO` hasta que el tramo final lo declare disponible.
     * La operación (sesiones, movimientos, cobro) y el cierre del día de caja (corregir un medio, declarar totales, la conciliación) salen por acá.
     */
    casosDeUsoDeCaja: perezoso(() =>
      crearCasosDeUsoDeCaja({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeCaja: perezoso(() =>
      crearConsultasDeCaja({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        // El total vigente de los tickets, que ventas informará cuando exista (E4): hoy, fail-closed (`cierre-de-caja.ts`).
        tickets: ticketsPorCobranzaDeLaComposicion,
      }),
    ),
    /**
     * Ventas (E4): abrir, cargar, anular y cerrar la cuenta y anular el ticket, cada uno con SU acción. El módulo sigue `en_desarrollo`: el
     * guard rechaza todo con `MODULO_EN_DESARROLLO` hasta que el dueño lo pase a disponible.
     */
    casosDeUsoDeVentas: perezoso(() =>
      crearCasosDeUsoDeVentas({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        // Facturar un ticket (E1 §3.4): la composición es el único lugar donde ventas y fiscal se tocan.
        facturador: crearFacturadorDeTickets(reglas),
        // Descontar y devolver stock al cerrar y anular un ticket (E5-T12): la composición es el único lugar donde ventas y stock se tocan.
        stock: crearStockDeVentas(reglas),
      }),
    ),
    consultasDeVentas: perezoso(() =>
      crearConsultasDeVentas({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        facturador: crearFacturadorDeTickets(reglas),
      }),
    ),
    /**
     * Stock (E5): depósitos, artículos, movimientos, conteos y composiciones (casos de uso) y sus consultas, cada uno con SU acción de `stock`. El
     * módulo sigue `en_desarrollo` hasta que el dueño lo pase a disponible: el guard rechaza todo con `MODULO_EN_DESARROLLO`. Los puertos que
     * ofrece a ventas y a compras (`crearPuertosDeStock`) no salen por acá: corren en la transacción de quien los llama y no tienen acción propia.
     */
    casosDeUsoDeStock: perezoso(() =>
      crearCasosDeUsoDeStock({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeStock: perezoso(() =>
      crearConsultasDeStock({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /**
     * Producción (E6): abrir, cerrar, cancelar y anular órdenes (casos de uso) y sus consultas, cada uno con SU acción de `transformaciones`. El módulo
     * sigue `en_desarrollo` hasta que el dueño lo pase a disponible: el guard rechaza todo con `MODULO_EN_DESARROLLO`. Escribe el libro de stock por
     * `stock/publico.ts`, dentro de la MISMA transacción de la orden.
     */
    casosDeUsoDeProduccion: perezoso(() =>
      crearCasosDeUsoDeProduccion({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeProduccion: perezoso(() =>
      crearConsultasDeProduccion({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /**
     * Comandas (E7): enviar a cocina, pedir que salga, anular un ítem enviado, quitar sin enviar, las impresoras y los trabajos de impresión, cada uno con
     * SU acción. El módulo sigue `en_desarrollo` y sin plan (pregunta abierta del dueño): el guard rechaza todo con `MODULO_EN_DESARROLLO`. El papel se
     * imprime en el navegador con el diálogo del sistema: el servidor solo entrega el modelo (`documentoParaImprimir`).
     */
    casosDeUsoDeComandas: perezoso(() =>
      crearCasosDeUsoDeComandas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeComandas: perezoso(() =>
      crearConsultasDeComandas({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /**
     * Salón (E7): las mesas y su plano, el pedido de la mesa, el envío a cocina desde la mesa, cambiar de mesa, unir, dividir y cobrar la mesa. Orquesta
     * ventas y comandas en la MISMA transacción; descuenta stock por el mismo puerto que ventas (la composición es el único lugar donde se tocan). El
     * módulo sigue `en_desarrollo` y sin plan: el guard rechaza todo con `MODULO_EN_DESARROLLO`.
     */
    casosDeUsoDeSalon: perezoso(() =>
      crearCasosDeUsoDeSalon({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        stock: crearStockDeVentas(reglas),
      }),
    ),
    consultasDeSalon: perezoso(() =>
      crearConsultasDeSalon({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /**
     * Clientes y proveedores (E9): el directorio de partes con sus roles y vínculos (casos de uso) y sus consultas, cada uno con SU acción de `partes`. El
     * módulo es de la empresa, no de una sucursal. Los puertos que ofrece a compras (`crearDirectorioDePartes`, `crearRegistroDePartes`) no salen por acá:
     * corren en la transacción de quien los llama.
     */
    casosDeUsoDeClientes: perezoso(() =>
      crearCasosDeUsoDeClientes({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    consultasDeClientes: perezoso(() =>
      crearConsultasDeClientes({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /**
     * Compras (E9, N1 y N2): la ficha del proveedor, «Comprar y recibir» con su factura y su pago, anular, el nivel y las consultas, cada uno con SU acción de
     * `compras`. Los puertos de stock (la entrada por origen, los artículos controlados y la existencia) los arma esta composición y compras los recibe:
     * es el único lugar donde se tocan los dos módulos.
     */
    casosDeUsoDeCompras: perezoso(() =>
      crearCasosDeUsoDeCompras({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        stock: crearPuertosDeStock({ reglas }),
        egresoDeCaja: crearEgresoDeCaja(),
        ivaDeLaEmpresa: crearIvaDeLaEmpresa(),
      }),
    ),
    consultasDeCompras: perezoso(() =>
      crearConsultasDeCompras({ transacciones: conexiones.transaccionesDeApp(), reglas }),
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
     * Listado y detalle de comprobantes, el modelo de impresión de uno autorizado y los puntos de venta de la sucursal para el filtro
     * (todos `comprobantes.ver`). Las dos de la pantalla de Emitir (si la empresa discrimina IVA y los puntos de venta activos de la
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
        modeloDeImpresion: consultas.modeloDeImpresion,
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
