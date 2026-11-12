import { errorDeCodigo } from "../../../../../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import { cargarLosMedios } from "../../../../../../../servidor/medios-de-pago";
import { accionesDeLaListaDeCaja } from "../../../../../../../servidor/modulos";
import { FormularioDeMedio } from "../../../../../../../ui/plantillas/caja/FormularioDeMedio.cliente";
import { opcionesDeTipo } from "../../../../../../../ui/plantillas/caja/modelo-de-medios-de-pago";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { editarMedioAccion } from "../../../../acciones-de-medios-de-pago";

type PropsDePagina = Readonly<{ params: Promise<{ id: string }> }>;

// `/caja/medios-de-pago/[id]`: editar el nombre de un medio. El id de la dirección es lo único que viene del navegador: se busca entre los medios de la
// empresa; uno que no está ahí (ajeno, inexistente, mal escrito) sale como el genérico y no dice cuál de los casos es. La acción lleva la versión que se vio.
export default async function PaginaDeUnMedio({ params }: PropsDePagina) {
  const { id } = await params;
  return pantallaDeOperacion({ titulo: "caja.accion.editar" }, async ({ contexto }) => {
    const medios = await cargarLosMedios(contexto);
    if (!medios.ok) return <ErrorDelDetalle error={medios.error} />;
    const medio = medios.dato.medios.find((m) => m.id === id);
    if (medio === undefined) {
      return <ErrorDelDetalle error={errorDeCodigo("CAJA_ACCION_NO_PERMITIDA")} />;
    }
    return (
      <FormularioDeMedio
        original={medio}
        tipos={opcionesDeTipo(medio)}
        accion={editarMedioAccion.bind(null, medio.id, medio.version)}
        textos={{
          tipo: texto({}, "caja.campo.tipo"),
          nombre: texto({}, "caja.campo.nombre_opcional"),
          guardar: texto({}, "caja.accion.guardar"),
        }}
        puedeGuardar={(await accionesDeLaListaDeCaja(contexto, "medios_de_pago")).editar}
      />
    );
  });
}
