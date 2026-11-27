"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { puedeMontarseElLibro } from "../../../../../src/capacidades/experiencia/vidriera/capa-de-libro";
import {
  PRODUCTOS_PARA_BUSCAR,
  filtrarSecciones,
} from "../../../../../src/capacidades/experiencia/vidriera/busqueda";
import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import type {
  VistaDeVidriera,
  VistaDeProducto,
} from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { Boton } from "../../componentes/Boton.cliente";
import { BuscarEnVidriera } from "./BuscarEnVidriera";
import { ControlDeLetra } from "./ControlDeLetra";
import escala from "./EscalaDeLetra.module.css";
import { CabeceraDeLaCarta } from "./CabeceraDeLaCarta";
import { atributosDeLaCara } from "./IdentidadDeLaCarta";
import { BotonFlotanteDeSecciones, IndiceDeSecciones } from "./IndiceDeSecciones";
import { ListaDeVidriera } from "./ListaDeVidriera";
import estilos from "./PlantillaDeVidriera.module.css";
import { PlantillaLibro } from "./PlantillaLibro";
import { TarjetaDeProducto } from "./TarjetaDeProducto";
import { usePasoDeLetra } from "./usePasoDeLetra";

export type PropsDePlantillaDeVidriera = Readonly<{
  vista: VistaDeVidriera;
  textos: TextosDeVidriera;
}>;

const nadie = () => () => {};

/** Falso en el servidor y en la primera pintura; verdadero cuando ya hay JavaScript funcionando. */
function useHidratada(): boolean {
  return useSyncExternalStore(
    nadie,
    () => true,
    () => false,
  );
}

/** Lo que el navegador informa de la conexión; no está en los tipos de `lib.dom`. */
type ConexionDelNavegador = Readonly<{ saveData?: boolean; effectiveType?: string }>;

/**
 * ¿Se puede montar el Libro? Se mide una sola vez, cuando ya hay JavaScript: si llegó tarde, hay ahorro de datos,
 * red lenta o movimiento reducido, la carta se queda en Lista (03 §4.4).
 */
function medirSiPuedeMontarseElLibro(): boolean {
  const conexion = (navigator as Navigator & { connection?: ConexionDelNavegador }).connection;
  return puedeMontarseElLibro({
    msHastaElScript: performance.now(),
    ahorroDeDatos: conexion?.saveData === true,
    tipoDeRed: conexion?.effectiveType ?? null,
    movimientoReducido: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  });
}

/** El segmento del producto que dejó `history.pushState` al abrir su tarjeta, o `null`. */
function segmentoGuardado(estado: unknown): string | null {
  if (typeof estado !== "object" || estado === null || !("zhTarjeta" in estado)) return null;
  return typeof estado.zhTarjeta === "string" ? estado.zhTarjeta : null;
}

/**
 * La plantilla de la carta (capa 5, modelo Lista): cabecera, herramientas («Letra» y «Buscar»), índice, la
 * lista de secciones, el botón flotante «Secciones» y la tarjeta del producto. Todo el HTML sale del servidor
 * y se lee sin JavaScript; con él, el toque abre la tarjeta sin perder el lugar (la dirección del producto
 * entra al historial y «Atrás» la cierra), se filtra con la búsqueda y la letra se puede agrandar.
 *
 * La letra parte de `letra_base` de la carta y el paso de «Letra» se suma encima (D10).
 */
