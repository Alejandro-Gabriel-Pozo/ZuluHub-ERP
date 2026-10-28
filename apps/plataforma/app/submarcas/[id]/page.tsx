import { ArmazonDeConsola } from "../../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../../pantallas/aviso-de-error";
import { EditorDeSubmarca } from "../../../pantallas/editor-de-submarca.cliente";
import estilos from "../../../pantallas/empresas.module.css";
import { exigirAcceso } from "../../../servidor/acceso";
import { fichaDeSubmarca } from "../../../servidor/submarcas";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/submarcas/ID`: el editor de la submarca (formulario y vista previa en vivo). Todo es borrador hasta confirmar.
export default async function PaginaDeSubmarca({ params }: PropsDePagina) {
  await exigirAcceso();
  const { id } = await params;
  const resultado = await fichaDeSubmarca(id);
  const volver = (
    <a className={estilos["enlaceSimple"]} href="/submarcas">
      Volver a Submarcas
    </a>
  );
  if (!resultado.ok) {
    return (
      <ArmazonDeConsola activo="submarcas" titulo="Submarca" acciones={volver}>
        <AvisoDeError
          error={resultado.error}
          referencia={resultado.referencia}
          reintentarHref={`/submarcas/${encodeURIComponent(id)}`}
          textoInesperado="No pudimos cargar la submarca."
        />
      </ArmazonDeConsola>
    );
  }
  const { ficha } = resultado;
  return (
    <ArmazonDeConsola
      activo="submarcas"
      titulo={`Submarca ${ficha.nombre}${ficha.borrador === null ? "" : " · borrador"}`}
      acciones={volver}
    >
      <EditorDeSubmarca ficha={ficha} />
    </ArmazonDeConsola>
  );
}
