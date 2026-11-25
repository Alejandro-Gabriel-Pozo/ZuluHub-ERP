"use client";

import { useEffect, useMemo, useState } from "react";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../../componentes/Aviso";
import { Boton } from "../../../componentes/Boton.cliente";
import { BuscadorEnLista } from "../../../componentes/BuscadorEnLista";
import { ErrorDelDetalle } from "../../../patrones/ErrorDelDetalle";
import { Texto } from "../../../primitivas/Texto";
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
  type ProveedorParaElegir,
  type RenglonCotizado,
  type RenglonEscrito,
} from "../nueva/modelo-de-nueva-compra";
import { anuncioDeResultados, type TextosDeNuevaCompra } from "../nueva/textos-de-nueva-compra";
import { useEnvioDeLaCompra } from "../nueva/useEnvioDeLaCompra.cliente";
import { useLecturaDemorada } from "../nueva/useLecturaDemorada";
import { rutaDeLaFactura } from "../rutas-de-compras";
import { comoRegistro } from "./apoyo-de-facturas";
import { armarElPedidoDeFactura } from "./modelo-de-cargar-factura";
import estilos from "../nueva/NuevaCompra.module.css";

export type PropsDePantallaDeCargarFactura = Readonly<{
  /** Los textos del formulario de la factura (los mismos de «Nueva compra»: la factura es el mismo bloque). */
  textos: TextosDeNuevaCompra;
  /** El texto del botón («Cargar factura»). */
  textoDelBoton: string;
  buscarProductos: (texto: string) => Promise<Respuesta<ProductosParaElegir>>;
  buscarProveedores: (texto: string) => Promise<Respuesta<readonly ProveedorParaElegir[]>>;
  /** Las cuentas de la factura que hace el servidor con lo escrito. */
  cotizarFactura: (factura: unknown) => Promise<Respuesta<FacturaCotizada>>;
  /** `registrarFacturaAccion`: el pedido sale con la clave del intento y vuelve la factura hecha (o el rechazo ya traducido). */
  registrar: (
    pedido: unknown,
  ) => Promise<Respuesta<Readonly<{ comprobanteId: string; yaExistia: boolean }>>>;
  /** Adónde va al terminar. Por defecto, una navegación completa al detalle de la factura. */
  irA?: (ruta: string) => void;
  esperaEntreVerificacionesMs?: number | undefined;
  esperaDeLaLecturaMs?: number | undefined;
}>;

const SIN_COTIZADOS: ReadonlyMap<string, RenglonCotizado> = new Map();

/**
 * «Cargar factura» (Compras 4; maqueta `compra-conciliar.html`, estado `cargar`): la factura de la EMPRESA, sin sucursal: se elige el proveedor, se agregan los productos de la factura y por cada uno su cantidad
 * facturada, su precio neto y su IVA (el mismo bloque de la factura de «Nueva compra»), más las percepciones y el total según la factura. No toca stock: la conciliación con lo recibido es otro acto. Lo que se muestra
 * de importes lo calcula el SERVIDOR (`cotizarFactura`); la pantalla no suma nada. El envío es idempotente por intento (`useEnvioDeLaCompra`): el botón se apaga al primer toque y un reintento manda la misma clave con
 * el mismo pedido, así que no hay dos facturas. Al terminar abre el detalle de la factura.
 */
