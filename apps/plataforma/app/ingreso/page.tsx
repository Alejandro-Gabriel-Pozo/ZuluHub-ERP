import { Aviso } from "../../../web/ui/componentes/Aviso";
import { Pila } from "../../../web/ui/primitivas/Pila";
import { Texto } from "../../../web/ui/primitivas/Texto";
import { PlantillaNeutra } from "../../../web/ui/plantillas/PlantillaNeutra";
import { textoDelErrorDeIngreso } from "../../logica/ingreso";
import { IngresoConGoogle } from "../../pantallas/ingreso.cliente";
import { resolverIngreso } from "../../servidor/acceso";

type Consulta = Promise<Record<string, string | string[] | undefined>>;

/** El primer valor de un parámetro de la dirección (puede venir repetido o faltar). */
const unico = (valor: string | string[] | undefined): string | null =>
  (Array.isArray(valor) ? valor[0] : valor) ?? null;

// `/ingreso`: «Ingresar con Google» y el motivo si el ingreso anterior no salió (pantalla 4a).
export default async function PaginaDeIngreso({ searchParams }: { searchParams: Consulta }) {
  await resolverIngreso();
  const error = textoDelErrorDeIngreso(unico((await searchParams)["error"]));
  return (
    <PlantillaNeutra titulo="Consola de plataforma">
      <Pila separacion={4}>
        <Texto>Ingresá con tu cuenta de Google de la empresa.</Texto>
        {error === null ? null : (
          <Aviso tono="peligro">
            <Texto>{error}</Texto>
          </Aviso>
        )}
        <IngresoConGoogle />
      </Pila>
    </PlantillaNeutra>
  );
}
