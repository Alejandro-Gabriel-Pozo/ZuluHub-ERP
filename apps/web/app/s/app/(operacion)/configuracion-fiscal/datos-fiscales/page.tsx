import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import {
  cargarLosDatosFiscales,
  opcionesDeDatosFiscales,
} from "../../../../../../servidor/configuracion-fiscal";
import { FormularioDeDatosFiscales } from "../../../../../../ui/plantillas/configuracion-fiscal/FormularioDeDatosFiscales.cliente";
import { RUTAS_DE_CONFIGURACION } from "../../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { ConMigas } from "../../../../../../ui/plantillas/configuracion-fiscal/MigasDeConfiguracion";
import { ErrorDelDetalle } from "../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import {
  confirmarDatosFiscalesAccion,
  guardarBorradorDeDatosFiscalesAccion,
} from "../../../acciones-de-config-fiscal";

// `/configuracion-fiscal/datos-fiscales` (D-88): la fila de la lista abre directo el formulario, con el borrador si existe (el borrador es
// de la empresa, no de la pestaña: D-68), si no con lo vigente y, si nunca hubo nada, en blanco. Abrirlo solo lee: no se guarda nada hasta
// «Guardar borrador» o «Confirmar». Lo que el servidor no deja leer (sin permiso, por ejemplo) se dice con su texto, sin campos ni botones.
export default async function PaginaDeDatosFiscales() {
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.config_fila_datos_fiscales" },
    async ({ contexto }) => {
      const datos = await cargarLosDatosFiscales(contexto);
      if (!datos.ok) return <ErrorDelDetalle error={datos.error} />;
      return (
        <ConMigas
          tramos={[
            {
              texto: texto({}, "fiscal.pantalla.config_titulo"),
              href: RUTAS_DE_CONFIGURACION.lista,
            },
          ]}
        >
          <FormularioDeDatosFiscales
            emisorId={datos.dato.emisorId}
            cuit={datos.dato.cuit}
            borrador={datos.dato.borrador}
            vigente={datos.dato.vigente}
            condicionesDeIva={opcionesDeDatosFiscales().condicionesDeIva.map((c) => ({
              valor: c.valor,
              etiqueta: c.texto,
            }))}
            guardar={guardarBorradorDeDatosFiscalesAccion}
            confirmar={confirmarDatosFiscalesAccion}
            rutaAlGuardar={RUTAS_DE_CONFIGURACION.lista}
            rutaAlConfirmar={RUTAS_DE_CONFIGURACION.lista}
            rutaAlCancelar={RUTAS_DE_CONFIGURACION.lista}
          />
        </ConMigas>
      );
    },
  );
}
