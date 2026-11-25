import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLoDeRecibir } from "../../../../../../../servidor/comprar";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeNuevaCompra } from "../../../../../../../ui/plantillas/compras/nueva/PantallaDeNuevaCompra.cliente";
import { textosDeNuevaCompra } from "../../../../../../../ui/plantillas/compras/nueva/textos-de-nueva-compra";
import {
  agregarProveedorAccion,
  buscarProductosAccion,
  buscarProveedoresAccion,
  cotizarCompraAccion,
} from "../../../../acciones-de-comprar";
import { registrarRecepcionAccion } from "../../../../acciones-de-recepciones";

// `/compras/recepciones/recibir`: cargar lo que llegó a la sucursal (maqueta `compra-recibir.html`, estado `recibir`). La empresa, la persona y la sucursal las decide el servidor: del navegador solo salen lo que se
// escribe (proveedor, renglones, remito) y la clave del envío. SIN precio: lo recibido queda «sin costo» hasta tomar el costo de la factura. Sin permiso para registrar la pantalla no se abre (el genérico): nace
// cerrada; el guard de la acción vuelve a decidir. Es el formulario de «Nueva compra» en su modo «recepción»: no se escribe dos veces.
export default async function PaginaDeRecibir() {
  return pantallaDeOperacion({ titulo: "compras.recepcion.recibir" }, async ({ contexto }) => {
    const previo = await cargarLoDeRecibir(contexto);
    if (!previo.ok) return <ErrorDelDetalle error={previo.error} />;
    return (
      <PantallaDeNuevaCompra
        modo="RECEPCION"
        textos={textosDeNuevaCompra()}
        buscarProductos={buscarProductosAccion}
        buscarProveedores={buscarProveedoresAccion}
        cotizar={cotizarCompraAccion}
        registrar={registrarRecepcionAccion}
        agregarProveedor={agregarProveedorAccion}
        puedeAgregarProveedor={previo.dato.puedeAgregarProveedor}
        depositos={[]}
      />
    );
  });
}
