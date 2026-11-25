"use client";

import { useEffect, useMemo, useState } from "react";
import type { Respuesta } from "../../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../../componentes/Aviso";
import { Boton } from "../../../componentes/Boton.cliente";
import { BuscadorEnLista } from "../../../componentes/BuscadorEnLista";
import { Campo } from "../../../componentes/Campo";
import { Selector } from "../../../componentes/Selector";
import { ErrorDelDetalle } from "../../../patrones/ErrorDelDetalle";
import { Texto } from "../../../primitivas/Texto";
import { rutaDeLaCompra } from "../rutas-de-compras";
import { BloqueDeFactura } from "./BloqueDeFactura.cliente";
import { HojaDeNuevoProveedor, type AgregarProveedor } from "./HojaDeNuevoProveedor.cliente";
import {
  armarElPedido,
  type CompraCotizada,
  conRenglon,
  idSiguiente,
  nombreDeUnidad,
  renglonNuevo,
  renglonesParaCotizar,
  resumenDeRenglon,
  REMITO_VACIO,
  sinLosYaAgregados,
  totalDelPie,
  type ProductosParaElegir,
  type ProveedorParaElegir,
  type RemitoEscrito,
  type RenglonEscrito,
} from "./modelo-de-nueva-compra";
import {
  FACTURA_VACIA,
  facturaParaCotizar,
  facturaParaElServidor,
  type FacturaCotizada,
  type FacturaEscrita,
} from "./modelo-de-factura";
import { TarjetaDeRenglon } from "./TarjetaDeRenglon.cliente";
import { anuncioDeResultados, type TextosDeNuevaCompra } from "./textos-de-nueva-compra";
import { useEnvioDeLaCompra, type RegistrarLaCompra } from "./useEnvioDeLaCompra.cliente";
import { useLecturaDemorada } from "./useLecturaDemorada";
import estilos from "./NuevaCompra.module.css";

export type PropsDePantallaDeNuevaCompra = Readonly<{
  textos: TextosDeNuevaCompra;
  /** Las acciones del servidor (la página pasa las de `acciones-de-comprar.ts`). */
  buscarProductos: (texto: string) => Promise<Respuesta<ProductosParaElegir>>;
  buscarProveedores: (texto: string) => Promise<Respuesta<readonly ProveedorParaElegir[]>>;
  cotizar: (renglones: unknown) => Promise<Respuesta<CompraCotizada>>;
  /** Las cuentas de la factura que hace el servidor con lo escrito (solo «Con factura»). */
  cotizarFactura?: (factura: unknown) => Promise<Respuesta<FacturaCotizada>>;
  registrar: RegistrarLaCompra;
  agregarProveedor: AgregarProveedor;
  /** La empresa compra «Con factura»: lo dice el servidor (`nivelParaComprar`); la pantalla dibuja el bloque de la factura y no guarda sin ella. */
  conFactura?: boolean;
  /** La persona puede dar de alta un proveedor (`partes.crear`): sin permiso no hay botón. Lo lee el servidor; el alta vuelve a pedir el permiso. */
  puedeAgregarProveedor: boolean;
  /** Los depósitos de uso normal y activos de la sucursal, SOLO si hay más de uno (con uno, el servidor lo toma). */
  depositos: readonly Readonly<{ id: string; nombre: string }>[];
  /** Adónde va al terminar. Por defecto, una navegación completa a la ficha de la compra. */
  irA?: (ruta: string) => void;
  esperaEntreVerificacionesMs?: number | undefined;
  esperaDeLaLecturaMs?: number | undefined;
}>;

/** Sin cuentas de factura (la empresa compra «Sin factura»): nunca se llama, porque no hay nada que cotizar. */
const sinCotizarFactura = (): Promise<Respuesta<FacturaCotizada>> =>
  Promise.reject(new Error("la factura no se cotiza en «Sin factura»"));

const irAPorDefecto = (ruta: string): void => {
  window.location.assign(ruta);
};

