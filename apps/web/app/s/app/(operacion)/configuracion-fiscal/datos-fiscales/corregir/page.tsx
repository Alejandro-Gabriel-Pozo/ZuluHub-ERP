import { redirect } from "next/navigation";
import { texto } from "../../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../../pantallas/operacion";
import {
  cargarLosDatosFiscales,
  opcionesDeDatosFiscales,
} from "../../../../../../../servidor/configuracion-fiscal";
import { FormularioDeDatosFiscales } from "../../../../../../../ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente";
import { RUTAS_DE_CONFIGURACION } from "../../../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { ConMigas } from "../../../../../../../ui/plantillas/configuracion-fiscal/MigasDeConfiguracion";
import { ErrorDelDetalle } from "../../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import {
  confirmarDatosFiscalesAccion,
  guardarBorradorDeDatosFiscalesAccion,
} from "../../../../acciones-de-config-fiscal";

// `/configuracion-fiscal/datos-fiscales/corregir`: el formulario. Siempre abre el borrador que ya existe (el borrador es de la empresa,
// no de la pestaña: D-68), precargado con lo vigente cuando lo creó «Corregir» (D-62). Sin borrador y con algo vigente no hay nada que
// editar: vuelve a la lectura (también cuando «versión desactualizada» dejó la pantalla sin borrador). Sin nada vigente, parte de cero.
export default async function PaginaDeCorreccionDeDatosFiscales() {
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.config_df_titulo_corregir" },
    async ({ contexto }) => {
      const datos = await cargarLosDatosFiscales(contexto);
      if (!datos.ok) return <ErrorDelDetalle error={datos.error} />;
      const { vigente, borrador } = datos.dato;
      if (borrador === null && vigente !== null) redirect(RUTAS_DE_CONFIGURACION.datosFiscales);
      const hayVigente = vigente !== null;
      const lista = {
        texto: texto({}, "fiscal.pantalla.config_titulo"),
        href: RUTAS_DE_CONFIGURACION.lista,
      };
      return (
        <ConMigas
          tramos={
            hayVigente
              ? [
                  lista,
                  {
                    texto: texto({}, "fiscal.pantalla.config_fila_datos_fiscales"),
                    href: RUTAS_DE_CONFIGURACION.datosFiscales,
                  },
                ]
              : [lista]
          }
        >
          <FormularioDeDatosFiscales
            emisorId={datos.dato.emisorId}
            cuit={datos.dato.cuit}
            borrador={borrador}
            condicionesDeIva={opcionesDeDatosFiscales().condicionesDeIva.map((c) => ({
              valor: c.valor,
              etiqueta: c.texto,
            }))}
            guardar={guardarBorradorDeDatosFiscalesAccion}
            confirmar={confirmarDatosFiscalesAccion}
            // Sin nada vigente no hay lectura adonde volver: el borrador guardado se ve como «Pendiente» en la lista.
            rutaAlGuardar={
              hayVigente ? RUTAS_DE_CONFIGURACION.datosFiscales : RUTAS_DE_CONFIGURACION.lista
            }
            rutaAlConfirmar={RUTAS_DE_CONFIGURACION.datosFiscales}
            rutaAlCancelar={
              hayVigente ? RUTAS_DE_CONFIGURACION.datosFiscales : RUTAS_DE_CONFIGURACION.lista
            }
          />
        </ConMigas>
      );
    },
  );
}
