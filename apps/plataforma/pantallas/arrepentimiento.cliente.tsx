"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton.cliente";
import { Campo } from "../../web/ui/componentes/Campo";
import { Insignia } from "../../web/ui/componentes/Insignia";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import type { RespuestaDeConsola } from "../logica/respuesta-de-consola";
import {
  queMostrarDelUltimoCambio,
  textosDeLaConfirmacion,
  type UltimoCambioVista,
} from "../logica/arrepentimiento";
import { textoDePlanes, textoDelNucleo } from "../logica/textos-de-planes";
import propios from "./plan.module.css";
import { useEnvioDePlanes } from "./usar-envio-de-planes.cliente";

type Fijado = Readonly<{
  tenantId: string;
  numero: number;
  numeroEsperado: number;
  motivo: string;
}>;
type Hecho = Readonly<{ numero: number }>;

export type PropsDeArrepentimiento = Readonly<{
  tenantId: string;
  /** El último cambio del cliente y lo que el servidor decidió de él. */
  cambio: UltimoCambioVista | null;
  /** El día de hoy (Argentina) con el que el servidor decidió: es desde cuándo vuelve la empresa al plan anterior. */
  hoy: string;
  /** Solo muestra u oculta el botón: el servidor lo vuelve a exigir. */
  puedeArrepentir: boolean;
  /** La acción del servidor que deshace el cambio (la página la pasa: así este archivo no importa código de servidor). */
  accion: (entrada: Fijado & { claveDeIdempotencia: string }) => Promise<RespuestaDeConsola<Hecho>>;
}>;

/**
 * Junto al plan actual: si el último cambio admite arrepentimiento, hasta qué día, si fue suba o baja y, para quien puede, el botón y la confirmación; si el último cambio nació de un arrepentimiento, lo dice.
 * El pedido se FIJA con la clave de idempotencia al primer toque del intento y se reusa en cada reintento (doble toque o corte de red: un solo arrepentimiento). Qué se puede deshacer lo decide el servidor.
 */
export function Arrepentimiento({
  tenantId,
  cambio,
  hoy,
  puedeArrepentir,
  accion,
}: PropsDeArrepentimiento) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [local, setLocal] = useState<string | undefined>(undefined);
  const { envio, fijar, fijada, referenciaIncierta, ventana } = useEnvioDePlanes<Fijado, Hecho>({
    accion,
    segundoFactor: true,
    textos: {
      sinConexion: textoDelNucleo("conexion.no_se_puede_enviar"),
      verificando: textoDelNucleo("conexion.verificando"),
    },
  });
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueada = envio.enCurso || incierto;
  const hecho = estado.tipo === "hecho";
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

  // Deshecho: la pantalla se recarga y el último cambio pasa a ser el arrepentimiento (el diálogo se cierra solo, derivado del estado).
  useEffect(() => {
    if (estado.tipo === "hecho") router.refresh();
  }, [estado.tipo, router]);

  const mostrar = queMostrarDelUltimoCambio(cambio, puedeArrepentir);
  if (mostrar.tipo === "NADA" || cambio === null) return null;
  if (mostrar.tipo === "DESHECHO") {
    return (
      <div className={propios["arrepentimiento"]}>
        <Insignia tono="info">{mostrar.etiqueta}</Insignia>
        <Texto>{mostrar.texto}</Texto>
      </div>
    );
  }
  const textos = textosDeLaConfirmacion(cambio, hoy);

  function abrir() {
    setMotivo("");
    setLocal(undefined);
    envio.reiniciar();
    setAbierta(true);
  }

  function cerrar() {
    envio.reiniciar();
    setLocal(undefined);
    setAbierta(false);
  }

  function tocarDeshacer() {
    if (envio.enCurso || cambio === null) return;
    if (fijada === null) {
      const limpio = motivo.trim();
      if (limpio === "") {
        setLocal(textoDePlanes("plataforma.planes.falta_motivo"));
        return;
      }
      fijar({ tenantId, numero: cambio.numero, numeroEsperado: cambio.numero, motivo: limpio });
    }
    envio.enviar();
  }

  return (
    <div className={propios["arrepentimiento"]}>
      {mostrar.sentido === null ? null : <Insignia tono="neutro">{mostrar.sentido}</Insignia>}
      <Texto>{mostrar.puedeHasta}</Texto>
      {mostrar.ofreceElBoton ? (
        <Boton variante="secundaria" alTocar={abrir}>
          {textoDePlanes("plataforma.arrepentir.boton")}
        </Boton>
      ) : null}
      <Superposicion
        abierta={abierta && !hecho}
        titulo={textoDePlanes("plataforma.arrepentir.boton")}
        proposito="confirmar"
        cerrable={!envio.enCurso}
        etiquetaDeCerrar="Cerrar"
        alCerrar={cerrar}
      >
        <form
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            tocarDeshacer();
          }}
        >
          <Pila separacion={4}>
            {textoGeneral === null ? null : (
              <Aviso tono={error?.tipo === "OCULTAR_ACCION" ? "aviso" : "peligro"}>
                <Texto>{textoGeneral}</Texto>
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
                <Texto>{envio.motivoQueNoPuede ?? textoDelNucleo("conexion.verificando")}</Texto>
                {referenciaIncierta === undefined ? null : (
                  <Texto>Código de referencia: {referenciaIncierta}</Texto>
                )}
              </Aviso>
            ) : null}
            {textos.vuelve === null ? null : <Texto>{textos.vuelve}</Texto>}
            {textos.consecuencia === null ? null : <Texto>{textos.consecuencia}</Texto>}
            <Campo
              dato="motivo-de-arrepentimiento"
              etiqueta={textoDePlanes("plataforma.planes.motivo")}
              nombre="motivo"
              autoComplete="off"
              valor={motivo}
              alCambiar={(v) => {
                setMotivo(v);
                setLocal(undefined);
                envio.reiniciar();
              }}
              error={local ?? errorDeMotivo}
              deshabilitado={bloqueada}
            />
            <Texto>{textos.noSeRepite}</Texto>
            <Boton
              tipo="submit"
              ancho="completo"
              enviando={envio.enCurso}
              textoEnviando={textoDelNucleo("conexion.verificando")}
              deshabilitado={!envio.enCurso && envio.bloqueado}
              motivo={envio.motivoQueNoPuede}
            >
              {textoDePlanes("plataforma.arrepentir.boton")}
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
    </div>
  );
}
