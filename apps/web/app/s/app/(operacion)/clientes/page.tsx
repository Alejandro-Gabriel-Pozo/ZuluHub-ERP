import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { cargarLasPartes } from "../../../../../servidor/directorio";
import { accionesDelDirectorio } from "../../../../../servidor/ofertas-de-clientes";
import { ErrorDelDetalle } from "../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeListaDelDirectorio } from "../../../../../ui/plantillas/clientes/PantallaDeListaDelDirectorio";
import {
  armarLaLista,
  armarLosFiltros,
  leerLaPagina,
  leerLosFiltros,
} from "../../../../../ui/plantillas/clientes/modelo-de-directorio";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/clientes`: clientes y proveedores de la empresa (maqueta `directorio.html`, aprobada el 09/11/2026). «Clientes» (área Ventas) y «Proveedores» (área Compras) abren esta misma pantalla con
// el filtro por rol. Solo lectura. Los filtros y la página viajan en la dirección y se vuelven a validar en el servidor; la empresa y la persona las pone el servidor, y el permiso (`partes.ver`)
// lo decide la consulta; «Nuevo» sale solo con `partes.crear` (`accionesDelDirectorio`, cierra ante la duda).
export default async function PaginaDeLaListaDelDirectorio({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion(
    { titulo: "clientes.lista.clientes_y_proveedores" },
    async ({ contexto }) => {
      const filtros = leerLosFiltros(params);
      const pagina = await cargarLasPartes({
        texto: filtros.texto === "" ? undefined : filtros.texto,
        rol: filtros.rol === "" ? undefined : filtros.rol,
        desactivados: filtros.desactivados ? "1" : undefined,
        despuesDe: leerLaPagina(params),
      });
      return (
        <PantallaDeListaDelDirectorio
          filtros={armarLosFiltros(filtros)}
          lista={
            pagina.ok
              ? armarLaLista(pagina.dato, filtros, await accionesDelDirectorio(contexto))
              : null
          }
          error={pagina.ok ? null : <ErrorDelDetalle error={pagina.error} />}
        />
      );
    },
  );
}
