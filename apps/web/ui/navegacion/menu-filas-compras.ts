import { RUTA_DE_CLIENTES } from "../plantillas/clientes/modelo-de-directorio";
import { RUTA_DE_COMPRAS } from "../plantillas/compras/rutas-de-compras";

/**
 * Las filas del área Compras del menú (proveedores y compras). Es SOLO una parte de la tabla del menú (`menu.ts`, que las compone en el orden de las áreas y es la única fuente que lee el resto): sumar una pantalla de este
 * área es sumar UNA fila acá. Los tipos y las reglas viven en `menu.ts`, que comprueba cada fila contra ellos al componerlas. Previene: que la tabla pase el tope de largo de archivo
 * (deuda `archivo-grande`).
 */
export const FILAS_DE_COMPRAS = [
  {
    tipo: "pantalla",
    clave: "proveedores",
    area: "compras",
    grupo: "proveedores",
    modulo: "clientes",
    accion: "partes.ver",
    perilla: null,
    href: `${RUTA_DE_CLIENTES}?rol=proveedor`,
    etiqueta: "clientes.lista.proveedores",
    departamento: null,
  },
  // «Compras» (Compras PR 3): la lista de compras de la sucursal, solo lectura. Módulo `compras` y la acción de su consulta (`recepciones.ver`, los tres roles); nace cerrada: sin la acción no se ofrece.
  {
    tipo: "pantalla",
    clave: "compras",
    area: "compras",
    grupo: "compras",
    modulo: "compras",
    accion: "recepciones.ver",
    perilla: null,
    href: RUTA_DE_COMPRAS,
    etiqueta: "compras.compra.compras",
    departamento: null,
  },
] as const;
