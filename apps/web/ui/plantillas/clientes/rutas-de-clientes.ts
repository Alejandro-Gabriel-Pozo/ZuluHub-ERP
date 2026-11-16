/**
 * Las rutas de «Clientes y proveedores» (maqueta aprobada `directorio.html`, 09/11/2026). «Clientes» (área Ventas) y «Proveedores» (área Compras) abren la MISMA pantalla con el filtro
 * por rol en la dirección (`?rol=`); el valor de `rol` es el de la dirección, y la lista de roles del dominio la decide el servidor, que no confía en lo que venga.
 */
export const RUTAS_DE_CLIENTES = {
  lista: "/clientes",
  nuevo: "/clientes/nuevo",
  clientes: "/clientes?rol=cliente",
  proveedores: "/clientes?rol=proveedor",
} as const;

export const rutaDeUnaParte = (id: string): string => `${RUTAS_DE_CLIENTES.lista}/${id}`;
