"use client";

import { useMemo, useRef, useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Superposicion } from "../../patrones/Superposicion";
import { HojaDeProducto, type LineaElegida } from "../venta/HojaDeProducto.cliente";
import estilosDeLaVenta from "../venta/VentaRapida.module.css";
import {
  formaDeCantidad,
  precioDeLaTarjeta,
  productosVisibles,
  sePuedeAgregar,
  textoSinResultados,
  tieneOpciones,
  type ProductoDeLaVenta,
  type SeccionDeLaVenta,
  type TextosDeLaVenta,
} from "../venta/modelo-de-venta-rapida";
import type { CotizacionDeLaVenta } from "../venta/modelo-de-la-cuenta";

export type PropsDeCatalogoDeLaMesa = Readonly<{
  secciones: readonly SeccionDeLaVenta[];
  productos: readonly ProductoDeLaVenta[];
  textos: TextosDeLaVenta;
  /** La cotización del servidor (una lectura): da el importe de «Agregar · $ …» en la hoja. */
  cotizar: (pedido: unknown) => Promise<Respuesta<CotizacionDeLaVenta>>;
  /** Hay un pedido en vuelo: no se abre otra hoja ni se agrega nada hasta que vuelva. */
  ocupado: boolean;
  alAgregar: (linea: LineaElegida) => void;
}>;

/** Tras cerrar la hoja se ignora un segundo toque sobre un producto: evita abrirla dos veces con un doble toque (igual que la venta rápida). */
const ESPERA_TRAS_CERRAR_LA_HOJA_MS = 500;

/**
 * Lo que se ofrece para agregar a la mesa (SAL-B, S3): los mismos productos, secciones, buscador y hoja de producto de la venta rápida (`../venta/`), sin la cuenta local ni el cobro: lo que se elige se agrega
 * a la cuenta de la mesa en el servidor (`alAgregar`). Nada se calcula acá: el precio sale del catálogo en el servidor. Sin textos propios: todos llegan resueltos.
 */
export function CatalogoDeLaMesa({
  secciones,
  productos,
  textos,
  cotizar,
  ocupado,
  alAgregar,
}: PropsDeCatalogoDeLaMesa) {
  const [busqueda, setBusqueda] = useState("");
  const [seccionId, setSeccionId] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<ProductoDeLaVenta | null>(null);
  const hojaBloqueada = useRef(false);
  const temporizador = useRef<ReturnType<typeof setTimeout> | null>(null);
  const visibles = useMemo(
    () => productosVisibles(productos, secciones, busqueda, seccionId),
    [productos, secciones, busqueda, seccionId],
  );
  const formaAbierta = abierto === null ? null : formaDeCantidad(abierto);

  const cerrarHoja = () => {
    hojaBloqueada.current = true;
    if (temporizador.current !== null) clearTimeout(temporizador.current);
    temporizador.current = setTimeout(() => {
      hojaBloqueada.current = false;
    }, ESPERA_TRAS_CERRAR_LA_HOJA_MS);
    setAbierto(null);
  };

  return (
    <div className={estilosDeLaVenta["pantalla"]}>
      <Campo
        dato="texto-de-busqueda-de-producto"
        etiqueta={textos.buscar}
        tipo="search"
        autoComplete="off"
        valor={busqueda}
        alCambiar={setBusqueda}
      />
      {secciones.length === 0 ? null : (
        <div className={estilosDeLaVenta["secciones"]} role="group" aria-label={textos.secciones}>
          <button
            type="button"
            className={estilosDeLaVenta["seccion"]}
            aria-pressed={seccionId === null}
            onClick={() => {
              setSeccionId(null);
            }}
          >
            {textos.todo}
          </button>
          {secciones.map((s) => (
            <button
              key={s.id}
              type="button"
              className={estilosDeLaVenta["seccion"]}
              aria-pressed={seccionId === s.id}
              onClick={() => {
                setSeccionId(s.id);
              }}
            >
              {s.nombre}
            </button>
          ))}
        </div>
      )}
      {visibles.length === 0 && busqueda.trim() !== "" ? (
        <div className={estilosDeLaVenta["sinResultados"]}>
          <p className={estilosDeLaVenta["vacia"]}>{textoSinResultados(busqueda.trim())}</p>
          <p className={estilosDeLaVenta["ayuda"]}>{textos.sinResultadosAyuda}</p>
          <Boton
            variante="secundaria"
            alTocar={() => {
              setBusqueda("");
            }}
          >
            {textos.borrarBusqueda}
          </Boton>
        </div>
      ) : null}
      {visibles.map((grupo) => (
        <section
          key={grupo.seccion?.id ?? "sin-seccion"}
          className={estilosDeLaVenta["grupoDeProductos"]}
        >
          {grupo.seccion === null ? null : (
            <h2 className={estilosDeLaVenta["titulo"]}>{grupo.seccion.nombre}</h2>
          )}
          <ul className={estilosDeLaVenta["grilla"]}>
            {grupo.productos.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className={estilosDeLaVenta["tarjeta"]}
                  disabled={!sePuedeAgregar(p) || ocupado}
                  onClick={() => {
                    if (!hojaBloqueada.current) setAbierto(p);
                  }}
                >
                  <span className={estilosDeLaVenta["nombre"]}>{p.nombre}</span>
                  {tieneOpciones(p) ? (
                    <span className={estilosDeLaVenta["subtitulo"]}>{textos.conOpciones}</span>
                  ) : null}
                  <span className={estilosDeLaVenta["precio"]}>{precioDeLaTarjeta(p, textos)}</span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
      <Superposicion
        abierta={abierto !== null && formaAbierta !== null}
        titulo={abierto?.nombre ?? ""}
        proposito="elegir"
        alCerrar={cerrarHoja}
        cerrable
        etiquetaDeCerrar={textos.cerrar}
      >
        {abierto === null || formaAbierta === null ? null : (
          <HojaDeProducto
            key={abierto.id}
            producto={abierto}
            forma={formaAbierta}
            textos={textos}
            cotizar={cotizar}
            alAgregar={(linea) => {
              alAgregar(linea);
              cerrarHoja();
            }}
            alCancelar={cerrarHoja}
          />
        )}
      </Superposicion>
    </div>
  );
}
