"use client";

import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Insignia } from "../../componentes/Insignia";
import { ErrorDelDetalle } from "../../patrones/ErrorDelDetalle";
import { AvisosDelEnvio } from "../configuracion-fiscal/AvisosDelEnvio";
import { FormularioDeAnulacion } from "./FormularioDeAnulacion.cliente";
import { FormularioDeApertura } from "./FormularioDeApertura.cliente";
import { FormularioDeCierre } from "./FormularioDeCierre.cliente";
import {
  FormularioDeMovimiento,
  type ClaseDeMovimientoNuevo,
} from "./FormularioDeMovimiento.cliente";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import {
  ESTADOS_DE_CAJA,
  botonesDeLaCaja,
  cabeceraDeJornada,
  estadoDeLaCaja,
  lineaDeMovimiento,
  medioDelEfectivo,
  resumenDeLaUltimaSesion,
  textoDelEfectivo,
  type CajaDeLaPantalla,
  type LineaDeMovimiento,
} from "./modelo-de-la-caja";
import type { ConteoDeLaCaja } from "./modelo-de-conteo-de-caja";
import { armarElPedidoDeSesion } from "./pedidos-de-caja";
import estilos from "./PantallaDeCaja.module.css";
import { useEnvioDeCaja } from "./useEnvioDeCaja";

/** Las acciones de servidor de la pantalla (`acciones-de-sesion-de-caja.ts`): reciben el pedido tal cual se armó y devuelven la respuesta ya traducida. */
export type AccionesDelServidorDeCaja = Readonly<{
  abrir: (pedido: unknown) => Promise<Respuesta<unknown>>;
  iniciarCierre: (pedido: unknown) => Promise<Respuesta<unknown>>;
  cancelarCierre: (pedido: unknown) => Promise<Respuesta<unknown>>;
  cerrar: (pedido: unknown) => Promise<Respuesta<unknown>>;
  registrarMovimiento: (pedido: unknown) => Promise<Respuesta<unknown>>;
  registrarAjuste: (pedido: unknown) => Promise<Respuesta<unknown>>;
  anular: (pedido: unknown) => Promise<Respuesta<unknown>>;
}>;

export type PropsDeBloqueDeCaja = Readonly<{
  caja: CajaDeLaPantalla;
  /** Lo que hay que contar, solo con la sesión en cierre; `null` si no la hay o no se pudo leer (entonces va `errorDelConteo`). */
  conteo: ConteoDeLaCaja | null;
  errorDelConteo: ErrorPublico | null;
  permisos: AccionesDeLaPantallaDeCaja;
  acciones: AccionesDelServidorDeCaja;
  /** El largo máximo del motivo y de la observación: lo dice la primitiva del dato, la pantalla lo recibe. */
  largoMaximoDelTexto: number;
}>;

type Vista = "inicio" | "abrir" | "ingreso" | "egreso" | "ajuste";

type Anulacion = Readonly<{ linea: LineaDeMovimiento; abierta: boolean; intento: number }>;

/**
 * Una caja de la sucursal en la pantalla «Caja» del mostrador (maqueta `caja.html`): caja cerrada con el resumen de la última sesión y «Abrir caja»; caja abierta con su jornada, el efectivo
 * esperado, «Ingreso», «Egreso» y «Ajuste» y la lista de movimientos con «Anular»; y «Contar» con la sesión en cierre. Qué vista se ve lo decide el servidor (el estado de la caja) más lo
 * que la persona abrió (el formulario). Cada acción que cambia datos termina con una recarga (`router.refresh`) y la pantalla no cambia hasta tener la respuesta. Los botones apagados son una
 * ayuda: ocultar no es autorizar, el servidor decide al enviar y su rechazo se muestra como viene.
 */
