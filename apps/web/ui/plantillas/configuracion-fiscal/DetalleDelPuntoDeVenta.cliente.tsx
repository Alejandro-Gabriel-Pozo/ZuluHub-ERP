"use client";

import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton";
import { Insignia } from "../../componentes/Insignia";
import { RegionDeEstado } from "../../patrones/RegionDeEstado";
import { Superposicion } from "../../patrones/Superposicion";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import { ErrorDelDetalle } from "../facturacion/ErrorDelDetalle";
import estilos from "./DetalleDelPuntoDeVenta.module.css";
import type { PuntoDeVentaArmado } from "./modelo-de-puntos-de-venta";
import { useEnvioFijado, type EnvioFijado } from "./useEnvioFijado";

type Accion = (pedido: unknown) => Promise<Respuesta<unknown>>;

export type PropsDeDetalleDelPuntoDeVenta = Readonly<{
  armado: PuntoDeVentaArmado;
  punto: Readonly<{ id: string; activo: boolean; version: number }>;
  /** Las acciones del servidor. Activar y desactivar son idempotentes (`yaEstaba`); el cambio de ambiente lleva la versión que vio la pantalla. */
  activar: Accion;
  desactivar: Accion;
  cambiarAmbiente: Accion;
  /** Adónde lleva «Editar». */
  rutaDeEdicion: string;
}>;

/** Cuando termina bien se pide de nuevo la pantalla; ante «versión desactualizada» también, para ver lo último. */
function useRecargarAlTerminar(envio: EnvioFijado<unknown, unknown>["envio"]): void {
  const router = useRouter();
  const hecho = envio.estado.tipo === "hecho";
  const desactualizado =
    envio.estado.tipo === "rechazado" &&
    envio.estado.rechazo.codigo === "FISCAL_VERSION_DESACTUALIZADA";
  useEffect(() => {
    if (hecho || desactualizado) router.refresh();
  }, [hecho, desactualizado, router]);
}

/**
 * Un punto de venta (PROTO-PV, pantalla 3): su sucursal, si está activo (con «Activar» o «Desactivar»), su ambiente (con «Pasar a
 * producción» mientras esté en pruebas) y «Editar». Cambiar el ambiente pide confirmación en una ventana que avisa que de producción
 * no se vuelve (D-48), sin segundo factor. Cada acción fija su pedido en el primer toque y lo reenvía igual si la respuesta no llegó
 * (`useEnvioFijado`); dos toques seguidos son un solo envío.
 */
