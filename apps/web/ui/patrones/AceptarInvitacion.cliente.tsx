"use client";

import type { ErrorPublico, Respuesta } from "../../../../src/capacidades/experiencia/respuesta";
import {
  texto,
  type DiccionarioResuelto,
} from "../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../componentes/Aviso";
import { Boton } from "../componentes/Boton";
import { EnlaceDeAccion } from "../componentes/EnlaceDeAccion";
import { Pila } from "../primitivas/Pila";
import { Texto } from "../primitivas/Texto";
import { ErrorDeRespuesta } from "./ErrorDeRespuesta";
import { RegionDeEstado } from "./RegionDeEstado";
import { useEnvioConClave } from "./useEnvioConClave";

/** Lo que la pantalla sabe de una invitación aceptada: nada interno (ni la persona ni su vínculo). */
export type InvitacionAceptadaParaLaPantalla = Readonly<{ yaEstabaAceptada: boolean }>;

export type PropsDeAceptarInvitacion = Readonly<{
  /**
   * Manda el pedido al servidor con la clave del intento. Repetirlo con la MISMA clave devuelve el mismo
   * resultado (regla natural de la invitación: ADR-015, punto 4). Si falla por red, que lance: es «incierto».
   */
  aceptar: (clave: string) => Promise<Respuesta<InvitacionAceptadaParaLaPantalla>>;
  /** Adónde sigue la persona al terminar: el inicio. */
  rutaDeContinuar: string;
  diccionario?: DiccionarioResuelto;
}>;

/**
 * «Aceptar invitación» con el envío incierto resuelto (P-11, [01] §6.4): si se corta la red justo al aceptar,
 * dice «Verificando si se registró…» y reintenta con LA MISMA clave, nunca con otra; sin conexión el botón
 * queda deshabilitado con su motivo; recién con la respuesta del servidor se muestra el resultado.
 */
export function AceptarInvitacion({
  aceptar,
  rutaDeContinuar,
  diccionario = {},
}: PropsDeAceptarInvitacion) {
  const envio = useEnvioConClave<InvitacionAceptadaParaLaPantalla, ErrorPublico>({
    enviar: async (clave) => {
      const respuesta = await aceptar(clave);
      return respuesta.ok
        ? { ok: true, valor: respuesta.dato }
        : { ok: false, rechazo: respuesta.error };
    },
    textos: {
      sinConexion: texto(diccionario, "conexion.no_se_puede_enviar"),
      verificando: texto(diccionario, "conexion.verificando"),
    },
  });
  const { estado } = envio;

  if (estado.tipo === "hecho") {
    return (
      <Pila separacion={4}>
        <Aviso tono="exito">
          <Texto>
            {texto(
              diccionario,
              estado.valor.yaEstabaAceptada ? "invitacion.ya_aceptada" : "invitacion.aceptada",
            )}
          </Texto>
        </Aviso>
        <EnlaceDeAccion href={rutaDeContinuar}>
          {texto(diccionario, "invitacion.continuar")}
        </EnlaceDeAccion>
      </Pila>
    );
  }

  return (
    <Pila separacion={4}>
      <RegionDeEstado urgencia="cortes" ocupada={envio.enCurso}>
        {estado.tipo === "incierto" ? texto(diccionario, "conexion.verificando") : null}
      </RegionDeEstado>
      {estado.tipo === "rechazado" ? (
        <ErrorDeRespuesta
          error={estado.rechazo}
          diccionario={diccionario}
          accion={
            // Reintentar solo tiene sentido si fue un fallo del servidor; un rechazo de negocio no cambia al repetirlo.
            estado.rechazo.presentacion === "INESPERADO" ? (
              <Boton variante="secundaria" alTocar={envio.enviar}>
                {texto(diccionario, "estado.reintentar")}
              </Boton>
            ) : undefined
          }
        />
      ) : null}
      <Boton
        ancho="completo"
        alTocar={envio.enviar}
        enviando={envio.enCurso}
        textoEnviando={texto(diccionario, "invitacion.aceptando")}
        deshabilitado={envio.bloqueado}
        motivo={envio.motivoQueNoPuede}
      >
        {texto(diccionario, "invitacion.aceptar")}
      </Boton>
    </Pila>
  );
}