export function BloqueDeCaja({
  caja,
  conteo,
  errorDelConteo,
  permisos,
  acciones,
  largoMaximoDelTexto,
}: PropsDeBloqueDeCaja) {
  const router = useRouter();
  const [, empezarTransicion] = useTransition();
  const [vista, setVista] = useState<Vista>("inicio");
  const [verConteo, setVerConteo] = useState(true);
  const [anulacion, setAnulacion] = useState<Anulacion | null>(null);
  const intentos = useRef(0);

  // Recargar y, junto con la respuesta nueva, cambiar de vista: así la pantalla no muestra el estado viejo entre una cosa y la otra.
  const recargarY = (cambio: () => void) => () => {
    empezarTransicion(() => {
      router.refresh();
      cambio();
    });
  };
  const alVolverAlInicio = recargarY(() => {
    setVista("inicio");
  });
  const alIniciarCierre = recargarY(() => {
    setVerConteo(true);
  });
  const alCancelarElCierre = recargarY(() => {
    setVerConteo(true);
  });
  const alAnular = recargarY(() => {
    setAnulacion((previa) => (previa === null ? null : { ...previa, abierta: false }));
  });

  const sesion = caja.sesion;
  const enCierre = caja.estado === ESTADOS_DE_CAJA.enCierre;
  const efectivo = sesion === null ? null : medioDelEfectivo(sesion.lineas);
  const botones = botonesDeLaCaja(caja.estado, efectivo !== null, permisos);
  const cierre = useEnvioDeCaja<object>(
    () =>
      sesion === null
        ? Promise.reject(new Error("Sin sesión"))
        : acciones.iniciarCierre(armarElPedidoDeSesion(sesion.sesionId)),
    alIniciarCierre,
  );
  const estado = estadoDeLaCaja(caja.estado);

  const irA = (v: Vista) => () => {
    setVista(v);
  };
  const alVolver = () => {
    setVista("inicio");
  };

  const contando = enCierre && verConteo;
  const vistaDeFormulario = !contando && vista !== "inicio";
  const encabezado = (titulo: string) => (
    <div className={estilos["cabecera"]}>
      <h2 className={estilos["titulo"]}>{titulo}</h2>
    </div>
  );

  return (
    <section className={estilos["bloque"]} aria-label={caja.nombre}>
      {enCierre && conteo !== null && sesion !== null ? (
        <div hidden={!verConteo}>
          {encabezado(texto({}, "caja.sesion.contar"))}
          <FormularioDeCierre
            conteo={conteo}
            cerrar={acciones.cerrar}
            cancelarCierre={acciones.cancelarCierre}
            puedeCerrar={permisos.cerrar}
            puedeCancelarCierre={permisos.cancelarCierre}
            largoMaximoDeLaObservacion={largoMaximoDelTexto}
            alCerrar={alVolverAlInicio}
            alCancelarElCierre={alCancelarElCierre}
            alVolver={() => {
              setVerConteo(false);
            }}
          />
        </div>
      ) : null}
      {contando && conteo === null ? (
        <div>
          {encabezado(texto({}, "caja.sesion.contar"))}
          {errorDelConteo === null ? null : <ErrorDelDetalle error={errorDelConteo} />}
          <Boton
            variante="secundaria"
            alTocar={() => {
              setVerConteo(false);
            }}
          >
            {texto({}, "fiscal.pantalla.anular_volver")}
          </Boton>
        </div>
      ) : null}
      {vistaDeFormulario && vista === "abrir" ? (
        <div>
          {encabezado(texto({}, "caja.sesion.abrir"))}
          <FormularioDeApertura
            cajaId={caja.cajaId}
            abrir={acciones.abrir}
            puedeAbrir={permisos.abrir}
            alTerminar={alVolverAlInicio}
            alCancelar={alVolver}
          />
        </div>
      ) : null}
      {vistaDeFormulario && vista !== "abrir" && sesion !== null ? (
        <div>
          {encabezado(
            texto(
              {},
              vista === "ingreso"
                ? "caja.movimiento.ingreso"
                : vista === "egreso"
                  ? "caja.movimiento.egreso"
                  : "caja.movimiento.ajuste",
            ),
          )}
          <FormularioDeMovimiento
            sesionId={sesion.sesionId}
            clase={claseDeMovimiento(vista, efectivo)}
            registrarMovimiento={acciones.registrarMovimiento}
            registrarAjuste={acciones.registrarAjuste}
            puedeRegistrar={vista === "ajuste" ? permisos.ajustar : permisos.registrarMovimiento}
            largoMaximoDelMotivo={largoMaximoDelTexto}
            alTerminar={alVolverAlInicio}
            alCancelar={alVolver}
          />
        </div>
      ) : null}
      {!contando && !vistaDeFormulario ? (
        <div className={estilos["bloque"]}>
          <div className={estilos["cabecera"]}>
            <h2 className={estilos["titulo"]}>{caja.nombre}</h2>
            <Insignia tono={estado.tono}>{estado.texto}</Insignia>
          </div>
          {sesion === null ? (
            <>
              {caja.ultimaSesion === null ? null : <UltimaSesion ultima={caja.ultimaSesion} />}
              <div>
                <Boton alTocar={irA("abrir")} deshabilitado={!botones.abrir}>
                  {texto({}, "caja.sesion.abrir")}
                </Boton>
              </div>
            </>
          ) : (
            <>
              <p className={estilos["suave"]}>
                {cabeceraDeJornada(sesion.fechaDeNegocio, sesion.horaDeCorte)}
              </p>
              <p className={estilos["destacado"]}>{textoDelEfectivo(sesion.lineas)}</p>
              <div className={estilos["acciones"]}>
                <Boton
                  variante="secundaria"
                  alTocar={irA("ingreso")}
                  deshabilitado={!botones.ingreso}
                >
                  {texto({}, "caja.movimiento.ingreso")}
                </Boton>
                <Boton
                  variante="secundaria"
                  alTocar={irA("egreso")}
                  deshabilitado={!botones.egreso}
                >
                  {texto({}, "caja.movimiento.egreso")}
                </Boton>
                <Boton
                  variante="secundaria"
                  alTocar={irA("ajuste")}
                  deshabilitado={!botones.ajuste}
                >
                  {texto({}, "caja.movimiento.ajuste")}
                </Boton>
              </div>
              <ul className={estilos["lista"]}>
                {sesion.movimientos
                  .map((m) => lineaDeMovimiento(m, caja.estado))
                  .map((l) => (
                    <li key={l.id} className={estilos["linea"]}>
                      <div className={estilos["renglon"]}>
                        <span className={estilos["nombre"]}>
                          <span>
                            {l.clase}
                            {l.anulado ? (
                              <>
                                {" · "}
                                <strong>{texto({}, "caja.estado.anulado")}</strong>
                              </>
                            ) : null}
                            {l.motivo === null || l.motivo === "" ? null : ` · ${l.motivo}`}
                          </span>
                          <span className={estilos["suave"]}>{l.detalle}</span>
                        </span>
                        <span className={estilos["importe"]}>{l.importe}</span>
                      </div>
                      {l.anular === null ? null : (
                        <div>
                          <Boton
                            variante="secundaria"
                            deshabilitado={l.anular.apagado}
                            etiqueta={l.anular.etiqueta}
                            alTocar={() => {
                              intentos.current += 1;
                              setAnulacion({ linea: l, abierta: true, intento: intentos.current });
                            }}
                          >
                            {texto({}, "caja.accion.anular")}
                          </Boton>
                        </div>
                      )}
                    </li>
                  ))}
              </ul>
              <AvisosDelEnvio
                enCurso={cierre.envio.enCurso}
                incierto={cierre.envio.estado.tipo === "incierto"}
                referenciaIncierta={cierre.referenciaIncierta}
                rechazo={cierre.rechazo}
              />
              <div>
                <Boton
                  enviando={cierre.ocupado}
                  deshabilitado={!botones.cerrar && !cierre.ocupado}
                  alTocar={() => {
                    cierre.enviarCon({});
                  }}
                  motivo={cierre.envio.motivoQueNoPuede}
                >
                  {texto({}, "caja.sesion.cerrar")}
                </Boton>
              </div>
            </>
          )}
        </div>
      ) : null}
      {anulacion === null ? null : (
        <FormularioDeAnulacion
          key={`${anulacion.linea.id}-${String(anulacion.intento)}`}
          abierta={anulacion.abierta}
          movimiento={anulacion.linea}
          anular={acciones.anular}
          largoMaximoDelMotivo={largoMaximoDelTexto}
          alTerminar={alAnular}
          alCerrar={() => {
            setAnulacion({ ...anulacion, abierta: false });
          }}
        />
      )}
    </section>
  );
}

