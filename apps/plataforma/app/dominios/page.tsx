import { ArmazonDeConsola } from "../../pantallas/armazon-de-consola";
import { AvisoDeError } from "../../pantallas/aviso-de-error";
import { ListaDeDominios } from "../../pantallas/lista-de-dominios.cliente";
import { exigirAcceso } from "../../servidor/acceso";
import { dominiosDeLasEmpresas } from "../../servidor/dominios";

// `/dominios`: los dominios de las empresas (aplicación y carta) con su estado: agregar, verificar, activar, desactivar y retirar (plan de dominio propio, P1).
export default async function PaginaDeDominios() {
  await exigirAcceso();
  const resultado = await dominiosDeLasEmpresas();
  return (
    <ArmazonDeConsola activo="dominios">
      {!resultado.ok ? (
        <AvisoDeError
          error={resultado.error}
          referencia={resultado.referencia}
          reintentarHref="/dominios"
          textoInesperado="Esta acción no está permitida"
        />
      ) : (
        <ListaDeDominios
          dominios={resultado.dominios}
          empresas={resultado.empresas}
          puedeEditar={resultado.puedeEditar}
        />
      )}
    </ArmazonDeConsola>
  );
}
