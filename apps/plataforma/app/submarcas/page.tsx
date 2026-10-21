import { Texto } from "../../../web/ui/primitivas/Texto";
import { ArmazonDeConsola } from "../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../pantallas/aviso-de-error";
import { TablaDeSubmarcas } from "../../pantallas/tabla-de-submarcas";
import estilos from "../../pantallas/empresas.module.css";
import { exigirAcceso } from "../../servidor/acceso";
import { listaDeSubmarcas } from "../../servidor/submarcas";

// `/submarcas`: la lista de submarcas con sus pendientes. Cada una lleva a su editor.
export default async function PaginaDeSubmarcas() {
  await exigirAcceso();
  const lista = await listaDeSubmarcas();
  return (
    <ArmazonDeConsola activo="submarcas">
      {!lista.ok ? (
        <AvisoDeError
          error={lista.error}
          referencia={lista.referencia}
          reintentarHref="/submarcas"
          textoInesperado="No pudimos cargar las submarcas."
        />
      ) : (
        <section className={estilos["lista"]} aria-label="Lista de submarcas">
          {lista.submarcas.length === 0 ? (
            <div className={estilos["vacio"]}>
              <Texto variante="subtitulo">Todavía no hay submarcas.</Texto>
            </div>
          ) : (
            <>
              <TablaDeSubmarcas filas={lista.submarcas} />
              <div className={estilos["pie"]}>
                <Texto>
                  {lista.submarcas.length} {lista.submarcas.length === 1 ? "submarca" : "submarcas"}
                </Texto>
              </div>
            </>
          )}
        </section>
      )}
    </ArmazonDeConsola>
  );
}
