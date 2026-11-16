import { pantallaDeOperacion } from "../../../../../../../../pantallas/operacion";
import { puedeEditarProductos } from "../../../../../../../../servidor/modulos";
import { cargarLosCandidatos } from "../../../../../../../../servidor/secciones";
import { ErrorDelDetalle } from "../../../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLosCandidatos } from "../../../../../../../../ui/plantillas/catalogo/modelo-de-secciones";
import { PantallaDeAgregarProducto } from "../../../../../../../../ui/plantillas/catalogo/PantallaDeAgregarProducto";
import { agregarProductoASeccionAccion } from "../../../../../acciones-de-secciones";

type PropsDePagina = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

const primero = (valor: string | string[] | undefined): string =>
  (Array.isArray(valor) ? valor[0] : valor) ?? "";

// `/catalogo/secciones/[id]/agregar`: elegir un producto para ponerlo en la sección (maqueta `productos-secciones.html`, «Agregar producto», 12/11/2026; pantalla y no hoja, S6 de la ficha). El texto
// buscado y la página viajan en la dirección; el id es lo único más que viene del navegador y se busca entre las secciones de la empresa (una que no está ahí sale como el genérico). «Agregar» lleva
// ligados con `bind` los candidatos como se ven, con su versión (no viajan en un campo). Los candidatos salen apagados sin `productos.editar` (`puedeEditarProductos`, cierra ante la duda).
export default async function PaginaDeAgregarProducto({ params, searchParams }: PropsDePagina) {
  const { id } = await params;
  const direccion = await searchParams;
  const buscado = primero(direccion["texto"]).trim();
  return pantallaDeOperacion(
    { titulo: "catalogo.seccion.agregar_producto" },
    async ({ contexto }) => {
      const respuesta = await cargarLosCandidatos(
        contexto,
        id,
        buscado,
        primero(direccion["despues"]),
      );
      if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
      const candidatos = armarLosCandidatos(
        respuesta.dato,
        buscado,
        await puedeEditarProductos(contexto),
      );
      return (
        <PantallaDeAgregarProducto
          candidatos={candidatos}
          accion={agregarProductoASeccionAccion.bind(
            null,
            candidatos.seccion.id,
            candidatos.vistas,
          )}
        />
      );
    },
  );
}
