import type { ContextoOperativo } from "../../contexto/contexto";
import type { SucursalId } from "../../primitivas/identificadores/marca";
import type { Resultado } from "../../primitivas/resultado/resultado";
import type { DatosDeJornada } from "./dominio/sucursal";

/** El gancho no pudo completar lo suyo: `crearSucursal` aborta entera (ni sucursal ni lo que el gancho iba a crear). */
export type ErrorDeGancho = "GANCHO_DE_SUCURSAL_FALLIDO";

/**
 * Puerto `GanchosDeSucursal` de empresas (decisión 165; e3 §3.2.1): lo que otro módulo necesita que nazca
 * junto con una sucursal (hoy, «Caja 1»), sin que empresas lo importe. Empresas solo declara el puerto; el
 * módulo dueño lo implementa y la composición lo registra. Corre DENTRO de la transacción serializable de
 * `crearSucursal`, después del alta y de su auditoría, y SOLO si la sucursal se creó (una repetición
 * idempotente no lo vuelve a invocar). Sin guard propio: la autorización es la de crear la sucursal. Un
 * error aborta la creación entera. Previene que cada camino que crea sucursales tenga que acordarse de
 * crear lo que la acompaña, y que una sucursal quede sin ello si algo falla a mitad. Es genérico en la
 * transacción (`TxDeEmpresas` en la práctica) para no formar un ciclo con el contrato de los casos de uso.
 *
 * Cubre solo las sucursales creadas con `crearSucursal`; la primera sucursal del alta de empresa la cubre el
 * disparador de E3 (decisión PP-7, opción 1, 09/11/2026).
 */
export type GanchoDeSucursal<Tx> = Readonly<{
  alCrearSucursalEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    sucursal: Readonly<{ sucursalId: SucursalId; nombre: string }>,
  ): Promise<Resultado<null, ErrorDeGancho>>;
}>;

export type GanchosDeSucursal<Tx> = readonly GanchoDeSucursal<Tx>[];

/**
 * Por qué un gancho no deja desactivar la sucursal (decisión 178): su jornada está en auditoría, tiene movimiento (hay que hacer antes el
 * cierre del día) o no se pudo comprobar (un módulo no respondió: falla cerrado, nunca se asume «sin movimiento»). Códigos tipados, sin texto.
 */
export type ErrorDeGanchoAlDesactivar =
  | "SUCURSAL_CON_JORNADA_EN_AUDITORIA"
  | "SUCURSAL_CON_MOVIMIENTO_EN_LA_JORNADA"
  | "JORNADA_NO_VERIFICABLE";

/**
 * Puerto de empresas para lo que otro módulo decide ANTES de desactivar una sucursal (decisión 178; hoy, el cierre del día: no se desactiva
 * con la jornada en auditoría, y una jornada abierta sin movimiento se cierra sola). Mismo molde que `GanchoDeSucursal`: empresas solo
 * declara el puerto, el módulo dueño lo implementa y la composición lo registra. Corre DENTRO de la transacción serializable de
 * `desactivarSucursal`, después del guard y de decidir que hay que desactivar y ANTES de cambiar la sucursal; solo si la sucursal estaba
 * activa (desactivar de nuevo no lo invoca). Sin guard propio (es el de `sucursales.desactivar`). Un error aborta todo: la sucursal sigue
 * activa y lo que el gancho hubiera escrito se revierte. Recibe la zona y el corte de la sucursal para que fechar la jornada sea una sola
 * regla. Previene desactivar una sucursal en medio de un cierre del día o con ventas y dinero sin cerrar.
 */
export type GanchoAlDesactivarSucursal<Tx> = Readonly<{
  alDesactivarSucursalEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    sucursal: Readonly<{ sucursalId: SucursalId; nombre: string }>,
    jornada: DatosDeJornada,
  ): Promise<Resultado<null, ErrorDeGanchoAlDesactivar>>;
}>;

export type GanchosAlDesactivarSucursal<Tx> = readonly GanchoAlDesactivarSucursal<Tx>[];
