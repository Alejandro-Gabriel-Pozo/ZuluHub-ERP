"use client";

import { useEffect, useMemo, useState } from "react";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../../componentes/Aviso";
import { Boton } from "../../../componentes/Boton.cliente";
import { BuscadorEnLista } from "../../../componentes/BuscadorEnLista";
import { Campo } from "../../../componentes/Campo";
import { ErrorDelDetalle } from "../../../patrones/ErrorDelDetalle";
import { Texto } from "../../../primitivas/Texto";
import { comoRegistro } from "../facturas/apoyo-de-facturas";
import { BloqueDeFactura } from "../nueva/BloqueDeFactura.cliente";
import { irAPorDefecto } from "../nueva/apoyo-de-nueva-compra";
import {
  FACTURA_VACIA,
  facturaParaCotizar,
  type FacturaCotizada,
  type FacturaEscrita,
} from "../nueva/modelo-de-factura";
import {
  idSiguiente,
  nombreDeUnidad,
  renglonNuevo,
  sinLosYaAgregados,
  type ProductosParaElegir,
  type RenglonCotizado,
  type RenglonEscrito,
} from "../nueva/modelo-de-nueva-compra";
import { anuncioDeResultados } from "../nueva/textos-de-nueva-compra";
import { useEnvioDeLaCompra } from "../nueva/useEnvioDeLaCompra.cliente";
import { useLecturaDemorada } from "../nueva/useLecturaDemorada";
import { rutaDeLaCompra, rutaDeLaFactura } from "../rutas-de-compras";
import {
  armarElPedidoDeReemplazo,
  importeDifiere,
  motivoDelReemplazo,
  numeroParaElMotivo,
} from "./modelo-de-reemplazo";
import type { TextosDeReemplazo } from "./textos-de-reemplazo";
import estilos from "../nueva/NuevaCompra.module.css";

/** Qué se reemplaza: una factura que llega sola (N3/N4: los productos de la factura nueva se eligen) o el comprobante de una compra (N1/N2: las líneas son los renglones de la compra y no se eligen). */
export type QueSeReemplaza =
  | Readonly<{ tipo: "FACTURA"; comprobanteId: string }>
  | Readonly<{
      tipo: "COMPRA";
      recepcionId: string;
      /** La factura vigente que mostró la página: el control de versión del cambio. La fija la lectura del servidor, no lo que se escriba. */
      facturaVigenteVistaId: string;
      renglones: readonly RenglonEscrito[];
    }>;

export type PropsDeFormularioDeReemplazar = Readonly<{
  textos: TextosDeReemplazo;
  que: QueSeReemplaza;
  /** El importe (total según la factura) de la que se reemplaza, como TEXTO decimal: solo para saber si la nueva difiere. */
  importeOriginal: string;
  /** Hay pasos previos sin hacer: la pantalla los muestra y el envío queda apagado (el servidor igual revalida bajo bloqueo). */
  conPasosPendientes: boolean;
  buscarProductos: (texto: string) => Promise<Respuesta<ProductosParaElegir>>;
  /** Las cuentas de la factura que hace el servidor con lo escrito. */
  cotizarFactura: (factura: unknown) => Promise<Respuesta<FacturaCotizada>>;
  /** `reemplazarFacturaAccion` o `cambiarElComprobanteAccion`: sale con la clave del intento y vuelve el comprobante nuevo (o el rechazo ya traducido). */
  enviar: (
    pedido: unknown,
  ) => Promise<Respuesta<Readonly<{ comprobanteId: string; yaExistia: boolean }>>>;
  /** Adónde va al terminar. Por defecto, una navegación completa. */
  irA?: (ruta: string) => void;
  esperaEntreVerificacionesMs?: number | undefined;
  esperaDeLaLecturaMs?: number | undefined;
}>;

const SIN_COTIZADOS: ReadonlyMap<string, RenglonCotizado> = new Map();

/**
 * «Reemplazar el comprobante», el paso 2 (NOTAS-2c-2; pantalla 11): el comprobante nuevo y el motivo. La factura nueva es el mismo bloque de «Nueva compra» y «Cargar factura»; el proveedor es el de la original (no se elige). El
 * motivo viene precargado con «Reemplazada por la factura {número}» (el número que se escribe en la factura nueva), se puede editar y es obligatorio. Si el importe de la nueva difiere del de la original se avisa que el costo del
 * stock no cambia (el dueño, P-1 del 26/11/2026). Lo que se muestra de importes lo calcula el SERVIDOR (`cotizarFactura`); la pantalla no suma ni compara números: compara TEXTO decimal. El envío es idempotente por intento
 * (`useEnvioDeLaCompra`): el botón se apaga al primer toque y un reintento manda la misma clave con el mismo pedido, así que no hay dos reemplazos. Al terminar abre el comprobante nuevo o la compra.
 */
