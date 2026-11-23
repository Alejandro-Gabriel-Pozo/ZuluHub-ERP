import { Texto } from "../../../web/ui/primitivas/Texto";
import { ArmazonDeConsola } from "../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../pantallas/aviso-de-error";
import estilos from "../../pantallas/empresas.module.css";
import { exigirAcceso } from "../../servidor/acceso";
import { resumenDeListas } from "../../servidor/listas";

// `/listas`: las listas del sistema que administra la plataforma, cada una con la cantidad de valores que se ofrecen hoy (maqueta `listas.html`, 09/11/2026).
export default async function PaginaDeListas() {
  await exigirAcceso();
  const resumen = await resumenDeListas();
  return (
    <ArmazonDeConsola activo="listas">
      {!resumen.ok ? (
        <AvisoDeError
          error={resumen.error}
          referencia={resumen.referencia}
          reintentarHref="/listas"
          textoInesperado="Esta acción no está permitida"
        />
      ) : (
        <section className={estilos["lista"]} aria-label="Listas">
          <ul>
            {resumen.listas.map((l) => (
              <li key={l.nombre}>
                <a className={estilos["enlaceSimple"]} href={`/listas/${l.nombre}`}>
                  {l.titulo}
                </a>
                <Texto>{l.activos} valores</Texto>
              </li>
            ))}
          </ul>
        </section>
      )}
    </ArmazonDeConsola>
  );
}
