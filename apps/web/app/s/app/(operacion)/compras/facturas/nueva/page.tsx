import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLoDeCargarFactura } from "../../../../../../../servidor/facturas";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeCargarFactura } from "../../../../../../../ui/plantillas/compras/facturas/PantallaDeCargarFactura.cliente";
import { textosDeFacturas } from "../../../../../../../ui/plantillas/compras/facturas/textos-de-facturas";
import { textosDeNuevaCompra } from "../../../../../../../ui/plantillas/compras/nueva/textos-de-nueva-compra";
import {
  buscarProductosAccion,
  buscarProveedoresAccion,
  cotizarFacturaAccion,
} from "../../../../acciones-de-comprar";
import { registrarFacturaAccion } from "../../../../acciones-de-facturas";

// `/compras/facturas/nueva`: cargar la factura de la empresa (maqueta `compra-conciliar.html`, estado `cargar`). NO hay sucursal ni stock: la factura es de la empresa y se concilia después con lo recibido. La empresa
// y la persona las decide el servidor: del navegador solo sale lo que se escribe (proveedor, productos, importes) y la clave del envío. Sin permiso para registrar la pantalla no se abre (el genérico): nace cerrada;
// el guard de la acción vuelve a decidir. Reusa el bloque de la factura de «Nueva compra»: no se escribe dos veces.
export default async function PaginaDeCargarFactura() {
  return pantallaDeOperacion({ titulo: "compras.factura.cargar_factura" }, async ({ contexto }) => {
    const previo = await cargarLoDeCargarFactura(contexto);
    if (!previo.ok) return <ErrorDelDetalle error={previo.error} />;
    return (
      <PantallaDeCargarFactura
        textos={textosDeNuevaCompra()}
        textoDelBoton={textosDeFacturas().cargarFactura}
        buscarProductos={buscarProductosAccion}
        buscarProveedores={buscarProveedoresAccion}
        cotizarFactura={cotizarFacturaAccion}
        registrar={registrarFacturaAccion}
      />
    );
  });
}
