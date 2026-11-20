import { Aviso } from "../../../../../web/ui/componentes/Aviso";
import { Texto } from "../../../../../web/ui/primitivas/Texto";
import { textoDePlanes } from "../../../../logica/textos-de-planes";
import { ArmazonDeConsola } from "../../../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../../../pantallas/aviso-de-error";
import { EditorDeBorrador } from "../../../../pantallas/editor-de-borrador.cliente";
import { exigirAcceso } from "../../../../servidor/acceso";
import { fichaDelPlan } from "../../../../servidor/planes";

type Props = Readonly<{ params: Promise<{ id: string }> }>;

// `/planes/ID/borrador`: el editor del borrador. Sin el permiso de editar (o con el plan retirado) no se ofrece: el servidor igual lo vuelve a exigir al guardar.
export default async function PaginaDeBorradorDePlan({ params }: Props) {
  await exigirAcceso();
  const { id } = await params;
  const datos = await fichaDelPlan(id);
  if (!datos.ok) {
    return (
      <ArmazonDeConsola activo="planes" titulo={textoDePlanes("plataforma.planes.titulo")}>
        <AvisoDeError
          error={datos.error}
          referencia={datos.referencia}
          reintentarHref={`/planes/${encodeURIComponent(id)}/borrador`}
          textoInesperado={textoDePlanes("plataforma.planes.no_se_pudo_cargar")}
        />
      </ArmazonDeConsola>
    );
  }
  const { ficha, puede } = datos;
  const titulo = `${ficha.codigo} · ${textoDePlanes("plataforma.planes.version_borrador")}`;
  if (!puede.editar || ficha.retirado) {
    return (
      <ArmazonDeConsola activo="planes" titulo={titulo}>
        <Aviso tono="aviso">
          <Texto>{textoDePlanes("plataforma.planes.no_permitido")}</Texto>
        </Aviso>
      </ArmazonDeConsola>
    );
  }
  const fuente = ficha.borrador ?? ficha.ultima;
  const inicial = fuente === null ? { nombreComercial: "", modulos: [], perillas: {} } : fuente;
  return (
    <ArmazonDeConsola activo="planes" titulo={titulo}>
      <EditorDeBorrador
        planId={ficha.id}
        codigo={ficha.codigo}
        inicial={{
          nombreComercial: inicial.nombreComercial,
          modulos: inicial.modulos,
          perillas: inicial.perillas,
        }}
        versionEsperada={ficha.borrador?.version ?? null}
        base={
          ficha.ultima === null || ficha.ultima.numero === null
            ? null
            : {
                numero: ficha.ultima.numero,
                contenido: {
                  nombreComercial: ficha.ultima.nombreComercial,
                  modulos: ficha.ultima.modulos,
                  perillas: ficha.ultima.perillas,
                },
              }
        }
        copiadaDe={ficha.borrador === null && ficha.ultima !== null ? ficha.ultima.numero : null}
        puedePublicar={puede.publicar}
      />
    </ArmazonDeConsola>
  );
}
