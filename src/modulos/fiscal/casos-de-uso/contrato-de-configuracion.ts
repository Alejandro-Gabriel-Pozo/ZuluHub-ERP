import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type {
  RepositorioDeDatosFiscales,
  RepositorioDeDomicilios,
  RepositorioDeEmisores,
  RepositorioDePuntosDeVenta,
  RepositorioDeReglasDeEmisor,
  RepositorioDeSeries,
} from "../persistencia/repositorios";
import type { TxDeNumeracion } from "./contrato";

/**
 * Lo que recibe el trabajo de una transacción de configuración fiscal del gerente (H7, T5): los repositorios que
 * usa, la lectura de estados (empresa y tenant, tipados por su forma: fiscal no conoce a esos módulos) y los puertos
 * de auditoría y autorización. La composición lo arma a partir de la conexión de la transacción; los casos de uso
 * solo ven estas interfaces. Cada repositorio se pide ANGOSTO: lo que un caso no necesita no se le ofrece.
 */
export type TxDeConfiguracionFiscal = Readonly<{
  empresas: TxDeNumeracion["empresas"];
  tenants: TxDeNumeracion["tenants"];
  emisores: Pick<RepositorioDeEmisores, "obtener">;
  domicilios: Pick<RepositorioDeDomicilios, "crear" | "obtener">;
  datosFiscales: RepositorioDeDatosFiscales;
  reglasDeEmisor: RepositorioDeReglasDeEmisor;
  puntosDeVenta: Pick<
    RepositorioDePuntosDeVenta,
    "obtener" | "listarDelEmisor" | "crear" | "guardar"
  >;
  /** Solo para saber si el punto de venta ya usó números (el número deja de poder cambiar). */
  series: Pick<RepositorioDeSeries, "hayNumerosUsadosDelPuntoDeVenta">;
  auditoria: Auditoria;
  /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeConfiguracionFiscal = Readonly<{
  transacciones: Transacciones<TxDeConfiguracionFiscal>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