export function DetalleDelPuntoDeVenta({
  armado,
  punto,
  activar,
  desactivar,
  cambiarAmbiente,
  rutaDeEdicion,
}: PropsDeDetalleDelPuntoDeVenta) {
  const router = useRouter();
  const idDeLaDescripcion = useId();
  const [ventanaAbierta, setVentanaAbierta] = useState(false);
  const envolturaDelBoton = useRef<HTMLSpanElement>(null);
  const estabaAbierta = useRef(false);

  const estadoDelPunto = useEnvioFijado<{ puntoDeVentaId: string; activar: boolean }, unknown>(
    (p) =>
      p.activar
        ? activar({ puntoDeVentaId: p.puntoDeVentaId })
        : desactivar({ puntoDeVentaId: p.puntoDeVentaId }),
  );
  const ambiente = useEnvioFijado<object, unknown>(cambiarAmbiente);
  useRecargarAlTerminar(estadoDelPunto.envio);
  useRecargarAlTerminar(ambiente.envio);

  const rechazoDelEstado =
    estadoDelPunto.envio.estado.tipo === "rechazado" ? estadoDelPunto.envio.estado.rechazo : null;
  const rechazoDelAmbiente =
    ambiente.envio.estado.tipo === "rechazado" ? ambiente.envio.estado.rechazo : null;
  const ambienteHecho = ambiente.envio.estado.tipo === "hecho";
  const ambienteIncierto = ambiente.envio.estado.tipo === "incierto";
  const estadoIncierto = estadoDelPunto.envio.estado.tipo === "incierto";

  // Hecho el cambio de ambiente: la ventana se cierra (el botón recupera el foco) y el envío vuelve a reposo.
  // Al cerrarse la ventana el foco vuelve al botón que la abrió. `Superposicion` lo restaura al elemento activo de entonces, que en
  // Safari no es el botón (tocar un botón no le da el foco): se fija acá, sin depender de eso.
  useEffect(() => {
    if (estabaAbierta.current && !ventanaAbierta) {
      envolturaDelBoton.current?.querySelector("button")?.focus();
    }
    estabaAbierta.current = ventanaAbierta;
  }, [ventanaAbierta]);
  const reiniciarAmbiente = ambiente.envio.reiniciar;
  if (ambienteHecho && ventanaAbierta) setVentanaAbierta(false);
  useEffect(() => {
    if (ambienteHecho) reiniciarAmbiente();
  }, [ambienteHecho, reiniciarAmbiente]);

  function cerrarLaVentana(): void {
    reiniciarAmbiente();
    setVentanaAbierta(false);
  }

  const ocupado = estadoDelPunto.envio.enCurso || ambiente.envio.enCurso;

  return (
    <Pila separacion={4}>
      <RegionDeEstado urgencia="cortes" ocupada={ocupado}>
        {estadoIncierto || ambienteIncierto ? texto({}, "conexion.verificando") : null}
      </RegionDeEstado>
      {rechazoDelEstado === null ? null : <ErrorDelDetalle error={rechazoDelEstado} />}
      {estadoDelPunto.referenciaIncierta === undefined || !estadoIncierto ? null : (
        <ErrorDelDetalle
          error={{
            codigo: "ERROR_INTERNO",
            clave: "error.inesperado",
            presentacion: "INESPERADO",
            referencia: estadoDelPunto.referenciaIncierta,
          }}
        />
      )}
      <div className={estilos["tarjeta"]}>
        <span className={estilos["destacado"]}>{armado.sucursal}</span>
      </div>
      <div className={estilos["tarjeta"]}>
        <span className={estilos["marca"]}>
          <span className={estilos["rotulo"]}>{armado.activo.rotulo}</span>
          <Insignia tono={armado.activo.tono}>{armado.activo.texto}</Insignia>
        </span>
        <Boton
          variante="secundaria"
          enviando={estadoDelPunto.envio.enCurso}
          textoEnviando={texto({}, "fiscal.pantalla.config_pv_guardando")}
          deshabilitado={!estadoDelPunto.envio.enCurso && estadoDelPunto.envio.bloqueado}
          motivo={estadoDelPunto.envio.motivoQueNoPuede}
          alTocar={() => {
            estadoDelPunto.enviarCon({ puntoDeVentaId: punto.id, activar: !punto.activo });
          }}
        >
          {texto(
            {},
            punto.activo
              ? "fiscal.pantalla.config_pv_desactivar"
              : "fiscal.pantalla.config_pv_activar",
          )}
        </Boton>
      </div>
      <div className={estilos["tarjeta"]}>
        <span className={estilos["marca"]}>
          <span className={estilos["rotulo"]}>{armado.ambiente.rotulo}</span>
          <Insignia tono={armado.ambiente.tono}>{armado.ambiente.texto}</Insignia>
        </span>
        {armado.puedePasarAProduccion ? (
          <span ref={envolturaDelBoton}>
            <Boton
              variante="secundaria"
              alTocar={() => {
                setVentanaAbierta(true);
              }}
            >
              {texto({}, "fiscal.pantalla.config_pv_pasar_a_produccion")}
            </Boton>
          </span>
        ) : null}
      </div>
      {armado.avisoDePruebas === null ? null : <Texto>{armado.avisoDePruebas}</Texto>}
      <div>
        <Boton
          variante="secundaria"
          alTocar={() => {
            router.push(rutaDeEdicion);
          }}
        >
          {texto({}, "fiscal.pantalla.config_pv_editar")}
        </Boton>
      </div>
      <Superposicion
        abierta={ventanaAbierta}
        titulo={texto({}, "fiscal.pantalla.config_pv_ventana_titulo")}
        proposito="confirmar"
        cerrable={!ambiente.envio.enCurso && !ambienteIncierto}
        etiquetaDeCerrar={texto({}, "vidriera.producto.cerrar")}
        alCerrar={cerrarLaVentana}
        idDeLaDescripcion={idDeLaDescripcion}
      >
        <Pila separacion={4}>
          <Texto id={idDeLaDescripcion}>{texto({}, "error.fiscal_ambiente_no_vuelve")}</Texto>
          {rechazoDelAmbiente === null ? null : <ErrorDelDetalle error={rechazoDelAmbiente} />}
          {ambienteIncierto ? <Texto>{texto({}, "conexion.verificando")}</Texto> : null}
          <div className={estilos["botones"]}>
            <Boton
              variante="secundaria"
              deshabilitado={ambiente.envio.enCurso || ambienteIncierto}
              alTocar={cerrarLaVentana}
            >
              {texto({}, "fiscal.pantalla.config_pv_cancelar")}
            </Boton>
            <Boton
              enviando={ambiente.envio.enCurso}
              textoEnviando={texto({}, "fiscal.pantalla.config_pv_guardando")}
              deshabilitado={!ambiente.envio.enCurso && ambiente.envio.bloqueado}
              motivo={ambiente.envio.motivoQueNoPuede}
              alTocar={() => {
                ambiente.enviarCon({
                  puntoDeVentaId: punto.id,
                  ambiente: "PRODUCCION",
                  versionEsperada: punto.version,
                });
              }}
            >
              {texto({}, "fiscal.pantalla.config_pv_pasar_a_produccion")}
            </Boton>
          </div>
        </Pila>
      </Superposicion>
    </Pila>
  );
}
