import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLasCajas } from "../../../../../../servidor/cajas";
import { accionesDeLaListaDeCaja } from "../../../../../../servidor/modulos";
import {
  armarLaListaDeCajas,
  RUTAS_DE_CAJAS,
} from "../../../../../../ui/plantillas/caja/modelo-de-cajas";
import { PantallaDeListaDeCaja } from "../../../../../../ui/plantillas/caja/PantallaDeListaDeCaja";
import { pestanasDeCaja } from "../../../../../../ui/plantillas/caja/pestanas-de-caja";
import { PestanasDeCaja } from "../../../../../../ui/plantillas/caja/PestanasDeCaja";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { desactivarCajaAccion, reactivarCajaAccion } from "../../../acciones-de-cajas";

// `/caja/cajas`: las cajas de la sucursal elegida en el dispositivo, también las desactivadas (maqueta `medios.html`, 09/11/2026). Sin sucursal elegida no se asume «todas»: sale el
// genérico. «Caja 1» nace sola con la sucursal; sumar otra depende del plan y lo rechaza el servidor al guardar.
export default async function PaginaDeCajas() {
  return pantallaDeOperacion({ titulo: "caja.cajas.titulo" }, async ({ contexto }) => {
    const cajas = await cargarLasCajas(contexto);
    if (!cajas.ok) return <ErrorDelDetalle error={cajas.error} />;
    return (
      <>
        <PestanasDeCaja pestanas={pestanasDeCaja("cajas")} />
        <PantallaDeListaDeCaja
          filas={armarLaListaDeCajas(cajas.dato.cajas)}
          acciones={await accionesDeLaListaDeCaja(contexto, "cajas")}
          textos={{
            agregar: texto({}, "caja.cajas.agregar"),
            editar: texto({}, "caja.accion.editar"),
            desactivar: texto({}, "caja.accion.desactivar"),
            reactivar: texto({}, "caja.accion.reactivar"),
          }}
          hrefDeAgregar={RUTAS_DE_CAJAS.nuevo}
          accionDe={(fila) => ({
            desactivar: desactivarCajaAccion.bind(null, fila.id),
            reactivar: reactivarCajaAccion.bind(null, fila.id),
          })}
        />
      </>
    );
  });
}