/**
 * «Nueva compra» (maqueta `compra.html`, estado `nueva`; Compras PR 6b): se elige el proveedor (o se agrega sin salir), se agregan los productos (cada uno con su cantidad y su precio) y se guarda con
 * «Comprar y recibir», que registra la compra y la entrada de stock de una vez. Mientras se carga, lo que entra al stock y cuánto cuesta cada unidad lo calcula el SERVIDOR (`cotizarCompra`, la misma cuenta
 * que el alta); la pantalla solo lo muestra. El envío es idempotente por intento: el botón se bloquea al primer toque y un reintento (doble toque, red cortada) manda la misma clave con el mismo pedido
 * (`useEnvioDeLaCompra`), así que no hay dos compras ni dos entradas de stock. Sin conexión no se envía (la franja de la aplicación avisa) y lo escrito se conserva. Al terminar abre la ficha de la compra.
 */
export function PantallaDeNuevaCompra({
  textos,
  buscarProductos,
  buscarProveedores,
  cotizar,
  cotizarFactura,
  registrar,
  agregarProveedor,
  conFactura = false,
  puedeAgregarProveedor,
  depositos,
  irA = irAPorDefecto,
  esperaEntreVerificacionesMs,
  esperaDeLaLecturaMs,
}: PropsDePantallaDeNuevaCompra) {
  const [proveedor, setProveedor] = useState<ProveedorParaElegir | null>(null);
  const [consultaDeProveedor, setConsultaDeProveedor] = useState("");
  const [hojaAbierta, setHojaAbierta] = useState(false);
  const [consultaDeProducto, setConsultaDeProducto] = useState("");
  const [renglones, setRenglones] = useState<readonly RenglonEscrito[]>([]);
  const [remito, setRemito] = useState<RemitoEscrito>(REMITO_VACIO);
  const [depositoId, setDepositoId] = useState("");
  const [factura, setFactura] = useState<FacturaEscrita>(FACTURA_VACIA);
  const { envio, comprar, inesperado } = useEnvioDeLaCompra({
    accion: registrar,
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
  const paraCotizar = renglonesParaCotizar(renglones);
  const cotizacion = useLecturaDemorada(
    paraCotizar.length === 0 ? null : paraCotizar,
    cotizar,
    esperaDeLaLecturaMs,
  );

  const cotizados = new Map((cotizacion.dato?.renglones ?? []).map((r) => [r.productoId, r]));
  const paraCotizarLaFactura = conFactura
    ? facturaParaCotizar(factura, renglones, cotizados)
    : null;
  const cuentasDeLaFactura = useLecturaDemorada(
    paraCotizarLaFactura,
    cotizarFactura ?? sinCotizarFactura,
    esperaDeLaLecturaMs,
  );
  const pideCuit = conFactura && proveedor !== null && !proveedor.tieneCuit;
  const facturaParaGuardar = conFactura
    ? facturaParaElServidor(factura, renglones, cotizados, pideCuit)
    : null;

  const { estado } = envio;
  const hecho = estado.tipo === "hecho";
  const incierto = estado.tipo === "incierto";
  // Mientras se envía, hay un resultado incierto o ya se hizo, nada se edita: lo que se ve es lo que salió.
  const editable = !envio.enCurso && !incierto && !hecho;

  const recepcionId = estado.tipo === "hecho" ? estado.valor.recepcionId : null;
  useEffect(() => {
    if (recepcionId !== null) irA(rutaDeLaCompra(recepcionId));
  }, [recepcionId, irA]);

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

  const total = totalDelPie(renglones, cotizacion.dato, textos.sinPrecio);
  const hayDepositoAElegir = depositos.length > 1;
  const listo =
    proveedor !== null &&
    renglones.length > 0 &&
    renglones.every((r) => r.cantidad !== "") &&
    (!hayDepositoAElegir || depositoId !== "") &&
    (!conFactura || facturaParaGuardar !== null);

  const tocarComprar = () => {
    if (!editable || !listo) return;
    comprar(
      armarElPedido(
        proveedor.id,
        hayDepositoAElegir ? depositoId : null,
        remito,
        renglones,
        conFactura ? facturaParaGuardar : undefined,
      ),
    );
  };

  const agregarElProducto = (productoId: string) => {
    const elegido = productos.dato?.productos.find((p) => p.productoId === productoId);
    if (elegido === undefined) return;
    setRenglones([...renglones, renglonNuevo(idSiguiente(renglones), elegido)]);
    setConsultaDeProducto("");
    editado();
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
        {puedeAgregarProveedor ? (
          <Boton
            ancho="completo"
            variante="secundaria"
            deshabilitado={!editable}
            alTocar={() => {
              setHojaAbierta(true);
            }}
          >
            {textos.agregarProveedor}
          </Boton>
        ) : null}
      </div>

      {renglones.map((renglon) => (
        <TarjetaDeRenglon
          key={renglon.id}
          renglon={renglon}
          resumen={resumenDeRenglon(renglon, cotizados.get(renglon.productoId), textos)}
          alCambiar={(cambios) => {
            setRenglones(conRenglon(renglones, renglon.id, cambios));
            editado();
          }}
          alQuitar={() => {
            setRenglones(renglones.filter((r) => r.id !== renglon.id));
            editado();
          }}
          textos={textos}
          deshabilitada={!editable}
        />
      ))}

      <BuscadorEnLista
        dato="producto-de-compra"
        etiqueta={textos.agregarProducto}
        consulta={consultaDeProducto}
        alCambiarLaConsulta={setConsultaDeProducto}
        valor=""
        alElegir={agregarElProducto}
        opciones={opcionesDeProducto}
        anuncio={anuncioDeResultados(opcionesDeProducto.length, textos.sinResultados)}
        deshabilitado={!editable}
      />

      <fieldset className={estilos["remito"]} disabled={!editable}>
        <legend>{textos.remitoDelProveedor}</legend>
        <div className={estilos["fila"]}>
          <Campo
            dato="punto-de-venta-del-remito"
            etiqueta={textos.puntoDeVenta}
            inputMode="numeric"
            autoComplete="off"
            valor={remito.puntoDeVenta}
            alCambiar={(puntoDeVenta) => {
              setRemito({ ...remito, puntoDeVenta });
              editado();
            }}
          />
          <Campo
            dato="numero-del-remito"
            etiqueta={textos.numero}
            inputMode="numeric"
            autoComplete="off"
            valor={remito.numero}
            alCambiar={(numero) => {
              setRemito({ ...remito, numero });
              editado();
            }}
          />
        </div>
        <Campo
          dato="fecha-del-remito"
          etiqueta={textos.fechaDelRemito}
          tipo="date"
          valor={remito.fecha}
          alCambiar={(fecha) => {
            setRemito({ ...remito, fecha });
            editado();
          }}
        />
      </fieldset>

      {conFactura ? (
        <BloqueDeFactura
          factura={factura}
          alCambiar={(nueva) => {
            setFactura(nueva);
            editado();
          }}
          renglones={renglones}
          cotizados={cotizados}
          cuentas={cuentasDeLaFactura.dato}
          pideCuit={pideCuit}
          textos={textos}
          deshabilitado={!editable}
        />
      ) : null}

      {hayDepositoAElegir ? (
        <Selector
          dato="deposito-de-compra"
          etiqueta={textos.deposito}
          valor={depositoId}
          alCambiar={(id) => {
            setDepositoId(id);
            editado();
          }}
          opciones={depositos.map((d) => ({ valor: d.id, etiqueta: d.nombre }))}
          textoDeElegir={textos.sinElegir}
          deshabilitado={!editable}
        />
      ) : null}

      {total === null ? null : (
        <p className={estilos["total"]}>
          <span>{textos.total}</span> <span className={estilos["importe"]}>{total}</span>
        </p>
      )}

      {estado.tipo === "rechazado" ? <ErrorDelDetalle error={estado.rechazo} /> : null}
      {estado.tipo !== "rechazado" && cotizacion.error !== null ? (
        <ErrorDelDetalle error={cotizacion.error} />
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
        alTocar={tocarComprar}
        enviando={envio.enCurso || hecho}
        textoEnviando={textos.enviando}
        deshabilitado={!envio.enCurso && !hecho && (!listo || envio.bloqueado)}
        motivo={incierto ? undefined : envio.motivoQueNoPuede}
      >
        {textos.comprarYRecibir}
      </Boton>

      <HojaDeNuevoProveedor
        abierta={hojaAbierta}
        alCerrar={() => {
          setHojaAbierta(false);
        }}
        alAgregar={(agregado) => {
          setProveedor(agregado);
          setConsultaDeProveedor(agregado.nombre);
          setHojaAbierta(false);
          editado();
        }}
        accion={agregarProveedor}
        textos={textos}
      />
    </div>
  );
}
