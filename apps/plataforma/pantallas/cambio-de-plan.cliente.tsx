"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, useTransition } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Campo } from "../../web/ui/componentes/Campo";
import { Selector } from "../../web/ui/componentes/Selector";
import { Icono } from "../../web/ui/iconos/Icono";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { useEnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { cambiarPlanAccion } from "../app/empresas/[id]/plan/acciones";
import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { PlanDeEmpresa } from "../logica/plan-de-empresa";
import { CANCELADO, conSegundoFactor } from "../logica/segundo-factor";
import { fechaLegible, fechaMinimaDeVigencia } from "../logica/vigencia";
import propios from "./plan.module.css";
import submarcas from "./submarcas.module.css";
import { useVentanaDeCodigo } from "./ventana-de-codigo.cliente";

export type PropsDeCambioDePlan = Readonly<{ plan: PlanDeEmpresa }>;

type Fijada = Readonly<{
  versionDePlanId: string;
  vigenteDesde: string;
  motivo: string;
  reemplazaProgramada: boolean;
  numeroEsperado: number | null;
}>;

type Rechazo =
  | Readonly<{ tipo: "ERROR"; error: ErrorParaLaPantalla; referencia: string | undefined }>
  | Readonly<{ tipo: "CANCELADO" }>;

type Hecho = Readonly<{ yaExistia: boolean; vigenteDesde: string }>;
type CampoLocal = "vigenteDesde" | "motivo" | "reemplaza";

/**
 * «Cambiar a» y la ventana de confirmación del cambio de plan. La versión de plan, la fecha, el motivo, la casilla y
 * el número esperado se FIJAN una sola vez, junto con la clave de idempotencia, al primer toque del intento y se
 * reusan en cada reintento. El código del segundo factor se pide en otra ventana, apilada encima.
 */
export function CambioDePlan({ plan }: PropsDeCambioDePlan) {
  const router = useRouter();
  const [, enTransicion] = useTransition();
  const [elegido, setElegido] = useState("");
  const [abierta, setAbierta] = useState(false);
  const [vigenteDesde, setVigenteDesde] = useState("");
  const [motivo, setMotivo] = useState("");
  const [reemplaza, setReemplaza] = useState(false);
  const [locales, setLocales] = useState<Partial<Record<CampoLocal, string>>>({});
  const fijada = useRef<Fijada | null>(null);
  const idDeLaCasilla = useId();
  const { pedirCodigo, ventana } = useVentanaDeCodigo();
  const hayProgramada = plan.programada !== null;

  const envio = useEnvioConClave<Hecho, Rechazo>({
    textos: {
      sinConexion: "Sin conexión. Cuando vuelva, podés cambiar el plan.",
      verificando: "Verificando si el cambio de plan quedó registrado…",
    },
    enviar: async (clave) => {
      const base = fijada.current;
      if (base === null) throw new Error("Sin pedido fijado");
      // Lo que lance (red cortada) es «incierto» y se reintenta con la misma clave y los mismos valores.
      const resultado = await conSegundoFactor({
        intento: () =>
          cambiarPlanAccion({ ...base, claveDeIdempotencia: clave, tenantId: plan.tenantId }),
        pideCodigo: (r) => !r.ok && r.error.tipo === "SEGUNDO_FACTOR",
        pedirCodigo,
      });
      fijada.current = null;
      if (resultado === CANCELADO) return { ok: false, rechazo: { tipo: "CANCELADO" } };
      if (resultado.ok) {
        return {
          ok: true,
          valor: { yaExistia: resultado.dato.yaExistia, vigenteDesde: base.vigenteDesde },
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
  const errorDeVersion =
    errorDeServidor?.tipo === "CAMPO" && errorDeServidor.campo === "versionDePlanId"
      ? errorDeServidor.texto
      : undefined;

  // Al cambiarse, la pantalla de atrás se vuelve a pedir al servidor para mostrar el plan nuevo.
  useEffect(() => {
    if (!hecho) return;
    enTransicion(() => {
      router.refresh();
    });
  }, [hecho, router]);

  const opciones = plan.planesElegibles.map((p) => ({
    valor: p.versionDePlanId,
    etiqueta: p.esActual ? `${p.nombre} (actual)` : p.nombre,
  }));
  const elegida = plan.planesElegibles.find((p) => p.versionDePlanId === elegido);
  const puedeCambiar = elegida !== undefined && !elegida.esActual;
  const motivoQueNoPuede =
    elegida === undefined
      ? "Elegí un plan para poder cambiarlo."
      : elegida.esActual
        ? "Elegí un plan distinto del actual."
        : undefined;

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

  function tocarCambiar() {
    if (envio.enCurso) return;
    if (fijada.current === null) {
      if (!puedeCambiar) return;
      const faltas = validar();
      setLocales(faltas);
      if (Object.keys(faltas).length > 0) return;
      // Se fijan acá, al primer toque del intento, junto con la clave.
      fijada.current = {
        versionDePlanId: elegido,
        vigenteDesde,
        motivo: motivo.trim(),
        reemplazaProgramada: hayProgramada && reemplaza,
        numeroEsperado: plan.ultimoNumeroDeAsignacion,
      };
    }
    envio.enviar();
  }

  function cerrar() {
    if (hecho) {
      envio.reiniciar();
      setElegido("");
      setVigenteDesde("");
      setMotivo("");
      setReemplaza(false);
      setLocales({});
    }
    setAbierta(false);
  }

  const resumen = `Se cambia a ${elegida?.nombre ?? "el plan elegido"}, vigente desde ${
    vigenteDesde === "" ? "la fecha que elijas" : fechaLegible(vigenteDesde)
  }.`;

  return (
    <div className={propios["cambio"]}>
      <Selector
        etiqueta="Cambiar a"
        nombre="versionDePlanId"
        textoDeElegir="Elegí un plan"
        opciones={opciones}
        valor={elegido}
        alCambiar={setElegido}
        deshabilitado={plan.planesElegibles.length === 0}
      />
      <Boton
        alTocar={() => {
          setAbierta(true);
        }}
        deshabilitado={!puedeCambiar}
        motivo={motivoQueNoPuede}
      >
        Cambiar de plan…
      </Boton>
      <Superposicion
        abierta={abierta}
        titulo="Cambiar de plan"
        proposito="confirmar"
        cerrable={!envio.enCurso}
        etiquetaDeCerrar="Cerrar"
        alCerrar={cerrar}
      >
        {estado.tipo === "hecho" ? (
          <Pila separacion={4}>
            <Aviso tono="exito">
              <Texto>
                {estado.valor.yaExistia
                  ? "Este cambio ya estaba hecho; no se duplicó."
                  : `Plan cambiado; rige desde ${fechaLegible(estado.valor.vigenteDesde)}.`}
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
              tocarCambiar();
            }}
          >
            <Pila separacion={4}>
              {errorDeServidor === null || textoGeneral === null ? null : (
                <Aviso tono={errorDeServidor.tipo === "OCULTAR_ACCION" ? "aviso" : "peligro"}>
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
                  <Texto>Cancelaste el cambio. El plan no se modificó.</Texto>
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
                      "No supimos si el cambio quedó registrado. Reintentá: no se va a duplicar."}
                  </Texto>
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
                <div className={submarcas["casillaCaja"]}>
                  <label className={submarcas["casilla"]}>
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
                  <p className={submarcas["ayuda"]}>
                    Ya hay un cambio de plan programado para esta empresa. Al confirmar este, lo
                    reemplaza.
                  </p>
                  {locales.reemplaza === undefined ? null : (
                    <p id={idDeLaCasilla} className={submarcas["error"]}>
                      <Icono clave="estado-peligro" tamano="chico" decorativo />
                      <span>{locales.reemplaza}</span>
                    </p>
                  )}
                </div>
              ) : null}
              <Texto>{resumen}</Texto>
              {errorDeVersion === undefined ? null : (
                <p className={submarcas["error"]}>
                  <Icono clave="estado-peligro" tamano="chico" decorativo />
                  <span>{errorDeVersion}</span>
                </p>
              )}
              <Boton
                tipo="submit"
                ancho="completo"
                enviando={envio.enCurso}
                textoEnviando="Guardando…"
                deshabilitado={!envio.enCurso && envio.bloqueado}
                motivo={envio.motivoQueNoPuede}
              >
                Guardar cambio de plan
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
    </div>
  );
}

/** El texto de un error que no es de los campos de la ventana. */
function textoDelError(error: ErrorParaLaPantalla): string | null {
  switch (error.tipo) {
    case "GENERAL":
    case "PANTALLA_VIEJA":
      return error.texto;
    case "CAMPO":
      return error.campo === "vigenteDesde" ||
        error.campo === "motivo" ||
        error.campo === "versionDePlanId"
        ? null
        : error.texto;
    case "OCULTAR_ACCION":
      return "No tenés permiso para cambiar el plan.";
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return "No pudimos cambiar el plan.";
  }
}
