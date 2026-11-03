import { redirect } from "next/navigation";
import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { hoyEnArgentina } from "../../../../../../pantallas/entrada-del-listado";
import {
  cargarLosDatosFiscales,
  opcionesDeDatosFiscales,
} from "../../../../../../servidor/configuracion-fiscal";
import { BotonDeCorregir } from "../../../../../../ui/plantillas/configuracion-fiscal/BotonDeCorregir.cliente";
import { RUTAS_DE_CONFIGURACION } from "../../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { armarLaLectura } from "../../../../../../ui/plantillas/configuracion-fiscal/modelo-de-datos-fiscales";
import { PantallaDeDatosFiscales } from "../../../../../../ui/plantillas/configuracion-fiscal/PantallaDeDatosFiscales";
import { EnlaceDeAccion } from "../../../../../../ui/componentes/EnlaceDeAccion";
import { ErrorDelDetalle } from "../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { empezarCorreccionDeDatosFiscalesAccion } from "../../../acciones-de-config-fiscal";

// `/configuracion-fiscal/datos-fiscales`: lo que rige hoy, solo para leer (opción A, aprobada por el dueño el 2026-10-29). Con un
// borrador sin confirmar ofrece seguir con él (D-68); si todavía no hay nada vigente, abre directo el formulario. Lo que el servidor
// no deja leer (sin permiso, por ejemplo) se dice con su texto y no muestra datos ni acciones.
export default async function PaginaDeDatosFiscales() {
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.config_fila_datos_fiscales" },
    async ({ contexto }) => {
      const datos = await cargarLosDatosFiscales(contexto);
      if (!datos.ok) return <ErrorDelDetalle error={datos.error} />;
      const vigente = datos.dato.vigente;
      if (vigente === null) redirect(RUTAS_DE_CONFIGURACION.corregirDatosFiscales);
      const condiciones = opcionesDeDatosFiscales().condicionesDeIva.map((c) => ({
        valor: c.valor,
        etiqueta: c.texto,
      }));
      // «Rige desde» es un instante: se dice como el día civil de Argentina en que empezó a regir.
      const lectura = armarLaLectura(
        datos.dato.cuit,
        vigente,
        condiciones,
        hoyEnArgentina(new Date(vigente.vigenteDesde)),
      );
      const hayBorrador = datos.dato.borrador !== null;
      return (
        <PantallaDeDatosFiscales
          migas={[
            {
              texto: texto({}, "fiscal.pantalla.config_titulo"),
              href: RUTAS_DE_CONFIGURACION.lista,
            },
          ]}
          lectura={lectura}
          aviso={
            hayBorrador
              ? {
                  titulo: texto({}, "fiscal.pantalla.config_df_aviso_titulo"),
                  detalle: texto({}, "fiscal.pantalla.config_df_aviso_detalle"),
                }
              : null
          }
          accion={
            hayBorrador ? (
              <EnlaceDeAccion href={RUTAS_DE_CONFIGURACION.corregirDatosFiscales}>
                {texto({}, "fiscal.pantalla.config_df_seguir_con_el_borrador")}
              </EnlaceDeAccion>
            ) : (
              <BotonDeCorregir
                emisorId={datos.dato.emisorId}
                empezar={empezarCorreccionDeDatosFiscalesAccion}
                rutaAlTerminar={RUTAS_DE_CONFIGURACION.corregirDatosFiscales}
              />
            )
          }
        />
      );
    },
  );
}