export function PantallaDeCargarFactura({
  textos,
  textoDelBoton,
  buscarProductos,
  buscarProveedores,
  cotizarFactura,
  registrar,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
  esperaDeLaLecturaMs,
}: PropsDePantallaDeCargarFactura) {
  const [proveedor, setProveedor] = useState<ProveedorParaElegir | null>(null);
  const [consultaDeProveedor, setConsultaDeProveedor] = useState("");
  const [consultaDeProducto, setConsultaDeProducto] = useState("");
  const [renglones, setRenglones] = useState<readonly RenglonEscrito[]>([]);
  const [factura, setFactura] = useState<FacturaEscrita>(FACTURA_VACIA);
  const { envio, comprar, inesperado } = useEnvioDeLaCompra({
    accion: comoRegistro(registrar, (f) => f.comprobanteId),
    diccionario: {},
    esperaEntreVerificacionesMs,
  });

  const proveedores = useLecturaDemorada(
    proveedor === null && consultaDeProveedor.trim() !== "" ? consultaDeProveedor : null,
    buscarProveedores,
    esperaDeLaLecturaMs,
  );
  const productos = useLecturaDemorada(
    consultaDeProducto.trim() !== "" ? consultaDeProducto : null,
    buscarProductos,
    esperaDeLaLecturaMs,
  );
  const cuentas = useLecturaDemorada(
    facturaParaCotizar(factura, renglones, SIN_COTIZADOS),
    cotizarFactura,
    esperaDeLaLecturaMs,
  );
  const pideCuit = proveedor !== null && !proveedor.tieneCuit;
  const pedido =
    proveedor === null ? null : armarElPedidoDeFactura(proveedor.id, factura, renglones, pideCuit);

  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  const editable = !envio.enCurso && !incierto && !hecho;
  const comprobanteId = estado.tipo === "hecho" ? estado.valor.recepcionId : null;
  useEffect(() => {
    if (comprobanteId !== null) irA(rutaDeLaFactura(comprobanteId));
  }, [comprobanteId, irA]);

  /** Cualquier cambio de lo escrito descarta el resultado anterior (un rechazo): el próximo toque es otro intento. */
  const editado = () => {
    envio.reiniciar();
  };

  const opcionesDeProveedor = (proveedores.dato ?? []).map((p) => ({
    valor: p.id,
    etiqueta: p.nombre,
  }));
  const opcionesDeProducto = useMemo(
    () =>
      sinLosYaAgregados(productos.dato?.productos ?? [], renglones).map((p) => ({
        valor: p.productoId,
        etiqueta: p.nombre,
        detalle: nombreDeUnidad(p.unidadBase),
      })),
    [productos.dato, renglones],
  );

  const tocar = () => {
    if (!editable || pedido === null) return;
    comprar(pedido);
  };

  return (
    <div className={estilos["pantalla"]}>
      <div className={estilos["proveedor"]}>
        <BuscadorEnLista
          dato="proveedor-de-compra"
          etiqueta={textos.proveedor}
          consulta={consultaDeProveedor}
          alCambiarLaConsulta={(consulta) => {
            setConsultaDeProveedor(consulta);
            editado();
          }}
          valor={proveedor?.id ?? ""}
          alElegir={(id) => {
            const elegido = (proveedores.dato ?? []).find((p) => p.id === id) ?? null;
            setProveedor(elegido);
            if (elegido !== null) setConsultaDeProveedor(elegido.nombre);
            editado();
          }}
          opciones={opcionesDeProveedor}
          anuncio={anuncioDeResultados(opcionesDeProveedor.length, textos.sinResultados)}
          deshabilitado={!editable}
        />
      </div>

      <BuscadorEnLista
        dato="producto-de-compra"
        etiqueta={textos.agregarProducto}
        consulta={consultaDeProducto}
        alCambiarLaConsulta={setConsultaDeProducto}
        valor=""
        alElegir={(productoId) => {
          const elegido = productos.dato?.productos.find((p) => p.productoId === productoId);
          if (elegido === undefined) return;
          setRenglones([...renglones, renglonNuevo(idSiguiente(renglones), elegido)]);
          setConsultaDeProducto("");
          editado();
        }}
        opciones={opcionesDeProducto}
        anuncio={anuncioDeResultados(opcionesDeProducto.length, textos.sinResultados)}
        deshabilitado={!editable}
      />

      <BloqueDeFactura
        factura={factura}
        alCambiar={(nueva) => {
          setFactura(nueva);
          editado();
        }}
        renglones={renglones}
        cotizados={SIN_COTIZADOS}
        cuentas={cuentas.dato}
        pideCuit={pideCuit}
        textos={textos}
        deshabilitado={!editable}
      />
      {renglones.map((r) => (
        <Boton
          key={r.id}
          ancho="completo"
          variante="secundaria"
          deshabilitado={!editable}
          alTocar={() => {
            setRenglones(renglones.filter((x) => x.id !== r.id));
            editado();
          }}
        >
          {`${textos.quitar} ${r.nombre}`}
        </Boton>
      ))}

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
        deshabilitado={!envio.enCurso && !hecho && (pedido === null || envio.bloqueado)}
        motivo={incierto ? undefined : envio.motivoQueNoPuede}
      >
        {textoDelBoton}
      </Boton>
    </div>
  );
}
