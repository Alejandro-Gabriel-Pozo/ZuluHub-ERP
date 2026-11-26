import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLasExistencias } from "../../../../../../servidor/existencias-y-libro-de-stock";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { armarLasExistencias } from "../../../../../../ui/plantillas/stock/existencias/modelo-de-existencias";
import { PantallaDeExistencias } from "../../../../../../ui/plantillas/stock/existencias/PantallaDeExistencias";
import { leerLaLectura } from "../../../../../../ui/plantillas/stock/lectura/modelo-de-lectura";
import { pestanasDeStock } from "../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../ui/plantillas/stock/PestanasDeStock";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/stock/existencias`: la existencia de cada artículo en el depósito elegido de la sucursal elegida en el dispositivo (maqueta `stock.html`, 09/11/2026). El depósito y la página viajan en la dirección;
// la sucursal la fija el servidor, nunca la dirección. Solo lectura: sin costos ni botones que escriban.
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
        />
      </>
    );
  });
}
