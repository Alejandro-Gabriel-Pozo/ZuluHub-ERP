import { PlantillaNeutra } from "../../../../web/ui/plantillas/PlantillaNeutra";
import { AltaDelSegundoFactor } from "../../../pantallas/alta-segundo-factor.cliente";
import { exigirPasoDeIngreso } from "../../../servidor/acceso";

// `/ingreso/alta`: el segundo factor la primera vez (pantalla 4c). Sin caché: el proxy responde `no-store`.
export default async function PaginaDeAlta() {
  await exigirPasoDeIngreso("segundo_factor_a_enrolar");
  return (
    <PlantillaNeutra titulo="Configurá el segundo factor">
      <AltaDelSegundoFactor />
    </PlantillaNeutra>
  );
}
