"use client";

import { useRef, useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton.cliente";
import { Campo } from "../../web/ui/componentes/Campo";
import { EnlaceDeAccion } from "../../web/ui/componentes/EnlaceDeAccion";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { LARGO_MAXIMO_DEL_NOMBRE_DE_PLAN } from "../../../src/capacidades/planes/version-de-plan";
import {
  LIMITE_MAXIMO_DE_PERILLA,
  type ValorDePerilla,
} from "../../../src/capacidades/planes/valores";
import { guardarBorradorAccion } from "../app/planes/acciones";
import {
  advertenciasDeLaVersion,
  conLoQueSePide,
  conModulo,
  lineasDeDiferencia,
  modulosParaElegir,
  perillasParaElegir,
  valorDe,
  type ContenidoDePlan,
} from "../logica/editor-de-plan";
import { textoDePlanes, textoDelNucleo } from "../logica/textos-de-planes";
import { GrupoDeModulos, GrupoDePerillas } from "./grupos-del-plan.cliente";
import estilos from "./planes.module.css";
import { PublicarVersion } from "./publicar-version.cliente";
import { useEnvioDePlanes } from "./usar-envio-de-planes.cliente";

type Fijado = Readonly<{
  planId: string;
  versionEsperada: number | null;
  nombreComercial: string;
  modulos: readonly string[];
  perillas: Readonly<Record<string, ValorDePerilla>>;
}>;
type Hecho = Readonly<{ version: number }>;

export type PropsDeEditorDeBorrador = Readonly<{
  planId: string;
  codigo: string;
  /** El contenido con el que se abre: el borrador guardado o, si no hay, la copia de la última publicada. */
  inicial: ContenidoDePlan;
  /** La `version` del borrador guardado, o null si todavía no hay (el primer guardado lo crea). */
  versionEsperada: number | null;
  /** La última publicada: base de «qué cambia» y del número de la versión nueva. */
  base: Readonly<{ numero: number; contenido: ContenidoDePlan }> | null;
  /** Si el contenido inicial es la copia de una publicada (todavía no hay borrador), su número. */
  copiadaDe: number | null;
  puedePublicar: boolean;
}>;

/** El contenido en forma canónica (módulos con lo que se pide y ordenados, perillas por clave): lo guardado llega ordenado de otra manera y no por eso hay cambios sin guardar. */
const clave = (c: ContenidoDePlan): string =>
  JSON.stringify([
    c.nombreComercial,
    [...conLoQueSePide(c.modulos)].sort(),
    Object.entries(c.perillas).sort(([a], [b]) => (a < b ? -1 : 1)),
  ]);
const textoDeLimite = (v: ValorDePerilla): string =>
  v.tipo === "LIMITE" && v.limite !== "ILIMITADO" ? String(v.limite) : "";
const sinObligatorios = (modulos: readonly string[]): readonly string[] => {
  const obligatorios = new Set(
    modulosParaElegir()
      .filter((m) => m.obligatorio)
      .map((m) => m.clave),
  );
  return modulos.filter((m) => !obligatorios.has(m));
};

/**
 * El editor del borrador: nombre comercial, módulos y perillas del catálogo real, «qué cambia» frente a la última publicada y las advertencias (que avisan y no bloquean). Guardar crea o actualiza el borrador con
 * `versionEsperada` (si otra persona guardó antes, «la pantalla quedó vieja»: no se pisa su trabajo). «Publicar…» guarda lo que haya sin guardar y abre el diálogo del motivo.
 */
export function EditorDeBorrador({
  planId,
  codigo,
  inicial,
  versionEsperada,
  base,
  copiadaDe,
  puedePublicar,
}: PropsDeEditorDeBorrador) {
  const [nombre, setNombre] = useState(inicial.nombreComercial);
  const [elegidos, setElegidos] = useState<readonly string[]>(sinObligatorios(inicial.modulos));
  const [perillas, setPerillas] = useState<Readonly<Record<string, ValorDePerilla>>>(
    inicial.perillas,
  );
  const [limites, setLimites] = useState<Readonly<Record<string, string>>>(() =>
    Object.fromEntries(
      perillasParaElegir()
        .filter((p) => p.tipo === "LIMITE")
        .map((p) => [p.clave, textoDeLimite(valorDe(inicial.perillas, p.clave))]),
    ),
  );
  const [version, setVersion] = useState(versionEsperada);
  const [guardado, setGuardado] = useState<string | null>(
    versionEsperada === null ? null : clave(inicial),
  );
  const [localDelNombre, setLocalDelNombre] = useState<string | undefined>(undefined);
  const [publicando, setPublicando] = useState(false);
  const instantanea = useRef("");
  const publicarAlGuardar = useRef(false);

  const { envio, fijar, fijada, referenciaIncierta } = useEnvioDePlanes<Fijado, Hecho>({
    accion: async (entrada) => {
      const respuesta = await guardarBorradorAccion(entrada);
      // Se anota lo guardado apenas vuelve la respuesta (no en un efecto): lo único que cambia es qué versión sigue y qué contenido ya está a salvo.
      if (respuesta.ok) {
        setVersion(respuesta.dato.version);
        setGuardado(instantanea.current);
      }
      if (publicarAlGuardar.current && respuesta.ok) setPublicando(true);
      if (!(respuesta.ok === false && respuesta.error.tipo === "INESPERADO"))
        publicarAlGuardar.current = false;
      return respuesta;
    },
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
  const textoDeError =
    error === null
      ? null
      : error.tipo === "OCULTAR_ACCION"
        ? textoDePlanes("plataforma.planes.no_permitido")
        : "texto" in error
          ? error.texto
          : null;

  const contenido: ContenidoDePlan = {
    nombreComercial: nombre,
    modulos: conLoQueSePide(elegidos),
    perillas,
  };
  const sucio = guardado === null || clave(contenido) !== guardado;
  const advertencias = advertenciasDeLaVersion(contenido);
  const cambios = base === null ? null : lineasDeDiferencia(base.contenido, contenido);

  function tocarGuardar(): boolean {
    if (envio.enCurso) return false;
    if (fijada === null) {
      if (nombre.trim() === "") {
        setLocalDelNombre(textoDePlanes("plataforma.planes.falta_nombre"));
        return false;
      }
      instantanea.current = clave(contenido);
      fijar({
        planId,
        versionEsperada: version,
        nombreComercial: nombre,
        modulos: contenido.modulos,
        perillas,
      });
    }
    envio.enviar();
    return true;
  }

  function tocarPublicar() {
    if (nombre.trim() === "") {
      setLocalDelNombre(textoDePlanes("plataforma.planes.falta_nombre"));
      return;
    }
    if (sucio) {
      publicarAlGuardar.current = true;
      if (!tocarGuardar()) publicarAlGuardar.current = false;
      return;
    }
    setPublicando(true);
  }

  function editado(cambiar: () => void) {
    cambiar();
    envio.reiniciar();
  }

  function ponerLimite(clavePerilla: string, texto: string) {
    const digitos = texto.replace(/\D/g, "").slice(0, String(LIMITE_MAXIMO_DE_PERILLA).length);
    editado(() => {
      setLimites((previo) => ({ ...previo, [clavePerilla]: digitos }));
      const n = Number(digitos);
      if (digitos !== "" && n <= LIMITE_MAXIMO_DE_PERILLA) {
        setPerillas((previo) => ({ ...previo, [clavePerilla]: { tipo: "LIMITE", limite: n } }));
      }
    });
  }

  return (
    <Pila separacion={4}>
      {copiadaDe === null || guardado !== null ? null : (
        <Texto>{textoDePlanes("plataforma.planes.copiada_de", { n: copiadaDe })}</Texto>
      )}
      {estado.tipo === "hecho" && !publicando ? (
        <Aviso tono="exito">
          <Texto>{textoDePlanes("plataforma.planes.borrador_guardado")}</Texto>
        </Aviso>
      ) : null}
      {textoDeError === null ? null : (
        <Aviso tono={error?.tipo === "OCULTAR_ACCION" ? "aviso" : "peligro"}>
          <Texto>{textoDeError}</Texto>
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
      <div className={estilos["campoAncho"]}>
        <Campo
          dato="nombre-comercial-de-plan"
          etiqueta={textoDePlanes("plataforma.planes.nombre_comercial")}
          nombre="nombreComercial"
          autoComplete="off"
          valor={nombre}
          alCambiar={(v) => {
            editado(() => {
              setNombre(v.slice(0, LARGO_MAXIMO_DEL_NOMBRE_DE_PLAN));
              setLocalDelNombre(undefined);
            });
          }}
          error={localDelNombre}
          deshabilitado={bloqueada}
        />
      </div>
      <GrupoDeModulos
        bloqueada={bloqueada}
        marcados={contenido.modulos}
        elegidos={elegidos}
        alCambiar={(clave, marcada) => {
          editado(() => {
            setElegidos((previo) => conModulo(previo, clave, marcada));
          });
        }}
      />
      <GrupoDePerillas
        bloqueada={bloqueada}
        perillas={perillas}
        limites={limites}
        alCambiarInterruptor={(clave, encendida) => {
          editado(() => {
            setPerillas((previo) => ({ ...previo, [clave]: { tipo: "INTERRUPTOR", encendida } }));
          });
        }}
        alCambiarLimite={ponerLimite}
      />
      {advertencias.length === 0 ? null : (
        <Aviso tono="aviso">
          <Texto variante="subtitulo">{textoDePlanes("plataforma.planes.revisar_antes")}</Texto>
          {advertencias.map((a) => (
            <Texto key={a}>{a}</Texto>
          ))}
        </Aviso>
      )}
      {cambios === null || base === null ? null : (
        <section aria-labelledby="titulo-que-cambia">
          <h2 id="titulo-que-cambia">
            {textoDePlanes("plataforma.planes.que_cambia", { n: base.numero })}
          </h2>
          {cambios.length === 0 ? (
            <p>{textoDePlanes("plataforma.planes.sin_cambios")}</p>
          ) : (
            <ul className={estilos["sinMargen"]}>
              {cambios.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          )}
        </section>
      )}
      <div className={estilos["acciones"]}>
        <Boton
          alTocar={() => {
            tocarGuardar();
          }}
          enviando={envio.enCurso}
          textoEnviando={textoDelNucleo("conexion.verificando")}
          deshabilitado={!envio.enCurso && envio.bloqueado}
          motivo={envio.motivoQueNoPuede}
        >
          {textoDePlanes("plataforma.planes.guardar")}
        </Boton>
        {puedePublicar ? (
          <Boton variante="secundaria" alTocar={tocarPublicar} deshabilitado={bloqueada}>
            {textoDePlanes("plataforma.planes.publicar_abrir")}
          </Boton>
        ) : null}
        <EnlaceDeAccion href={`/planes/${encodeURIComponent(planId)}`} variante="secundaria">
          {textoDePlanes("plataforma.planes.volver")}
        </EnlaceDeAccion>
      </div>
      <PublicarVersion
        planId={planId}
        codigo={codigo}
        numeroNuevo={(base?.numero ?? 0) + 1}
        abierta={publicando}
        alCerrar={() => {
          setPublicando(false);
        }}
      />
    </Pila>
  );
}
