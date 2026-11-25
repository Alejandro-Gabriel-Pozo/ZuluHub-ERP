import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLosDepositos } from "../../../../../../servidor/depositos-de-stock";
import { puedeEnStock } from "../../../../../../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarLaListaDeDepositos,
  RUTAS_DE_DEPOSITOS,
} from "../../../../../../ui/plantillas/stock/depositos/modelo-de-depositos";
import { PantallaDeDepositos } from "../../../../../../ui/plantillas/stock/depositos/PantallaDeDepositos";
import { pestanasDeStock } from "../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../ui/plantillas/stock/PestanasDeStock";
import { cambiarElEstadoDelDepositoAccion } from "../../../acciones-de-depositos";

// `/stock/depositos`: los depósitos de la sucursal elegida en el dispositivo (maquetas `stock.html`, 09/11/2026, y `stock-depositos-gestion.html`, 25/11/2026). Sin sucursal elegida no se asume
// «todas»: sale el genérico. También se ven los desactivados, con su estado, para poder reactivarlos. «Editar», «Desactivar» y «Reactivar» se dibujan solo para quien tiene el permiso (el servidor
// igual decide al intentarlo).
export default async function PaginaDeDepositos() {
  return pantallaDeOperacion({ titulo: "stock.pantalla.depositos" }, async ({ contexto }) => {
    const depositos = await cargarLosDepositos(contexto);
    if (!depositos.ok) return <ErrorDelDetalle error={depositos.error} />;
    return (
      <>
        <PestanasDeStock pestanas={pestanasDeStock("depositos")} />
        <PantallaDeDepositos
          filas={armarLaListaDeDepositos(depositos.dato.depositos, (clave) => texto({}, clave))}
          textos={{
            agregar: texto({}, "stock.deposito.agregar"),
            deVenta: texto({}, "stock.deposito.de_venta"),
            desactivado: texto({}, "catalogo.estado.desactivado"),
            editar: texto({}, "catalogo.accion.editar"),
            desactivar: texto({}, "catalogo.accion.desactivar"),
            reactivar: texto({}, "catalogo.accion.reactivar"),
          }}
          puede={{
            editar: await puedeEnStock(contexto, "depositos.editar"),
            desactivar: await puedeEnStock(contexto, "depositos.desactivar"),
            reactivar: await puedeEnStock(contexto, "depositos.reactivar"),
          }}
          hrefDeEditar={RUTAS_DE_DEPOSITOS.editar}
          accionDeEstado={(id, activar) => cambiarElEstadoDelDepositoAccion.bind(null, id, activar)}
          puedeAgregar={await puedeEnStock(contexto, "depositos.crear")}
          hrefDeAgregar={RUTAS_DE_DEPOSITOS.nuevo}
        />
      </>
    );
  });
}
