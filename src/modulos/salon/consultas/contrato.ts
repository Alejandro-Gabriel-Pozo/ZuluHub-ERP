import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { TxDeConsultasDeVentas } from "../../ventas/publico";
import type { RepositorioDeMesas } from "../persistencia/repositorio-de-mesas";

/** Lo que recibe el trabajo de una consulta del salón (ADR-005): solo lecturas y la carga de autorización. Por tipos, una consulta no escribe. */
export type TxDeConsultasDeSalon = TxDeConsultasDeVentas &
  LecturaDeEstados &
  Readonly<{
    mesas: Pick<RepositorioDeMesas, "listar" | "obtener" | "obtenerVarias">;
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeConsultasDeSalon = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeSalon>;
  reglas: ReglasDeEmpresa;
}>;
