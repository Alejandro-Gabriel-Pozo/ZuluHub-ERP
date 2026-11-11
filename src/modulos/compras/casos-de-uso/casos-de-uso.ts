import { armarAnularCompra } from "./anular-compra";
import { armarCorregirCompra } from "./correcciones";
import { armarAnularPago, armarDeclararPago } from "./pagos";
import { armarConfigurarCompras } from "./configuracion";
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
    anularCompra: armarAnularCompra(dependencias),
    configurarCompras: armarConfigurarCompras(dependencias),
    declararPago: armarDeclararPago(dependencias),
    anularPago: armarAnularPago(dependencias),
    corregirCompra: armarCorregirCompra(dependencias),
  } satisfies Record<keyof typeof DECLARACIONES, unknown>;
}

export type CasosDeUsoDeCompras = ReturnType<typeof crearCasosDeUsoDeCompras>;
