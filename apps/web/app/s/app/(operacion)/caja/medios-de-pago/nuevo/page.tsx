import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { accionesDeMediosDePago } from "../../../../../../../servidor/modulos";
import { FormularioDeMedio } from "../../../../../../../ui/plantillas/caja/FormularioDeMedio.cliente";
import { opcionesDeTipo } from "../../../../../../../ui/plantillas/caja/modelo-de-medios-de-pago";
import { agregarMedioAccion } from "../../../../acciones-de-medios-de-pago";

// `/caja/medios-de-pago/nuevo`: agregar un medio (tipo de una lista cerrada, sin el efectivo, y nombre opcional). Repetir el envío no duplica: el servidor
// devuelve el medio que ya existe.
export default async function PaginaDeAltaDeMedio() {
  return pantallaDeOperacion({ titulo: "caja.medios.agregar" }, async ({ contexto }) => (
    <FormularioDeMedio
      original={null}
      tipos={opcionesDeTipo(null)}
      accion={agregarMedioAccion}
      textos={{
        tipo: texto({}, "caja.campo.tipo"),
        nombre: texto({}, "caja.campo.nombre_opcional"),
        guardar: texto({}, "caja.accion.guardar"),
      }}
      puedeGuardar={(await accionesDeMediosDePago(contexto)).agregar}
    />
  ));
}
