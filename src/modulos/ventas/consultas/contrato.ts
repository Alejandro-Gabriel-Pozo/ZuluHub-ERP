import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TxDeLecturaDeCaja } from "../../caja/publico";
import type { LecturasDeCatalogo } from "../../catalogo/publico";
import type { LecturaDeEstados } from "../../empresas/publico";
import type { LecturasDeVentas } from "../persistencia/repositorio-de-lecturas";
import type { FacturadorDeTickets } from "../casos-de-uso/puertos-de-facturacion";
import type { RepositorioDeDocumentos } from "../persistencia/repositorio-de-documentos";
import type { RepositorioDeCuentas } from "../persistencia/repositorio-de-cuentas";

/** Lo que recibe el trabajo de una consulta (ADR-005): solo lecturas y la carga de autorización. Por tipos, una consulta no escribe. */
export type TxDeConsultasDeVentas = LecturasDeCatalogo &
  LecturaDeEstados &
  TxDeLecturaDeCaja &
  Readonly<{
    lecturasDeVentas: LecturasDeVentas;
    cuentas: Pick<RepositorioDeCuentas, "obtener" | "lineasDeCuenta">;
    /** El puntero ticket → comprobante (E1, 0029): qué tickets ya tienen documento. */
    documentos: Pick<RepositorioDeDocumentos, "vigentesDe">;
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeConsultasDeVentas = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeVentas>;
  reglas: ReglasDeEmpresa;
  /** Quien dice si un comprobante sigue valiendo (lo arma la composición con fiscal): lo necesita «Pendientes de facturar» para tickets ya facturados. */
  facturador?: FacturadorDeTickets<never, TxDeConsultasDeVentas> | undefined;
}>;
