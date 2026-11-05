import { redirect } from "next/navigation";
import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { sucursalDelPedido } from "../../../../../servidor/sucursal-elegida";
import { EleccionDeSucursal } from "../../../../../ui/plantillas/facturacion/EleccionDeSucursal.cliente";
import { armarLaEleccionDeSucursal } from "../../../../../ui/plantillas/facturacion/modelo-del-listado";
import { elegirSucursalAlIngresarAccion } from "../../acciones-de-sucursal";

// `/sucursal`: «Elegir sucursal» al ingresar (opción B). Un desplegable en blanco y «Continuar»; si ya hay una elegida arranca con ella.
// Sin sucursales para elegir no hay nada que mostrar: se vuelve al Inicio.
export default function PaginaDeEleccionDeSucursal() {
  return pantallaDeOperacion({ titulo: "sucursal.elegir" }, async ({ contexto }) => {
    const sucursales = await sucursalDelPedido(contexto);
    if (!sucursales.ok) return redirect("/");
    const eleccion = armarLaEleccionDeSucursal(
      sucursales.dato.elegibles,
      sucursales.dato.elegida ?? "",
      {},
      true,
    );
    if (eleccion === null) return redirect("/");
    return <EleccionDeSucursal eleccion={eleccion} accion={elegirSucursalAlIngresarAccion} />;
  });
}
