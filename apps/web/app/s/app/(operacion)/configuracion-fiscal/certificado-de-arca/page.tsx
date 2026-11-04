import { texto } from "../../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../../pantallas/operacion";
import { aCertificadoParaMostrar } from "../../../../../../pantallas/certificado";
import { cargarLosCertificados } from "../../../../../../servidor/certificado-de-arca";
import { RUTAS_DE_CONFIGURACION } from "../../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { ConMigas } from "../../../../../../ui/plantillas/configuracion-fiscal/MigasDeConfiguracion";
import { armarLaListaDeAmbientes } from "../../../../../../ui/plantillas/configuracion-fiscal/modelo-de-certificado";
import { PantallaDeCertificados } from "../../../../../../ui/plantillas/configuracion-fiscal/PantallaDeCertificados";
import { ErrorDelDetalle } from "../../../../../../ui/plantillas/facturacion/ErrorDelDetalle";

// `/configuracion-fiscal/certificado-de-arca`: una fila por ambiente (Pruebas, Producción) con su estado; tocarla abre el asistente de ese
// ambiente. Solo el gerente: el servidor decide y, sin permiso, la pantalla dice «sin permiso» como las demás.
export default async function PaginaDeCertificados() {
  return pantallaDeOperacion(
    { titulo: "fiscal.pantalla.config_fila_certificado" },
    async ({ contexto }) => {
      const estado = await cargarLosCertificados(contexto);
      if (!estado.ok) return <ErrorDelDetalle error={estado.error} />;
      return (
        <ConMigas
          tramos={[
            {
              texto: texto({}, "fiscal.pantalla.config_titulo"),
              href: RUTAS_DE_CONFIGURACION.lista,
            },
          ]}
        >
          <PantallaDeCertificados
            filas={armarLaListaDeAmbientes(estado.dato.certificados.map(aCertificadoParaMostrar))}
          />
        </ConMigas>
      );
    },
  );
}
