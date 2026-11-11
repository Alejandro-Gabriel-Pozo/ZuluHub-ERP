import { CONDICIONES_DE_IVA_DE_LA_EMPRESA } from "../modulos/compras/publico";
import type {
  CondicionDeIvaDeLaEmpresa,
  IvaDeLaEmpresa,
  TxDeCompras,
} from "../modulos/compras/publico";
import type { RepositorioDeDatosFiscales, RepositorioDeEmisores } from "../modulos/fiscal/publico";

/**
 * La condición de la empresa frente al IVA para compras (E9 T15, DEC-0322): compras declara el puerto y esta composición lo implementa con fiscal, que compras no
 * puede importar. Es la de la ÚLTIMA versión CONFIRMADA de los datos fiscales del emisor PRINCIPAL de la empresa (el que factura con el CUIT de la empresa; DEC-0323).
 * Sin emisor, sin versión confirmada o con una condición que no es una de las tres de la lista: `null` (no se puede leer: con IVA discriminado la compra no se registra).
 * La transacción de compras es, en la aplicación, la compuesta, que trae los repositorios de fiscal sobre la MISMA conexión; si no los trae, se aborta (un defecto de armado).
 */
type TxConFiscal = Readonly<{
  emisores: RepositorioDeEmisores;
  datosFiscales: RepositorioDeDatosFiscales;
}>;

function comoTxConFiscal(tx: TxDeCompras): TxConFiscal {
  for (const pieza of ["emisores", "datosFiscales"] as const) {
    if (!Object.hasOwn(tx, pieza)) {
      throw new Error(`la transacción de compras no trae la pieza de fiscal «${pieza}»`);
    }
  }
  return tx as unknown as TxConFiscal;
}

const esCondicionDeLaEmpresa = (texto: string): texto is CondicionDeIvaDeLaEmpresa =>
  (CONDICIONES_DE_IVA_DE_LA_EMPRESA as readonly string[]).includes(texto);

export function crearIvaDeLaEmpresa(): IvaDeLaEmpresa {
  return {
    async condicion(tx, contexto) {
      const { emisores, datosFiscales } = comoTxConFiscal(tx);
      const principal = await emisores.delPrincipal(contexto.empresaId);
      if (principal === null) return null;
      const confirmadas = await datosFiscales.confirmadas(contexto.empresaId, principal.id);
      const ultima = confirmadas.at(-1);
      return ultima !== undefined && esCondicionDeLaEmpresa(ultima.condicionIva)
        ? ultima.condicionIva
        : null;
    },
  };
}
