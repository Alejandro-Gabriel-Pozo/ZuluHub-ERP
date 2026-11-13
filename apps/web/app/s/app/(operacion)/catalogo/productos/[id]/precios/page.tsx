import { conTitulo, pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { puedeCambiarPrecios } from "../../../../../../../../servidor/modulos";
import { cargarLosPrecios } from "../../../../../../../../servidor/precios-de-producto";
import { FormularioDePrecioDeProducto } from "../../../../../../../../ui/plantillas/catalogo/FormularioDePrecioDeProducto.cliente";
import { armarLosPrecios } from "../../../../../../../../ui/plantillas/catalogo/modelo-de-precios-de-producto";
import { ErrorDelDetalle } from "../../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { cambiarPrecioAccion } from "../../../../../acciones-de-productos";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]/precios`: el precio de la empresa de un producto (maqueta `productos.html`, solapa «Precios», 12/11/2026). El id de la dirección es lo único que viene del
// navegador: se busca entre los productos de la empresa; uno que no está ahí (ajeno, inexistente, mal escrito, que no se vende) sale como el genérico y no dice cuál de los casos es. La
// acción lleva la clave del cambio (idempotencia) y la fila que se vio como vigente (si otra persona cambió antes, el servidor rechaza). Sin entrada en el menú: se llega por la dirección.
// El permiso (`productos.ver`) y el módulo en desarrollo los decide la consulta.
export default async function PaginaDeLosPreciosDeUnProducto({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLosPrecios(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const precios = armarLosPrecios(respuesta.dato);
    return conTitulo(
      precios.titulo,
      <FormularioDePrecioDeProducto
        key={precios.id}
        precios={precios}
        accion={cambiarPrecioAccion.bind(
          null,
          precios.id,
          respuesta.dato.claveDelCambio,
          respuesta.dato.vigente === null ? null : respuesta.dato.vigente.precioId,
        )}
        puedeGuardar={await puedeCambiarPrecios(contexto)}
      />,
    );
  });
}
