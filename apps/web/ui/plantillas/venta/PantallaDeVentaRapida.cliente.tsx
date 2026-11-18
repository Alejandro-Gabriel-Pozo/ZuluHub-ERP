"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  errorDeCodigo,
  type ErrorPublico,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../patrones/Superposicion";
import { formatearImporte } from "../../patrones/formato-fiscal";
import { CuentaDeLaVenta } from "./CuentaDeLaVenta.cliente";
import { HojaDeProducto, type LineaElegida } from "./HojaDeProducto.cliente";
import estilos from "./VentaRapida.module.css";
import {
  cantidadParaLeer,
  formaDeCantidad,
  precioDeLaTarjeta,
  productosVisibles,
  sePuedeAgregar,
  textoSinResultados,
  tieneOpciones,
  type ProductoDeLaVenta,
  type SeccionDeLaVenta,
  type TextosDeLaVenta,
} from "./modelo-de-venta-rapida";
import {
  agregarALaCuenta,
  cambiarCantidad,
  cantidadDelProductoEnLaCuenta,
  pedidoDeCotizacion,
  quitarDeLaCuenta,
  type CotizacionDeLaVenta,
  type LineaDeLaVenta,
} from "./modelo-de-la-cuenta";

export type PropsDePantallaDeVentaRapida = Readonly<{
  secciones: readonly SeccionDeLaVenta[];
  productos: readonly ProductoDeLaVenta[];
  textos: TextosDeLaVenta;
  /** La cotización del servidor: la acción de servidor que llama a `cotizarElCarritoDeLaSucursal`. Es una lectura (repetirla no cambia nada). */
  cotizar: (pedido: unknown) => Promise<Respuesta<CotizacionDeLaVenta>>;
}>;

type EstadoDeLaCotizacion =
  | Readonly<{ tipo: "SIN_CUENTA" }>
  | Readonly<{ tipo: "PENDIENTE" }>
  | Readonly<{ tipo: "LISTA"; cotizacion: CotizacionDeLaVenta }>
  | Readonly<{ tipo: "ERROR"; error: ErrorPublico }>;

/** Lo que volvió del servidor y para QUÉ cuenta: una respuesta solo vale para la cuenta que la pidió. */
type Resultado = Readonly<{
  para: readonly LineaDeLaVenta[];
  respuesta: Respuesta<CotizacionDeLaVenta>;
}>;

/** Tras cerrar la hoja se ignora un segundo toque sobre un producto: evita abrirla dos veces con un doble toque (decisión 171 y maqueta v4). */
const ESPERA_TRAS_CERRAR_LA_HOJA_MS = 500;
const DURACION_DEL_AVISO_MS = 2500;
/** El total de una cuenta sin líneas: el cero de «no hay nada que cotizar» (no es un cálculo; con líneas el total es siempre el que da el servidor). */
const TOTAL_SIN_LINEAS = "0.00";

/**
 * La VENTA RÁPIDA del mostrador (maqueta `venta-rapida-v4.html`): los productos de la sucursal por sección, un buscador por nombre, la hoja del producto y la cuenta, con el total siempre a la
 * vista. La cuenta vive en este navegador hasta cobrar (cobrar es otra pantalla): nada se escribe ni se audita acá. **Ningún importe se calcula en el cliente**: cada cambio de la cuenta se
 * manda al servidor (`cotizar`) y el total y el importe de cada línea son los que vuelve a dar; mientras no llegue la cotización de la cuenta ACTUAL no se muestra ninguno (una respuesta vieja
 * se descarta). Sin textos propios: todos llegan resueltos.
 */
