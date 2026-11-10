import type { ReglasDeEmpresa } from "../../../capacidades/permisos/empresa";
import type { Auditoria } from "../../../puertos/auditoria";
import type { CargaDeAutorizacion } from "../../../puertos/autorizacion";
import type { LecturaDeDerechosDeUso } from "../../../puertos/derechos-de-uso";
import type { Transacciones } from "../../../puertos/transacciones";
import type { TxDeJornadas } from "../../cierre/publico";
import type {
  LecturaDeEstados,
  LecturaDeSucursalBloqueada,
  RepositorioDeSucursales,
} from "../../empresas/publico";
import type { RepositorioDeArqueos } from "../persistencia/repositorio-de-arqueos";
import type { RepositorioDeCajas } from "../persistencia/repositorio-de-cajas";
import type { RepositorioDeCuentasDeCobro } from "../persistencia/repositorio-de-cuentas";
import type { RepositorioDeMediosDePago } from "../persistencia/repositorio-de-medios";
import type { RepositorioDeMovimientos } from "../persistencia/repositorio-de-movimientos";
import type { RepositorioDeSesiones } from "../persistencia/repositorio-de-sesiones";

/**
 * Lo que recibe el trabajo de una transacción de la configuración de caja (ADR-004, G5): los repositorios del módulo, la lectura de
 * estados (la empresa opera), la sucursal leída con `FOR SHARE` (una caja o una cuenta nueva exige que siga existiendo), los derechos
 * de uso (el límite de cajas del plan, leído en esta transacción y sin caché) y los puertos de auditoría y autorización. La operación
 * suma las sesiones, los movimientos y el arqueo, la jornada de la sucursal (de `cierre`: abrir una sesión la exige abierta) y los datos
 * de jornada de la sucursal (zona y hora de corte, de `empresas`). La composición lo arma a partir de la conexión de la transacción;
 * los casos de uso solo ven estas interfaces. El tramo del puerto de cobrar suma acá lo suyo.
 */
export type TxDeCaja = LecturaDeEstados &
  TxDeJornadas &
  Readonly<{
    sucursales: Pick<RepositorioDeSucursales, "jornadaDe">;
    sesiones: RepositorioDeSesiones;
    movimientos: RepositorioDeMovimientos;
    arqueos: RepositorioDeArqueos;
    cajas: RepositorioDeCajas;
    mediosDePago: RepositorioDeMediosDePago;
    cuentasDeCobro: RepositorioDeCuentasDeCobro;
    sucursalBloqueada: LecturaDeSucursalBloqueada;
    derechos: Pick<LecturaDeDerechosDeUso, "deLaEmpresa">;
    auditoria: Auditoria;
    /** Quién es el actor, qué módulos tiene la empresa y a qué sucursales llega, leído dentro de la transacción (sin caché). */
    autorizacion: CargaDeAutorizacion;
  }>;

export type DependenciasDeCaja = Readonly<{
  transacciones: Transacciones<TxDeCaja>;
  /** El catálogo y la matriz rol → acciones con los que el guard autoriza (los pasa la composición). */
  reglas: ReglasDeEmpresa;
}>;
