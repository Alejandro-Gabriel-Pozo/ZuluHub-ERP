import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLasRecepciones, puedeRecibir } from "../../../../../../servidor/recepciones";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { PantallaDeListaDeRecepciones } from "../../../../../../ui/plantillas/compras/recepciones/PantallaDeListaDeRecepciones";
import { textosDeRecepciones } from "../../../../../../ui/plantillas/compras/recepciones/textos-de-recepciones";

// `/compras/recepciones`: las recepciones de la sucursal elegida en este dispositivo (maqueta `compra-recibir.html`, estado `lista`). La sucursal la fija el servidor y la lectura exige `recepciones.ver`; lo que no
// se puede mostrar (sin sucursal, sin permiso, cursor mal formado) sale como el genérico: nunca una lista que parezca completa. La dirección solo aporta el cursor (`despues`). Sin filtros en la primera versión.
export default async function PaginaDeRecepciones({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const parametros = await searchParams;
  return pantallaDeOperacion({ titulo: "compras.recepcion.titulo_lista" }, async ({ contexto }) => {
    const lista = await cargarLasRecepciones(contexto, parametros);
    if (!lista.ok) return <ErrorDelDetalle error={lista.error} />;
    return (
      <PantallaDeListaDeRecepciones
        lista={lista.dato}
        textos={textosDeRecepciones()}
        puedeRecibir={await puedeRecibir(contexto)}
      />
    );
  });
}
