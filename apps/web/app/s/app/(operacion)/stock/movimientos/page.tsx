import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLosMovimientos } from "../../../../../../servidor/existencias-y-libro-de-stock";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { leerLaLectura } from "../../../../../../ui/plantillas/stock/lectura/modelo-de-lectura";
import { armarLosMovimientos } from "../../../../../../ui/plantillas/stock/movimientos/modelo-de-movimientos";
import { PantallaDeMovimientos } from "../../../../../../ui/plantillas/stock/movimientos/PantallaDeMovimientos";
import { pestanasDeStock } from "../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../ui/plantillas/stock/PestanasDeStock";

type PropsDePagina = Readonly<{
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}>;

// `/stock/movimientos`: el libro del depósito elegido de la sucursal elegida en el dispositivo (maqueta `stock.html`, 09/11/2026), solo lectura: sin «Anular» todavía. El depósito y la página viajan
// en la dirección; la sucursal la fija el servidor, nunca la dirección.
export default async function PaginaDeMovimientos({ searchParams }: PropsDePagina) {
  const params = await searchParams;
  return pantallaDeOperacion({ titulo: "stock.pantalla.movimientos" }, async ({ contexto }) => {
    const cargado = await cargarLosMovimientos(contexto, leerLaLectura(params));
    if (!cargado.ok) return <ErrorDelDetalle error={cargado.error} />;
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("movimientos")} />
        <PantallaDeMovimientos
          vista={armarLosMovimientos(cargado.dato, (clave) => texto({}, clave))}
          textos={{
            depositos: texto({}, "stock.pantalla.depositos"),
            anulado: texto({}, "stock.estado.anulado"),
            siguiente: texto({}, "fiscal.pantalla.config_cert_siguiente"),
          }}
        />
      </>
    );
  });
}
