import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { accionesDeLaListaDeCaja } from "../../../../../../../servidor/modulos";
import { FormularioDeCaja } from "../../../../../../../ui/plantillas/caja/FormularioDeCaja.cliente";
import { agregarCajaAccion } from "../../../../acciones-de-cajas";

// `/caja/cajas/nuevo`: agregar una caja a la sucursal elegida (la fija el servidor, no el formulario). Repetir el envío no duplica; sumar una caja por encima del plan lo rechaza
// el servidor con el genérico.
export default async function PaginaDeAltaDeCaja() {
  return pantallaDeOperacion({ titulo: "caja.cajas.agregar" }, async ({ contexto }) => (
    <FormularioDeCaja
      nombreOriginal={null}
      accion={agregarCajaAccion}
      textos={{ nombre: texto({}, "caja.campo.nombre"), guardar: texto({}, "caja.accion.guardar") }}
      puedeGuardar={(await accionesDeLaListaDeCaja(contexto, "cajas")).agregar}
    />
  ));
}
