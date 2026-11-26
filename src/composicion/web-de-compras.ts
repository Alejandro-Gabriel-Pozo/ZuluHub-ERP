import { crearCasosDeUsoDeCompras, crearConsultasDeCompras } from "../modulos/compras/publico";
import { crearPuertosDeStock } from "../modulos/stock/publico";
import { crearCuentaDelProveedor } from "./cuenta-del-proveedor";
import { crearEgresoDeCaja } from "./egreso-de-caja";
import { crearIvaDeLaEmpresa } from "./iva-de-la-empresa";
import { crearLibroDeProveedores } from "./libro-de-proveedores";
import { perezoso } from "./perezoso";
import type { BaseDeWeb } from "./web-base";

export function armarWebDeCompras({ conexiones, reglas }: BaseDeWeb) {
  return {
    /**
     * Compras (E9, N1 y N2): la ficha del proveedor, «Comprar y recibir» con su factura y su pago, anular, el nivel y las consultas, cada uno con SU acción de
     * `compras`. Los puertos de stock (la entrada por origen, los artículos controlados y la existencia) los arma esta composición y compras los recibe:
     * es el único lugar donde se tocan los dos módulos.
     */
    casosDeUsoDeCompras: perezoso(() =>
      crearCasosDeUsoDeCompras({
        transacciones: conexiones.transaccionesDeApp(),
        reglas,
        stock: crearPuertosDeStock({ reglas }),
        egresoDeCaja: crearEgresoDeCaja(),
        libroDeProveedores: crearLibroDeProveedores(),
        ivaDeLaEmpresa: crearIvaDeLaEmpresa(),
      }),
    ),
    consultasDeCompras: perezoso(() =>
      crearConsultasDeCompras({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
    /** La cuenta del proveedor desde el libro (lo que se debe y lo que queda a favor): una lectura que cruza compras y el libro, por eso vive en la composición. */
    cuentaDelProveedor: perezoso(() =>
      crearCuentaDelProveedor({ transacciones: conexiones.transaccionesDeApp(), reglas }),
    ),
  };
}
