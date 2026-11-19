"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { GrupoDeOpciones } from "../../componentes/GrupoDeOpciones";
import { Boton } from "../../componentes/Boton.cliente";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { ControlDeCantidad } from "./ControlDeCantidad.cliente";
import estilos from "./VentaRapida.module.css";
import {
  nombreDeLaUnidad,
  precioDeLaTarjeta,
  type FormaDeCantidad,
  type ProductoDeLaVenta,
  type TextosDeLaVenta,
} from "./modelo-de-venta-rapida";
import {
  agregarALaCuenta,
  claveDeLinea,
  pedidoDeCotizacion,
  type CotizacionDeLaVenta,
} from "./modelo-de-la-cuenta";

export type LineaElegida = Readonly<{
  productoId: string;
  varianteId: string | null;
  opcionIds: readonly string[];
  cantidad: number;
}>;

export type PropsDeHojaDeProducto = Readonly<{
  producto: ProductoDeLaVenta;
  forma: FormaDeCantidad;
  textos: TextosDeLaVenta;
  /** La misma cotización del servidor que usa la pantalla (una lectura): da el importe de «Agregar · $ …». */
  cotizar: (pedido: unknown) => Promise<Respuesta<CotizacionDeLaVenta>>;
  alAgregar: (linea: LineaElegida) => void;
  alCancelar: () => void;
}>;

/**
 * La hoja de un producto (maqueta `venta-rapida-v4.html`): primero se elige lo que es (la medida y las opciones, si tiene) y después la cantidad; recién ahí «Agregar» deja la línea en la
 * cuenta. Todo producto pasa por la hoja. El botón queda apagado mientras falte algo obligatorio o la cantidad no sea válida; el motivo lo comunica el propio control (un grupo sin elegir, la
 * cantidad marcada), sin un aviso aparte. El precio que se ve es el de lista o el de cada medida, tal cual lo trae el servidor: la hoja NO suma recargos. Con la elección completa pide al servidor
 * (`cotizar`, una lectura) lo que costaría esa línea y lo muestra en «Agregar · $ …»; una respuesta de una elección que ya cambió se descarta, y agregar no espera esa respuesta. Un segundo
 * toque sobre «Agregar» no repite la línea.
 */
export function HojaDeProducto({
  producto,
  forma,
  textos,
  cotizar,
  alAgregar,
  alCancelar,
}: PropsDeHojaDeProducto) {
  const [medida, setMedida] = useState<readonly string[]>([]);
  const [elegidas, setElegidas] = useState<Readonly<Record<string, readonly string[]>>>({});
  const [cantidad, setCantidad] = useState<number | null>(
    forma.tipo === "UNIDAD" ? forma.paso : null,
  );
  const [cotizado, setCotizado] = useState<Readonly<{ para: string; monto: string }> | null>(null);
  const enviada = useRef(false);

  const medidaFaltante = producto.variante !== null && medida.length === 0;
  const gruposFaltantes = producto.grupos.some(
    (g) => g.obligatorio && (elegidas[g.id] ?? []).length === 0,
  );
  // La línea que se agregaría, o `null` mientras falte algo o la cantidad no sea válida.
  const eleccion = useMemo<LineaElegida | null>(
    () =>
      medidaFaltante || gruposFaltantes || cantidad === null
        ? null
        : {
            productoId: producto.id,
            varianteId: medida[0] ?? null,
            opcionIds: producto.grupos.flatMap((g) => elegidas[g.id] ?? []),
            cantidad,
          },
    [medidaFaltante, gruposFaltantes, cantidad, producto, medida, elegidas],
  );
  const listo = eleccion !== null;
  const paraLaEleccion =
    eleccion === null
      ? null
      : JSON.stringify([
          claveDeLinea(eleccion.productoId, eleccion.varianteId, eleccion.opcionIds),
          eleccion.cantidad,
        ]);

  // El importe de «Agregar» lo da el servidor (nunca una cuenta del navegador). Una respuesta solo vale para la elección que la pidió; si falla, el botón queda en «Agregar» (agregar no depende de esto).
  useEffect(() => {
    if (eleccion === null || paraLaEleccion === null) return;
    let vigente = true;
    cotizar(pedidoDeCotizacion(agregarALaCuenta([], eleccion)))
      .then((respuesta) => {
        if (vigente) {
          setCotizado(
            respuesta.ok ? { para: paraLaEleccion, monto: respuesta.dato.total.monto } : null,
          );
        }
      })
      .catch(() => {
        if (vigente) setCotizado(null);
      });
    return () => {
      vigente = false;
    };
  }, [eleccion, paraLaEleccion, cotizar]);

  const importe = cotizado !== null && cotizado.para === paraLaEleccion ? cotizado.monto : null;

  const alEnviar = (evento: FormEvent) => {
    evento.preventDefault();
    if (eleccion === null || enviada.current) return;
    enviada.current = true;
    alAgregar(eleccion);
  };

  const medidaElegida = producto.variante?.opciones.find((o) => o.id === medida[0]);
  const precio =
    medidaElegida === undefined
      ? precioDeLaTarjeta(producto, textos)
      : formatearImporte(medidaElegida.precio);

  return (
    <form className={estilos["hoja"]} onSubmit={alEnviar} noValidate>
      <p className={estilos["precioDeLaHoja"]}>{precio}</p>
      {producto.variante === null ? null : (
        <GrupoDeOpciones
          dato="eleccion-de-opcion-de-venta"
          nombre={producto.variante.esTamano ? textos.medida : producto.variante.nombre}
          ocultarNombre={producto.variante.esTamano}
          notaDelGrupo={medida.length === 0 ? textos.sinElegir : undefined}
          varias={false}
          valor={medida}
          alCambiar={setMedida}
          opciones={producto.variante.opciones.map((o) => ({
            id: o.id,
            etiqueta: o.nombre,
            nota: formatearImporte(o.precio),
          }))}
        />
      )}
      {producto.grupos.map((g) => (
        <GrupoDeOpciones
          key={g.id}
          dato="eleccion-de-opcion-de-venta"
          nombre={g.nombre}
          aclaracion={g.obligatorio ? textos.obligatorio : textos.opcional}
          varias={g.admiteVarias}
          valor={elegidas[g.id] ?? []}
          alCambiar={(valor) => {
            setElegidas((previas) => ({ ...previas, [g.id]: valor }));
          }}
          etiquetaSinElegir={g.admiteVarias || g.obligatorio ? undefined : textos.sinElegir}
          opciones={g.opciones.map((o) => ({
            id: o.id,
            etiqueta: o.nombre,
            nota: /^0+(\.0+)?$/.test(o.recargo)
              ? textos.incluido
              : `+ ${formatearImporte(o.recargo)}`,
          }))}
        />
      ))}
      <ControlDeCantidad
        forma={forma}
        inicial={forma.tipo === "UNIDAD" ? forma.paso : null}
        textos={textos}
        nombreDeLaUnidad={forma.tipo === "MEDIDA" ? nombreDeLaUnidad(forma.unidadDeVentaId) : null}
        conAtajos
        importe={importe === null ? undefined : formatearImporte(importe)}
        alCambiar={setCantidad}
      />
      <div className={estilos["pie"]}>
        <Boton tipo="submit" deshabilitado={!listo} ancho="completo">
          {importe === null ? textos.agregar : `${textos.agregar} · ${formatearImporte(importe)}`}
        </Boton>
        <Boton variante="secundaria" alTocar={alCancelar} ancho="completo">
          {textos.cancelar}
        </Boton>
      </div>
    </form>
  );
}
