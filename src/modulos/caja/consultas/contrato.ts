import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeCajas } from "../persistencia/repositorio-de-cajas";
import type { RepositorioDeCuentasDeCobro } from "../persistencia/repositorio-de-cuentas";
import type { RepositorioDeMediosDePago } from "../persistencia/repositorio-de-medios";

/**
 * Lo que recibe el trabajo de una consulta (ADR-005): solo métodos de lectura de los repositorios y la carga de autorización. No hay
 * auditoría ni derechos: por tipos, una consulta no escribe. Los tramos siguientes suman las lecturas de sesiones y movimientos.
 */
export type TxDeConsultasDeCaja = Readonly<{
  cajas: Pick<RepositorioDeCajas, "listarDeLaSucursal">;
  mediosDePago: Pick<RepositorioDeMediosDePago, "listar">;
  cuentasDeCobro: Pick<RepositorioDeCuentasDeCobro, "listar">;
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeConsultasDeCaja = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCaja>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
