"use client";

import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import {
  PRODUCTOS_PARA_BUSCAR,
  filtrarSecciones,
} from "../../../../../src/capacidades/experiencia/vidriera/busqueda";
import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import type {
  VistaDeVidriera,
  VistaDeProducto,
} from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { Boton } from "../../componentes/Boton";
import { BuscarEnVidriera } from "./BuscarEnVidriera";
import { ControlDeLetra } from "./ControlDeLetra";
import escala from "./EscalaDeLetra.module.css";
import { BotonFlotanteDeSecciones, IndiceDeSecciones } from "./IndiceDeSecciones";
import { ListaDeVidriera } from "./ListaDeVidriera";
import estilos from "./PlantillaDeVidriera.module.css";
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
    >
      <header className={estilos["cabecera"]}>
        <p className={estilos["rubro"]}>{vista.rubro}</p>
        <h1 className={estilos["nombre"]}>{vista.nombre}</h1>
        {vista.lugar === null ? null : <p className={estilos["lugar"]}>{vista.lugar}</p>}
      </header>

      <div className={estilos["herramientas"]} data-busqueda={conBusqueda ? "si" : "no"}>
        {hidratada ? (
          <>
            <ControlDeLetra paso={paso} alElegir={cambiarPaso} textos={textos} />
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

      <TarjetaDeProducto
        producto={abierto === null ? null : (productos.get(abierto) ?? null)}
        textos={textos}
        alCerrar={cerrar}
      />
    </main>
  );
}
