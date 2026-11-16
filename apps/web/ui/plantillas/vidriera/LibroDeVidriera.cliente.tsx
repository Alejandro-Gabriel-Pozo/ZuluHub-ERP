"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import {
  anclaDePagina,
  armarLibro,
  indiceDeAncla,
  moverse,
  navegacionEn,
  paginaEn,
  INDICE_DEL_INDICE,
} from "../../../../../src/capacidades/experiencia/vidriera/libro";
import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import type { VistaDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { Boton } from "../../componentes/Boton.cliente";
import { RegionDeEstado } from "../../patrones/RegionDeEstado";
import { Compartir } from "./Compartir.cliente";
import { ControlDeLetra } from "./ControlDeLetra";
import escala from "./EscalaDeLetra.module.css";
import { ListaDeVidriera } from "./ListaDeVidriera";
import estilos from "./LibroDeVidriera.module.css";
import { usePasoDeLetra } from "./usePasoDeLetra";

export type PropsDeLibroDeVidriera = Readonly<{
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

/** «Sección {n} de {m}» con los números como TEXTO (nunca como parte de un patrón). */
function contador(texto: string, n: number, m: number): string {
  return texto.replace("{n}", () => String(n)).replace("{m}", () => String(m));
}

function Portada({ vista }: Readonly<{ vista: VistaDeVidriera }>) {
  return (
    <header className={estilos["portada"]}>
      {vista.rubro === null ? null : <p className={estilos["rubro"]}>{vista.rubro}</p>}
      <h1 tabIndex={-1} className={estilos["nombre"]}>
        {vista.nombre}
      </h1>
      {vista.lugar === null ? null : <p className={estilos["lugar"]}>{vista.lugar}</p>}
      {/* El mensaje de portada es libre y opcional; vacío, queda el adorno de siempre. */}
      <p
        className={estilos["final"]}
        aria-hidden={vista.mensajeDePortada === null ? "true" : undefined}
      >
        {vista.mensajeDePortada ?? "✦"}
      </p>
    </header>
  );
}

/**
 * La carta en modelo Libro (carta-libro-especificacion §4 a §6): portada, índice y una página por sección. Es una
 * CAPA sobre la misma vista de la Lista y reusa sus piezas (`ListaDeVidriera`, `ItemDeVidriera`, `Compartir`,
 * `ControlDeLetra`): ninguna regla de lectura de productos se repite acá.
 *
 * Antes de hidratar (y sin JavaScript) se dibuja TODO el contenido como la Lista (portada, índice de anclas y todas
 * las secciones): es lo que lee un buscador y quien no tiene JavaScript. Con JavaScript se muestra una página por
 * vez: flechas, botón «Índice», teclas ← → Inicio y Fin, y el fragmento `#<sección>` (se reemplaza, no se apila:
 * «Atrás» sale de la carta). El foco pasa al título de la página nueva y el contador se anuncia («Sección n de m»).
 *
 * Aceptado por el dueño (16/11/2026, Q6 A y supuestos de la especificación): el control «Letra» vive en la página del índice (Q6 A) y no hay buscador.
 */
export function LibroDeVidriera({ vista, textos }: PropsDeLibroDeVidriera) {
  const [paso, cambiarPaso] = usePasoDeLetra();
  const hidratada = useHidratada();
  const libro = useMemo(() => armarLibro(vista.secciones), [vista.secciones]);
  const [indice, setIndice] = useState(0);
  const contenedor = useRef<HTMLDivElement | null>(null);
  const [mueveFoco, setMueveFoco] = useState(false);

  // Al hidratar, la dirección manda: un `#<sección>` abre esa página; uno desconocido, la portada (no adivina).
  useEffect(() => {
    function leerFragmento() {
      const encontrado = indiceDeAncla(libro, decodificar(window.location.hash));
      setIndice(encontrado ?? 0);
    }
    leerFragmento();
    window.addEventListener("hashchange", leerFragmento);
    return () => {
      window.removeEventListener("hashchange", leerFragmento);
    };
  }, [libro]);

  useEffect(() => {
    if (mueveFoco) contenedor.current?.querySelector<HTMLElement>("h1, h2")?.focus();
  }, [indice, mueveFoco]);

  function ir(destino: number) {
    const pagina = paginaEn(libro, destino);
    const ancla = anclaDePagina(pagina);
    // Se reemplaza la dirección: cada página no suma una entrada al historial.
    window.history.replaceState(
      window.history.state,
      "",
      ancla === null ? window.location.pathname + window.location.search : `#${ancla}`,
    );
    setMueveFoco(true);
    setIndice(destino);
  }

  const navegacion = navegacionEn(libro, indice);
  const pagina = paginaEn(libro, indice);
  const anuncio =
    navegacion.contador === null
      ? ""
      : `${contador(textos.libroSeccionNDeM, navegacion.contador.numero, navegacion.contador.total)}: ${pagina.tipo === "SECCION" ? pagina.nombre : ""}`;

  // Las teclas son del libro en toda la página (no solo cuando el foco está dentro): quien llega con el teclado no tiene que buscar dónde.
  useEffect(() => {
    function alTeclear(e: KeyboardEvent) {
      // No son del libro si el foco está escribiendo o usando un control propio, ni con modificadores.
      const objetivo = e.target instanceof Element ? e.target : null;
      if (objetivo?.closest("input, textarea, select, [contenteditable]") != null) return;
      if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
      const ultima = libro.paginas.length - 1;
      if (e.key === "ArrowRight") ir(moverse(libro, indice, 1));
      else if (e.key === "ArrowLeft") ir(moverse(libro, indice, -1));
      else if (e.key === "Home") ir(0);
      else if (e.key === "End") ir(ultima);
      else return;
      e.preventDefault();
    }
    document.addEventListener("keydown", alTeclear);
    return () => {
      document.removeEventListener("keydown", alTeclear);
    };
  });

  if (!hidratada) {
    // Lo que sale del servidor: la Lista completa. Es el contenido que se indexa y el que lee quien no tiene JavaScript.
    return (
      <main
        className={[escala["escala"], estilos["raiz"]].join(" ")}
        data-modelo="LIBRO"
        data-letra-base={vista.letraBase}
        data-letra={paso}
      >
        <Portada vista={vista} />
        <nav className={estilos["indiceDeAnclas"]} aria-labelledby="libro-indice-titulo">
          <h2 id="libro-indice-titulo">{textos.libroIndice}</h2>
          <ol>
            {vista.secciones.map((s) => (
              <li key={s.id}>
                <a href={`#${s.id}`}>{s.nombre}</a>
              </li>
            ))}
          </ol>
        </nav>
        <ListaDeVidriera secciones={vista.secciones} textos={textos} />
        <p className={estilos["pie"]}>{textos.precioConIva}</p>
      </main>
    );
  }

  const seccionActual =
    pagina.tipo === "SECCION" ? vista.secciones.filter((s) => s.id === pagina.id) : [];
  return (
    <main
      className={[escala["escala"], estilos["raiz"]].join(" ")}
      data-modelo="LIBRO"
      data-letra-base={vista.letraBase}
      data-letra={paso}
    >
      <div className={estilos["barra"]}>
        <Compartir
          enlace={`${vista.hrefDeLaVidriera}${anclaDePagina(pagina) === null ? "" : `#${anclaDePagina(pagina)}`}`}
          titulo={vista.nombre}
          textos={textos}
        />
      </div>

      <div className={estilos["pagina"]} data-pagina={pagina.tipo} ref={contenedor}>
        {pagina.tipo === "PORTADA" ? <Portada vista={vista} /> : null}
        {pagina.tipo === "INDICE" ? (
          <section aria-labelledby="libro-indice-titulo">
            <h2 id="libro-indice-titulo" tabIndex={-1} className={estilos["tituloDePagina"]}>
              {textos.libroIndice}
            </h2>
            <ControlDeLetra paso={paso} alElegir={cambiarPaso} textos={textos} />
            <ol className={estilos["indice"]}>
              {libro.paginas.flatMap((p, i) =>
                p.tipo === "SECCION"
                  ? [
                      <li key={p.id}>
                        <button
                          type="button"
                          className={estilos["fila"]}
                          onClick={() => {
                            ir(i);
                          }}
                        >
                          <span className={estilos["numero"]}>
                            {String(p.numero).padStart(2, "0")}
                          </span>
                          <span>{p.nombre}</span>
                        </button>
                      </li>,
                    ]
                  : [],
              )}
            </ol>
          </section>
        ) : null}
        {pagina.tipo === "SECCION" ? (
          <div data-seccion={pagina.id}>
            <ListaDeVidriera secciones={seccionActual} textos={textos} />
          </div>
        ) : null}
        <p className={estilos["pie"]}>{textos.precioConIva}</p>
      </div>

      <nav className={estilos["navegacion"]} aria-label={textos.libroIndice}>
        <Boton
          variante="secundaria"
          deshabilitado={!navegacion.puedeIrAtras}
          alTocar={() => {
            ir(moverse(libro, indice, -1));
          }}
        >
          <span aria-hidden="true">‹</span>
          <span className={estilos["soloLector"]}>{textos.libroAnterior}</span>
        </Boton>
        {navegacion.mostrarIndice ? (
          <Boton
            variante="secundaria"
            alTocar={() => {
              ir(INDICE_DEL_INDICE);
            }}
          >
            {textos.libroIndice}
          </Boton>
        ) : (
          <span />
        )}
        <Boton
          variante="secundaria"
          deshabilitado={!navegacion.puedeIrAdelante}
          alTocar={() => {
            ir(moverse(libro, indice, 1));
          }}
        >
          <span aria-hidden="true">›</span>
          <span className={estilos["soloLector"]}>{textos.libroSiguiente}</span>
        </Boton>
      </nav>
      <RegionDeEstado visible={false}>{anuncio}</RegionDeEstado>
    </main>
  );
}

/** El fragmento sin `#` y sin codificar; uno mal codificado no rompe el libro (queda tal cual y no coincide con nada). */
function decodificar(fragmento: string): string {
  const sinNumeral = fragmento.startsWith("#") ? fragmento.slice(1) : fragmento;
  try {
    return decodeURIComponent(sinNumeral);
  } catch {
    return sinNumeral;
  }
}
