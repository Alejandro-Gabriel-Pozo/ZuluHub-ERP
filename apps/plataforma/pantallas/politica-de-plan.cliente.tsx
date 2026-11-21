"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton.cliente";
import { Campo } from "../../web/ui/componentes/Campo";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { definirPoliticaAccion } from "../app/politica-de-plan/acciones";
import {
  diasConUnidad,
  formularioInicial,
  pieDeLaVersion,
  resumenDelCambio,
  validarFormularioDePolitica,
  type CampoDePolitica,
  type FormularioDePolitica,
  type VersionDePolitica,
} from "../logica/politica-de-plan";
import { textoDePlanes, textoDelNucleo } from "../logica/textos-de-planes";
import estilos from "./politica-de-plan.module.css";
import { useEnvioDePlanes } from "./usar-envio-de-planes.cliente";

type Fijado = Readonly<{
  versionEsperada: number;
  diasDeAnticipacionDeSuba: number;
  diasDeAnticipacionDeBaja: number;
  diasDeArrepentimiento: number;
  motivo: string;
}>;
type Hecho = Readonly<{ version: number }>;

export type PropsDePoliticaDePlan = Readonly<{
  vigente: VersionDePolitica;
  /** Solo muestra u oculta el botón: definir la vuelve a exigir el servidor. */
  puedeDefinir: boolean;
}>;

const NUMEROS = [
  { campo: "suba", rotulo: "plataforma.politica.rotulo_suba" },
  { campo: "baja", rotulo: "plataforma.politica.rotulo_baja" },
  { campo: "arrepentimiento", rotulo: "plataforma.politica.rotulo_arrepentimiento" },
] as const;

/**
 * El bloque «vigente» y, para quien puede, el botón y el diálogo para definir una versión nueva. Los valores se FIJAN con la clave de idempotencia y la versión vista al primer toque del intento
 * y se reusan en cada reintento (doble toque o corte de red: un solo pedido). Si otra persona definió antes, el formulario conserva lo escrito y la pantalla se recarga para mostrar la vigente.
 */
export function PoliticaDePlan({ vigente, puedeDefinir }: PropsDePoliticaDePlan) {
  const router = useRouter();
  const [abierta, setAbierta] = useState(false);
  const [form, setForm] = useState<FormularioDePolitica>(() => formularioInicial(vigente));
  const [faltas, setFaltas] = useState<Partial<Record<CampoDePolitica, string>>>({});
  const { envio, fijar, fijada, referenciaIncierta, ventana } = useEnvioDePlanes<Fijado, Hecho>({
    accion: definirPoliticaAccion,
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
  const hayConflicto = error?.tipo === "PANTALLA_VIEJA";
  const validado = validarFormularioDePolitica(form);
  const guardada = estado.tipo === "hecho";

  // Guardada: la pantalla se recarga para mostrar la versión nueva arriba. El aviso y el cierre del diálogo se derivan del estado del envío (sin estado aparte).
  useEffect(() => {
    if (estado.tipo === "hecho") router.refresh();
  }, [estado.tipo, router]);

  // Con un conflicto, la pantalla se recarga una vez para mostrar la política que ganó (sin tocar lo escrito).
  useEffect(() => {
    if (hayConflicto) router.refresh();
  }, [hayConflicto, router]);

  function abrir() {
    setForm(formularioInicial(vigente));
    setFaltas({});
    envio.reiniciar();
    setAbierta(true);
  }

  function cerrar() {
    envio.reiniciar();
    setFaltas({});
    setAbierta(false);
  }

  function cambiar(campo: CampoDePolitica, valor: string) {
    setForm((previo) => ({ ...previo, [campo]: valor }));
    setFaltas((previo) => ({ ...previo, [campo]: undefined }));
    envio.reiniciar();
  }

  function tocarGuardar() {
    if (envio.enCurso) return;
    if (fijada === null) {
      if (!validado.ok) {
        setFaltas(validado.faltas);
        return;
      }
      fijar({
        versionEsperada: vigente.version,
        diasDeAnticipacionDeSuba: validado.dias.suba,
        diasDeAnticipacionDeBaja: validado.dias.baja,
        diasDeArrepentimiento: validado.dias.arrepentimiento,
        motivo: validado.motivo,
      });
    }
    envio.enviar();
  }

  return (
    <>
      {guardada ? (
        <Aviso tono="exito">
          <Texto>{textoDePlanes("plataforma.politica.guardada")}</Texto>
        </Aviso>
      ) : null}
      <dl className={estilos["vigente"]}>
        {NUMEROS.map(({ campo, rotulo }) => (
          <div key={campo} className={estilos["dato"]}>
            <dt>{textoDePlanes(rotulo)}</dt>
            <dd>{diasConUnidad(vigente[campo])}</dd>
          </div>
        ))}
      </dl>
      <p className={estilos["pie"]}>{pieDeLaVersion(vigente)}</p>
      {puedeDefinir ? (
        <Boton alTocar={abrir}>{textoDePlanes("plataforma.politica.definir")}</Boton>
      ) : null}
      <Superposicion
        abierta={abierta && !guardada}
        titulo={textoDePlanes("plataforma.politica.definir")}
        proposito="confirmar"
        cerrable={!envio.enCurso}
        etiquetaDeCerrar="Cerrar"
        alCerrar={cerrar}
      >
        <form
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            tocarGuardar();
          }}
        >
          <Pila separacion={4}>
            {textoGeneral === null ? null : (
              <Aviso tono={error?.tipo === "OCULTAR_ACCION" || hayConflicto ? "aviso" : "peligro"}>
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
            {NUMEROS.map(({ campo, rotulo }) => (
              <Campo
                key={campo}
                dato="dias-de-la-politica-de-plan"
                etiqueta={textoDePlanes(rotulo)}
                nombre={campo}
                inputMode="numeric"
                autoComplete="off"
                valor={form[campo]}
                alCambiar={(v) => {
                  cambiar(campo, v);
                }}
                error={faltas[campo]}
                deshabilitado={bloqueada}
              />
            ))}
            <Campo
              dato="motivo-de-politica-de-plan"
              etiqueta={textoDePlanes("plataforma.planes.motivo")}
              nombre="motivo"
              autoComplete="off"
              valor={form.motivo}
              alCambiar={(v) => {
                cambiar("motivo", v);
              }}
              error={faltas.motivo ?? errorDeMotivo}
              deshabilitado={bloqueada}
            />
            {validado.ok ? (
              <Pila separacion={2}>
                <Texto>{resumenDelCambio(vigente, validado.dias)}</Texto>
                <Texto>{textoDePlanes("plataforma.politica.no_modifica")}</Texto>
              </Pila>
            ) : null}
            <Boton
              tipo="submit"
              ancho="completo"
              enviando={envio.enCurso}
              textoEnviando={textoDelNucleo("conexion.verificando")}
              deshabilitado={!envio.enCurso && envio.bloqueado}
              motivo={envio.motivoQueNoPuede}
            >
              {textoDePlanes("plataforma.politica.guardar")}
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
