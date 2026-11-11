import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { RepositorioDeEnvios } from "../../comandas/publico";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { RepositorioDeCuentas, TxDeConsultasDeVentas } from "../../ventas/publico";
import type { RepositorioDeMesas } from "../persistencia/repositorio-de-mesas";
import type { RepositorioDeUnionesYDivisiones } from "../persistencia/repositorio-de-uniones-y-divisiones";

/** Lo que recibe el trabajo de una consulta del salón (ADR-005): solo lecturas y la carga de autorización. Por tipos, una consulta no escribe. */
export type TxDeConsultasDeSalon = TxDeConsultasDeVentas &
  LecturaDeEstados &
  Readonly<{
    mesas: Pick<RepositorioDeMesas, "listar" | "obtener" | "obtenerVarias">;
    unionesYDivisiones: Pick<
      RepositorioDeUnionesYDivisiones,
      | "reservasDeUnion"
      | "divisionesPorMadres"
      | "partesDeDivision"
      | "divisionPorMadre"
      | "divisionPorHija"
      | "unionPorOrigen"
      | "lineasUnidas"
    >;
    envios: Pick<RepositorioDeEnvios, "filasDeCuenta" | "resumenPorCuentas">;
    cuentas: Pick<
      RepositorioDeCuentas,
      "obtener" | "lineasDeCuenta" | "abiertasPorAnclas" | "abiertaPorAncla"
    >;
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeConsultasDeSalon = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeSalon>;
  reglas: ReglasDeEmpresa;
}>;
