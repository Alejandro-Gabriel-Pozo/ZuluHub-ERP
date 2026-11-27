import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  PAGINA_INDICE,
  PAGINA_PORTADA,
  numeroDeSeccion,
  paginaDeLaSeccion,
  paginaDelAncla,
  paginaVecina,
  paginaVisible,
} from "../../../../../src/capacidades/experiencia/vidriera/capa-de-libro";
import type { PasoDeLetra } from "../../../../../src/capacidades/experiencia/vidriera/letra";
import type { TextosDeVidriera } from "../../../../../src/capacidades/experiencia/vidriera/textos";
import type {
  VistaDeProducto,
  VistaDeVidriera,
} from "../../../../../src/capacidades/experiencia/vidriera/vista";
import { Boton } from "../../componentes/Boton.cliente";
import { Icono } from "../../iconos/Icono";
import { CabeceraDeLaCarta } from "./CabeceraDeLaCarta";
import { ControlDeLetra } from "./ControlDeLetra";
import { ListaDeVidriera } from "./ListaDeVidriera";
import estilos from "./PlantillaLibro.module.css";

export type PropsDePlantillaLibro = Readonly<{
  vista: VistaDeVidriera;
  textos: TextosDeVidriera;
  paso: PasoDeLetra;
  alElegirLetra: (paso: PasoDeLetra) => void;
  alAbrir: (producto: VistaDeProducto) => void;
  alVerComoLista: () => void;
}>;

/** Las teclas que pasan de página; dentro de un campo, un diálogo o un control propio las usa quien las recibe. */
function laTeclaEsDeOtro(destino: EventTarget | null): boolean {
  return (
    destino instanceof Element &&
    destino.closest('input, textarea, select, [role="dialog"], [role="radiogroup"]') !== null
  );
}

/**
 * El modelo Libro (03 §4): una CAPA sobre el mismo contenido de la Lista. Una pista horizontal con ajuste al
 * deslizar (`scroll-snap`) y una página por cada cosa: portada, índice y una por sección. Cada sección se
 * desplaza hacia abajo dentro de su página. Es DOM común (nunca canvas): el lector de pantalla, el zoom y la
 * búsqueda del navegador siguen funcionando. Solo se monta después de hidratar y si el entorno lo permite
 * (`puedeMontarseElLibro`); si no, la carta es la Lista.
 *
 * Inventario de textos y pantalla: DEC-CAT-003 (siete textos `vidriera.libro.*`; el resto se reutiliza). SUPUESTO: dentro
 * del Libro no hay búsqueda (para buscar, «Ver como lista»). La carta pública no tiene ficha de pantalla (hoy exige un permiso).
 */
