import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarLosMedios } from "../../../../../../servidor/medios-de-pago";
import { accionesDeLaListaDeCaja } from "../../../../../../servidor/modulos";
import {
  armarLaListaDeMedios,
  RUTAS_DE_MEDIOS,
} from "../../../../../../ui/plantillas/caja/modelo-de-medios-de-pago";
import { PantallaDeListaDeCaja } from "../../../../../../ui/plantillas/caja/PantallaDeListaDeCaja";
import { pestanasDeCaja } from "../../../../../../ui/plantillas/caja/pestanas-de-caja";
import { PestanasDeCaja } from "../../../../../../ui/plantillas/caja/PestanasDeCaja";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import { desactivarMedioAccion, reactivarMedioAccion } from "../../../acciones-de-medios-de-pago";

// `/caja/medios-de-pago`: los medios de pago de la empresa, también los desactivados (maqueta `medios.html`, 09/11/2026). Solo lo que el servidor deja ver
// (`cajas.ver`); los botones salen apagados sin el permiso de cada acción (una ayuda: el guard vuelve a decidir al enviar).
export default async function PaginaDeMediosDePago() {
  return pantallaDeOperacion({ titulo: "caja.medios.titulo" }, async ({ contexto }) => {
    const medios = await cargarLosMedios(contexto);
    if (!medios.ok) return <ErrorDelDetalle error={medios.error} />;
    return (
      <>
        <PestanasDeCaja pestanas={pestanasDeCaja("medios")} />
        <PantallaDeListaDeCaja
          filas={armarLaListaDeMedios(medios.dato.medios)}
          acciones={await accionesDeLaListaDeCaja(contexto, "medios_de_pago")}
          textos={{
            agregar: texto({}, "caja.medios.agregar"),
            editar: texto({}, "caja.accion.editar"),
            desactivar: texto({}, "caja.accion.desactivar"),
            reactivar: texto({}, "caja.accion.reactivar"),
          }}
          hrefDeAgregar={RUTAS_DE_MEDIOS.nuevo}
          accionDe={(fila) => ({
            desactivar: desactivarMedioAccion.bind(null, fila.id),
            reactivar: reactivarMedioAccion.bind(null, fila.id),
          })}
        />
      </>
    );
  });
}
