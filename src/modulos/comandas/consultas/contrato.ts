import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { LecturaDeEstados, RepositorioDeSucursales } from "../../empresas/publico";
import type { LecturasDeVentas, RepositorioDeCuentas } from "../../ventas/publico";
import type { RepositorioDeEnvios } from "../persistencia/repositorio-de-envios";
import type { RepositorioDeImpresion } from "../persistencia/repositorio-de-impresion";

/** Lo que recibe el trabajo de una consulta de comandas (ADR-005): solo lecturas y la carga de autorización. Por tipos, una consulta no escribe. */
export type TxDeConsultasDeComandas = LecturaDeEstados &
  Readonly<{
    envios: Pick<
      RepositorioDeEnvios,
      "envioPorId" | "renglonesDeEnvio" | "enviosDeCuenta" | "avisoPorId"
    >;
    impresion: Pick<
      RepositorioDeImpresion,
      "impresorasDeSucursal" | "impresoraPorId" | "trabajosDeDocumento"
    >;
    cuentas: Pick<RepositorioDeCuentas, "obtener" | "obtenerLinea">;
    /** La zona de la empresa para mostrar la hora del envío. */
    sucursales: Pick<RepositorioDeSucursales, "jornadaDe">;
    /** La ficha del ticket, para imprimir el del cliente. */
    lecturasDeVentas: Pick<LecturasDeVentas, "fichaDeTicket">;
    /** Quién tomó el pedido (su correo): D-ID-1, hasta que identidad ofrezca el nombre. */
    personas?: Readonly<{
      obtener(id: never): Promise<Readonly<{ email: string }> | null>;
    }>;
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeConsultasDeComandas = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeComandas>;
  reglas: ReglasDeEmpresa;
}>;
