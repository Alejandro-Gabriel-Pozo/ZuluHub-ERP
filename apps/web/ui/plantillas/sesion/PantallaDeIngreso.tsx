import { claveDeErrorDeIngreso } from "../../../../../src/capacidades/experiencia/errores-de-ingreso";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import { Texto } from "../../primitivas/Texto";
import { PlantillaNeutra } from "../PlantillaNeutra";

export type PropsDePantallaDeIngreso = Readonly<{
  /** El nombre visible de la marca, ya resuelto. */
  marca: string;
  /** La acción del servidor «Ingresar con Google». */
  accion: AccionDeFormulario;
  /** A dónde vuelve después de ingresar: una ruta propia ya validada (`rutaDeRetorno`). */
  volver: string;
  /** El `?error=` que dejó el ingreso (código de la lista cerrada de W3b): se traduce por clave. */
  codigoDeError?: string | null;
  diccionario?: DiccionarioResuelto;
}>;

/** `/ingreso`: un solo botón, «Ingresar con Google», y el motivo si el ingreso anterior no salió. */
export function PantallaDeIngreso({
  marca,
  accion,
  volver,
  codigoDeError = null,
  diccionario = {},
}: PropsDePantallaDeIngreso) {
  const claveDelError = claveDeErrorDeIngreso(codigoDeError);
  return (
    <PlantillaNeutra titulo={texto(diccionario, "ingreso.titulo", { marca })}>
      <Texto>{texto(diccionario, "ingreso.detalle")}</Texto>
      {claveDelError === null ? null : (
        <Aviso tono="peligro">
          <Texto>{texto(diccionario, claveDelError)}</Texto>
        </Aviso>
      )}
      <FormularioDeAccion accion={accion} diccionario={diccionario}>
        <input type="hidden" name="volver" value={volver} />
        <BotonDeEnvio ancho="completo" textoEnviando={texto(diccionario, "ingreso.enviando")}>
          {texto(diccionario, "ingreso.boton")}
        </BotonDeEnvio>
      </FormularioDeAccion>
    </PlantillaNeutra>
  );
}
