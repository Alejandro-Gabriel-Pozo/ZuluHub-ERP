import { ArmazonDeConsola } from "../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../pantallas/aviso-de-error";
import { PoliticaDePlan } from "../../pantallas/politica-de-plan.cliente";
import { TablaDePoliticas } from "../../pantallas/tabla-de-politicas";
import estilos from "../../pantallas/empresas.module.css";
import { Texto } from "../../../web/ui/primitivas/Texto";
import { textoDePlanes, textoDelNucleo } from "../../logica/textos-de-planes";
import { exigirAcceso } from "../../servidor/acceso";
import { politicaDeCambioDePlan } from "../../servidor/politica";

// `/politica-de-plan`: la política de cambio de plan vigente y su historial. «Definir versión nueva» solo se ofrece a quien puede (el servidor lo vuelve a exigir).
export default async function PaginaDePoliticaDePlan() {
  await exigirAcceso();
  const politica = await politicaDeCambioDePlan();
  return (
    <ArmazonDeConsola activo="politica" titulo={textoDePlanes("plataforma.politica.titulo")}>
      {!politica.ok ? (
        <AvisoDeError
          error={politica.error}
          referencia={politica.referencia}
          reintentarHref="/politica-de-plan"
          textoInesperado={textoDelNucleo("estado.error_titulo")}
        />
      ) : (
        <>
          <PoliticaDePlan vigente={politica.vigente} puedeDefinir={politica.puedeDefinir} />
          <section
            className={estilos["lista"]}
            aria-label={textoDePlanes("plataforma.politica.historial")}
          >
            <Texto variante="subtitulo">{textoDePlanes("plataforma.politica.historial")}</Texto>
            <TablaDePoliticas filas={politica.historial} />
          </section>
        </>
      )}
    </ArmazonDeConsola>
  );
}
