import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TicketsPorCobranza } from "../aporte/tickets-por-cobranza";
import type { TxDeLecturaDeLaJornada } from "../aporte/contrato";
import type { RepositorioDeArqueos } from "../persistencia/repositorio-de-arqueos";
import type { RepositorioDeCajas } from "../persistencia/repositorio-de-cajas";
import type { RepositorioDeCuentasDeCobro } from "../persistencia/repositorio-de-cuentas";
import type { RepositorioDeMediosDePago } from "../persistencia/repositorio-de-medios";
import type { RepositorioDeCobrosDeLaJornada } from "../persistencia/repositorio-de-cobros-de-la-jornada";
import type { RepositorioDeFotos } from "../persistencia/repositorio-de-fotos";
import type { RepositorioDeLaJornada } from "../persistencia/repositorio-de-la-jornada";
import type { RepositorioDeMovimientos } from "../persistencia/repositorio-de-movimientos";
import type { RepositorioDeSesiones } from "../persistencia/repositorio-de-sesiones";

/**
 * Lo que recibe el trabajo de una consulta (ADR-005): solo métodos de lectura de los repositorios y la carga de autorización. No hay
 * auditoría ni derechos: por tipos, una consulta no escribe. La operación suma las lecturas de sesiones, movimientos y arqueos, y el cierre
 * del día lo que cruza la jornada (con `TxDeLecturaDeLaJornada`, lo mismo que lee el aporte de caja al cierre).
 */
export type TxDeConsultasDeCaja = TxDeLecturaDeLaJornada &
  Readonly<{
    cajas: Pick<RepositorioDeCajas, "listarDeLaSucursal" | "obtener">;
    sesiones: Pick<RepositorioDeSesiones, "obtener" | "listar">;
    movimientos: Pick<RepositorioDeMovimientos, "esperadoPorLinea" | "pagina">;
    arqueos: Pick<RepositorioDeArqueos, "deLaSesion" | "ultimoEfectivoContadoDeLaCaja">;
    mediosDePago: Pick<RepositorioDeMediosDePago, "listar">;
    cuentasDeCobro: Pick<RepositorioDeCuentasDeCobro, "listar">;
    /** El cierre del día de caja (e3b §4.5): lo que cruza las sesiones de la jornada y lo que caja congeló al cerrarla. */
    laJornada: Pick<
      RepositorioDeLaJornada,
      "movimientosManuales" | "ajustesPosteriores" | "cobradoPorMedioVigente"
    >;
    cobrosDeLaJornada: RepositorioDeCobrosDeLaJornada;
    fotos: Pick<RepositorioDeFotos, "lineas" | "origenes">;
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeConsultasDeCaja = Readonly<{
  transacciones: Transacciones<TxDeConsultasDeCaja>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
  /**
   * El total vigente del ticket de cada cobranza (e3b §4.6), que implementa la composición con ventas. Sin él, `conciliacionDeLaJornada`
   * no puede mostrar el cobrado contra el ticket en vivo: no se asume que no hay diferencias.
   */
  tickets: TicketsPorCobranza;
}>;