export function FormularioDeReemplazar({
  textos,
  que,
  importeOriginal,
  conPasosPendientes,
  buscarProductos,
  cotizarFactura,
  enviar,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
  esperaDeLaLecturaMs,
}: PropsDeFormularioDeReemplazar) {
  const fijos = que.tipo === "COMPRA";
  const [consultaDeProducto, setConsultaDeProducto] = useState("");
  const [agregados, setAgregados] = useState<readonly RenglonEscrito[]>([]);
  const [factura, setFactura] = useState<FacturaEscrita>(FACTURA_VACIA);
  const [motivoEscrito, setMotivoEscrito] = useState<string | null>(null);
  const renglones = que.tipo === "COMPRA" ? que.renglones : agregados;
  const { envio, comprar, inesperado } = useEnvioDeLaCompra({
    accion: comoRegistro(enviar, (f) => f.comprobanteId),
    diccionario: {},
    esperaEntreVerificacionesMs,
  });

  const productos = useLecturaDemorada(
    !fijos && consultaDeProducto.trim() !== "" ? consultaDeProducto : null,
    buscarProductos,
    esperaDeLaLecturaMs,
  );
  const cuentas = useLecturaDemorada(
    facturaParaCotizar(factura, renglones, SIN_COTIZADOS),
    cotizarFactura,
    esperaDeLaLecturaMs,
  );

  const numero = numeroParaElMotivo(factura.puntoDeVenta, factura.numero);
  const motivo = motivoDelReemplazo(motivoEscrito, numero, textos.motivoPorDefecto);
  const pedido = armarElPedidoDeReemplazo(factura, renglones, motivo, !fijos);
  const idsDelPedido =
    que.tipo === "COMPRA"
      ? { recepcionId: que.recepcionId, facturaVigenteVistaId: que.facturaVigenteVistaId }
      : { comprobanteId: que.comprobanteId };

  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  const editable = !envio.enCurso && !incierto && !hecho;
  const nuevoId = estado.tipo === "hecho" ? estado.valor.recepcionId : null;
  const destino = que.tipo === "COMPRA" ? rutaDeLaCompra(que.recepcionId) : null;
  useEffect(() => {
    if (nuevoId !== null) irA(destino ?? rutaDeLaFactura(nuevoId));
  }, [nuevoId, destino, irA]);

  /** Cualquier cambio de lo escrito descarta el resultado anterior (un rechazo): el próximo toque es otro intento. */
  const editado = () => {
    envio.reiniciar();
  };

  const opcionesDeProducto = useMemo(
    () =>
      sinLosYaAgregados(productos.dato?.productos ?? [], agregados).map((p) => ({
        valor: p.productoId,
        etiqueta: p.nombre,
        detalle: nombreDeUnidad(p.unidadBase),
      })),
    [productos.dato, agregados],
  );

  const tocar = () => {
    if (!editable || pedido === null || conPasosPendientes) return;
    comprar({ ...idsDelPedido, ...pedido });
  };

  return (
    <div className={estilos["pantalla"]}>
      <Texto>{textos.comprobanteNuevo}</Texto>
      {fijos ? null : (
        <BuscadorEnLista
          dato="producto-de-compra"
          etiqueta={textos.factura.agregarProducto}
          consulta={consultaDeProducto}
          alCambiarLaConsulta={setConsultaDeProducto}
          valor=""
          alElegir={(productoId) => {
            const elegido = productos.dato?.productos.find((p) => p.productoId === productoId);
            if (elegido === undefined) return;
            setAgregados([...agregados, renglonNuevo(idSiguiente(agregados), elegido)]);
            setConsultaDeProducto("");
            editado();
          }}
          opciones={opcionesDeProducto}
          anuncio={anuncioDeResultados(opcionesDeProducto.length, textos.factura.sinResultados)}
          deshabilitado={!editable}
        />
      )}

      <BloqueDeFactura
        factura={factura}
        alCambiar={(nueva) => {
          setFactura(nueva);
          editado();
        }}
        renglones={renglones}
        cotizados={SIN_COTIZADOS}
        cuentas={cuentas.dato}
        pideCuit={false}
        textos={textos.factura}
        deshabilitado={!editable}
      />
      {fijos
        ? null
        : agregados.map((r) => (
            <Boton
              key={r.id}
              ancho="completo"
              variante="secundaria"
              deshabilitado={!editable}
              alTocar={() => {
                setAgregados(agregados.filter((x) => x.id !== r.id));
                editado();
              }}
            >
              {`${textos.factura.quitar} ${r.nombre}`}
            </Boton>
          ))}

      <Campo
        dato="motivo-de-anulacion-de-compra"
        etiqueta={textos.motivo}
        valor={motivo}
        alCambiar={(escrito) => {
          setMotivoEscrito(escrito);
          editado();
        }}
        deshabilitado={!editable}
      />

      {importeDifiere(importeOriginal, factura.totalSegunFactura) ? (
        <Aviso tono="aviso">
          <Texto>{textos.costoNoCambia}</Texto>
        </Aviso>
      ) : null}

      {estado.tipo === "rechazado" ? <ErrorDelDetalle error={estado.rechazo} /> : null}
      {estado.tipo !== "rechazado" && cuentas.error !== null ? (
        <ErrorDelDetalle error={cuentas.error} />
      ) : null}
      {incierto ? (
        <Aviso
          tono="aviso"
          accion={
            envio.enCurso ? undefined : (
              <Boton ancho="completo" variante="secundaria" alTocar={envio.enviar}>
                {textos.reintentar}
              </Boton>
            )
          }
        >
          <Texto>{envio.motivoQueNoPuede ?? ""}</Texto>
          {inesperado?.referencia === undefined ? null : <Texto>{inesperado.referencia}</Texto>}
        </Aviso>
      ) : null}

      <Boton
        ancho="completo"
        alTocar={tocar}
        enviando={envio.enCurso || hecho}
        textoEnviando={textos.enviando}
        deshabilitado={
          !envio.enCurso && !hecho && (pedido === null || conPasosPendientes || envio.bloqueado)
        }
        motivo={incierto ? undefined : envio.motivoQueNoPuede}
      >
        {fijos ? textos.cambiarElComprobante : textos.reemplazar}
      </Boton>
    </div>
  );
}
