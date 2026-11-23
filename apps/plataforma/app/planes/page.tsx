import { ArmazonDeConsola } from "../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../pantallas/aviso-de-error";
import { ListaDePlanes } from "../../pantallas/lista-de-planes";
import { NuevoPlan } from "../../pantallas/nuevo-plan.cliente";
import estilos from "../../pantallas/empresas.module.css";
import { Texto } from "../../../web/ui/primitivas/Texto";
import { textoDePlanes, textoDelNucleo } from "../../logica/textos-de-planes";
import { exigirAcceso } from "../../servidor/acceso";
import { listaDePlanes } from "../../servidor/planes";

// `/planes`: la lista de planes. «Nuevo plan» solo se ofrece a quien puede crear (el servidor lo vuelve a exigir).
export default async function PaginaDePlanes() {
  await exigirAcceso();
  const lista = await listaDePlanes();
  return (
    <ArmazonDeConsola
      activo="planes"
      acciones={lista.ok && lista.puede.crear ? <NuevoPlan /> : undefined}
    >
      {!lista.ok ? (
        <AvisoDeError
          error={lista.error}
          referencia={lista.referencia}
          reintentarHref="/planes"
          textoInesperado={textoDelNucleo("estado.error_titulo")}
        />
      ) : lista.planes.length === 0 ? (
        <div className={estilos["vacio"]}>
          <Texto variante="subtitulo">{textoDePlanes("plataforma.planes.sin_planes")}</Texto>
        </div>
      ) : (
        <section
          className={estilos["lista"]}
          aria-label={textoDePlanes("plataforma.planes.titulo")}
        >
          <ListaDePlanes filas={lista.planes} />
        </section>
      )}
    </ArmazonDeConsola>
  );
}
