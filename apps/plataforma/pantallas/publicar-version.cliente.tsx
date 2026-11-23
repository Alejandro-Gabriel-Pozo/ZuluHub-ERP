"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton.cliente";
import { Campo } from "../../web/ui/componentes/Campo";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { publicarVersionAccion } from "../app/planes/acciones";
import { LARGO_MAXIMO_DEL_MOTIVO } from "../logica/entrada-del-plan";
import { textoDePlanes, textoDelNucleo } from "../logica/textos-de-planes";
import { useEnvioDePlanes } from "./usar-envio-de-planes.cliente";

type Fijado = Readonly<{ planId: string; motivo: string }>;
type Hecho = Readonly<{ numero: number }>;

export type PropsDePublicarVersion = Readonly<{
  planId: string;
  codigo: string;
  /** El número que va a tener la versión que se publica (la última publicada + 1). */
  numeroNuevo: number;
  abierta: boolean;
  alCerrar: () => void;
}>;

/**
 * El diálogo de «Publicar»: resumen, motivo obligatorio y, si el segundo factor venció, la ventana del código encima. El motivo se FIJA con la clave al primer toque del intento y se reusa en cada
 * reintento. Al publicar se vuelve a la ficha con el aviso de que ningún cliente cambió. Si otra persona publicó antes, el rechazo `SIN_BORRADOR` se dice con su texto.
 */
export function PublicarVersion({
  planId,
  codigo,
  numeroNuevo,
  abierta,
  alCerrar,
}: PropsDePublicarVersion) {
  const router = useRouter();
  const [motivo, setMotivo] = useState("");
  const [local, setLocal] = useState<string | undefined>(undefined);
  const { envio, fijar, fijada, referenciaIncierta, ventana } = useEnvioDePlanes<Fijado, Hecho>({
    accion: publicarVersionAccion,
    segundoFactor: true,
    textos: {
      sinConexion: textoDelNucleo("conexion.no_se_puede_enviar"),
      verificando: textoDelNucleo("conexion.verificando"),
    },
  });
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueada = envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const error = rechazo?.tipo === "ERROR" ? rechazo.error : null;
  const errorDeMotivo =
    error?.tipo === "CAMPO" && error.campo === "motivo" ? error.texto : undefined;
  const textoGeneral =
    error === null || errorDeMotivo !== undefined
      ? null
      : error.tipo === "OCULTAR_ACCION"
        ? textoDePlanes("plataforma.planes.no_permitido")
        : "texto" in error
          ? error.texto
          : null;

  useEffect(() => {
    if (estado.tipo !== "hecho") return;
    router.push(`/planes/${encodeURIComponent(planId)}?aviso=publicada`);
  }, [estado, planId, router]);

  function tocarPublicar() {
    if (envio.enCurso) return;
    if (fijada === null) {
      const limpio = motivo.trim();
      if (limpio === "" || limpio.length > LARGO_MAXIMO_DEL_MOTIVO) {
        setLocal(textoDePlanes("plataforma.planes.falta_motivo"));
        return;
      }
      fijar({ planId, motivo: limpio });
    }
    envio.enviar();
  }

  function cerrar() {
    envio.reiniciar();
    setLocal(undefined);
    alCerrar();
  }

  return (
    <>
      <Superposicion
        abierta={abierta}
        titulo={textoDePlanes("plataforma.planes.publicar_titulo")}
        proposito="confirmar"
        cerrable={!envio.enCurso}
        etiquetaDeCerrar="Cerrar"
        alCerrar={cerrar}
      >
        <form
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            tocarPublicar();
          }}
        >
          <Pila separacion={4}>
            <Texto>
              {textoDePlanes("plataforma.planes.publicar_resumen", { n: numeroNuevo, codigo })}
            </Texto>
            {textoGeneral === null ? null : (
              <Aviso tono={error?.tipo === "OCULTAR_ACCION" ? "aviso" : "peligro"}>
                <Texto>{textoGeneral}</Texto>
                {rechazo?.tipo === "ERROR" && rechazo.referencia !== undefined ? (
                  <Texto>Código de referencia: {rechazo.referencia}</Texto>
                ) : null}
                {error?.tipo === "PANTALLA_VIEJA" ? (
                  <Boton
                    variante="secundaria"
                    alTocar={() => {
                      window.location.reload();
                    }}
                  >
                    Recargar
                  </Boton>
                ) : null}
              </Aviso>
            )}
            {incierto ? (
              <Aviso
                tono="aviso"
                accion={
                  envio.enCurso ? null : (
                    <Boton variante="secundaria" alTocar={envio.enviar}>
                      Reintentar
                    </Boton>
                  )
                }
              >
                <Texto>{envio.motivoQueNoPuede ?? textoDelNucleo("conexion.verificando")}</Texto>
                {referenciaIncierta === undefined ? null : (
                  <Texto>Código de referencia: {referenciaIncierta}</Texto>
                )}
              </Aviso>
            ) : null}
            <Campo
              dato="motivo-de-plan"
              etiqueta={textoDePlanes("plataforma.planes.motivo")}
              nombre="motivo"
              autoComplete="off"
              ayuda={textoDePlanes("plataforma.planes.motivo_ayuda")}
              valor={motivo}
              alCambiar={(v) => {
                setMotivo(v);
                setLocal(undefined);
                envio.reiniciar();
              }}
              error={local ?? errorDeMotivo}
              deshabilitado={bloqueada}
            />
            <Boton
              tipo="submit"
              ancho="completo"
              enviando={envio.enCurso}
              textoEnviando={textoDelNucleo("conexion.verificando")}
              deshabilitado={!envio.enCurso && envio.bloqueado}
              motivo={envio.motivoQueNoPuede}
            >
              {textoDePlanes("plataforma.planes.publicar")}
            </Boton>
            <Boton
              variante="secundaria"
              ancho="completo"
              deshabilitado={envio.enCurso}
              alTocar={cerrar}
            >
              {textoDePlanes("plataforma.planes.cancelar")}
            </Boton>
          </Pila>
        </form>
      </Superposicion>
      {ventana}
    </>
  );
}
