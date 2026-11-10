import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturasDeCatalogo } from "../../catalogo/publico";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { LecturasDeVentas } from "../persistencia/repositorio-de-lecturas";
import type { RepositorioDeCuentas } from "../persistencia/repositorio-de-cuentas";

/** Lo que recibe el trabajo de una consulta (ADR-005): solo lecturas y la carga de autorización. Por tipos, una consulta no escribe. */
export type TxDeConsultasDeVentas = LecturasDeCatalogo &
  LecturaDeEstados &
  Readonly<{
    lecturasDeVentas: LecturasDeVentas;
    cuentas: Pick<RepositorioDeCuentas, "obtener" | "lineasDeCuenta">;
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeConsultasDeVentas = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeVentas>;
  reglas: ReglasDeEmpresa;
}>;
