import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLasCuentas } from "../../../../../../servidor/cuentas-de-cobro";
import { accionesDeLaListaDeCaja } from "../../../../../../servidor/modulos";
import {
  armarLaListaDeCuentas,
  RUTAS_DE_CUENTAS,
} from "../../../../../../ui/plantillas/caja/modelo-de-cuentas-de-cobro";
import { PantallaDeListaDeCaja } from "../../../../../../ui/plantillas/caja/PantallaDeListaDeCaja";
import { pestanasDeCaja } from "../../../../../../ui/plantillas/caja/pestanas-de-caja";
import { PestanasDeCaja } from "../../../../../../ui/plantillas/caja/PestanasDeCaja";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import {
  desactivarCuentaAccion,
  reactivarCuentaAccion,
} from "../../../acciones-de-cuentas-de-cobro";

// `/caja/cuentas-de-cobro`: las cuentas de cobro a las que llega la persona, también las desactivadas (maqueta `medios.html`, 09/11/2026). Solo lo que el servidor deja ver
// (`cajas.ver`); los botones salen apagados sin el permiso de cada acción (una ayuda: el guard vuelve a decidir al enviar).
export default async function PaginaDeCuentasDeCobro() {
  return pantallaDeOperacion({ titulo: "caja.cuentas.titulo" }, async ({ contexto }) => {
    const cuentas = await cargarLasCuentas(contexto);
    if (!cuentas.ok) return <ErrorDelDetalle error={cuentas.error} />;
    return (
      <>
        <PestanasDeCaja pestanas={pestanasDeCaja("cuentas")} />
        <PantallaDeListaDeCaja
          filas={armarLaListaDeCuentas(cuentas.dato.cuentas, cuentas.dato.sucursales)}
          acciones={await accionesDeLaListaDeCaja(contexto, "cuentas_de_cobro")}
          textos={{
            agregar: texto({}, "caja.cuentas.agregar"),
            editar: texto({}, "caja.accion.editar"),
            desactivar: texto({}, "caja.accion.desactivar"),
            reactivar: texto({}, "caja.accion.reactivar"),
          }}
          hrefDeAgregar={RUTAS_DE_CUENTAS.nuevo}
          accionDe={(fila) => ({
            desactivar: desactivarCuentaAccion.bind(null, fila.id),
            reactivar: reactivarCuentaAccion.bind(null, fila.id),
          })}
        />
      </>
    );
  });
}
