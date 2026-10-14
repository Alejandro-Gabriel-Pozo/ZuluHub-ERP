import { Texto } from "../../../ui/primitivas/Texto";
import { PlantillaNeutra } from "../../../ui/plantillas/PlantillaNeutra";

export default function NoEncontradaEnLanding() {
  return (
    <PlantillaNeutra titulo="No encontrado">
      <Texto>La página que buscás no existe.</Texto>
    </PlantillaNeutra>
  );
}
