import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { EmpresaId, SucursalId } from "../../../primitivas/identificadores/marca";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { MarcaParaImprimir } from "../dominio/modelo-de-impresion";
import type { LecturasDeCertificados } from "../persistencia/lecturas-de-certificados";
import type { LecturasDeComprobantes } from "../persistencia/lecturas-de-comprobantes";
import type { RepositorioDeComprobantes } from "../persistencia/repositorio-de-comprobantes";
import type { RepositorioDeIntentos } from "../persistencia/repositorio-de-intentos";
import type {
  RepositorioDeDatosFiscales,
  RepositorioDeDomicilios,
  RepositorioDeEmisores,
  RepositorioDePuntosDeVenta,
  RepositorioDeSeries,
} from "../persistencia/repositorios";

/**
 * Lo que recibe el trabajo de una consulta (ADR-005): solo métodos de lectura de los repositorios y la carga
 * de autorización. No hay auditoría ni trabajos: por tipos, una consulta no escribe. Las credenciales de acceso a
 * ARCA y la clave de los certificados no figuran: ninguna consulta las lee (los certificados se miran solo por
 * `lecturasDeCertificados`, que no trae ninguna columna cifrada).
 */
export type TxDeConsultasDeFacturacion = Readonly<{
  comprobantes: Pick<RepositorioDeComprobantes, "obtener">;
  lecturas: LecturasDeComprobantes;
  /**
   * El emisor al que se le mira el estado de los certificados o la configuración (de otra empresa, no existe) y el
   * principal, que es el que muestra la lista de configuración fiscal (D-47).
   */
  emisores: Pick<RepositorioDeEmisores, "obtener" | "delPrincipal">;
  /** Los datos fiscales de un emisor para la pantalla de configuración: su borrador y sus versiones confirmadas. */
  datosFiscales: Pick<RepositorioDeDatosFiscales, "obtenerBorrador" | "confirmadas">;
  /** El domicilio fiscal de esas versiones. */
  domicilios: Pick<RepositorioDeDomicilios, "obtener" | "obtenerVarios">;
  /** Los puntos de venta de un emisor, con su ambiente y su estado (pantalla de configuración). */
  puntosDeVenta: Pick<RepositorioDePuntosDeVenta, "listarDelEmisor">;
  /** Qué certificado cuenta hoy de un emisor en cada ambiente (D-42): sin clave, solo lectura. */
  lecturasDeCertificados: LecturasDeCertificados;
  intentos: Pick<RepositorioDeIntentos, "delComprobante">;
  series: Pick<RepositorioDeSeries, "obtener" | "hayNumerosUsadosDelPuntoDeVenta">;
  /**
   * La marca con la que se imprime el comprobante de una empresa: la de su tenant, con la herencia ya
   * resuelta. La arma la composición desde `marcas` (fiscal no importa ese módulo: la marca es presentación);
   * si la marca no tiene logo o color, los campos vienen en `null`.
   */
  marca: Readonly<{ deLaEmpresa(empresa: EmpresaId): Promise<MarcaParaImprimir> }>;
  /**
   * Las sucursales de la empresa, abiertas y cerradas (las del módulo de empresas: la composición pasa su repositorio, que ya
   * cumple esto). De ellas y del alcance del actor sale la sucursal en la que trabaja el listado (`sucursal-del-pedido.ts`),
   * con el nombre que la pantalla muestra: viene de la misma lectura, sin otra consulta.
   */
  sucursales: Readonly<{
    listar(
      empresa: EmpresaId,
    ): Promise<readonly Readonly<{ id: SucursalId; nombre: string; activa: boolean }>[]>;
  }>;
  /** Quién es el actor y qué módulos tiene la empresa, leído dentro de la transacción (sin caché). */
  autorizacion: CargaDeAutorizacion;
}>;

export type DependenciasDeConsultasDeFacturacion = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeFacturacion>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
