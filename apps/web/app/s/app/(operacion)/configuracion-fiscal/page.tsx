import { texto } from "../../../../../../../src/capacidades/vocabulario/vocabulario";
import { pantallaDeOperacion } from "../../../../../pantallas/operacion";
import { cargarElEstadoDeLaConfiguracion } from "../../../../../servidor/configuracion-fiscal";
import { ErrorDelDetalle } from "../../../../../ui/plantillas/facturacion/ErrorDelDetalle";
import { armarLaLista } from "../../../../../ui/plantillas/configuracion-fiscal/lista-de-lo-que-falta";
import { PantallaDeConfiguracionFiscal } from "../../../../../ui/plantillas/configuracion-fiscal/PantallaDeConfiguracionFiscal";

// `/configuracion-fiscal`: la lista de lo que falta para emitir (D-43, opción C). Solo el gerente: el servidor decide y, sin permiso, la
// pantalla dice «sin permiso» como las demás. No está en la barra de abajo (el punto de entrada todavía no está decidido).
export default async function PaginaDeConfiguracionFiscal() {
  return pantallaDeOperacion({ titulo: "fiscal.pantalla.config_titulo" }, async ({ contexto }) => {
    const estado = await cargarElEstadoDeLaConfiguracion(contexto);
    if (!estado.ok) return <ErrorDelDetalle error={estado.error} />;
    return (
      <PantallaDeConfiguracionFiscal
        subtitulo={texto({}, "fiscal.pantalla.config_subtitulo")}
        filas={armarLaLista(estado.dato)}
      />
    );
  });
}
