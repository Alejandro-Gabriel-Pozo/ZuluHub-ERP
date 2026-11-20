import { ArmazonDeConsola } from "../../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../../pantallas/aviso-de-error";
import { FichaDePlan, type AvisoDeFicha } from "../../../pantallas/ficha-de-plan";
import { textoDePlanes } from "../../../logica/textos-de-planes";
import { exigirAcceso } from "../../../servidor/acceso";
import { fichaDelPlan } from "../../../servidor/planes";

type Props = Readonly<{
  params: Promise<{ id: string }>;
  searchParams: Promise<{ aviso?: string | string[] }>;
}>;

/** Lista blanca de lo que la dirección puede pedir que se diga: nada que no sea una de estas tres palabras llega a la pantalla. */
const AVISOS: readonly Exclude<AvisoDeFicha, null>[] = ["creado", "existia", "publicada"];

// `/planes/ID`: la ficha del plan con sus versiones.
export default async function PaginaDeFichaDePlan({ params, searchParams }: Props) {
  await exigirAcceso();
  const { id } = await params;
  const { aviso } = await searchParams;
  const ficha = await fichaDelPlan(id);
  const delAviso = AVISOS.find((a) => a === aviso) ?? null;
  return (
    <ArmazonDeConsola
      activo="planes"
      titulo={
        ficha.ok
          ? `${textoDePlanes("plataforma.planes.titulo")} · ${ficha.ficha.codigo}`
          : textoDePlanes("plataforma.planes.titulo")
      }
    >
      {ficha.ok ? (
        <FichaDePlan ficha={ficha.ficha} puede={ficha.puede} aviso={delAviso} />
      ) : (
        <AvisoDeError
          error={ficha.error}
          referencia={ficha.referencia}
          reintentarHref={`/planes/${encodeURIComponent(id)}`}
          textoInesperado={textoDePlanes("plataforma.planes.no_se_pudo_cargar")}
        />
      )}
    </ArmazonDeConsola>
  );
}
