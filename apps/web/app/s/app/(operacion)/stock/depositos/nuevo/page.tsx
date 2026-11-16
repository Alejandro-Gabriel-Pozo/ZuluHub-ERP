import { randomUUID } from "node:crypto";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { USOS_PARA_ELEGIR } from "../../../../../../../servidor/depositos-de-stock";
import { puedeEnStock } from "../../../../../../../servidor/stock";
import { FormularioDeDeposito } from "../../../../../../../ui/plantillas/stock/depositos/FormularioDeDeposito.cliente";
import { opcionesDeUso } from "../../../../../../../ui/plantillas/stock/depositos/modelo-de-depositos";
import { agregarDepositoAccion } from "../../../../acciones-de-depositos";

// `/stock/depositos/nuevo`: agregar un depósito a la sucursal elegida (la fija el servidor, no el formulario). El identificador del alta se genera una vez al abrir el formulario y viaja
// ligado a la acción: repetir el envío (doble toque, red cortada) devuelve el mismo depósito sin duplicarlo.
export default async function PaginaDeAltaDeDeposito() {
  return pantallaDeOperacion({ titulo: "stock.deposito.agregar" }, async ({ contexto }) => (
    <FormularioDeDeposito
      accion={agregarDepositoAccion.bind(null, randomUUID())}
      textos={{
        nombre: texto({}, "catalogo.dato.nombre"),
        uso: texto({}, "stock.deposito.uso"),
        deVenta: texto({}, "stock.deposito.de_venta"),
        guardar: texto({}, "stock.deposito.agregar"),
      }}
      opcionesDeUso={opcionesDeUso(USOS_PARA_ELEGIR, (clave) => texto({}, clave))}
      puedeGuardar={await puedeEnStock(contexto, "depositos.crear")}
    />
  ));
}
