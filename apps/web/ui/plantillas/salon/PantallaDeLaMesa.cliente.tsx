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
import type { armarLosTextosDeImprimir } from "../../patrones/papel/textos-de-imprimir";
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
import { AccionesDeLaMesa } from "./AccionesDeLaMesa.cliente";
import { CatalogoDeLaMesa } from "./CatalogoDeLaMesa.cliente";
import { EnviosDeLaMesa } from "./EnviosDeLaMesa.cliente";
import { HojaDeAnularItem } from "./HojaDeAnularItem.cliente";
import { HojaDeCambiarDeMesa } from "./HojaDeCambiarDeMesa.cliente";
import { ImpresionDelDocumento } from "./ImpresionDelDocumento.cliente";
import estilos from "./PantallaDeLaMesa.module.css";
import { PlatoDeLaMesa } from "./PlatoDeLaMesa.cliente";
import { UnirODividirLaMesa } from "./UnirODividirLaMesa.cliente";
import { CuentasDeLaMesaDividida } from "./CuentasDeLaMesaDividida.cliente";
import type { TextosDeDividir } from "./textos-de-dividir";
import {
  tituloDelEnvio,
  type MesaArmada,
  type MesaParaUnir,
  type MesaLibre,
  type PlatoArmado,
  type TextosDeLaMesa,
} from "./modelo-de-la-mesa";
import { rutaDeCobrarLaCuenta, rutaDeCobrarLaMesa, rutaDeLaCuentaDeMesa } from "./rutas-del-salon";
import type { AccionesDelServidorDeLaMesa } from "./acciones-de-la-mesa";
import { useCocinaDeLaMesa } from "./useCocinaDeLaMesa.cliente";

