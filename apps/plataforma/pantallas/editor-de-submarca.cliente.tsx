"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Campo } from "../../web/ui/componentes/Campo";
import { Selector } from "../../web/ui/componentes/Selector";
import { useEnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { guardarBorradorAccion } from "../app/submarcas/acciones";
import { evaluarContraste } from "../logica/contraste-de-submarca";
import type { CampoDeSubmarca, ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { FichaDeSubmarca } from "../logica/ficha-de-submarca";
import {
  cambiosDelBorrador,
  ESQUINAS,
  ESTILOS,
  esColorHex,
  hayCambios,
  INGRESOS,
  normalizarColor,
  SUPERFICIES,
  TITULOS,
  type AspectoDeSubmarca,
  type CambiosDelBorrador,
  type ColoresDeSubmarca,
  type FormularioDeSubmarca,
} from "../logica/submarca";
import { VentanaDeConfirmacion } from "./ventana-de-confirmacion.cliente";
import { VistaPreviaDeIngreso } from "./vista-previa-de-ingreso.cliente";
import propios from "./submarcas.module.css";

export type PropsDeEditorDeSubmarca = Readonly<{
  ficha: FichaDeSubmarca;
}>;

type ClaveDeColor = keyof ColoresDeSubmarca;
type ClaveDeAspecto = keyof AspectoDeSubmarca;

const COLORES = [
  { clave: "primary", etiqueta: "Principal" },
  { clave: "onPrimary", etiqueta: "Texto sobre principal" },
  { clave: "accent", etiqueta: "Acento" },
  { clave: "secondary", etiqueta: "Secundario" },
] as const satisfies readonly { clave: ClaveDeColor; etiqueta: string }[];

/** Lo que muestra el selector nativo de color cuando el texto está vacío o a medio escribir. */
const COLOR_DE_MUESTRA = "#000000";

type Rechazo = Readonly<{ error: ErrorParaLaPantalla; referencia: string | undefined }>;

/** Elige de una lista cerrada el valor tipado que corresponde al texto del desplegable. */
function elegir<T extends string>(
  opciones: readonly Readonly<{ valor: T }>[],
  texto: string,
): T | undefined {
  return opciones.find((o) => o.valor === texto)?.valor;
}

/**
 * El editor de una submarca: formulario a la izquierda y vista previa en vivo a la derecha (debajo en el celular).
 * Todo es borrador hasta confirmar. Guardar no toca a los clientes; confirmar abre su propia ventana.
 */
export function EditorDeSubmarca({ ficha }: PropsDeEditorDeSubmarca) {
  const router = useRouter();
  const [refrescando, enTransicion] = useTransition();
  const [actual, setActual] = useState<FormularioDeSubmarca>(ficha.formulario);
  const [fichaVista, setFichaVista] = useState(ficha);
  const [confirmando, setConfirmando] = useState(false);
  const fijada = useRef<CambiosDelBorrador | null>(null);

  // Cuando el servidor entrega una ficha nueva (después de guardar o confirmar), el formulario vuelve a lo guardado.
  if (ficha !== fichaVista) {
    setFichaVista(ficha);
    setActual(ficha.formulario);
  }

  const envio = useEnvioConClave<null, Rechazo>({
    textos: {
      sinConexion: "Sin conexión. Cuando vuelva, podés guardar el borrador.",
      verificando: "Verificando si el borrador quedó guardado…",
    },
    enviar: async (clave) => {
      const cambios = fijada.current;
      if (cambios === null) throw new Error("Sin pedido fijado");
      // Lo que lance (red cortada) es «incierto» y se reintenta con la misma clave y los mismos valores.
      const resultado = await guardarBorradorAccion({
        claveDeIdempotencia: clave,
        marcaId: ficha.id,
        versionEsperada: ficha.borrador?.version ?? null,
        cambios,
      });
      fijada.current = null;
      if (resultado.ok) return { ok: true, valor: null };
      // Guardar no pide el segundo factor: si lo pidiera, es un error inesperado.
      const error: ErrorParaLaPantalla =
        resultado.error.tipo === "SEGUNDO_FACTOR" ? { tipo: "INESPERADO" } : resultado.error;
      return { ok: false, rechazo: { error, referencia: resultado.referencia } };
    },
  });

  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueadaLaEdicion = envio.enCurso || incierto;
  const guardado = estado.tipo === "hecho";
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const errorDeServidor = rechazo?.error ?? null;

  // Guardado el borrador, se vuelve a pedir la ficha para traer la versión nueva.
  useEffect(() => {
    if (!guardado) return;
    enTransicion(() => {
      router.refresh();
    });
  }, [guardado, router]);

  const conCambios = hayCambios(ficha.formulario, actual);
  const contraste = evaluarContraste(actual.colores, actual.aspecto.superficie, ficha.catalogo);

  /** El error de un color que se ve junto a él: formato, luego el del servidor y por último el contraste en vivo. */
  function errorDeColor(clave: ClaveDeColor): string | undefined {
    const texto = actual.colores[clave];
    if (texto !== "" && !esColorHex(normalizarColor(texto))) {
      return "Escribí el color con seis cifras, por ejemplo #1f4e79.";
    }
    const delServidor = textoDelCampo(clave);
    if (delServidor !== undefined) return delServidor;
    const pares =
      clave === "onPrimary"
        ? ["on-primary/primary"]
        : clave === "accent"
          ? ["accent/fondo", "accent/superficie"]
          : [];
    return contraste.find((r) => pares.includes(r.par) && r.cumple === false)?.texto ?? undefined;
  }

  function textoDelCampo(campo: CampoDeSubmarca): string | undefined {
    if (errorDeServidor?.tipo === "CAMPO" && errorDeServidor.campo === campo) {
      return errorDeServidor.texto;
    }
    return undefined;
  }

  function editar(poner: (previo: FormularioDeSubmarca) => FormularioDeSubmarca) {
    setActual(poner);
    envio.reiniciar();
  }

  function ponerColor(clave: ClaveDeColor, valor: string) {
    editar((previo) => ({ ...previo, colores: { ...previo.colores, [clave]: valor } }));
  }

  function ponerAspecto<K extends ClaveDeAspecto>(
    clave: K,
    valor: AspectoDeSubmarca[K] | undefined,
  ) {
    if (valor === undefined) return;
    editar((previo) => ({ ...previo, aspecto: { ...previo.aspecto, [clave]: valor } }));
  }

  const hayColorMalEscrito = COLORES.some(
    (c) => actual.colores[c.clave] !== "" && !esColorHex(normalizarColor(actual.colores[c.clave])),
  );

  function tocarGuardar() {
    if (envio.enCurso || hayColorMalEscrito) return;
    if (fijada.current === null) {
      // Los valores del pedido se fijan acá, al primer toque del intento, y se reusan en cada reintento.
      const cambios = cambiosDelBorrador(ficha.formulario, actual);
      if (Object.keys(cambios).length === 0) return;
      fijada.current = cambios;
    }
    envio.enviar();
  }

  const motivoDeGuardar = !conCambios ? "No hay cambios para guardar." : envio.motivoQueNoPuede;
  const motivoDeConfirmar = conCambios
    ? "Guardá el borrador antes de confirmar."
    : !ficha.puedeConfirmarse.ok
      ? (textoParaAviso(ficha.puedeConfirmarse.error) ?? "Todavía no se puede confirmar.")
      : undefined;

  const numeroNuevo = ficha.numeroDeLaVersionNueva;

  return (
    <>
      <div className={propios["editor"]}>
        <Pila separacion={4}>
          {ficha.puedeConfirmarse.ok ? null : (
            <Aviso tono="aviso" titulo="Todavía no se puede confirmar">
              <Texto>
                {textoParaAviso(ficha.puedeConfirmarse.error) ??
                  "Revisá el borrador antes de confirmar."}
              </Texto>
            </Aviso>
          )}
          {errorDeServidor === null || errorDeServidor.tipo === "CAMPO" ? null : (
            <Aviso
              tono={errorDeServidor.tipo === "OCULTAR_ACCION" ? "aviso" : "peligro"}
              accion={
                errorDeServidor.tipo === "PANTALLA_VIEJA" ? (
                  <Boton
                    variante="secundaria"
                    alTocar={() => {
                      window.location.reload();
                    }}
                  >
                    Recargar
                  </Boton>
                ) : null
              }
            >
              <Texto>{textoGeneral(errorDeServidor)}</Texto>
              {errorDeServidor.tipo === "INESPERADO" && rechazo?.referencia !== undefined ? (
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
                {envio.motivoQueNoPuede ??
                  "No supimos si el borrador quedó guardado. Reintentá: no se va a duplicar."}
              </Texto>
            </Aviso>
          ) : null}
          {guardado ? (
            <Aviso tono="exito">
              <Texto>Borrador guardado.</Texto>
            </Aviso>
          ) : null}

          <div className={propios["barra"]}>
            <Boton
              enviando={envio.enCurso}
              textoEnviando="Guardando…"
              deshabilitado={!envio.enCurso && (!conCambios || envio.bloqueado || refrescando)}
              motivo={motivoDeGuardar}
              alTocar={tocarGuardar}
            >
              Guardar borrador
            </Boton>
            <Boton
              variante="secundaria"
              deshabilitado={
                conCambios || !ficha.puedeConfirmarse.ok || bloqueadaLaEdicion || refrescando
              }
              motivo={motivoDeConfirmar}
              alTocar={() => {
                setConfirmando(true);
              }}
            >
              Confirmar versión
            </Boton>
          </div>
        </Pila>

        <div className={propios["columnas"]}>
          <form
            className={propios["formulario"]}
            noValidate
            onSubmit={(evento) => {
              evento.preventDefault();
              tocarGuardar();
            }}
          >
            <Pila separacion={5}>
              <Campo
                etiqueta="Nombre visible"
                nombre="nombreVisible"
                autoComplete="off"
                valor={actual.nombreVisible}
                alCambiar={(v) => {
                  editar((previo) => ({ ...previo, nombreVisible: v }));
                }}
                error={textoDelCampo("nombreVisible")}
                deshabilitado={bloqueadaLaEdicion}
              />

              <fieldset className={propios["grupo"]}>
                <legend className={propios["leyenda"]}>Colores</legend>
                <Pila separacion={4}>
                  {COLORES.map((c) => (
                    <ColorEditable
                      key={c.clave}
                      etiqueta={c.etiqueta}
                      valor={actual.colores[c.clave]}
                      error={errorDeColor(c.clave)}
                      deshabilitado={bloqueadaLaEdicion}
                      alCambiar={(v) => {
                        ponerColor(c.clave, v);
                      }}
                    />
                  ))}
                </Pila>
              </fieldset>

              <fieldset className={propios["grupo"]}>
                <legend className={propios["leyenda"]}>Aspecto</legend>
                <Pila separacion={4}>
                  <Selector
                    etiqueta="Estilo"
                    nombre="estilo"
                    opciones={ESTILOS}
                    valor={actual.aspecto.estilo}
                    alCambiar={(v) => {
                      ponerAspecto("estilo", elegir(ESTILOS, v));
                    }}
                    error={textoDelCampo("estilo")}
                    deshabilitado={bloqueadaLaEdicion}
                  />
                  <Selector
                    etiqueta="Superficie"
                    nombre="superficie"
                    opciones={SUPERFICIES}
                    valor={actual.aspecto.superficie}
                    alCambiar={(v) => {
                      ponerAspecto("superficie", elegir(SUPERFICIES, v));
                    }}
                    error={textoDelCampo("superficie")}
                    deshabilitado={bloqueadaLaEdicion}
                  />
                  <Selector
                    etiqueta="Esquinas"
                    nombre="esquinas"
                    opciones={ESQUINAS}
                    valor={actual.aspecto.esquinas}
                    alCambiar={(v) => {
                      ponerAspecto("esquinas", elegir(ESQUINAS, v));
                    }}
                    error={textoDelCampo("esquinas")}
                    deshabilitado={bloqueadaLaEdicion}
                  />
                  <Selector
                    etiqueta="Títulos"
                    nombre="titulos"
                    opciones={TITULOS}
                    valor={actual.aspecto.titulos}
                    alCambiar={(v) => {
                      ponerAspecto("titulos", elegir(TITULOS, v));
                    }}
                    error={textoDelCampo("titulos")}
                    deshabilitado={bloqueadaLaEdicion}
                  />
                  <Selector
                    etiqueta="Ingreso"
                    nombre="ingreso"
                    opciones={INGRESOS}
                    valor={actual.aspecto.ingreso}
                    alCambiar={(v) => {
                      ponerAspecto("ingreso", elegir(INGRESOS, v));
                    }}
                    error={textoDelCampo("ingreso")}
                    deshabilitado={bloqueadaLaEdicion}
                  />
                </Pila>
              </fieldset>

              <div className={propios["grupo"]}>
                <p className={propios["leyenda"]}>Vigente desde</p>
                <Texto variante="suave">
                  {ficha.versionVigente === null
                    ? "Todavía no hay una versión vigente."
                    : `Hoy rige la versión ${String(ficha.versionVigente)}.`}{" "}
                  La fecha desde la que rige este borrador se elige al confirmar la versión. Todo lo
                  de acá es borrador y no cambia nada para los clientes hasta confirmar.
                </Texto>
              </div>
            </Pila>
          </form>

          <aside className={propios["previa"]} aria-labelledby="titulo-de-la-previa">
            <h2 id="titulo-de-la-previa" className={propios["tituloDeLaPrevia"]}>
              Así se ve el ingreso de la submarca
            </h2>
            <VistaPreviaDeIngreso
              nombre={actual.nombreVisible}
              colores={actual.colores}
              aspecto={actual.aspecto}
              catalogo={ficha.catalogo}
            />
          </aside>
        </div>
      </div>
      <VentanaDeConfirmacion
        abierta={confirmando}
        alCerrar={() => {
          setConfirmando(false);
        }}
        marcaId={ficha.id}
        nombre={ficha.nombre}
        numero={numeroNuevo}
        hayProgramada={ficha.hayProgramada}
      />
    </>
  );
}

type PropsDeColorEditable = Readonly<{
  etiqueta: string;
  valor: string;
  error: string | undefined;
  deshabilitado: boolean;
  alCambiar: (valor: string) => void;
}>;

/** Un color: el selector nativo y el texto `#rrggbb` van sincronizados. El texto se normaliza al salir del campo. */
function ColorEditable({ etiqueta, valor, error, deshabilitado, alCambiar }: PropsDeColorEditable) {
  const normalizado = normalizarColor(valor);
  const paraElSelector = esColorHex(normalizado) ? normalizado : COLOR_DE_MUESTRA;
  return (
    <div className={propios["color"]}>
      <div
        className={propios["colorTexto"]}
        onBlur={() => {
          if (normalizado !== valor) alCambiar(normalizado);
        }}
      >
        <Campo
          etiqueta={etiqueta}
          nombre={`color-${etiqueta}`}
          autoComplete="off"
          autoCapitalize="off"
          ayuda="Por ejemplo #1f4e79."
          valor={valor}
          alCambiar={alCambiar}
          error={error}
          deshabilitado={deshabilitado}
        />
      </div>
      <input
        type="color"
        className={propios["muestra"]}
        aria-label={`Elegir el color: ${etiqueta}`}
        value={paraElSelector}
        disabled={deshabilitado}
        onChange={(evento) => {
          alCambiar(evento.target.value.toLowerCase());
        }}
      />
    </div>
  );
}

/** El texto de un error que no es de un campo; el de campo se ve junto a su campo. */
function textoGeneral(error: ErrorParaLaPantalla): string {
  switch (error.tipo) {
    case "GENERAL":
    case "PANTALLA_VIEJA":
      return error.texto;
    case "OCULTAR_ACCION":
      return "No tenés permiso para editar submarcas.";
    case "CAMPO":
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return "No pudimos guardar el borrador.";
  }
}

/** El texto de un error de la ficha que se muestra en un aviso, o `null` si no dice nada útil. */
function textoParaAviso(error: ErrorParaLaPantalla): string | null {
  switch (error.tipo) {
    case "CAMPO":
    case "GENERAL":
    case "PANTALLA_VIEJA":
      return error.texto;
    case "OCULTAR_ACCION":
      return "No tenés permiso para confirmar versiones.";
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return null;
  }
}
