import { Texto } from "../../../web/ui/primitivas/Texto";
import { EnlaceDeAccion } from "../../../web/ui/componentes/EnlaceDeAccion";
import { Aviso } from "../../../web/ui/componentes/Aviso";
import { ArmazonDeConsola } from "../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../pantallas/aviso-de-error";
import { FiltrosDeEmpresas } from "../../pantallas/filtros-de-empresas.cliente";
import { TablaDeEmpresas } from "../../pantallas/tabla-de-empresas";
import estilos from "../../pantallas/empresas.module.css";
import { direccionDeEmpresas, filtrosDeLaDireccion } from "../../logica/filtros-de-empresas";
import { exigirAcceso } from "../../servidor/acceso";
import { listaDeEmpresas, opcionesDeFiltros } from "../../servidor/empresas";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/empresas`: la lista con filtros (opción A del prototipo). Los filtros viajan en la dirección.
export default async function PaginaDeEmpresas({ searchParams }: PropsDePagina) {
  await exigirAcceso();
  const filtros = filtrosDeLaDireccion(await searchParams);
  const [lista, opciones] = await Promise.all([listaDeEmpresas(filtros), opcionesDeFiltros()]);
  const hayFiltros =
    filtros.estadoEfectivo !== undefined ||
    filtros.marcaId !== undefined ||
    filtros.planId !== undefined ||
    filtros.buscar !== undefined;
  const aqui = direccionDeEmpresas(filtros);

  return (
    <ArmazonDeConsola
      activo="empresas"
      acciones={<EnlaceDeAccion href="/empresas/nueva">+ Nueva empresa</EnlaceDeAccion>}
    >
      {!lista.ok ? (
        <AvisoDeError
          error={lista.error}
          referencia={lista.referencia}
          reintentarHref={aqui}
          textoInesperado="No pudimos cargar las empresas."
        />
      ) : (
        <>
          {opciones.ok ? (
            <FiltrosDeEmpresas
              submarcas={opciones.submarcas}
              planes={opciones.planes}
              hayFiltros={hayFiltros}
              inicial={{
                estado: filtros.estadoEfectivo ?? "",
                submarca: filtros.marcaId ?? "",
                plan: filtros.planId ?? "",
                buscar: filtros.buscar ?? "",
              }}
            />
          ) : (
            <Aviso tono="aviso">
              <Texto>
                No pudimos cargar las opciones de los filtros. Podés seguir viendo la lista.
              </Texto>
            </Aviso>
          )}
          <section className={estilos["lista"]} aria-label="Lista de empresas">
            {lista.filas.length === 0 ? (
              <div className={estilos["vacio"]}>
                <Texto variante="subtitulo">
                  {hayFiltros
                    ? "Ninguna empresa coincide con los filtros"
                    : "Todavía no hay empresas"}
                </Texto>
                {hayFiltros ? (
                  <a className={estilos["enlaceSimple"]} href="/empresas">
                    Quitar filtros
                  </a>
                ) : null}
              </div>
            ) : (
              <>
                <TablaDeEmpresas filas={lista.filas} />
                <div className={estilos["pie"]}>
                  <Texto>
                    {lista.filas.length} {lista.filas.length === 1 ? "empresa" : "empresas"}
                  </Texto>
                  {lista.siguienteDespuesDeId === null ? null : (
                    <a
                      className={estilos["enlaceSimple"]}
                      href={direccionDeEmpresas({
                        ...filtros,
                        despuesDeId: lista.siguienteDespuesDeId,
                      })}
                    >
                      Ver más
                    </a>
                  )}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </ArmazonDeConsola>
  );
}
