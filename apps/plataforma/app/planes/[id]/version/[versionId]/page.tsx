import { ArmazonDeConsola } from "../../../../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../../../../pantallas/aviso-de-error";
import { VistaDeVersion } from "../../../../../pantallas/vista-de-version";
import { textoDePlanes } from "../../../../../logica/textos-de-planes";
import { exigirAcceso } from "../../../../../servidor/acceso";
import { versionDelPlan } from "../../../../../servidor/planes";

type Props = Readonly<{ params: Promise<{ id: string; versionId: string }> }>;

// `/planes/ID/version/VERSION`: una versión publicada, solo lectura.
export default async function PaginaDeVersionDePlan({ params }: Props) {
  await exigirAcceso();
  const { id, versionId } = await params;
  const datos = await versionDelPlan(id, versionId);
  const version = datos.ok ? datos.ficha.publicadas.find((v) => v.id === versionId) : undefined;
  return (
    <ArmazonDeConsola
      activo="planes"
      titulo={
        datos.ok && version !== undefined
          ? `${datos.ficha.codigo} · v${String(version.numero)}`
          : textoDePlanes("plataforma.planes.titulo")
      }
    >
      {datos.ok && version !== undefined ? (
        <VistaDeVersion ficha={datos.ficha} version={version} clientes={datos.clientes} />
      ) : (
        <AvisoDeError
          error={datos.ok ? { tipo: "INESPERADO" } : datos.error}
          referencia={datos.ok ? undefined : datos.referencia}
          reintentarHref={`/planes/${encodeURIComponent(id)}`}
          textoInesperado={textoDePlanes("plataforma.planes.no_se_pudo_cargar")}
        />
      )}
    </ArmazonDeConsola>
  );
}
