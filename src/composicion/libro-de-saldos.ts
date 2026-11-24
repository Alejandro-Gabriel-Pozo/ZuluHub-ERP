import { crearAuditoriaDePostgres, type AuditoriaDb } from "../adaptadores/postgres/auditoria";
import type { ConfiguracionDeTransacciones } from "../adaptadores/postgres/transacciones";
import {
  crearRepositorioDeAsientos,
  crearRepositorioDeImputaciones,
  crearRepositorioDeSaldos,
  type SaldosDb,
  type TxDeSaldos,
} from "../modulos/saldos_de_partes/publico";

/**
 * Las piezas del libro de saldos (`saldos_de_partes`) sobre la conexión de UNA transacción: los tres repositorios y la auditoría. El módulo que usa
 * el libro (Compras, la cuenta corriente de clientes) las suma a las suyas en su propio `armar` y corre los casos de uso `…EnTx` DENTRO de su
 * transacción, después de autorizar con su propio guard: el libro no abre transacción ni autoriza. Ninguna app lo importa
 * (`test/arquitectura/cobrar-no-expuesto.test.ts`).
 */
export function armarTxDeSaldos(
  db: Parameters<ConfiguracionDeTransacciones<unknown>["armar"]>[0],
): TxDeSaldos {
  const tablas = db.withTables<SaldosDb & AuditoriaDb>();
  return {
    asientos: crearRepositorioDeAsientos(tablas),
    imputaciones: crearRepositorioDeImputaciones(tablas),
    saldos: crearRepositorioDeSaldos(tablas),
    auditoria: crearAuditoriaDePostgres(tablas),
  };
}
