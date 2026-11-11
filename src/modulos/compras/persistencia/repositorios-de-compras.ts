import type { Kysely } from "kysely";
import type { ComprasDb } from "./esquema";
import { crearProductosParaCompras, type ProductosParaCompras } from "./productos-para-compras";
import {
  crearRepositorioDeConfiguracionDeCompras,
  type RepositorioDeConfiguracionDeCompras,
} from "./repositorio-de-configuracion";
import { crearRepositorioDeFichas, type RepositorioDeFichas } from "./repositorio-de-fichas";
import { crearRepositorioDeOfertas, type RepositorioDeOfertas } from "./repositorio-de-ofertas";

/**
 * Los repositorios de compras, armados sobre la MISMA conexión de la transacción. La composición los junta con los de los demás módulos en UNA sola `Tx`:
 * los nombres genéricos llevan `DeCompra` o `DeProveedor` para no pisar a otros. Una prueba de la composición exige que ninguna clave se repita.
 */
export type RepositoriosDeCompras = Readonly<{
  fichasDeCompra: RepositorioDeFichas;
  ofertasDeProveedor: RepositorioDeOfertas;
  configuracionDeCompras: RepositorioDeConfiguracionDeCompras;
  productosParaCompras: ProductosParaCompras;
}>;

export function crearRepositoriosDeCompras(db: {
  withTables<T extends object>(): Kysely<T & ComprasDb>;
}): RepositoriosDeCompras {
  const conexion = db.withTables<ComprasDb>();
  return {
    fichasDeCompra: crearRepositorioDeFichas(conexion),
    ofertasDeProveedor: crearRepositorioDeOfertas(conexion),
    configuracionDeCompras: crearRepositorioDeConfiguracionDeCompras(conexion),
    productosParaCompras: crearProductosParaCompras(conexion),
  };
}
