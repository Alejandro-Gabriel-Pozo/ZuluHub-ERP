import { armarAnularCompra } from "./anular-compra";
import { armarCorregirCompra } from "./correcciones";
import { armarAnularPago, armarDeclararPago } from "./pagos";
import { armarConfigurarCompras } from "./configuracion";
import { armarAnularConciliacion, armarConciliarFactura } from "./conciliar-factura";
import { armarAnularFactura } from "./anular-factura";
import { armarRegistrarFactura } from "./registrar-factura";
import { armarAnularRecepcionPendiente, armarConfirmarRecepcion } from "./confirmar-recepcion";
import { armarRegistrarRecepcion } from "./registrar-recepcion";
import { armarCrearOrden, armarEditarOrden } from "./ordenes";
import { armarAnularDevolucion, armarDevolverAlProveedor } from "./devoluciones";
import { armarConfigurarTolerancias, armarResolverDiferencia } from "./diferencias";
import { armarAnularOrden, armarCerrarOrden, armarPedirOrden } from "./ordenes-de-estado";
import { armarRegistrarCompra, armarRegistrarCompraConFactura } from "./registrar-compra";
import type { DependenciasDeCompras } from "./contrato";
import type { DECLARACIONES } from "./declaraciones";
import {
  armarAgregarComprobante,
  armarAgregarPuntoDeVenta,
  armarDejarDeUsarComprobante,
  armarDejarDeUsarPuntoDeVenta,
  armarPedirComprobante,
  armarPedirPuntoDeVenta,
  armarResolverPedido,
} from "./ficha";

/**
 * Los casos de uso de compras, listos para que la composición los ofrezca. El `satisfies` exige que sean EXACTAMENTE los que declara `DECLARACIONES` (qué acción
 * exige cada uno y cómo se repite): uno nuevo sin declarar, o una declaración sin caso de uso, no compila.
 */
export function crearCasosDeUsoDeCompras(dependencias: DependenciasDeCompras) {
  return {
    agregarPuntoDeVenta: armarAgregarPuntoDeVenta(dependencias),
    dejarDeUsarPuntoDeVenta: armarDejarDeUsarPuntoDeVenta(dependencias),
    agregarComprobante: armarAgregarComprobante(dependencias),
    dejarDeUsarComprobante: armarDejarDeUsarComprobante(dependencias),
    pedirPuntoDeVenta: armarPedirPuntoDeVenta(dependencias),
    pedirComprobante: armarPedirComprobante(dependencias),
    resolverPedido: armarResolverPedido(dependencias),
    registrarCompra: armarRegistrarCompra(dependencias),
    registrarCompraConFactura: armarRegistrarCompraConFactura(dependencias),
    registrarRecepcion: armarRegistrarRecepcion(dependencias),
    confirmarRecepcion: armarConfirmarRecepcion(dependencias),
    anularRecepcionPendiente: armarAnularRecepcionPendiente(dependencias),
    registrarFactura: armarRegistrarFactura(dependencias),
    anularFactura: armarAnularFactura(dependencias),
    conciliarFactura: armarConciliarFactura(dependencias),
    anularConciliacion: armarAnularConciliacion(dependencias),
    crearOrden: armarCrearOrden(dependencias),
    editarOrden: armarEditarOrden(dependencias),
    pedirOrden: armarPedirOrden(dependencias),
    cerrarOrden: armarCerrarOrden(dependencias),
    anularOrden: armarAnularOrden(dependencias),
    devolverAlProveedor: armarDevolverAlProveedor(dependencias),
    anularDevolucion: armarAnularDevolucion(dependencias),
    configurarTolerancias: armarConfigurarTolerancias(dependencias),
    resolverDiferencia: armarResolverDiferencia(dependencias),
    anularCompra: armarAnularCompra(dependencias),
    configurarCompras: armarConfigurarCompras(dependencias),
    declararPago: armarDeclararPago(dependencias),
    anularPago: armarAnularPago(dependencias),
    corregirCompra: armarCorregirCompra(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCompras = ReturnType<typeof crearCasosDeUsoDeCompras>;
