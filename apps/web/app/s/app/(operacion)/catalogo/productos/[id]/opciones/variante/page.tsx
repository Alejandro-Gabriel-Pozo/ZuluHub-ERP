import { conTitulo, pantallaDeOperacion } from "../../../../../../../../../pantallas/operacion";
import { puedeEditarOpciones } from "../../../../../../../../../servidor/modulos";
import { cargarLaVariante } from "../../../../../../../../../servidor/opciones";
import { ErrorDelDetalle } from "../../../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeGrupoDeOpciones } from "../../../../../../../../../ui/plantillas/catalogo/FormularioDeGrupoDeOpciones.cliente";
import { armarLaVariante } from "../../../../../../../../../ui/plantillas/catalogo/modelo-de-opciones";
import { guardarVarianteAccion } from "../../../../../../acciones-de-opciones";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/catalogo/productos/[id]/opciones/variante`: la variante (la medida) del producto (maqueta `productos.html`, «Agregar variante» y «Editar»). Un producto admite una sola: esta pantalla edita la
// que tiene o crea la primera; el id de la dirección es lo único que viene del navegador. La clave del cambio es el id de la variante nueva (idempotencia) y la acción lleva la versión de las
// opciones que se vio. Sin recargos: el precio de cada medida es propio (se carga en la pantalla de precios).
export default async function PaginaDeLaVarianteDeUnProducto({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const respuesta = await cargarLaVariante(contexto, id);
    if (!respuesta.ok) return <ErrorDelDetalle error={respuesta.error} />;
    const variante = armarLaVariante(respuesta.dato);
    return conTitulo(
      variante.titulo,
      <FormularioDeGrupoDeOpciones
        key={`${variante.id}-${String(respuesta.dato.versionDeOpciones)}-variante`}
        grupo={variante}
        accion={guardarVarianteAccion.bind(
          null,
          variante.id,
          respuesta.dato.versionDeOpciones,
          respuesta.dato.grupo === null ? null : respuesta.dato.grupo.id,
          respuesta.dato.claveDelCambio,
          respuesta.dato.grupo === null ? [] : respuesta.dato.grupo.opciones.map((o) => o.id),
        )}
        puedeGuardar={await puedeEditarOpciones(contexto)}
      />,
    );
  });
}
