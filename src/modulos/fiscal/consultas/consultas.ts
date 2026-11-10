import type { DependenciasDeConsultasDeFacturacion } from "./contrato";
import type { DECLARACIONES_DE_CONSULTAS } from "./declaraciones";
import { armarDatosFiscalesDelEmisor } from "./datos-fiscales-del-emisor";
import { armarDiscriminaIvaAlEmitir } from "./discrimina-iva-al-emitir";
import { armarEstadoDeCertificados } from "./estado-de-certificados";
import { armarEstadoDeLaConfiguracionFiscal } from "./estado-de-la-configuracion-fiscal";
import { armarListarComprobantes } from "./listar-comprobantes";
import { armarModeloDeImpresion } from "./modelo-de-impresion";
import { armarListarPuntosDeVentaDeLaSucursal } from "./puntos-de-venta-de-la-sucursal";
import { armarPuntosDeVentaDelEmisor } from "./puntos-de-venta-del-emisor";
import { armarListarPuntosDeVentaParaEmitir } from "./puntos-de-venta-para-emitir";
import { armarVerComprobante } from "./ver-comprobante";
import { armarComprobanteVigenteDeUnOrigen } from "./comprobante-vigente-de-un-origen";
import { armarVigenciaDeComprobantes } from "./vigencia-de-comprobantes";

/**
 * Las consultas por pantalla del facturador (ADR-005). El `satisfies` exige que sean EXACTAMENTE las que declara
 * `DECLARACIONES_DE_CONSULTAS` (qué acción exige cada una): una consulta sin declarar, o una declaración sin
 * consulta, no compila.
 */
export function crearConsultasDeFacturacion(dependencias: DependenciasDeConsultasDeFacturacion) {
  return {
    listarComprobantes: armarListarComprobantes(dependencias),
    listarPuntosDeVentaDeLaSucursal: armarListarPuntosDeVentaDeLaSucursal(dependencias),
    discriminaIvaAlEmitir: armarDiscriminaIvaAlEmitir(dependencias),
    listarPuntosDeVentaParaEmitir: armarListarPuntosDeVentaParaEmitir(dependencias),
    verComprobante: armarVerComprobante(dependencias),
    vigenciaDeComprobantes: armarVigenciaDeComprobantes(dependencias),
    comprobanteVigenteDeUnOrigen: armarComprobanteVigenteDeUnOrigen(dependencias),
    modeloDeImpresion: armarModeloDeImpresion(dependencias),
    estadoDeCertificados: armarEstadoDeCertificados(dependencias),
    estadoDeLaConfiguracionFiscal: armarEstadoDeLaConfiguracionFiscal(dependencias),
    datosFiscalesDelEmisor: armarDatosFiscalesDelEmisor(dependencias),
    puntosDeVentaDelEmisor: armarPuntosDeVentaDelEmisor(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES_DE_CONSULTAS, unknown>;
}

export type ConsultasDeFacturacion = ReturnType<typeof crearConsultasDeFacturacion>;
