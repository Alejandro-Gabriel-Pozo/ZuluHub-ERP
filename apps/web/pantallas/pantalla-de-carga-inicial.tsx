import { randomUUID } from "node:crypto";
import { registrarCargaInicialAccion } from "../app/s/app/acciones-de-carga-inicial";
import { cargarLasOpcionesDeLaCargaInicial } from "../servidor/carga-inicial-de-stock";
import { puedeEnStock } from "../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../ui/patrones/ErrorDelDetalle";
import { FormularioDeCargaInicial } from "../ui/plantillas/stock/carga-inicial/FormularioDeCargaInicial.cliente";
import { textoDeLaUnidad } from "../ui/plantillas/produccion/modelo-de-ordenes";
import { RUTAS_DE_STOCK } from "../ui/plantillas/stock/rutas-de-stock";
import { pestanasDeStock } from "../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../ui/plantillas/stock/PestanasDeStock";
import { pantallaDeOperacion } from "./operacion";

/**
 * La pantalla «Carga inicial» (maqueta `stock-carga-inicial.html`, FP-STK-08): las pestañas de Stock (se llega desde Existencias) y la grilla, dentro del armazón de operación. La sucursal la fija el servidor; los
 * depósitos (solo de uso Normal) y los artículos que se ofrecen son los que el servidor deja mover. La clave de idempotencia se genera una vez al abrir la página: repetir el envío (doble toque, red cortada) no
 * duplica. «Registrar» sale apagado sin el permiso (`stock.registrar_entrada` y `stock.ajustar`; el servidor igual decide).
 */
export function pantallaDeCargaInicial() {
  return pantallaDeOperacion({ titulo: "stock.motivo.carga_inicial" }, async ({ contexto }) => {
    const opciones = await cargarLasOpcionesDeLaCargaInicial(contexto);
    if (!opciones.ok) return <ErrorDelDetalle error={opciones.error} />;
    const dato = opciones.dato;
    const puedeEnviar =
      (await puedeEnStock(contexto, "stock.registrar_entrada")) &&
      (await puedeEnStock(contexto, "stock.ajustar"));
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("existencias")} />
        <FormularioDeCargaInicial
          accion={registrarCargaInicialAccion.bind(null, randomUUID())}
          depositos={dato.depositos.map((d) => ({ valor: d.id, etiqueta: d.nombre }))}
          articulos={dato.articulos.map((a) => ({ valor: a.id, etiqueta: a.nombre }))}
          unidades={Object.fromEntries(
            dato.articulos.map((a) => [a.id, textoDeLaUnidad(a.unidadId)]),
          )}
          hrefDeCancelar={RUTAS_DE_STOCK.existencias}
          puedeEnviar={puedeEnviar}
        />
      </>
    );
  });
}
