"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Insignia } from "../../componentes/Insignia";
import { ErrorDelDetalle } from "../../patrones/ErrorDelDetalle";
import { AvisosDelEnvio } from "../configuracion-fiscal/AvisosDelEnvio";
import { FormularioDeApertura } from "./FormularioDeApertura.cliente";
import { FormularioDeCierre } from "./FormularioDeCierre.cliente";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import {
  ESTADOS_DE_CAJA,
  botonesDeLaCaja,
  cabeceraDeJornada,
  estadoDeLaCaja,
  lineaDeMovimiento,
  resumenDeLaUltimaSesion,
  textoDelEfectivo,
  type CajaDeLaPantalla,
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
}>;

export type PropsDeBloqueDeCaja = Readonly<{
  caja: CajaDeLaPantalla;
  /** Lo que hay que contar, solo con la sesión en cierre; `null` si no la hay o no se pudo leer (entonces va `errorDelConteo`). */
  conteo: ConteoDeLaCaja | null;
  errorDelConteo: ErrorPublico | null;
  permisos: AccionesDeLaPantallaDeCaja;
  acciones: AccionesDelServidorDeCaja;
  /** El largo máximo de la observación: lo dice la primitiva del dato, la pantalla lo recibe. */
  largoMaximoDelTexto: number;
}>;

type Vista = "inicio" | "abrir";

/**
 * Una caja de la sucursal en la pantalla «Caja» del mostrador (maqueta `caja.html`): caja cerrada con el resumen de la última sesión y «Abrir caja»; caja abierta con su jornada, el efectivo
 * esperado, la lista de movimientos (solo lectura) y «Cerrar caja»; y «Contar» con la sesión en cierre. Qué vista se ve lo decide el servidor (el estado de la caja) más lo que la persona
 * abrió (el formulario). Cada acción que cambia datos termina con una recarga (`router.refresh`) y la pantalla no cambia hasta tener la respuesta. Los botones apagados son una ayuda: ocultar
 * no es autorizar, el servidor decide al enviar y su rechazo se muestra como viene. Una diferencia en el arqueo no impide cerrar: se muestra y se deja constancia (criterio permisivo).
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
  const alCambiarElCierre = recargarY(() => {
    setVerConteo(true);
  });

  const sesion = caja.sesion;
  const enCierre = caja.estado === ESTADOS_DE_CAJA.enCierre;
  const botones = botonesDeLaCaja(caja.estado, permisos);
  const cierre = useEnvioDeCaja<object>(
    () =>
      sesion === null
        ? Promise.reject(new Error("Sin sesión"))
        : acciones.iniciarCierre(armarElPedidoDeSesion(sesion.sesionId)),
    alCambiarElCierre,
  );
  const estado = estadoDeLaCaja(caja.estado);

  const contando = enCierre && verConteo;
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
            alCancelarElCierre={alCambiarElCierre}
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
      {!contando && vista === "abrir" && sesion === null ? (
        <div>
          {encabezado(texto({}, "caja.sesion.abrir"))}
          <FormularioDeApertura
            cajaId={caja.cajaId}
            abrir={acciones.abrir}
            puedeAbrir={permisos.abrir}
            alTerminar={alVolverAlInicio}
            alCancelar={() => {
              setVista("inicio");
            }}
          />
        </div>
      ) : null}
      {!contando && (vista === "inicio" || sesion !== null) ? (
        <div className={estilos["bloque"]}>
          <div className={estilos["cabecera"]}>
            <h2 className={estilos["titulo"]}>{caja.nombre}</h2>
            <Insignia tono={estado.tono}>{estado.texto}</Insignia>
          </div>
          {sesion === null ? (
            <>
              {caja.ultimaSesion === null ? null : <UltimaSesion ultima={caja.ultimaSesion} />}
              <div>
                <Boton
                  alTocar={() => {
                    setVista("abrir");
                  }}
                  deshabilitado={!botones.abrir}
                >
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
              <ul className={estilos["lista"]}>
                {sesion.movimientos.map(lineaDeMovimiento).map((l) => (
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
    </section>
  );
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
