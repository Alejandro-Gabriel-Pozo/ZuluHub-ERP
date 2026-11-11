import type { Kysely } from "kysely";
import type { ComprasDb } from "./esquema";
import { crearProductosParaCompras, type ProductosParaCompras } from "./productos-para-compras";
import {
  crearRepositorioDeConfiguracionDeCompras,
  type RepositorioDeConfiguracionDeCompras,
} from "./repositorio-de-configuracion";
import { crearRepositorioDeFichas, type RepositorioDeFichas } from "./repositorio-de-fichas";
import {
  crearRepositorioDeLecturasDeCompras,
  type RepositorioDeLecturasDeCompras,
} from "./repositorio-de-lecturas-de-compras";
import {
  crearRepositorioDeConciliaciones,
  type RepositorioDeConciliaciones,
} from "./repositorio-de-conciliaciones";
import {
  crearRepositorioDeDetalleDeComprobantes,
  type RepositorioDeDetalleDeComprobantes,
} from "./repositorio-de-detalle-de-comprobantes";
import {
  crearRepositorioDeComprobantes,
  type RepositorioDeComprobantes,
} from "./repositorio-de-comprobantes";
import { crearRepositorioDePagos, type RepositorioDePagos } from "./repositorio-de-pagos";
import {
  crearRepositorioDeRecepciones,
  type RepositorioDeRecepciones,
} from "./repositorio-de-recepciones";
import { crearRepositorioDeOfertas, type RepositorioDeOfertas } from "./repositorio-de-ofertas";

/**
 * Los repositorios de compras, armados sobre la MISMA conexión de la transacción. La composición los junta con los de los demás módulos en UNA sola `Tx`:
 * los nombres genéricos llevan `DeCompra` o `DeProveedor` para no pisar a otros. Una prueba de la composición exige que ninguna clave se repita.
 */
export type RepositoriosDeCompras = Readonly<{
  fichasDeCompra: RepositorioDeFichas;
  ofertasDeProveedor: RepositorioDeOfertas;
  configuracionDeCompras: RepositorioDeConfiguracionDeCompras;
  recepciones: RepositorioDeRecepciones;
  lecturasDeCompras: RepositorioDeLecturasDeCompras;
  comprobantesDeProveedor: RepositorioDeComprobantes;
  detalleDeComprobantes: RepositorioDeDetalleDeComprobantes;
  conciliacionesDeCompra: RepositorioDeConciliaciones;
  pagosDeProveedor: RepositorioDePagos;
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
    recepciones: crearRepositorioDeRecepciones(conexion),
    lecturasDeCompras: crearRepositorioDeLecturasDeCompras(conexion),
    comprobantesDeProveedor: crearRepositorioDeComprobantes(conexion),
    detalleDeComprobantes: crearRepositorioDeDetalleDeComprobantes(conexion),
    conciliacionesDeCompra: crearRepositorioDeConciliaciones(conexion),
    pagosDeProveedor: crearRepositorioDePagos(conexion),
    productosParaCompras: crearProductosParaCompras(conexion),
  };
}
