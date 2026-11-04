import { ArmazonDeConsola } from "../../../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../../../pantallas/aviso-de-error";
import estilos from "../../../../pantallas/empresas.module.css";
import { PanelDePlan } from "../../../../pantallas/panel-de-plan.cliente";
import { exigirAcceso } from "../../../../servidor/acceso";
import { planDeEmpresa } from "../../../../servidor/plan";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/empresas/ID/plan`: el plan de una empresa (opción A del prototipo: ficha con sección Plan).
export default async function PaginaDePlanDeEmpresa({ params }: PropsDePagina) {
  await exigirAcceso();
  const { id } = await params;
  const resultado = await planDeEmpresa(id);
  const volver = (
    <a className={estilos["enlaceSimple"]} href="/empresas">
      Volver a Empresas
    </a>
  );
  if (!resultado.ok) {
    return (
      <ArmazonDeConsola activo="empresas" titulo="Plan de la empresa" acciones={volver}>
        <AvisoDeError
          error={resultado.error}
          referencia={resultado.referencia}
          reintentarHref={`/empresas/${encodeURIComponent(id)}/plan`}
          textoInesperado="No pudimos cargar el plan de la empresa."
        />
      </ArmazonDeConsola>
    );
  }
  return (
    <ArmazonDeConsola
      activo="empresas"
      titulo={`${resultado.plan.empresa} · Plan`}
      acciones={volver}
    >
      <PanelDePlan plan={resultado.plan} />
    </ArmazonDeConsola>
  );
}
