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

export type PropsDePantallaSinEmpresas = Readonly<{
  marca: string;
  /** Cerrar sesión: para entrar con otra cuenta de Google si esta no es la que recibió la invitación. */
  accionDeCerrarSesion: AccionDeFormulario;
  diccionario?: DiccionarioResuelto;
}>;

/** Vacío de primera vez: «No tenés empresas en {marca}. Si te invitaron, abrí el enlace del mail.» (nunca se busca por email). */
export function PantallaSinEmpresas({
  marca,
  accionDeCerrarSesion,
  diccionario = {},
}: PropsDePantallaSinEmpresas) {
  return (
    <PlantillaNeutra titulo={texto(diccionario, "empresa.sin_empresas_titulo")}>
      <Aviso tono="info">
        <Texto>{texto(diccionario, "empresa.sin_empresas", { marca })}</Texto>
      </Aviso>
      <FormularioDeAccion accion={accionDeCerrarSesion} diccionario={diccionario}>
        <BotonDeEnvio
          variante="secundaria"
          ancho="completo"
          textoEnviando={texto(diccionario, "cuenta.cerrando")}
        >
          {texto(diccionario, "cuenta.cerrar_sesion")}
        </BotonDeEnvio>
      </FormularioDeAccion>
    </PlantillaNeutra>
  );
}
