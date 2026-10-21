import { Pila } from "../../../../web/ui/primitivas/Pila";
import { Texto } from "../../../../web/ui/primitivas/Texto";
import { PlantillaNeutra } from "../../../../web/ui/plantillas/PlantillaNeutra";
import { VerificarCodigo } from "../../../pantallas/verificar-codigo.cliente";
import { exigirPasoDeIngreso } from "../../../servidor/acceso";

// `/ingreso/codigo`: el segundo factor, después de Google (pantalla 4b).
export default async function PaginaDeCodigo() {
  await exigirPasoDeIngreso("segundo_factor_requerido");
  return (
    <PlantillaNeutra titulo="Verificá tu identidad">
      <Pila separacion={4}>
        <Texto>Ingresá el código de seis números de tu aplicación de autenticación.</Texto>
        <VerificarCodigo destino="/" />
      </Pila>
    </PlantillaNeutra>
  );
}
