import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TxDeCaja } from "../../caja/publico";
import type { LecturasDeCatalogo } from "../../catalogo/publico";
import type { TxDeJornadas } from "../../cierre/publico";
import type { LecturaDeEstados, RepositorioDeSucursales } from "../../empresas/publico";
import type { FacturadorDeTickets } from "./puertos-de-facturacion";
import type { StockDeVentas } from "./puertos-de-stock";
import type { LecturasDeVentas } from "../persistencia/repositorio-de-lecturas";
import type { RepositorioDeCuentas } from "../persistencia/repositorio-de-cuentas";
import type { RepositorioDeDocumentos } from "../persistencia/repositorio-de-documentos";
import type { RepositorioDeTickets } from "../persistencia/repositorio-de-tickets";

/**
 * Lo que recibe el trabajo de una transacción de ventas (ADR-004, G5): sus repositorios, las LECTURAS del catálogo (con las que cotiza cada
 * línea, en la misma transacción), la jornada de la sucursal (de `cierre`) y los puertos de auditoría y autorización. La composición lo
 * arma sobre la conexión de la transacción, que es la MISMA que ven catálogo, cierre y (en la fase B) caja: lo que se lee y se escribe
 * es atómico con la venta.
 */
export type TxDeVentas = LecturaDeEstados &
  LecturasDeCatalogo &
  TxDeCaja &
  TxDeJornadas &
  Readonly<{
    cuentas: RepositorioDeCuentas;
    tickets: RepositorioDeTickets;
    /** El puntero ticket → comprobante (E1, 0029). */
    documentos: RepositorioDeDocumentos;
    /** El ticket con los renglones de su ejemplar vigente: lo que se factura (E1). */
    lecturasDeVentas: Pick<LecturasDeVentas, "ticketParaFacturar">;
    /** La zona de la empresa y el corte de la sucursal (`datosDeJornada`), para fechar por reloj. */
    sucursales: Pick<RepositorioDeSucursales, "jornadaDe">;
    auditoria: Auditoria;
    /** Quién es el actor, qué módulos tiene la empresa y a qué sucursales llega, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeVentas = Readonly<{
  transacciones: Transacciones<TxDeVentas>;
  /** Quien factura un ticket (lo arma la composición con fiscal). Sin él, facturar un ticket se rechaza: nace cerrado. */
  facturador?: FacturadorDeTickets<TxDeVentas> | undefined;
  /**
   * Quien descuenta y devuelve stock (lo arma la composición con stock; E5-T12). Sin él (`usaSiExiste: stock`) ninguna línea controla stock y ventas no
   * llama a nada: la empresa con stock apagado vende como antes (D146).
   */
  stock?: StockDeVentas<TxDeVentas> | undefined;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
