"use client";

import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import {
  errorDeCodigo,
  type ErrorPublico,
  type Respuesta,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { Boton } from "../../componentes/Boton.cliente";
import { Insignia } from "../../componentes/Insignia";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { Superposicion } from "../../patrones/Superposicion";
import type { LineaElegida } from "../venta/HojaDeProducto.cliente";
import {
  agregarALaCuenta,
  pedidoDeCotizacion,
  type CotizacionDeLaVenta,
} from "../venta/modelo-de-la-cuenta";
import type {
  ProductoDeLaVenta,
  SeccionDeLaVenta,
  TextosDeLaVenta,
} from "../venta/modelo-de-venta-rapida";
import { CatalogoDeLaMesa } from "./CatalogoDeLaMesa.cliente";
import estilos from "./PantallaDeLaMesa.module.css";
import type { MesaArmada, MesaLibre, PlatoArmado, TextosDeLaMesa } from "./modelo-de-la-mesa";
import { rutaDeLaCuentaDeMesa } from "./rutas-del-salon";

type Accion = (pedido: unknown) => Promise<Respuesta<unknown>>;

type AccionesDeLaMesa = Readonly<{
  tomarPedido: Accion;
  agregar: Accion;
  cambiarSalida: Accion;
  quitar: Accion;
  liberar: Accion;
  cambiarDeMesa: Accion;
}>;

export type PropsDePantallaDeLaMesa = Readonly<{
  mesaId: string;
  mesa: MesaArmada;
  textos: TextosDeLaMesa;
  acciones: AccionesDeLaMesa;
  /** El id de la cuenta de UN intento de «Tomar pedido»: lo fija la página al abrirse (recargar es otro intento). */
  cuentaNuevaId: string;
  /** Las mesas libres a las que se puede pasar la cuenta; `null` si la persona no puede cambiar de mesa (el botón no se ofrece). */
  mesasLibres: readonly MesaLibre[] | null;
  /** Lo que se ofrece para agregar; `null` si no se pudo leer (entonces no se ofrece agregar). */
  catalogo: Readonly<{
    secciones: readonly SeccionDeLaVenta[];
    productos: readonly ProductoDeLaVenta[];
    textos: TextosDeLaVenta;
    cotizar: (pedido: unknown) => Promise<Respuesta<CotizacionDeLaVenta>>;
  }> | null;
}>;

/** El error que se muestra: el de la respuesta o, si el pedido ni llegó a una respuesta, el genérico de «no permitido». */
const ERROR_SIN_RESPUESTA: ErrorPublico = errorDeCodigo("CATALOGO_ACCION_NO_PERMITIDA");

const nuevoId = (): string => crypto.randomUUID();

function Plato({
  plato,
  textos,
  ocupado,
  alCambiarSalida,
  alQuitar,
}: Readonly<{
  plato: PlatoArmado;
  textos: TextosDeLaMesa;
  ocupado: boolean;
  alCambiarSalida: (salida: "AHORA" | "DESPUES") => void;
  alQuitar: () => void;
}>) {
  return (
    <li className={estilos["plato"]}>
      <div className={estilos["datos"]}>
        <span>{plato.nombre}</span>
        {plato.nota === "" ? null : <span className={estilos["nota"]}>{plato.nota}</span>}
      </div>
      {plato.importe === null ? null : <span className={estilos["importe"]}>{plato.importe}</span>}
      {plato.salida === null ? null : (
        <button
          type="button"
          className={estilos["salida"]}
          aria-label={`${plato.salida === "AHORA" ? textos.saleAhora : textos.saleDespues}. ${textos.cuandoSale}: ${plato.nombre}`}
          aria-disabled={ocupado ? "true" : undefined}
          onClick={() => {
            if (!ocupado) alCambiarSalida(plato.salida === "AHORA" ? "DESPUES" : "AHORA");
          }}
        >
          {plato.salida === "AHORA" ? textos.saleAhora : textos.saleDespues}
        </button>
      )}
      {plato.quitable ? (
        <Boton variante="secundaria" alTocar={alQuitar} deshabilitado={ocupado}>
          {textos.quitar}
        </Boton>
      ) : null}
    </li>
  );
}

/**
 * La ficha de la mesa (SAL-B, S2; maqueta `salon.html` y `salida.html`): mesa libre → «Tomar pedido»; mesa con una cuenta → los platos agrupados por su estado de comanda, el total, agregar productos (la hoja de la
 * venta rápida), «Sale ahora» / «Sale después» y «Quitar» en lo que no se envió, «Liberar mesa» sin platos y «Cambiar de mesa». Cada acción escribe en el servidor (que decide el permiso, la sucursal y el precio) y la
 * pantalla se recarga con lo que quedó; mientras una acción está en vuelo ninguna otra sale (un doble toque es un solo envío). Repetir no duplica: «Tomar pedido» lleva el id de la cuenta que fijó la página, cada
 * plato el id de su intento (el mismo si se repite lo mismo tras un corte) y el resto es idempotente en el servidor. Sin textos propios: todos llegan resueltos.
 */
export function PantallaDeLaMesa({
  mesaId,
  mesa,
  textos,
  acciones,
  cuentaNuevaId,
  mesasLibres,
  catalogo,
}: PropsDePantallaDeLaMesa) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<ErrorPublico | null>(null);
  const [cambiando, setCambiando] = useState(false);
  // El pedido en vuelo: una sola cosa a la vez, también contra dos toques en el mismo instante (el estado se repinta tarde; la referencia no).
  const enVuelo = useRef(false);
  // El intento de agregar: repetir exactamente lo mismo (tras un corte de red, por ejemplo) reutiliza el id de la línea, así el servidor no la duplica; otra elección es otro intento.
  const intento = useRef<Readonly<{ para: string; lineaId: string }> | null>(null);

  const ejecutar = async (accion: Accion, pedido: unknown, alTerminar: () => void) => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    setOcupado(true);
    setError(null);
    try {
      const respuesta = await accion(pedido);
      if (respuesta.ok) {
        alTerminar();
      } else {
        setError(respuesta.error);
      }
    } catch {
      setError(ERROR_SIN_RESPUESTA);
    } finally {
      enVuelo.current = false;
      setOcupado(false);
    }
  };
  const recargar = () => {
    router.refresh();
  };

  const agregar = (linea: LineaElegida) => {
    if (mesa.cuentaId === null) return;
    const [pedido] = pedidoDeCotizacion(agregarALaCuenta([], linea)).lineas;
    if (pedido === undefined) return;
    const para = JSON.stringify([mesa.cuentaId, pedido]);
    if (intento.current === null || intento.current.para !== para) {
      intento.current = { para, lineaId: nuevoId() };
    }
    const lineaId = intento.current.lineaId;
    void ejecutar(acciones.agregar, { ...pedido, cuentaId: mesa.cuentaId, lineaId }, () => {
      intento.current = null;
      recargar();
    });
  };

  return (
    <div className={estilos["raiz"]}>
      {mesa.unida === null ? null : (
        <div className={estilos["cabecera"]}>
          <Insignia tono="info">{mesa.unida}</Insignia>
        </div>
      )}
      {error === null ? null : <ErrorDeRespuesta error={error} />}

      {mesa.modo === "LIBRE" ? (
        <>
          <p>{textos.mesaLibre}</p>
          <Boton
            enviando={ocupado}
            alTocar={() => {
              void ejecutar(acciones.tomarPedido, { cuentaId: cuentaNuevaId, mesaId }, recargar);
            }}
          >
            {textos.tomarPedido}
          </Boton>
        </>
      ) : null}

      {mesa.modo === "SOLO_LECTURA" && mesa.cuentasHijas.length > 0 ? (
        <ul className={estilos["cuentas"]}>
          {mesa.cuentasHijas.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
      ) : null}

      {mesa.modo === "CON_CUENTA" ? (
        <>
          {mesa.sinPlatos ? <p>{textos.sinPedido}</p> : null}
          {mesa.grupos.map((g) => (
            <section key={g.comanda} className={estilos["grupo"]}>
              <h3 className={estilos["subtitulo"]}>{g.titulo}</h3>
              <ul className={estilos["platos"]}>
                {g.platos.map((p) => (
                  <Plato
                    key={p.id}
                    plato={p}
                    textos={textos}
                    ocupado={ocupado}
                    alCambiarSalida={(salida) => {
                      if (mesa.cuentaId === null) return;
                      void ejecutar(
                        acciones.cambiarSalida,
                        { cuentaId: mesa.cuentaId, lineaId: p.id, salida },
                        recargar,
                      );
                    }}
                    alQuitar={() => {
                      if (mesa.cuentaId === null) return;
                      void ejecutar(
                        acciones.quitar,
                        { cuentaId: mesa.cuentaId, lineaId: p.id },
                        recargar,
                      );
                    }}
                  />
                ))}
              </ul>
            </section>
          ))}
          {mesa.total === null ? null : (
            <p className={estilos["total"]}>
              <span>{textos.total}</span>
              <strong>{mesa.total}</strong>
            </p>
          )}
          <div className={estilos["acciones"]}>
            {mesa.sinPlatos ? (
              <Boton
                variante="secundaria"
                deshabilitado={ocupado}
                alTocar={() => {
                  if (mesa.cuentaId === null) return;
                  void ejecutar(acciones.liberar, { cuentaId: mesa.cuentaId }, recargar);
                }}
              >
                {textos.liberar}
              </Boton>
            ) : null}
            {mesasLibres === null ? null : (
              <Boton
                variante="secundaria"
                deshabilitado={ocupado}
                alTocar={() => {
                  setCambiando(true);
                }}
              >
                {textos.cambiarDeMesa}
              </Boton>
            )}
          </div>
          {catalogo === null ? null : (
            <>
              <h3 className={estilos["subtitulo"]}>{textos.agregar}</h3>
              <CatalogoDeLaMesa
                secciones={catalogo.secciones}
                productos={catalogo.productos}
                textos={catalogo.textos}
                cotizar={catalogo.cotizar}
                ocupado={ocupado}
                alAgregar={agregar}
              />
            </>
          )}
        </>
      ) : null}

      <Superposicion
        abierta={cambiando && mesasLibres !== null}
        titulo={textos.pasarALaMesa}
        proposito="elegir"
        alCerrar={() => {
          setCambiando(false);
        }}
        cerrable={!ocupado}
        etiquetaDeCerrar={textos.cerrar}
      >
        {mesasLibres === null || mesasLibres.length === 0 ? (
          <p>{textos.noHayMesasLibres}</p>
        ) : (
          <ul className={estilos["destinos"]}>
            {mesasLibres.map((destino) => (
              <li key={destino.id}>
                <Boton
                  variante="secundaria"
                  deshabilitado={ocupado}
                  alTocar={() => {
                    if (mesa.cuentaId === null) return;
                    void ejecutar(
                      acciones.cambiarDeMesa,
                      { cuentaId: mesa.cuentaId, mesaDestinoId: destino.id },
                      () => {
                        setCambiando(false);
                        router.push(rutaDeLaCuentaDeMesa(destino.id));
                      },
                    );
                  }}
                >
                  {destino.titulo}
                </Boton>
              </li>
            ))}
          </ul>
        )}
      </Superposicion>
    </div>
  );
}
