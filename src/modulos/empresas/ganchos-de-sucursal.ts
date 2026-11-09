import type { ContextoOperativo } from "../../contexto/contexto";
import type { SucursalId } from "../../primitivas/identificadores/marca";
import type { Resultado } from "../../primitivas/resultado/resultado";

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
 */
export type GanchoDeSucursal<Tx> = Readonly<{
  alCrearSucursalEnTx(
    tx: Tx,
    contexto: ContextoOperativo,
    sucursal: Readonly<{ sucursalId: SucursalId; nombre: string }>,
  ): Promise<Resultado<null, ErrorDeGancho>>;
}>;

export type GanchosDeSucursal<Tx> = readonly GanchoDeSucursal<Tx>[];
