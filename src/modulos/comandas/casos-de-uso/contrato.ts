import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TxDeVentas } from "../../ventas/publico";
import type { RepositorioDeEnvios } from "../persistencia/repositorio-de-envios";
import type { RepositorioDeImpresion } from "../persistencia/repositorio-de-impresion";

/**
 * Lo que recibe el trabajo de una transacción de comandas (ADR-004, G5): todo lo de ventas (cuentas, líneas, jornada, auditoría y autorización: comandas
 * conoce cuentas y líneas por id, no sabe qué es una mesa) más los repositorios de envíos e impresión, armados sobre la MISMA conexión de la transacción.
 * El salón arma su transacción con esto adentro: lo que escribe cada módulo es atómico con lo del otro.
 */
export type TxDeComandas = TxDeVentas &
  Readonly<{
    envios: RepositorioDeEnvios;
    impresion: RepositorioDeImpresion;
  }>;

export type DependenciasDeComandas = Readonly<{
  transacciones: Transacciones<TxDeComandas>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
