import { urlDeIngreso } from "../../../../../src/capacidades/experiencia/ingreso";
import { EnlaceDeAccion } from "../../../ui/componentes/EnlaceDeAccion";
import { PlantillaNeutra } from "../../../ui/plantillas/PlantillaNeutra";
import { exigirPuerta } from "../../../servidor/pedido";

// La línea de la landing mínima. Texto provisorio hasta que el dueño dicte el definitivo.
const LINEA_DE_LA_LANDING = "Gestión simple para tu negocio, desde el celular.";

export default async function PaginaDeLanding() {
  const puerta = await exigirPuerta("LANDING");
  const ingreso = urlDeIngreso(puerta.marca.hostDeApp);
  return (
    <PlantillaNeutra titulo={LINEA_DE_LA_LANDING}>
      {ingreso === null ? null : <EnlaceDeAccion href={ingreso}>Ingresar</EnlaceDeAccion>}
    </PlantillaNeutra>
  );
}
