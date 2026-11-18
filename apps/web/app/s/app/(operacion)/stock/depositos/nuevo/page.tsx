import { randomUUID } from "node:crypto";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  cargarLosDepositos,
  USOS_PARA_ELEGIR,
} from "../../../../../../../servidor/depositos-de-stock";
import { puedeEnStock } from "../../../../../../../servidor/ofertas-de-stock";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { FormularioDeDeposito } from "../../../../../../../ui/plantillas/stock/depositos/FormularioDeDeposito.cliente";
import {
  armarLaListaDeDepositos,
  opcionesDeUso,
  RUTAS_DE_DEPOSITOS,
} from "../../../../../../../ui/plantillas/stock/depositos/modelo-de-depositos";
import { PantallaDeDepositos } from "../../../../../../../ui/plantillas/stock/depositos/PantallaDeDepositos";
import { pestanasDeStock } from "../../../../../../../ui/plantillas/stock/pestanas-de-stock";
import { PestanasDeStock } from "../../../../../../../ui/plantillas/stock/PestanasDeStock";
import { agregarDepositoAccion } from "../../../../acciones-de-depositos";

// `/stock/depositos/nuevo`: agregar un depósito a la sucursal elegida (la fija el servidor, no el formulario). Se ve como en la maqueta `stock.html` (09/11/2026): las pestañas y la lista de
// depósitos a la vista y el formulario debajo, con «Cancelar» y «Agregar depósito» al pie. El identificador del alta se genera una vez al abrir el formulario y viaja ligado a la acción:
// repetir el envío (doble toque, red cortada) devuelve el mismo depósito sin duplicarlo.
export default async function PaginaDeAltaDeDeposito() {
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
          }}
          puedeAgregar={false}
          hrefDeAgregar={RUTAS_DE_DEPOSITOS.nuevo}
          pie={
            <FormularioDeDeposito
              accion={agregarDepositoAccion.bind(null, randomUUID())}
              textos={{
                nombre: texto({}, "catalogo.dato.nombre"),
                uso: texto({}, "stock.deposito.uso"),
                deVenta: texto({}, "stock.deposito.de_venta"),
                guardar: texto({}, "stock.deposito.agregar"),
                cancelar: texto({}, "catalogo.accion.cancelar"),
              }}
              hrefDeCancelar={RUTAS_DE_DEPOSITOS.lista}
              opcionesDeUso={opcionesDeUso(USOS_PARA_ELEGIR, (clave) => texto({}, clave))}
              puedeGuardar={await puedeEnStock(contexto, "depositos.crear")}
            />
          }
        />
      </>
    );
  });
}