function claseDeMovimiento(
  vista: Vista,
  efectivo: Readonly<{ medioDePagoId: string; cuentaDeCobroId: string | null }> | null,
): ClaseDeMovimientoNuevo {
  if (vista === "ajuste" && efectivo !== null) return { tipo: "ajuste", medio: efectivo };
  return { tipo: vista === "egreso" ? "egreso" : "ingreso" };
}

function UltimaSesion({
  ultima,
}: Readonly<{ ultima: NonNullable<CajaDeLaPantalla["ultimaSesion"]> }>) {
  const resumen = resumenDeLaUltimaSesion(ultima);
  return (
    <div className={estilos["tarjeta"]}>
      <h3 className={estilos["leyenda"]}>{texto({}, "caja.sesion.ultima")}</h3>
      <ul className={estilos["lista"]}>
        {resumen.filas.map((f) => (
          <li key={f.clave} className={estilos["renglon"]}>
            <span className={estilos["nombre"]}>
              <span>{f.cuenta === null ? f.titulo : `${f.titulo} · ${f.cuenta}`}</span>
              <span
                className={`${estilos["suave"]} ${estilos["tono"]}`}
                data-tono={f.tonoDeLaDiferencia ?? undefined}
              >
                {f.secundaria}
              </span>
            </span>
            <span className={estilos["importe"]}>{f.principal}</span>
          </li>
        ))}
      </ul>
      {resumen.observacion === null ? null : (
        <p className={estilos["observacion"]}>{resumen.observacion}</p>
      )}
    </div>
  );
}
