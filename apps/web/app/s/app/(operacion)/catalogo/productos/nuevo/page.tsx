import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  cargarLasOpcionesDelAlta,
  nuevaClaveDeAlta,
} from "../../../../../../../servidor/alta-de-producto";
import { puedeCrearProductos } from "../../../../../../../servidor/modulos";
import { FormularioDeAltaDeProducto } from "../../../../../../../ui/plantillas/catalogo/FormularioDeAltaDeProducto.cliente";
import { armarElAlta } from "../../../../../../../ui/plantillas/catalogo/modelo-de-alta-de-producto";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { crearProductoAccion } from "../../../../acciones-de-productos";

// `/catalogo/productos/nuevo`: el alta de un producto (maqueta `productos.html`, «Nuevo producto», 12/11/2026). Nada viene del navegador más que lo que se escribe: la empresa y la persona
// las pone el servidor y el permiso (`productos.crear`) y el módulo en desarrollo los deciden la consulta y el caso de uso. La página fija UNA clave de creación al abrirse y la liga a la
// acción: el doble toque y el reintento son una sola alta; recargar la página es otro intento. Sin entrada en el menú: se llega por la dirección.
export default async function PaginaDeAltaDeProducto() {
  return pantallaDeOperacion({ titulo: "catalogo.lista.nuevo" }, async ({ contexto }) => {
    const respuesta = await cargarLasOpcionesDelAlta(contexto);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    return (
      <FormularioDeAltaDeProducto
        alta={armarElAlta(respuesta.dato)}
        accion={crearProductoAccion.bind(null, nuevaClaveDeAlta())}
        puedeCrear={await puedeCrearProductos(contexto)}
      />
    );
  });
}