export function PantallaDeVentaRapida({
  secciones,
  productos,
  textos,
  cotizar,
}: PropsDePantallaDeVentaRapida) {
  const [busqueda, setBusqueda] = useState("");
  const [seccionId, setSeccionId] = useState<string | null>(null);
  const [abierto, setAbierto] = useState<ProductoDeLaVenta | null>(null);
  const [cuentaAbierta, setCuentaAbierta] = useState(false);
  const [cuenta, setCuenta] = useState<readonly LineaDeLaVenta[]>([]);
  const [resultado, setResultado] = useState<Resultado | null>(null);
  const [aviso, setAviso] = useState("");
  const hojaBloqueada = useRef(false);
  const temporizadorDeLaHoja = useRef<ReturnType<typeof setTimeout> | null>(null);

  const porId = useMemo(() => new Map(productos.map((p) => [p.id, p])), [productos]);
  const visibles = productosVisibles(productos, secciones, busqueda, seccionId);

  // Cada cambio de la cuenta se cotiza en el servidor. Una respuesta solo vale para la cuenta que la pidió: si la cuenta cambió mientras tanto, se descarta (nunca un total de otra cuenta a la vista).
  useEffect(() => {
    if (cuenta.length === 0) return;
    let vigente = true;
    cotizar(pedidoDeCotizacion(cuenta))
      .then((respuesta) => {
        if (vigente) setResultado({ para: cuenta, respuesta });
      })
      .catch(() => {
        // Un corte de red no deja una cotización a medias ni una vieja a la vista.
        if (vigente) {
          setResultado({
            para: cuenta,
            respuesta: { ok: false, error: errorDeCodigo("VENTAS_ACCION_NO_PERMITIDA") },
          });
        }
      });
    return () => {
      vigente = false;
    };
  }, [cuenta, cotizar]);

  useEffect(
    () => () => {
      if (temporizadorDeLaHoja.current !== null) clearTimeout(temporizadorDeLaHoja.current);
    },
    [],
  );

  const estado: EstadoDeLaCotizacion =
    cuenta.length === 0
      ? { tipo: "SIN_CUENTA" }
      : resultado?.para !== cuenta
        ? { tipo: "PENDIENTE" }
        : resultado.respuesta.ok
          ? { tipo: "LISTA", cotizacion: resultado.respuesta.dato }
          : { tipo: "ERROR", error: resultado.respuesta.error };

  useEffect(() => {
    if (aviso === "") return;
    const pasado = setTimeout(() => {
      setAviso("");
    }, DURACION_DEL_AVISO_MS);
    return () => {
      clearTimeout(pasado);
    };
  }, [aviso]);

  const abrirHoja = (producto: ProductoDeLaVenta) => {
    if (hojaBloqueada.current) return;
    setAbierto(producto);
  };
  const cerrarHoja = () => {
    hojaBloqueada.current = true;
    if (temporizadorDeLaHoja.current !== null) clearTimeout(temporizadorDeLaHoja.current);
    temporizadorDeLaHoja.current = setTimeout(() => {
      hojaBloqueada.current = false;
    }, ESPERA_TRAS_CERRAR_LA_HOJA_MS);
    setAbierto(null);
  };
  const agregar = (linea: LineaElegida) => {
    setCuenta((previa) => agregarALaCuenta(previa, linea));
    setAviso(`${textos.agregado} · ${porId.get(linea.productoId)?.nombre ?? ""}`);
    cerrarHoja();
  };

  const cotizacion = estado.tipo === "LISTA" ? estado.cotizacion : null;
  const formaAbierta = abierto === null ? null : formaDeCantidad(abierto);

  return (
    <div className={estilos["pantalla"]}>
      <Campo
        dato="texto-de-busqueda-de-producto"
        etiqueta={textos.buscar}
        tipo="search"
        autoComplete="off"
        valor={busqueda}
        alCambiar={setBusqueda}
      />
      {secciones.length === 0 ? null : (
        <div className={estilos["secciones"]} role="group" aria-label={textos.secciones}>
          <button
            type="button"
            className={estilos["seccion"]}
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
              className={estilos["seccion"]}
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
        <div className={estilos["sinResultados"]}>
          <p className={estilos["vacia"]}>{textoSinResultados(busqueda.trim())}</p>
          <p className={estilos["ayuda"]}>{textos.sinResultadosAyuda}</p>
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
        <section key={grupo.seccion?.id ?? "sin-seccion"} className={estilos["grupoDeProductos"]}>
          {grupo.seccion === null ? null : (
            <h2 className={estilos["titulo"]}>{grupo.seccion.nombre}</h2>
          )}
          <ul className={estilos["grilla"]}>
            {grupo.productos.map((p) => {
              const enLaCuenta = cantidadDelProductoEnLaCuenta(cuenta, p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    className={estilos["tarjeta"]}
                    data-en-la-cuenta={enLaCuenta > 0 ? "" : undefined}
                    disabled={!sePuedeAgregar(p)}
                    onClick={() => {
                      abrirHoja(p);
                    }}
                  >
                    <span className={estilos["nombre"]}>{p.nombre}</span>
                    {tieneOpciones(p) ? (
                      <span className={estilos["subtitulo"]}>{textos.conOpciones}</span>
                    ) : null}
                    <span className={estilos["precio"]}>{precioDeLaTarjeta(p, textos)}</span>
                    {enLaCuenta > 0 ? (
                      <span className={estilos["contador"]}>
                        {cantidadParaLeer(enLaCuenta, formaDeCantidad(p))}
                      </span>
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ))}

      <p className={estilos["aviso"]} role="status">
        {aviso}
      </p>

      {cuentaAbierta ? (
        <>
          {estado.tipo === "ERROR" ? <ErrorDeRespuesta error={estado.error} /> : null}
          <CuentaDeLaVenta
            cuenta={cuenta}
            productos={porId}
            cotizacion={cotizacion}
            textos={textos}
            alCambiarCantidad={(clave, cantidad) => {
              if (cantidad !== null)
                setCuenta((previa) => cambiarCantidad(previa, clave, cantidad));
            }}
            alQuitar={(clave) => {
              setCuenta((previa) => quitarDeLaCuenta(previa, clave));
            }}
          />
        </>
      ) : null}

      <div className={estilos["barra"]}>
        <button
          type="button"
          className={estilos["verCuenta"]}
          aria-expanded={cuentaAbierta}
          aria-controls="cuenta-de-la-venta"
          onClick={() => {
            setCuentaAbierta(!cuentaAbierta);
          }}
        >
          {textos.verCuenta}
          {cuenta.length === 0 ? null : <span className={estilos["cuantas"]}>{cuenta.length}</span>}
        </button>
        <p className={estilos["total"]} aria-busy={estado.tipo === "PENDIENTE"}>
          <span>{textos.total}</span>
          <strong data-total>
            {estado.tipo === "SIN_CUENTA"
              ? formatearImporte(TOTAL_SIN_LINEAS)
              : cotizacion === null
                ? ""
                : formatearImporte(cotizacion.total.monto)}
          </strong>
        </p>
      </div>

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
            alAgregar={agregar}
            alCancelar={cerrarHoja}
          />
        )}
      </Superposicion>
    </div>
  );
}
