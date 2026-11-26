import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLasExistencias } from "../../../../../../servidor/existencias-y-libro-de-stock";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLasExistencias } from "../../../../../../ui/plantillas/stock/existencias/modelo-de-existencias";
import { PantallaDeExistencias } from "../../../../../../ui/plantillas/stock/existencias/PantallaDeExistencias";
import { puedeEnStock } from "../../../../../../servidor/ofertas-de-stock";
import { RUTAS_DE_MOVIMIENTOS } from "../../../../../../ui/plantillas/stock/movimientos/modelo-de-formularios";
import { leerLaLectura } from "../../../../../../ui/plantillas/stock/lectura/modelo-de-lectura";
import { RUTAS_DE_STOCK } from "../../../../../../ui/plantillas/stock/rutas-de-stock";
import { pestanasDeStock } from "../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../ui/plantillas/stock/PestanasDeStock";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/stock/existencias`: la existencia de cada artículo en el depósito elegido de la sucursal elegida en el dispositivo (maqueta `stock.html`, 09/11/2026). El depósito y la página viajan en la dirección;
// la sucursal la fija el servidor, nunca la dirección. Sin costos; los botones llevan a los formularios de movimiento, apagados sin permiso.
export default async function PaginaDeExistencias({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion({ titulo: "stock.pantalla.existencias" }, async ({ contexto }) => {
    const cargado = await cargarLasExistencias(contexto, leerLaLectura(params));
    if (!cargado.ok) return <ErrorDelDetalle error={cargado.error} />;
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("existencias")} />
        <PantallaDeExistencias
          vista={armarLasExistencias(cargado.dato)}
          textos={{
            depositos: texto({}, "stock.pantalla.depositos"),
            negativa: texto({}, "stock.pantalla.negativa"),
            siguiente: texto({}, "fiscal.pantalla.config_cert_siguiente"),
          }}
          acciones={[
            {
              texto: texto({}, "stock.accion.entrada"),
              href: RUTAS_DE_MOVIMIENTOS.entrada,
              habilitado: await puedeEnStock(contexto, "stock.registrar_entrada"),
            },
            {
              texto: texto({}, "stock.accion.salida"),
              href: RUTAS_DE_MOVIMIENTOS.salida,
              habilitado: await puedeEnStock(contexto, "stock.registrar_salida"),
            },
            {
              texto: texto({}, "stock.accion.transferir"),
              href: RUTAS_DE_MOVIMIENTOS.transferir,
              habilitado: await puedeEnStock(contexto, "stock.transferir"),
            },
            {
              texto: texto({}, "stock.accion.ajustar"),
              href: RUTAS_DE_MOVIMIENTOS.ajustar,
              habilitado: await puedeEnStock(contexto, "stock.ajustar"),
            },
            {
              texto: texto({}, "stock.motivo.carga_inicial"),
              href: RUTAS_DE_STOCK.cargaInicial,
              // DEC-STK-004: la carga inicial pide `stock.registrar_entrada` y además `stock.ajustar` (solo una ayuda: el servidor decide).
              habilitado:
                (await puedeEnStock(contexto, "stock.registrar_entrada")) &&
                (await puedeEnStock(contexto, "stock.ajustar")),
            },
          ]}
        />
      </>
    );
  });
}
