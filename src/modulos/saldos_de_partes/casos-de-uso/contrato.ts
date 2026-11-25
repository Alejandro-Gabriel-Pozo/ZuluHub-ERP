import type { Auditoria } from "../../../puertos/auditoria";
import type { RepositorioDeAsientos } from "../persistencia/repositorio-de-asientos";
import type { RepositorioDeImputaciones } from "../persistencia/repositorio-de-imputaciones";
import type { RepositorioDeSaldos } from "../persistencia/repositorio-de-saldos";

/**
 * Lo que recibe el trabajo del libro de saldos: sus repositorios y la auditoría. NO abre su propia transacción: corre dentro de la del llamador
 * (Compras, la cuenta corriente de clientes), que la abre `serializable` con reintento ante `40001` y `40P01` (el adaptador de transacciones lo
 * hace) y que ya autorizó (el libro no autoriza: cada módulo que lo llama usa su guard antes, como el puerto de egreso de caja). La composición
 * (LB-4b) arma esta forma a partir de la conexión de la transacción.
 */
export type TxDeSaldos = Readonly<{
  asientos: RepositorioDeAsientos;
  imputaciones: RepositorioDeImputaciones;
  saldos: RepositorioDeSaldos;
  auditoria: Auditoria;
}>;
