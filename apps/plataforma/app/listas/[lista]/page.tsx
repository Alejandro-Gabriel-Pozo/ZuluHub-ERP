import { notFound } from "next/navigation";
import { ArmazonDeConsola } from "../../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../../pantallas/aviso-de-error";
import estilos from "../../../pantallas/empresas.module.css";
import { ListaDeValores } from "../../../pantallas/lista-de-valores.cliente";
import { exigirAcceso } from "../../../servidor/acceso";
import { valoresDeLaLista } from "../../../servidor/listas";

type PropsDePagina = Readonly<{ params: Promise<{ lista: string }> }>;

// `/listas/marcas`: los valores de una lista (activos e inactivos). Un nombre de lista que no existe es «no encontrado»; el resto lo decide el servidor.
export default async function PaginaDeUnaLista({ params }: PropsDePagina) {
  await exigirAcceso();
  const { lista } = await params;
  const resultado = await valoresDeLaLista(lista);
  if (resultado === null) notFound();
  const volver = (
    <a className={estilos["enlaceSimple"]} href="/listas">
      Volver
    </a>
  );
  if (!resultado.ok) {
    return (
      <ArmazonDeConsola activo="listas" titulo="Listas" acciones={volver}>
        <AvisoDeError
          error={resultado.error}
          referencia={resultado.referencia}
          reintentarHref={`/listas/${encodeURIComponent(lista)}`}
          textoInesperado="Esta acción no está permitida"
        />
      </ArmazonDeConsola>
    );
  }
  return (
    <ArmazonDeConsola activo="listas" titulo={resultado.lista.titulo} acciones={volver}>
      <ListaDeValores
        lista={resultado.lista.nombre}
        valores={resultado.valores}
        puedeEditar={resultado.puedeEditar}
      />
    </ArmazonDeConsola>
  );
}