export type PropsDePantallaDeLaMesa = Readonly<{
  mesaId: string;
  mesa: MesaArmada;
  textos: TextosDeLaMesa;
  textosDeDividir: TextosDeDividir;
  acciones: AccionesDelServidorDeLaMesa;
  /** El id de la cuenta de UN intento de «Tomar pedido»: lo fija la página al abrirse (recargar es otro intento). */
  cuentaNuevaId: string;
  /** Las mesas libres a las que se puede pasar la cuenta; `null` si la persona no puede cambiar de mesa (el botón no se ofrece). */
  mesasLibres: readonly MesaLibre[] | null;
  /** Los textos de imprimir ya resueltos (los aprobados de `comandas.texto.imprimir_*`). */
  textosDeImprimir: ReturnType<typeof armarLosTextosDeImprimir>;
  /** Lo que la persona puede hacer con la cocina (solo ayudas: el servidor decide). `enviar` abre enviar, pedir que salga y anular; `reimprimir`, las copias; `imprimir`, el botón de imprimir. */
  puede: Readonly<{
    enviar: boolean;
    imprimir: boolean;
    reimprimir: boolean;
    cobrar: boolean;
    unir: boolean;
    dividir: boolean;
  }>;
  /** Las mesas a las que se puede unir esta (`mesasParaUnir`); `null` si no se pudieron leer: no se ofrece unir. */
  mesasParaUnir: readonly MesaParaUnir[] | null;
  /** Adónde lleva «Configurar impresoras»; `null` si la persona no puede ir (el enlace no se ofrece). */
  rutaDeImpresoras: string | null;
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
  textosDeDividir,
  acciones,
  cuentaNuevaId,
  mesasLibres,
  textosDeImprimir,
  puede,
  rutaDeImpresoras,
  mesasParaUnir,
  catalogo,
}: PropsDePantallaDeLaMesa) {
  const router = useRouter();
  const [ocupado, setOcupado] = useState(false);
  const [error, setError] = useState<ErrorPublico | null>(null);
  const [cambiando, setCambiando] = useState(false);
  const [anulando, setAnulando] = useState<PlatoArmado | null>(null);
  // El pedido en vuelo: una sola cosa a la vez, también contra dos toques en el mismo instante (el estado se repinta tarde; la referencia no).
  const enVuelo = useRef(false);
  // El intento de agregar: repetir exactamente lo mismo (tras un corte de red, por ejemplo) reutiliza el id de la línea, así el servidor no la duplica; otra elección es otro intento.
  const intento = useRef<Readonly<{ para: string; lineaId: string }> | null>(null);

  const ejecutar = async <R,>(
    accion: (pedido: unknown) => Promise<Respuesta<R>>,
    pedido: unknown,
    alTerminar: (dato: R) => void,
  ) => {
    if (enVuelo.current) return;
    enVuelo.current = true;
    setOcupado(true);
    setError(null);
    try {
      const respuesta = await accion(pedido);
      if (respuesta.ok) {
        alTerminar(respuesta.dato);
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
  const cocina = useCocinaDeLaMesa(mesa.cuentaId, acciones, ejecutar, recargar);

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
        <CuentasDeLaMesaDividida
          cuentas={mesa.cuentasHijas}
          textos={textosDeDividir}
          puedeCobrar={puede.cobrar}
          ocupado={ocupado}
          alCobrar={(c) => {
            router.push(rutaDeCobrarLaCuenta(mesaId, c.cuentaId));
          }}
        />
      ) : null}

      {mesa.modo === "CON_CUENTA" ? (
        <>
          {mesa.sinPlatos ? <p>{textos.sinPedido}</p> : null}
          {cocina.documento === null ? null : (
            <ImpresionDelDocumento
              key={cocina.documento.clave}
              documento={cocina.documento}
              textos={textosDeImprimir}
              textoDeLaCopia={textos.reimprimir}
              acciones={acciones}
              deshabilitado={!puede.imprimir}
              configurarImpresoras={
                rutaDeImpresoras === null ? null : (
                  <a href={rutaDeImpresoras}>{textos.configurarImpresoras}</a>
                )
              }
            />
          )}
          {mesa.grupos.map((g) => (
            <section key={g.comanda} className={estilos["grupo"]}>
              <h3 className={estilos["subtitulo"]}>{g.titulo}</h3>
              <ul className={estilos["platos"]}>
                {g.platos.map((p) => (
                  <PlatoDeLaMesa
                    key={p.id}
                    plato={p}
                    textos={textos}
                    ocupado={ocupado}
                    conCocina={puede.enviar}
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
                    alPedirQueSalga={() => {
                      cocina.pedirQueSalga([p.id], tituloDelEnvio);
                    }}
                    alAnular={() => {
                      setAnulando(p);
                    }}
                  />
                ))}
              </ul>
              {puede.enviar && g.comanda === "PARA_ENVIAR" ? (
                <Boton
                  deshabilitado={ocupado}
                  enviando={ocupado}
                  alTocar={() => {
                    cocina.enviar(tituloDelEnvio);
                  }}
                >
                  {textos.enviarACocina}
                </Boton>
              ) : null}
              {puede.enviar && g.comanda === "ESPERA" ? (
                <Boton
                  variante="secundaria"
                  deshabilitado={ocupado}
                  alTocar={() => {
                    cocina.pedirQueSalga("TODAS", tituloDelEnvio);
                  }}
                >
                  {textos.pedirQueSalgaTodo}
                </Boton>
              ) : null}
            </section>
          ))}
          {mesa.total === null ? null : (
            <p className={estilos["total"]}>
              <span>{textos.total}</span>
              <strong>{mesa.total}</strong>
            </p>
          )}
          {puede.reimprimir && mesa.envios.length > 0 ? (
            <EnviosDeLaMesa
              envios={mesa.envios}
              textos={textos}
              ocupado={ocupado}
              alCopiar={(e) => {
                cocina.copiar(e.envioId, e.titulo);
              }}
            />
          ) : null}
          <AccionesDeLaMesa
            textos={textos}
            ocupado={ocupado}
            puedeCobrar={puede.cobrar}
            cobrarApagado={
              mesa.hayParaEnviar || mesa.hayEnEspera || mesa.sinPlatos || mesa.totalACobrar === null
            }
            alCobrar={() => {
              router.push(rutaDeCobrarLaMesa(mesaId));
            }}
            sinPlatos={mesa.sinPlatos}
            alLiberar={() => {
              if (mesa.cuentaId === null) return;
              void ejecutar(acciones.liberar, { cuentaId: mesa.cuentaId }, recargar);
            }}
            puedeCambiarDeMesa={mesasLibres !== null}
            alCambiarDeMesa={() => {
              setCambiando(true);
            }}
          />
          <UnirODividirLaMesa
            mesa={mesa}
            textos={textos}
            textosDeDividir={textosDeDividir}
            puede={puede}
            mesasParaUnir={mesasParaUnir}
            ocupado={ocupado}
            error={error}
            acciones={acciones}
            ejecutar={ejecutar}
            alUnida={(destino) => {
              router.push(rutaDeLaCuentaDeMesa(destino.mesaId));
            }}
            alDividida={recargar}
          />
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

      {anulando === null ? null : (
        <HojaDeAnularItem
          plato={{ id: anulando.id, nombre: anulando.nombre, cantidad: anulando.cantidad }}
          textos={{
            anular: textos.anular,
            motivo: textos.motivo,
            cantidad: textos.cantidad,
            cancelar: textos.cancelar,
            cerrar: textos.cerrar,
          }}
          ocupado={ocupado}
          error={error}
          alAnular={(pedido) => {
            cocina.anular(pedido, textos.itemAnulado, () => {
              setAnulando(null);
            });
          }}
          alCancelar={() => {
            setAnulando(null);
          }}
        />
      )}

      <HojaDeCambiarDeMesa
        abierta={cambiando && mesasLibres !== null}
        mesasLibres={mesasLibres}
        textos={textos}
        ocupado={ocupado}
        alCerrar={() => {
          setCambiando(false);
        }}
        alElegir={(destino) => {
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
      />
    </div>
  );
}
