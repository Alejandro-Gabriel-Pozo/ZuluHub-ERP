import type { DeclaracionDeCaso } from "../../../capacidades/permisos/declaracion";

/**
 * Las consultas por pantalla del facturador (H7 facturación, especificación §B.4.9) y la acción que cada una
 * exige al guard (cruce X1 de ADR-003). Mirar lo emitido lo pueden los tres roles y es de solo lectura: un
 * plan dado de baja sigue viendo sus comprobantes. El estado de los certificados de ARCA es del gerente (D-43: la
 * configuración fiscal es solo del gerente) y reutiliza `certificados.gestionar`: no se creó un permiso nuevo para mirar.
 *
 * Las tres de configuración fiscal (la lista de lo que falta, los datos fiscales y los puntos de venta de un emisor) también
 * son del gerente y reutilizan la acción de quien edita lo que muestran, que ya existe y es de `administracion`
 * (obligatorio, nunca en solo lectura): el gerente configura ANTES de que exista la facturación, así que mirar su
 * configuración no puede depender de que ese módulo esté activo. Tampoco se creó un permiso nuevo para mirar.
 */
export const DECLARACIONES_DE_CONSULTAS = {
  listarComprobantes: { accion: "comprobantes.ver" },
  listarPuntosDeVentaDeLaSucursal: { accion: "comprobantes.ver" },
  verComprobante: { accion: "comprobantes.ver" },
  modeloDeImpresion: { accion: "comprobantes.ver" },
  estadoDeCertificados: { accion: "certificados.gestionar" },
  estadoDeLaConfiguracionFiscal: { accion: "datos_fiscales.editar" },
  datosFiscalesDelEmisor: { accion: "datos_fiscales.editar" },
  puntosDeVentaDelEmisor: { accion: "puntos_de_venta.editar" },
} as const satisfies Record<string, DeclaracionDeCaso>;
