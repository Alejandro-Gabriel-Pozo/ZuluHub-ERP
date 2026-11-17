import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { puedeCrearProductos } from "../../../../../../servidor/modulos";
import { cargarLosProductos } from "../../../../../../servidor/productos";
import {
  armarLosFiltros,
  leerLaPagina,
  leerLosFiltros,
} from "../../../../../../ui/plantillas/catalogo/filtros-de-productos";
import {
  armarElEnlaceDeAlta,
  armarLaLista,
} from "../../../../../../ui/plantillas/catalogo/modelo-de-productos";
import { PantallaDeListaDeProductos } from "../../../../../../ui/plantillas/catalogo/PantallaDeListaDeProductos";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/catalogo/productos`: la lista de productos de la empresa, también los desactivados (maqueta `productos.html`, 12/11/2026). Solo lectura. Los filtros y la página viajan en
// la dirección; la empresa y la persona las pone el servidor, y el permiso (`productos.ver`) lo decide la consulta; «Nuevo producto» sale solo con `productos.crear` (`puedeCrearProductos`, cierra ante la duda). Sin entrada en el menú: se llega por la dirección.
export default async function PaginaDeListaDeProductos({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion({ titulo: "catalogo.lista.titulo" }, async ({ contexto }) => {
    const filtros = leerLosFiltros(params);
    const despues = leerLaPagina(params);
    const pagina = await cargarLosProductos(contexto, { ...filtros, despues });
    const nuevo = armarElEnlaceDeAlta(await puedeCrearProductos(contexto));
    return (
      <PantallaDeListaDeProductos
        filtros={armarLosFiltros(filtros)}
        lista={pagina.ok ? armarLaLista(pagina.dato, filtros) : null}
        error={pagina.ok ? null : <ErrorDelDetalle error={pagina.error} />}
        nuevo={nuevo}
      />
    );
  });
}
