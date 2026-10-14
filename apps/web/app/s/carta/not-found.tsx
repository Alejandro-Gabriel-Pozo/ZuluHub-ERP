import { PlantillaNeutra } from "../../../ui/plantillas/PlantillaNeutra";

// Carta que no existe o no está disponible: la misma respuesta neutra de siempre, sin distinguir los casos.
export default function CartaNoDisponible() {
  return (
    <PlantillaNeutra titulo="No encontrado">
      <p>La página que buscás no existe.</p>
    </PlantillaNeutra>
  );
}
