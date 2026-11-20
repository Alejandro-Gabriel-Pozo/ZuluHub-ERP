"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton.cliente";
import { Campo } from "../../web/ui/componentes/Campo";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { validarCodigoDePlan } from "../../../src/capacidades/planes/version-de-plan";
import { crearPlanAccion } from "../app/planes/acciones";
import { textoDePlanes } from "../logica/textos-de-planes";
import { useEnvioDePlanes } from "./usar-envio-de-planes.cliente";

type Fijado = Readonly<{ codigo: string }>;
type Hecho = Readonly<{ planId: string; yaExistia: boolean }>;

/** «Nuevo plan»: botón y diálogo con el código técnico. Una clave por intento; crear el que ya existe es éxito y lleva a su ficha. */
export function NuevoPlan() {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [codigo, setCodigo] = useState("");
  const [local, setLocal] = useState<string | undefined>(undefined);
  const { envio, fijar, fijada, referenciaIncierta } = useEnvioDePlanes<Fijado, Hecho>({
    accion: crearPlanAccion,
    textos: {
      sinConexion: textoDePlanes("plataforma.planes.sin_conexion_crear"),
      verificando: textoDePlanes("plataforma.planes.verificando"),
    },
  });
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueada = envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const error = rechazo?.tipo === "ERROR" ? rechazo.error : null;

  useEffect(() => {
    if (estado.tipo !== "hecho") return;
    router.push(
      `/planes/${encodeURIComponent(estado.valor.planId)}?aviso=${estado.valor.yaExistia ? "existia" : "creado"}`,
    );
  }, [estado, router]);

  function tocarCrear() {
    if (envio.enCurso) return;
    if (fijada === null) {
      const limpio = codigo.trim();
      if (!validarCodigoDePlan(limpio).ok) {
        setLocal(textoDePlanes("plataforma.planes.codigo_invalido"));
        return;
      }
      fijar({ codigo: limpio });
    }
    envio.enviar();
  }

  function cerrar() {
    envio.reiniciar();
    setLocal(undefined);
    setCodigo("");
    setAbierta(false);
  }

  const textoDeError = error === null ? undefined : "texto" in error ? error.texto : undefined;
  return (
    <>
      <Boton
        alTocar={() => {
          setAbierta(true);
        }}
      >
        {textoDePlanes("plataforma.planes.nuevo_plan")}
      </Boton>
      <Superposicion
        abierta={abierta}
        titulo={textoDePlanes("plataforma.planes.nuevo_plan")}
        proposito="confirmar"
        cerrable={!envio.enCurso}
        etiquetaDeCerrar="Cerrar"
        alCerrar={cerrar}
      >
        <form
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            tocarCrear();
          }}
        >
          <Pila separacion={4}>
            {textoDeError === undefined ? null : (
              <Aviso tono="peligro">
                <Texto>{textoDeError}</Texto>
                {rechazo?.tipo === "ERROR" && rechazo.referencia !== undefined ? (
                  <Texto>Código de referencia: {rechazo.referencia}</Texto>
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
                <Texto>
                  {envio.motivoQueNoPuede ?? textoDePlanes("plataforma.planes.verificando")}
                </Texto>
                {referenciaIncierta === undefined ? null : (
                  <Texto>Código de referencia: {referenciaIncierta}</Texto>
                )}
              </Aviso>
            ) : null}
            <Campo
              dato="codigo-de-plan"
              etiqueta={textoDePlanes("plataforma.planes.campo_codigo")}
              nombre="codigo"
              autoComplete="off"
              autoCapitalize="off"
              ayuda={textoDePlanes("plataforma.planes.ayuda_codigo")}
              valor={codigo}
              alCambiar={(v) => {
                setCodigo(v);
                setLocal(undefined);
                envio.reiniciar();
              }}
              error={local}
              deshabilitado={bloqueada}
            />
            <Boton
              tipo="submit"
              ancho="completo"
              enviando={envio.enCurso}
              textoEnviando={textoDePlanes("plataforma.planes.verificando")}
              deshabilitado={!envio.enCurso && envio.bloqueado}
              motivo={envio.motivoQueNoPuede}
            >
              {textoDePlanes("plataforma.planes.crear_plan")}
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
    </>
  );
}
