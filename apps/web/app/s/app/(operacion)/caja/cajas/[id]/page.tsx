import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLasCajas } from "../../../../../../../servidor/cajas";
import { accionesDeLaListaDeCaja } from "../../../../../../../servidor/modulos";
import { FormularioDeCaja } from "../../../../../../../ui/plantillas/caja/FormularioDeCaja.cliente";
import { ErrorDelDetalle } from "../../../../../../../ui/patrones/ErrorDelDetalle";
import { editarCajaAccion } from "../../../../acciones-de-cajas";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/caja/cajas/[id]`: editar el nombre de una caja. El id de la dirección es lo único que viene del navegador: se busca entre las cajas de la sucursal elegida; una que no está ahí (de
// otra sucursal, ajena, inexistente) sale como el genérico y no dice cuál de los casos es. La acción lleva la versión que se vio.
export default async function PaginaDeUnaCaja({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "caja.accion.editar" }, async ({ contexto }) => {
    const cajas = await cargarLasCajas(contexto);
    if (!cajas.ok) return <ErrorDelDetalle error={cajas.error} />;
    const caja = cajas.dato.cajas.find((c) => c.id === id);
    if (caja === undefined) {
      return <ErrorDelDetalle error={errorDeCodigo("CAJA_ACCION_NO_PERMITIDA")} />;
    }
    return (
      <FormularioDeCaja
        nombreOriginal={caja.nombre}
        accion={editarCajaAccion.bind(null, caja.id, caja.version)}
        textos={{
          nombre: texto({}, "caja.campo.nombre"),
          guardar: texto({}, "caja.accion.guardar"),
        }}
        puedeGuardar={(await accionesDeLaListaDeCaja(contexto, "cajas")).editar}
      />
    );
  });
}
