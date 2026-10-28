"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Campo } from "../../web/ui/componentes/Campo";
import { Icono } from "../../web/ui/iconos/Icono";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { useEnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { confirmarVersionAccion } from "../app/submarcas/acciones";
import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import { CANCELADO, conSegundoFactor } from "../logica/segundo-factor";
import { fechaLegible, fechaMinimaDeVigencia } from "../logica/vigencia";
import propios from "./submarcas.module.css";
import { useVentanaDeCodigo } from "./ventana-de-codigo.cliente";

export type PropsDeVentanaDeConfirmacion = Readonly<{
  abierta: boolean;
  alCerrar: () => void;
  marcaId: string;
  nombre: string;
  /** El número de la versión que nace al confirmar (la siguiente a la vigente). */
  numero: number;
  /** Hay un cambio programado: confirmar exige reemplazarlo. */
  hayProgramada: boolean;
  /** La `version` del borrador que se va a confirmar (la de la ficha); `null` si no hay borrador y no se puede confirmar. */
  versionDelBorrador: number | null;
}>;

type Fijada = Readonly<{
  versionEsperada: number;
  vigenteDesde: string;
  motivo: string;
  reemplazaProgramada: boolean;
}>;

type Rechazo =
  | Readonly<{ tipo: "ERROR"; error: ErrorParaLaPantalla; referencia: string | undefined }>
  | Readonly<{ tipo: "CANCELADO" }>;

type Hecho = Readonly<{ numero: number; vigenteDesde: string }>;
type CampoLocal = "vigenteDesde" | "motivo" | "reemplaza";

/**
 * La ventana de «Confirmar versión». La versión del borrador, la fecha, el motivo y la casilla se FIJAN una sola vez,
 * junto con la clave de idempotencia, al primer toque del intento y se reusan en cada reintento (si cambiaran, el
 * servidor respondería CLAVE_REUTILIZADA, aunque la ficha de atrás se haya refrescado con otra versión). El código del segundo factor se pide en otra ventana, apilada encima.
 */
export function VentanaDeConfirmacion({
  abierta,
  alCerrar,
  marcaId,
  nombre,
  numero,
  hayProgramada,
  versionDelBorrador,
}: PropsDeVentanaDeConfirmacion) {
  const router = useRouter();
  const [, enTransicion] = useTransition();
  const [vigenteDesde, setVigenteDesde] = useState("");
  const [motivo, setMotivo] = useState("");
  const [reemplaza, setReemplaza] = useState(false);
  const [locales, setLocales] = useState<Partial<Record<CampoLocal, string>>>({});
  const fijada = useRef<Fijada | null>(null);
  const [versionDelIntento, setVersionDelIntento] = useState<number | null>(null);
  const [referenciaIncierta, setReferenciaIncierta] = useState<string | undefined>(undefined);
  const idDeLaCasilla = useId();
  const { pedirCodigo, ventana } = useVentanaDeCodigo();

  const envio = useEnvioConClave<Hecho, Rechazo>({
    textos: {
      sinConexion: "Sin conexión. Cuando vuelva, podés confirmar la versión.",
      verificando: "Verificando si la confirmación quedó registrada…",
    },
    enviar: async (clave) => {
      const base = fijada.current;
      if (base === null) throw new Error("Sin pedido fijado");
      // Lo que lance (red cortada) es «incierto» y se reintenta con la misma clave y los mismos valores.
      const resultado = await conSegundoFactor({
        intento: () => confirmarVersionAccion({ ...base, claveDeIdempotencia: clave, marcaId }),
        pideCodigo: (r) => !r.ok && r.error.tipo === "SEGUNDO_FACTOR",
        pedirCodigo,
      });
      if (resultado === CANCELADO) {
        fijada.current = null;
        setReferenciaIncierta(undefined);
        return { ok: false, rechazo: { tipo: "CANCELADO" } };
      }
      // Un error inesperado NO es una respuesta definitiva: puede que la versión haya quedado confirmada. Se lanza
      // para que el intento quede «incierto» y se reintente con la MISMA clave y los MISMOS valores (no se toca
      // `fijada`); la referencia `PD-…` se guarda para mostrarla junto al aviso.
      if (!resultado.ok && resultado.error.tipo === "INESPERADO") {
        setReferenciaIncierta(resultado.referencia);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      fijada.current = null;
      setReferenciaIncierta(undefined);
      if (resultado.ok) {
        return {
          ok: true,
          valor: { numero: resultado.dato.numero, vigenteDesde: base.vigenteDesde },
        };
      }
      return {
        ok: false,
        rechazo: { tipo: "ERROR", error: resultado.error, referencia: resultado.referencia },
      };
    },
  });

  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueada = envio.enCurso || incierto;
  const hecho = estado.tipo === "hecho";
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const errorDeServidor = rechazo?.tipo === "ERROR" ? rechazo.error : null;
  const textoGeneral = errorDeServidor === null ? null : textoDelError(errorDeServidor);
  // Una submarca retirada no se puede confirmar: no hay nada que reintentar.
  const retirada = errorDeServidor?.tipo === "MARCA_RETIRADA";

  // Al confirmarse, la pantalla de atrás se vuelve a pedir al servidor para mostrar la versión nueva.
  useEffect(() => {
    if (!hecho) return;
    enTransicion(() => {
      router.refresh();
    });
  }, [hecho, router]);

  function errorDe(campo: "vigenteDesde" | "motivo"): string | undefined {
    if (locales[campo] !== undefined) return locales[campo];
    if (errorDeServidor?.tipo === "CAMPO" && errorDeServidor.campo === campo) {
      return errorDeServidor.texto;
    }
    return undefined;
  }

  function editar(campo: CampoLocal, poner: () => void) {
    poner();
    setLocales((previo) => {
      const resto = { ...previo };
      delete resto[campo];
      return resto;
    });
    envio.reiniciar();
  }

  function validar(): Partial<Record<CampoLocal, string>> {
    const faltas: Partial<Record<CampoLocal, string>> = {};
    const minima = fechaMinimaDeVigencia(new Date());
    if (vigenteDesde === "") faltas.vigenteDesde = "Elegí desde qué fecha rige.";
    else if (vigenteDesde < minima) {
      faltas.vigenteDesde = `La fecha tiene que ser desde mañana: ${fechaLegible(minima)}.`;
    }
    if (motivo.trim() === "") faltas.motivo = "Escribí el motivo del cambio.";
    if (hayProgramada && !reemplaza) {
      faltas.reemplaza = "Tildá la casilla para reemplazar el cambio programado.";
    }
    return faltas;
  }

  function tocarConfirmar() {
    if (envio.enCurso) return;
    if (fijada.current === null) {
      if (versionDelBorrador === null) return;
      const faltas = validar();
      setLocales(faltas);
      if (Object.keys(faltas).length > 0) return;
      // Se fijan acá, al primer toque del intento, junto con la clave.
      setVersionDelIntento(versionDelBorrador);
      fijada.current = {
        versionEsperada: versionDelBorrador,
        vigenteDesde,
        motivo: motivo.trim(),
        reemplazaProgramada: hayProgramada && reemplaza,
      };
    }
    envio.enviar();
  }

  function cerrar() {
    if (hecho) {
      envio.reiniciar();
      setVigenteDesde("");
      setMotivo("");
      setReemplaza(false);
      setLocales({});
    }
    alCerrar();
  }

  // Con un intento en marcha se muestra la versión fijada, aunque la ficha de atrás ya traiga otra.
  const versionAConfirmar = bloqueada
    ? (versionDelIntento ?? versionDelBorrador)
    : versionDelBorrador;
  const sinBorrador = versionDelBorrador === null && !bloqueada;
  const resumen = `Se confirma la versión ${String(numero)} de ${nombre}, vigente desde ${
    vigenteDesde === "" ? "la fecha que elijas" : fechaLegible(vigenteDesde)
  }.`;

  return (
    <>
      <Superposicion
        abierta={abierta}
        titulo="Confirmar versión"
        proposito="confirmar"
        cerrable={!envio.enCurso}
        etiquetaDeCerrar="Cerrar"
        alCerrar={cerrar}
      >
        {estado.tipo === "hecho" ? (
          <Pila separacion={4}>
            <Aviso tono="exito">
              <Texto>
                Versión {estado.valor.numero} confirmada; rige desde{" "}
                {fechaLegible(estado.valor.vigenteDesde)}.
              </Texto>
            </Aviso>
            <Boton ancho="completo" alTocar={cerrar}>
              Cerrar
            </Boton>
          </Pila>
        ) : (
          <form
            noValidate
            onSubmit={(evento) => {
              evento.preventDefault();
              tocarConfirmar();
            }}
          >
            <Pila separacion={4}>
              {errorDeServidor === null || textoGeneral === null ? null : (
                <Aviso tono={tonoDelError(errorDeServidor)}>
                  <Texto>{textoGeneral}</Texto>
                  {errorDeServidor.tipo === "INESPERADO" &&
                  rechazo?.tipo === "ERROR" &&
                  rechazo.referencia !== undefined ? (
                    <Texto>Código de referencia: {rechazo.referencia}</Texto>
                  ) : null}
                  {errorDeServidor.tipo === "PANTALLA_VIEJA" ? (
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
              {rechazo?.tipo === "CANCELADO" ? (
                <Aviso tono="info">
                  <Texto>Cancelaste la confirmación. La versión no se confirmó.</Texto>
                </Aviso>
              ) : null}
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
                      "No supimos si la confirmación quedó registrada. Reintentá: no se va a duplicar."}
                  </Texto>
                  {referenciaIncierta === undefined ? null : (
                    <Texto>Código de referencia: {referenciaIncierta}</Texto>
                  )}
                </Aviso>
              ) : null}
              <Campo
                etiqueta="Vigente desde"
                nombre="vigenteDesde"
                tipo="date"
                obligatorio="obligatorio"
                ayuda={`Desde mañana (${fechaLegible(fechaMinimaDeVigencia(new Date()))}).`}
                valor={vigenteDesde}
                alCambiar={(v) => {
                  editar("vigenteDesde", () => {
                    setVigenteDesde(v);
                  });
                }}
                error={errorDe("vigenteDesde")}
                deshabilitado={bloqueada}
              />
              <Campo
                etiqueta="Motivo del cambio"
                nombre="motivo"
                obligatorio="obligatorio"
                autoComplete="off"
                valor={motivo}
                alCambiar={(v) => {
                  editar("motivo", () => {
                    setMotivo(v);
                  });
                }}
                error={errorDe("motivo")}
                deshabilitado={bloqueada}
              />
              {hayProgramada ? (
                <div className={propios["casillaCaja"]}>
                  <label className={propios["casilla"]}>
                    <input
                      type="checkbox"
                      checked={reemplaza}
                      disabled={bloqueada}
                      aria-required="true"
                      aria-invalid={locales.reemplaza === undefined ? undefined : true}
                      aria-describedby={locales.reemplaza === undefined ? undefined : idDeLaCasilla}
                      onChange={(evento) => {
                        editar("reemplaza", () => {
                          setReemplaza(evento.target.checked);
                        });
                      }}
                    />
                    <span>Reemplazar el cambio programado (obligatorio)</span>
                  </label>
                  <p className={propios["ayuda"]}>
                    Ya hay un cambio programado para esta submarca. Al confirmar esta versión, lo
                    reemplaza.
                  </p>
                  {locales.reemplaza === undefined ? null : (
                    <p id={idDeLaCasilla} className={propios["error"]}>
                      <Icono clave="estado-peligro" tamano="chico" decorativo />
                      <span>{locales.reemplaza}</span>
                    </p>
                  )}
                </div>
              ) : null}
              {versionAConfirmar === null ? null : (
                <Texto>Vas a confirmar el borrador n.º {versionAConfirmar}.</Texto>
              )}
              <Texto>{resumen}</Texto>
              <Boton
                tipo="submit"
                ancho="completo"
                enviando={envio.enCurso}
                textoEnviando="Confirmando…"
                deshabilitado={!envio.enCurso && (envio.bloqueado || retirada || sinBorrador)}
                motivo={envio.motivoQueNoPuede}
              >
                Confirmar versión
              </Boton>
              <Boton
                variante="secundaria"
                ancho="completo"
                deshabilitado={envio.enCurso}
                alTocar={cerrar}
              >
                Cancelar
              </Boton>
            </Pila>
          </form>
        )}
      </Superposicion>
      {/* Aparte de la ventana y de su formulario: se abre encima cuando el servidor pide el segundo factor. */}
      {ventana}
    </>
  );
}

const tonoDelError = (error: ErrorParaLaPantalla): "aviso" | "peligro" =>
  error.tipo === "OCULTAR_ACCION" || error.tipo === "MARCA_RETIRADA" ? "aviso" : "peligro";

/** El texto de un error que no es de los campos de la ventana. */
function textoDelError(error: ErrorParaLaPantalla): string | null {
  switch (error.tipo) {
    case "GENERAL":
    case "PANTALLA_VIEJA":
    case "MARCA_RETIRADA":
      return error.texto;
    case "CAMPO":
      return error.campo === "vigenteDesde" || error.campo === "motivo" ? null : error.texto;
    case "OCULTAR_ACCION":
      return "No tenés permiso para confirmar versiones.";
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return "No pudimos confirmar la versión.";
  }
}
