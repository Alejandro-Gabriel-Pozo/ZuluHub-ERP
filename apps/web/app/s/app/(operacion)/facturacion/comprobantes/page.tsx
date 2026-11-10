import { redirect } from "next/navigation";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import {
  conElPeriodoFijo,
  entradaDelListado,
} from "../../../../../../pantallas/entrada-del-listado";
import { cargarElListado } from "../../../../../../servidor/facturacion";
import { puedeEmitirFacturas } from "../../../../../../servidor/modulos";
import { ErrorDelDetalle } from "../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import {
  armarLosFiltros,
  conPuntoDeVentaDe,
  direccionDelListado,
  leerLaPagina,
  leerLosFiltros,
} from "../../../../../../ui/plantillas/facturacion/filtros-del-listado";
import {
  armarElListado,
  armarLaEleccionDeSucursal,
  enlaceDeEmitir,
  enlaceDePendientes,
  errorParaElListado,
} from "../../../../../../ui/plantillas/facturacion/modelo-del-listado";
import { PantallaDeListadoDeComprobantes } from "../../../../../../ui/plantillas/facturacion/PantallaDeListadoDeComprobantes";
import { elegirSucursalAccion } from "../../../acciones-de-sucursal";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/facturacion/comprobantes`: el listado (6A celular + 6C escritorio). Los filtros y la página viajan en la dirección; la sucursal
// la guarda y valida el servidor (cookie), nunca la dirección. El título es el del armazón (el único `h1`).
export default async function PaginaDeListadoDeComprobantes({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.listado_titulo", actual: "comprobantes" },
    async ({ contexto }) => {
      const filtros = leerLosFiltros(params);
      const despues = leerLaPagina(params);
      const ahora = new Date();
      const cargado = await cargarElListado(contexto, (puntosDeVenta) =>
        entradaDelListado(conPuntoDeVentaDe(filtros, puntosDeVenta), ahora, despues),
      );
      const aplicados = conPuntoDeVentaDe(
        filtros,
        cargado.puntosDeVenta.map((p) => p.numero),
      );
      const { pagina } = cargado;
      // Una clave de página que no sirve (vieja, tocada a mano) no se muestra como error: se vuelve a la primera página.
      if (!pagina.ok && pagina.error.codigo === "FISCAL_FILTRO_INVALIDO" && despues !== null) {
        redirect(direccionDelListado(aplicados, null));
      }
      // Sin sucursal con la que listar la pantalla hace elegir: el selector (con su invitación) reemplaza al error.
      const sinElegir = !pagina.ok && pagina.error.codigo === "FISCAL_SUCURSAL_NO_ELEGIDA";
      const sinSucursal = cargado.efectiva === "";
      // «+ Emitir» solo para quien puede emitir hoy (el servidor vuelve a validar al abrir Emitir y al emitir).
      const puedeEmitir = await puedeEmitirFacturas(contexto);
      return (
        <PantallaDeListadoDeComprobantes
          emitir={puedeEmitir ? enlaceDeEmitir({}) : null}
          pendientes={puedeEmitir ? enlaceDePendientes({}) : null}
          eleccionDeSucursal={armarLaEleccionDeSucursal(cargado.sucursales, cargado.efectiva)}
          accionDeSucursal={elegirSucursalAccion}
          filtros={sinSucursal ? null : armarLosFiltros(aplicados, cargado.puntosDeVenta)}
          listado={
            pagina.ok ? armarElListado(pagina.dato, conElPeriodoFijo(aplicados, ahora)) : null
          }
          error={
            pagina.ok || sinElegir ? null : (
              <ErrorDelDetalle error={errorParaElListado(pagina.error)} />
            )
          }
        />
      );
    },
  );
}
