import { ArmazonDeConsola } from "../../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../../pantallas/aviso-de-error";
import { FormularioDeAlta } from "../../../pantallas/formulario-de-alta.cliente";
import { exigirAcceso } from "../../../servidor/acceso";
import { opcionesDelAlta } from "../../../servidor/empresas";

// `/empresas/nueva`: el alta de una empresa. Las opciones (submarcas y planes) las lee el servidor.
export default async function PaginaDeAltaDeEmpresa() {
  await exigirAcceso();
  const opciones = await opcionesDelAlta();
  return (
    <ArmazonDeConsola activo="empresas" titulo="Nueva empresa">
      {opciones.ok ? (
        <FormularioDeAlta submarcas={opciones.submarcas} planes={opciones.planes} />
      ) : (
        <AvisoDeError
          error={opciones.error}
          referencia={opciones.referencia}
          reintentarHref="/empresas/nueva"
          textoInesperado="No pudimos cargar el formulario."
        />
      )}
    </ArmazonDeConsola>
  );
}
