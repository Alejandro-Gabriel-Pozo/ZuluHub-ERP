import { conTitulo, pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import { puedeCambiarPrecios } from "../../../../../../../../../servidor/modulos";
import { cargarLosPreciosPorMedida } from "../../../../../../../../../servidor/precios-por-medida";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDePreciosPorMedida } from "../../../../../../../../../ui/plantillas/catalogo/FormularioDePreciosPorMedida.cliente";
import { armarLosPreciosPorMedida } from "../../../../../../../../../ui/plantillas/catalogo/modelo-de-precios-por-medida";
import { cambiarPreciosPorMedidaAccion } from "../../../../../../acciones-de-productos";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]/precios/medidas`: el precio de la empresa de cada medida de un producto con variante (maqueta `productos.html`, solapa «Precios»). El id de la dirección es lo único que
// viene del navegador: un producto que no está, que no se vende o que no tiene variante sale como el genérico. La acción lleva la clave del cambio y, por medida, su id y la fila vista como
// vigente (si otra persona cambió antes, el servidor rechaza esa medida). Sin entrada en el menú: se llega desde los precios del producto.
export default async function PaginaDeLosPreciosPorMedida({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLosPreciosPorMedida(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const precios = armarLosPreciosPorMedida(respuesta.dato);
    return conTitulo(
      precios.titulo,
      <FormularioDePreciosPorMedida
        key={`${precios.id}-${respuesta.dato.medidas.map((m) => m.vigente?.precioId ?? "-").join(".")}`}
        precios={precios}
        accion={cambiarPreciosPorMedidaAccion.bind(
          null,
          precios.id,
          respuesta.dato.claveDelCambio,
          respuesta.dato.medidas.map((m) => ({
            opcionId: m.opcionId,
            precioIdEsperado: m.vigente === null ? null : m.vigente.precioId,
          })),
        )}
        puedeGuardar={await puedeCambiarPrecios(contexto)}
      />,
    );
  });
}
