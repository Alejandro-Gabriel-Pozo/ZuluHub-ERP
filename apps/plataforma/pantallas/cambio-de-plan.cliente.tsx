"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Campo } from "../../web/ui/componentes/Campo";
import { Selector } from "../../web/ui/componentes/Selector";
import { Icono } from "../../web/ui/iconos/Icono";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import {
  armarResumen,
  etiquetaDeVersion,
  textoDelError,
  validarCambio,
  type CampoLocal,
} from "../logica/cambio-de-plan";
import { LARGO_MAXIMO_DEL_MOTIVO } from "../logica/entrada-del-plan";
import type { PlanDeEmpresa } from "../logica/plan-de-empresa";
import { fechaLegible, fechaMinimaDeVigencia } from "../logica/vigencia";
import { CasillaDeProgramada } from "./casilla-de-programada.cliente";
import propios from "./plan.module.css";
import submarcas from "./submarcas.module.css";
import { useEnvioDelCambio } from "./usar-envio-del-cambio.cliente";

export type PropsDeCambioDePlan = Readonly<{ plan: PlanDeEmpresa }>;

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
  const { envio, fijada, fijar, referenciaIncierta, ventana } = useEnvioDelCambio(plan.tenantId);
  const hayProgramada = plan.programada !== null;

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
    etiqueta: etiquetaDeVersion(p),
  }));
  const elegida = plan.planesElegibles.find((p) => p.versionDePlanId === elegido);
  // El resumen muestra lo que se envía (o se reintenta), no lo que haya quedado en el selector.
  const delResumen =
    fijada === null
      ? elegida
      : plan.planesElegibles.find((p) => p.versionDePlanId === fijada.versionDePlanId);
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

  function tocarCambiar() {
    if (envio.enCurso) return;
    if (fijada === null) {
      if (!puedeCambiar) return;
      const faltas = validarCambio({
        vigenteDesde,
        motivo,
        hayProgramada,
        reemplaza,
        fechaMinima: fechaMinimaDeVigencia(new Date()),
      });
      setLocales(faltas);
      if (Object.keys(faltas).length > 0) return;
      // Se fijan acá, al primer toque del intento, junto con la clave.
      fijar({
        versionDePlanId: elegido,
        vigenteDesde,
        motivo: motivo.trim(),
        reemplazaProgramada: hayProgramada && reemplaza,
        numeroEsperado: plan.ultimoNumeroDeAsignacion,
      });
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

  const resumen = armarResumen(delResumen, fijada?.vigenteDesde ?? vigenteDesde);

  return (
    <div className={propios["cambio"]}>
      <Selector
        etiqueta="Cambiar a"
        nombre="versionDePlanId"
        textoDeElegir="Elegí un plan"
        opciones={opciones}
        valor={elegido}
        alCambiar={setElegido}
        deshabilitado={plan.planesElegibles.length === 0 || bloqueada}
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
                ayuda={`Hasta ${String(LARGO_MAXIMO_DEL_MOTIVO)} letras.`}
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
              {plan.programada === null ? null : (
                <CasillaDeProgramada
                  programada={plan.programada}
                  marcada={reemplaza}
                  deshabilitada={bloqueada}
                  error={locales.reemplaza}
                  alCambiar={(marcada) => {
                    editar("reemplaza", () => {
                      setReemplaza(marcada);
                    });
                  }}
                />
              )}
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