export function PlantillaLibro({
  vista,
  textos,
  paso,
  alElegirLetra,
  alAbrir,
  alVerComoLista,
}: PropsDePlantillaLibro) {
  const pista = useRef<HTMLDivElement>(null);
  const cuadro = useRef<number | null>(null);
  const [pagina, setPagina] = useState(PAGINA_PORTADA);
  const secciones = vista.secciones;
  const total = paginaDeLaSeccion(secciones.length);
  const idsDeSecciones = useMemo(() => secciones.map((s) => s.id), [secciones]);

  // El título que recibe el foco cuando la página nueva ya está activa: una página fuera de foco es `inert` y no lo acepta.
  const tituloPorEnfocar = useRef<string | null>(null);
  useEffect(() => {
    if (tituloPorEnfocar.current === null) return;
    document.getElementById(tituloPorEnfocar.current)?.focus({ preventScroll: true });
    tituloPorEnfocar.current = null;
  });

  // La página a la que se desliza por mando propio (botones, teclado, índice): mientras dura el deslizamiento,
  // las posiciones de paso no cambian la página, o el contador y los botones parpadearían.
  const rumbo = useRef<number | null>(null);
  const soltarElRumbo = useRef<ReturnType<typeof setTimeout> | null>(null);
  const paginaActual = useRef(PAGINA_PORTADA);
  const fijarPagina = useCallback((destino: number) => {
    paginaActual.current = destino;
    setPagina(destino);
  }, []);

  const irA = useCallback(
    (destino: number, opciones: { enfocarElTitulo?: boolean; instantaneo?: boolean } = {}) => {
      const elemento = pista.current;
      if (elemento === null) return;
      fijarPagina(destino);
      if (opciones.instantaneo !== true) {
        rumbo.current = destino;
        // Si el deslizamiento se interrumpe (un toque en el medio) la página vuelve a seguir al dedo.
        if (soltarElRumbo.current !== null) clearTimeout(soltarElRumbo.current);
        soltarElRumbo.current = setTimeout(() => {
          rumbo.current = null;
        }, 800);
      }
      // Sin `scrollTo` (entornos sin layout) no hay a dónde deslizar: queda la página elegida.
      elemento.scrollTo?.({
        left: destino * elemento.clientWidth,
        behavior: opciones.instantaneo === true ? "instant" : "smooth",
      });
      if (opciones.enfocarElTitulo !== true) return;
      tituloPorEnfocar.current = secciones[destino - PAGINA_INDICE - 1]?.id ?? null;
    },
    [secciones, fijarPagina],
  );

  // `#<slug>` abre esa sección y deja el foco en su título.
  const yaLeyoElAncla = useRef(false);
  useEffect(() => {
    // Solo al montar: después, la página la mandan los controles.
    if (yaLeyoElAncla.current) return;
    yaLeyoElAncla.current = true;
    const destino = paginaDelAncla(window.location.hash, idsDeSecciones);
    if (destino !== null) irA(destino, { enfocarElTitulo: true, instantaneo: true });
  }, [idsDeSecciones, irA]);

  useEffect(() => {
    function alTocarUnaTecla(evento: KeyboardEvent) {
      if (evento.defaultPrevented || evento.altKey || evento.ctrlKey || evento.metaKey) return;
      if (evento.key !== "ArrowLeft" && evento.key !== "ArrowRight") return;
      if (laTeclaEsDeOtro(evento.target)) return;
      evento.preventDefault();
      irA(paginaVecina(paginaActual.current, evento.key === "ArrowRight" ? 1 : -1, total));
    }
    window.addEventListener("keydown", alTocarUnaTecla);
    return () => {
      window.removeEventListener("keydown", alTocarUnaTecla);
    };
  }, [total, irA]);

  useEffect(
    () => () => {
      if (cuadro.current !== null) cancelAnimationFrame(cuadro.current);
      if (soltarElRumbo.current !== null) clearTimeout(soltarElRumbo.current);
    },
    [],
  );

  function alDeslizar() {
    if (cuadro.current !== null) return;
    cuadro.current = requestAnimationFrame(() => {
      cuadro.current = null;
      const elemento = pista.current;
      if (elemento === null) return;
      const visible = paginaVisible(elemento.scrollLeft, elemento.clientWidth, total);
      if (rumbo.current !== null) {
        if (visible === rumbo.current) rumbo.current = null;
        return;
      }
      fijarPagina(visible);
    });
  }

  const numero = numeroDeSeccion(pagina);
  const contador =
    numero === null
      ? ""
      : textos.libroSeccionNDeM
          .replace("{n}", () => String(numero))
          .replace("{m}", () => String(secciones.length));

  return (
    <div className={estilos["libro"]}>
      <div ref={pista} className={estilos["pista"]} onScroll={alDeslizar}>
        <div className={estilos["pagina"]} inert={pagina !== PAGINA_PORTADA} data-pagina="portada">
          <CabeceraDeLaCarta vista={vista} />
          <div className={estilos["portada"]}>
            <ControlDeLetra paso={paso} alElegir={alElegirLetra} textos={textos} />
            <p className={estilos["desliza"]}>{textos.libroDesliza}</p>
            <Boton variante="secundaria" alTocar={alVerComoLista}>
              {textos.libroVerComoLista}
            </Boton>
          </div>
        </div>

        <div className={estilos["pagina"]} inert={pagina !== PAGINA_INDICE} data-pagina="indice">
          <nav className={estilos["indice"]} aria-labelledby="pd-libro-indice">
            <h2 id="pd-libro-indice" className={estilos["tituloDelIndice"]}>
              {textos.libroIndice}
            </h2>
            <ol className={estilos["listaDelIndice"]}>
              {secciones.map((s, i) => (
                <li key={s.id}>
                  <a
                    href={`#${s.id}`}
                    className={estilos["enlaceDelIndice"]}
                    onClick={(evento) => {
                      evento.preventDefault();
                      irA(paginaDeLaSeccion(i), { enfocarElTitulo: true });
                    }}
                  >
                    <span>{s.nombre}</span>
                    <span className={estilos["cantidad"]}>{s.productos.length}</span>
                  </a>
                </li>
              ))}
            </ol>
          </nav>
        </div>

        {secciones.map((s, i) => (
          <div
            key={s.id}
            className={estilos["pagina"]}
            inert={pagina !== paginaDeLaSeccion(i)}
            data-pagina="seccion"
          >
            <ListaDeVidriera secciones={[s]} textos={textos} alAbrir={alAbrir} />
            <p className={estilos["pie"]}>{textos.precioConIva}</p>
          </div>
        ))}
      </div>

      <div className={estilos["barra"]}>
        <p className={estilos["contador"]} role="status">
          {contador}
        </p>
        <div className={estilos["controles"]}>
          <button
            type="button"
            className={estilos["flecha"]}
            aria-label={textos.libroAnterior}
            disabled={pagina === PAGINA_PORTADA}
            onClick={() => {
              irA(paginaVecina(pagina, -1, total));
            }}
          >
            <Icono clave="atras" decorativo />
          </button>
          <button
            type="button"
            className={estilos["indiceBoton"]}
            disabled={pagina === PAGINA_INDICE}
            onClick={() => {
              irA(PAGINA_INDICE);
            }}
          >
            {textos.libroIndice}
          </button>
          <button
            type="button"
            className={`${estilos["flecha"]} ${estilos["siguiente"]}`}
            aria-label={textos.libroSiguiente}
            disabled={pagina === total - 1}
            onClick={() => {
              irA(paginaVecina(pagina, 1, total));
            }}
          >
            <Icono clave="atras" decorativo />
          </button>
        </div>
      </div>
    </div>
  );
}
