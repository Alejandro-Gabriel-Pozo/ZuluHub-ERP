import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturasDeCatalogo } from "../../catalogo/publico";
import type { TxDeJornadas } from "../../cierre/publico";
import type { LecturaDeEstados, RepositorioDeSucursales } from "../../empresas/publico";
import type { RepositorioDeCuentas } from "../persistencia/repositorio-de-cuentas";
import type { RepositorioDeTickets } from "../persistencia/repositorio-de-tickets";

/**
 * Lo que recibe el trabajo de una transacción de ventas (ADR-004, G5): sus repositorios, las LECTURAS del catálogo (con las que cotiza cada
 * línea, en la misma transacción), la jornada de la sucursal (de `cierre`) y los puertos de auditoría y autorización. La composición lo
 * arma sobre la conexión de la transacción, que es la MISMA que ven catálogo, cierre y (en la fase B) caja: lo que se lee y se escribe
 * es atómico con la venta.
 */
export type TxDeVentas = LecturaDeEstados &
  LecturasDeCatalogo &
  TxDeJornadas &
  Readonly<{
    cuentas: RepositorioDeCuentas;
    tickets: RepositorioDeTickets;
    /** La zona de la empresa y el corte de la sucursal (`datosDeJornada`), para fechar por reloj. */
    sucursales: Pick<RepositorioDeSucursales, "jornadaDe">;
    auditoria: Auditoria;
    /** Quién es el actor, qué módulos tiene la empresa y a qué sucursales llega, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeVentas = Readonly<{
  transacciones: Transacciones<TxDeVentas>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
