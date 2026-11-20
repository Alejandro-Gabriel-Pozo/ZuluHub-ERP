import { errorDeCodigo } from "../../../../../../../../src/capacidades/experiencia/respuesta";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { cargarElCierreDeLaSucursal } from "../../../../../../servidor/cierre-del-dia";
import { accionesDelCierre } from "../../../../../../servidor/ofertas-de-cierre";
import { ErrorDelDetalle } from "../../../../../../ui/patrones/ErrorDelDetalle";
import {
  armarElModeloDelCierre,
  esErrorDelModelo,
} from "../../../../../../ui/plantillas/cierre/modelo-del-cierre";
import { PantallaDelCierre } from "../../../../../../ui/plantillas/cierre/PantallaDelCierre.cliente";
import {
  cancelarElCierreAccion,
  cerrarElDiaAccion,
  corregirElMedioAccion,
  darElConformeAccion,
  declararElTotalAccion,
  empezarElCierreAccion,
} from "../../../acciones-de-cierre-del-dia";

// `/caja/cierre-del-dia`: el cierre del día de la sucursal elegida (maqueta aceptada `cierre-del-dia.html`, tres pasos). Muestra la jornada más vieja que no está cerrada (o la de hoy); solo lo que el servidor deja
// ver (`jornadas.ver`, `cajas.ver`); los botones salen apagados sin el permiso de cada acción (una ayuda: el guard vuelve a decidir al enviar). Todo o nada: si algo no se puede leer o un control no
// tiene su texto aprobado, sale el genérico, nunca un día a medias.
export default async function PaginaDelCierreDelDia() {
  return pantallaDeOperacion({ titulo: "cierre.titulo" }, async ({ contexto }) => {
    const cierre = await cargarElCierreDeLaSucursal(contexto);
    if (!cierre.ok) return <ErrorDelDetalle error={cierre.error} />;
    const modelo = armarElModeloDelCierre(cierre.dato, await accionesDelCierre(contexto));
    if (esErrorDelModelo(modelo)) {
      return <ErrorDelDetalle error={errorDeCodigo("CIERRE_ACCION_NO_PERMITIDA")} />;
    }
    return (
      <PantallaDelCierre
        modelo={modelo}
        servidor={{
          empezar: empezarElCierreAccion,
          cancelar: cancelarElCierreAccion,
          cerrar: cerrarElDiaAccion,
          corregir: corregirElMedioAccion,
          declarar: declararElTotalAccion,
          conforme: darElConformeAccion,
        }}
      />
    );
  });
}
