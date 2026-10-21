import { exigirAcceso } from "../servidor/acceso";
import { Texto } from "../../web/ui/primitivas/Texto";
import { Pila } from "../../web/ui/primitivas/Pila";
import { PlantillaNeutra } from "../../web/ui/plantillas/PlantillaNeutra";
import { CerrarSesion } from "../pantallas/cerrar-sesion.cliente";
import { VigilanteDeSesion } from "../pantallas/vigilante-de-sesion.cliente";

// La consola. Hoy es el esqueleto: la sesión, el aviso de vencimiento y la salida; las pantallas de Empresas,
// Submarcas y Planes se suman sobre esta base.
export default async function PaginaDeInicio() {
  const acceso = await exigirAcceso();
  return (
    <PlantillaNeutra titulo="Consola de plataforma">
      <Pila separacion={4}>
        <Texto>
          Ingresaste como {acceso.admin.rol === "ADMIN" ? "administrador" : "personal de soporte"}.
        </Texto>
        <CerrarSesion />
      </Pila>
      <VigilanteDeSesion />
    </PlantillaNeutra>
  );
}
