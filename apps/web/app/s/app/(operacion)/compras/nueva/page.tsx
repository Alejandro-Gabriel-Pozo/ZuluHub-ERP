import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLoDeNuevaCompra } from "../../../../../../servidor/comprar";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeNuevaCompra } from "../../../../../../ui/plantillas/compras/nueva/PantallaDeNuevaCompra.cliente";
import { textosDeNuevaCompra } from "../../../../../../ui/plantillas/compras/nueva/textos-de-nueva-compra";
import {
  agregarProveedorAccion,
  buscarProductosAccion,
  buscarProveedoresAccion,
  cotizarCompraAccion,
  registrarCompraAccion,
} from "../../../acciones-de-comprar";

// `/compras/nueva`: cargar y recibir una compra (maqueta `compra.html`, estado `nueva`; Compras PR 6b). La empresa, la persona y la sucursal las decide el servidor: del navegador solo salen lo que se
// escribe (proveedor, renglones, remito, depósito) y la clave del envío. Sin permiso para registrar compras la pantalla no se abre (el genérico): nace cerrada; el guard de cada acción vuelve a decidir.
export default async function PaginaDeNuevaCompra() {
  return pantallaDeOperacion({ titulo: "compras.compra.nueva_compra" }, async ({ contexto }) => {
    const previo = await cargarLoDeNuevaCompra(contexto);
    if (!previo.ok) return <ErrorDelDetalle error={previo.error} />;
    return (
      <PantallaDeNuevaCompra
        textos={textosDeNuevaCompra()}
        buscarProductos={buscarProductosAccion}
        buscarProveedores={buscarProveedoresAccion}
        cotizar={cotizarCompraAccion}
        registrar={registrarCompraAccion}
        agregarProveedor={agregarProveedorAccion}
        puedeAgregarProveedor={previo.dato.puedeAgregarProveedor}
        depositos={previo.dato.depositos}
      />
    );
  });
}
