import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import {
  puedeCrearProductos,
  puedeOcultarEnElLocal,
  puedeOcultarEnLaEmpresa,
} from "../../../../../../servidor/modulos";
import { cargarLosOcultos } from "../../../../../../servidor/ocultar";
import { cargarLosProductos } from "../../../../../../servidor/productos";
import {
  RUTA_DE_PRODUCTOS,
  armarLosFiltros,
  leerLaPagina,
  leerLosFiltros,
  pideLosOcultos,
} from "../../../../../../ui/plantillas/catalogo/filtros-de-productos";
import {
  armarElEnlaceDeAlta,
  armarElFiltroDeOcultos,
  armarLaLista,
} from "../../../../../../ui/plantillas/catalogo/modelo-de-productos";
import { armarLosOcultos } from "../../../../../../ui/plantillas/catalogo/modelo-de-ocultos";
import { ListaDeProductosOcultos } from "../../../../../../ui/plantillas/catalogo/ListaDeProductosOcultos.cliente";
import { EnlaceDeAccion } from "../../../../../../ui/componentes/EnlaceDeAccion";
import { Pila } from "../../../../../../ui/primitivas/Pila";
import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { volverAMostrarAccion } from "../../../acciones-de-ocultar";
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
    // La lista de ocultos (C2): el filtro «Oculto». Solo se ofrece si se pudo leer dónde está oculto cada producto; si no, cae a la lista común.
    const ocultos = await cargarLosOcultos(contexto);
    if (pideLosOcultos(params) && ocultos.ok) {
      const lista = armarLosOcultos(ocultos.dato, {
        local: await puedeOcultarEnElLocal(contexto),
        empresa: await puedeOcultarEnLaEmpresa(contexto),
      });
      return (
        <Pila separacion={4}>
          <div>
            <EnlaceDeAccion href={RUTA_DE_PRODUCTOS}>
              {texto({}, "catalogo.lista.titulo")}
            </EnlaceDeAccion>
          </div>
          <ListaDeProductosOcultos
            lista={lista}
            acciones={Object.fromEntries(
              ocultos.dato.map((o) => [
                o.productoId,
                volverAMostrarAccion.bind(null, [o.productoId]),
              ]),
            )}
          />
        </Pila>
      );
    }
    const filtros = leerLosFiltros(params);
    const despues = leerLaPagina(params);
    const pagina = await cargarLosProductos(contexto, { ...filtros, despues });
    const nuevo = armarElEnlaceDeAlta(await puedeCrearProductos(contexto));
    return (
      <PantallaDeListaDeProductos
        filtros={armarLosFiltros(filtros)}
        lista={
          pagina.ok
            ? armarLaLista(
                pagina.dato,
                filtros,
                {},
                new Map(ocultos.ok ? ocultos.dato.map((o) => [o.productoId, o]) : []),
              )
            : null
        }
        error={pagina.ok ? null : <ErrorDelDetalle error={pagina.error} />}
        nuevo={nuevo}
        filtroDeOcultos={armarElFiltroDeOcultos(ocultos.ok)}
      />
    );
  });
}
