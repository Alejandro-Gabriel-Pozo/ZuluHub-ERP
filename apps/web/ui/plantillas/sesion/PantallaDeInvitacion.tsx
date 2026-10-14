import {
  texto,
  type DiccionarioResuelto,
} from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import {
  AceptarInvitacion,
  type PropsDeAceptarInvitacion,
} from "../../patrones/AceptarInvitacion.cliente";
import { BotonDeEnvio } from "../../patrones/BotonDeEnvio.cliente";
import {
  FormularioDeAccion,
  type AccionDeFormulario,
} from "../../patrones/FormularioDeAccion.cliente";
import { Texto } from "../../primitivas/Texto";
import { PlantillaNeutra } from "../PlantillaNeutra";

type Base = Readonly<{
  marca: string;
  diccionario?: DiccionarioResuelto;
}>;

export type PropsDePantallaDeInvitacion = Base &
  (
    | Readonly<{ estado: "SIN_ENLACE" }>
    | Readonly<{
        /** Todavía no ingresó: primero Google, con el enlace a salvo en una cookie del servidor. */
        estado: "SIN_SESION";
        token: string;
        accionDeIngreso: AccionDeFormulario;
      }>
    | Readonly<{
        /** Ya ingresó: puede aceptar. */
        estado: "CON_SESION";
        aceptar: PropsDeAceptarInvitacion["aceptar"];
      }>
  );

/** `/invitacion`: la única puerta del primer gerente. Ingresar con Google si hace falta, y aceptar. */
export function PantallaDeInvitacion(props: PropsDePantallaDeInvitacion) {
  const { marca, diccionario = {} } = props;
  return (
    <PlantillaNeutra titulo={texto(diccionario, "invitacion.titulo", { marca })}>
      {props.estado === "SIN_ENLACE" ? (
        <Aviso tono="aviso">
          <Texto>{texto(diccionario, "invitacion.sin_enlace")}</Texto>
        </Aviso>
      ) : null}
      {props.estado === "SIN_SESION" ? (
        <>
          <Texto>{texto(diccionario, "invitacion.detalle_sin_sesion")}</Texto>
          <FormularioDeAccion accion={props.accionDeIngreso} diccionario={diccionario}>
            <input type="hidden" name="invitacion" value={props.token} />
            <BotonDeEnvio ancho="completo" textoEnviando={texto(diccionario, "ingreso.enviando")}>
              {texto(diccionario, "ingreso.boton")}
            </BotonDeEnvio>
          </FormularioDeAccion>
        </>
      ) : null}
      {props.estado === "CON_SESION" ? (
        <>
          <Texto>{texto(diccionario, "invitacion.detalle_con_sesion")}</Texto>
          <AceptarInvitacion
            aceptar={props.aceptar}
            rutaDeContinuar="/"
            diccionario={diccionario}
          />
        </>
      ) : null}
    </PlantillaNeutra>
  );
}