export function PlantillaDeVidriera({ vista, textos }: PropsDePlantillaDeVidriera) {
  const [paso, cambiarPaso] = usePasoDeLetra();
  const hidratada = useHidratada();
  const [consulta, setConsulta] = useState("");
  const [abierto, setAbierto] = useState<string | null>(null);
  // `null` hasta medir; después, si el entorno deja montar el Libro. Solo importa si la carta es del modelo Libro.
  const [libroPosible, setLibroPosible] = useState<boolean | null>(null);
  // Lo que eligió quien mira con «Ver como lista» / «Ver como libro»; no se guarda: cada visita parte de cero.
  const [eleccion, setEleccion] = useState<"LIBRO" | "LISTA" | null>(null);
  useEffect(() => {
    if (vista.modelo === "LIBRO") setLibroPosible(medirSiPuedeMontarseElLibro());
  }, [vista.modelo]);
  const esDeLibro = vista.modelo === "LIBRO";
  const enLibro =
    esDeLibro && hidratada && (eleccion ?? (libroPosible === true ? "LIBRO" : "LISTA")) === "LIBRO";

  const productos = useMemo(
    () => new Map(vista.secciones.flatMap((s) => s.productos).map((p) => [p.segmento, p])),
    [vista],
  );
  const conBusqueda = vista.totalDeProductos > PRODUCTOS_PARA_BUSCAR;
  const filtrado = useMemo(
    () => filtrarSecciones(vista.secciones, consulta),
    [vista.secciones, consulta],
  );
  const buscando = consulta.trim() !== "";

  // «Atrás» y «Adelante» del navegador abren y cierran la tarjeta: la dirección del producto es del historial.
  useEffect(() => {
    function alMoverseEnElHistorial() {
      setAbierto(segmentoGuardado(window.history.state));
    }
    window.addEventListener("popstate", alMoverseEnElHistorial);
    return () => {
      window.removeEventListener("popstate", alMoverseEnElHistorial);
    };
  }, []);

  function abrir(producto: VistaDeProducto) {
    window.history.pushState({ zhTarjeta: producto.segmento }, "", producto.href);
    setAbierto(producto.segmento);
  }

  function cerrar() {
    // Si la tarjeta entró al historial, se sale por «Atrás» (queda la carta tal cual estaba); si no, se cierra.
    if (segmentoGuardado(window.history.state) === null) setAbierto(null);
    else window.history.back();
  }

  const anuncio = !buscando
    ? ""
    : filtrado.total === 0
      ? textos.buscarSinResultados.replace("{texto}", () => consulta.trim())
      : filtrado.total === 1
        ? textos.buscarUnResultado
        : textos.buscarResultados.replace("{cantidad}", () => String(filtrado.total));

  return (
    <main
      className={[escala["escala"], estilos["raiz"]].join(" ")}
      data-letra-base={vista.letraBase}
      data-letra={paso}
      {...atributosDeLaCara(vista.identidad)}
    >
      {enLibro ? (
        <PlantillaLibro
          vista={vista}
          textos={textos}
          paso={paso}
          alElegirLetra={cambiarPaso}
          alAbrir={abrir}
          alVerComoLista={() => {
            setEleccion("LISTA");
          }}
        />
      ) : (
        <>
          <CabeceraDeLaCarta vista={vista} />
          <div
            className={estilos["herramientas"]}
            data-busqueda={conBusqueda ? "si" : "no"}
            data-libro={esDeLibro ? "si" : undefined}
          >
            {hidratada ? (
              <>
                <ControlDeLetra paso={paso} alElegir={cambiarPaso} textos={textos} />
                {esDeLibro ? (
                  <Boton
                    variante="secundaria"
                    alTocar={() => {
                      setEleccion("LIBRO");
                    }}
                  >
                    {textos.libroVerComoLibro}
                  </Boton>
                ) : null}
                {conBusqueda ? (
                  <BuscarEnVidriera
                    consulta={consulta}
                    alCambiar={setConsulta}
                    anuncio={anuncio}
                    textos={textos}
                  />
                ) : null}
              </>
            ) : null}
          </div>

          {filtrado.secciones.length === 0 ? null : (
            <IndiceDeSecciones secciones={filtrado.secciones} textos={textos} />
          )}
          <ListaDeVidriera secciones={filtrado.secciones} textos={textos} alAbrir={abrir} />
          {buscando && filtrado.total === 0 ? (
            <div className={estilos["vacio"]}>
              <Boton
                variante="secundaria"
                alTocar={() => {
                  setConsulta("");
                  // El botón desaparece al limpiar: el foco vuelve al campo, que es donde se sigue.
                  document.querySelector<HTMLInputElement>('[role="search"] input')?.focus();
                }}
              >
                {textos.buscarLimpiar}
              </Boton>
            </div>
          ) : null}
          <BotonFlotanteDeSecciones textos={textos} />
          <p className={estilos["pie"]}>{textos.precioConIva}</p>
        </>
      )}

      <TarjetaDeProducto
        producto={abierto === null ? null : (productos.get(abierto) ?? null)}
        textos={textos}
        alCerrar={cerrar}
      />
    </main>
  );
}
