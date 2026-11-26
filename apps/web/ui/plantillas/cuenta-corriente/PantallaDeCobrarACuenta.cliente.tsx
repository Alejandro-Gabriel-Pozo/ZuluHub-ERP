"use client";

import { useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { EnlaceDeAccion } from "../../componentes/EnlaceDeAccion";
import { Insignia } from "../../componentes/Insignia";
import { Selector } from "../../componentes/Selector";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { DatosDelMedio } from "../cobrar/DatosDelMedio.cliente";
import { useEnvioDelPedido } from "../cobrar/useEnvioDelPedido.cliente";
import {
  cambiarDeMedio,
  cambiarUnDato,
  estadoDelCobro,
  nombreDelMedio,
  type MedioParaCobrar,
  type PagoEnEdicion,
} from "../cobrar/modelo-de-cobro";
import type { TextosDeCobrar } from "../cobrar/textos-de-cobrar";
import estilos from "./CuentaCorriente.module.css";
import {
  armarLaHoja,
  armarLoCobrado,
  cajaInicial,
  cajasParaElegir,
  lineaDeLaCaja,
  pagoInicial,
  pedidoDeCobrarACuenta,
  sePuedeCobrar,
  textoDeCobrar,
  type HojaParaCobrarALaCuenta,
  type TicketCobradoALaCuenta,
} from "./modelo-de-cobrar-a-cuenta";
import type { TextosDeCobrarACuenta } from "./textos-de-cobrar-a-cuenta";

const uuid = (): string => crypto.randomUUID();

export type PropsDePantallaDeCobrarACuenta = Readonly<{
  hoja: HojaParaCobrarALaCuenta;
  textos: TextosDeCobrarACuenta;
  /** Los textos del cobro del mostrador: los datos del medio (cupón, últimos 4, marca, cuotas, DNI) y los avisos de conexión son los mismos. */
  textosDeCobrar: TextosDeCobrar;
  /** Si la persona puede cobrar (`tickets.cobrar`): sin ese permiso «Cobrar» sale apagado. Es una ayuda: el servidor decide. */
  puedeCobrar: boolean;
  /** La acción de servidor: recibe el pedido con la clave de idempotencia y devuelve lo hecho (repetir con la misma clave devuelve lo mismo). */
  cobrar: (pedido: unknown) => Promise<Respuesta<TicketCobradoALaCuenta>>;
  /** Adónde vuelve «Cancelar» y lleva «Ver la cuenta del cliente»: la ficha. */
  hrefDeLaFicha: string;
  /** «Cobrar otro ticket»: la misma pantalla, que lee el siguiente cargo pendiente. */
  hrefDeCobrarOtro: string;
  nuevoId?: () => string;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

/**
 * «Cobrar un ticket a cuenta» (CC-5 B2b; maqueta P4 `cuenta-corriente-ficha-listado-y-cobro.html`): el cliente, el ticket (número, canal y fecha), cuándo vencía, el TOTAL a cobrar, el medio, la caja donde
 * entra el cobro y «Cobrar». Cobra el ticket entero por el total que muestra, pero el importe NO viaja: lo pone el servidor. Con el pedido en vuelo, incierto o hecho nada se edita: la clave de idempotencia
 * es una por intento (`useEnvioConClave`), así un doble clic o un reintento tras un corte devuelve lo hecho y no cobra dos veces. Al terminar, la misma pantalla pasa a «Cobrado» con el saldo del cliente.
 * Sin caja abierta hoy (o con el día en auditoría o cerrado) avisa y «Cobrar» queda apagado; lo demás lo decide el servidor y su rechazo se muestra tal cual.
 */
export function PantallaDeCobrarACuenta({
  hoja,
  textos,
  textosDeCobrar,
  puedeCobrar,
  cobrar,
  hrefDeLaFicha,
  hrefDeCobrarOtro,
  nuevoId = uuid,
  esperaEntreVerificacionesMs,
}: PropsDePantallaDeCobrarACuenta) {
  const cajas = cajasParaElegir(hoja);
  const [cajaId, setCajaId] = useState(() => cajaInicial(cajas));
  const [pago, setPago] = useState<PagoEnEdicion | null>(() => pagoInicial(hoja, nuevoId()));
  const { envio, enviar, inesperado } = useEnvioDelPedido<TicketCobradoALaCuenta>({
    mandar: cobrar,
    textos: {
      sinConexion: textosDeCobrar.noSePuedeEnviar,
      verificando: textosDeCobrar.verificando,
    },
    esperaEntreVerificacionesMs,
  });
  const medios = hoja.opciones?.medios ?? [];
  const medio: MedioParaCobrar | undefined = medios.find((m) => m.id === pago?.medioId);
  const cobrado = envio.estado.tipo === "hecho" ? envio.estado.valor : null;
  // Con un envío en curso, incierto o hecho nada se edita: otro pedido con la misma clave sería un error, y con otra clave podría cobrar dos veces.
  const congelado = envio.enCurso || envio.estado.tipo === "incierto" || cobrado !== null;

  if (cobrado !== null) {
    return (
      <div className={estilos["cuerpo"]} role="status">
        <div className={estilos["encabezado"]}>
          <Insignia tono="exito">{textos.cobrado}</Insignia>
        </div>
        <p>{armarLoCobrado(cobrado, medio).detalle}</p>
        <div className={estilos["acciones"]}>
          <EnlaceDeAccion href={hrefDeLaFicha}>{textos.verCuenta}</EnlaceDeAccion>
          <EnlaceDeAccion href={hrefDeCobrarOtro} variante="secundaria">
            {textos.cobrarOtro}
          </EnlaceDeAccion>
        </div>
      </div>
    );
  }

  const armada = armarLaHoja(hoja, textos);
  const cuenta = pago === null ? null : estadoDelCobro(hoja.ticket.total, [pago], medios);
  const puede = sePuedeCobrar({ hoja, puedeCobrar, cajaId, pago });

  const alCobrar = () => {
    if (!puede || pago === null) return;
    const pedido = pedidoDeCobrarACuenta({ hoja, cajaId, pago });
    if (pedido !== null) enviar(pedido);
  };

  return (
    <div className={estilos["cuerpo"]}>
      <p className={estilos["suave"]}>{textos.nota}</p>
      <dl className={estilos["condiciones"]}>
        <div>
          <dt>{textos.cliente}</dt>
          <dd>{armada.cliente}</dd>
        </div>
        <div>
          <dt>{textos.ticket}</dt>
          <dd>{armada.ticket}</dd>
        </div>
        <div>
          <dt>{textos.venciaEl}</dt>
          <dd>
            {armada.venceEl}
            {armada.vencida === null ? null : (
              <>
                {" "}
                <Insignia tono="peligro">{armada.vencida}</Insignia>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{textos.totalACobrar}</dt>
          <dd>{armada.total}</dd>
        </div>
      </dl>
      {pago === null || hoja.opciones === null ? null : (
        <>
          <Selector
            dato="medio-de-cobro"
            etiqueta={textos.medio}
            valor={pago.medioId}
            alCambiar={(id) => {
              const nuevo = medios.find((m) => m.id === id);
              if (nuevo !== undefined) setPago(cambiarDeMedio(pago, nuevo));
            }}
            opciones={medios.map((m) => ({ valor: m.id, etiqueta: nombreDelMedio(m) }))}
            deshabilitado={congelado}
          />
          {medio === undefined || medio.cuentas.length === 0 ? null : (
            <Selector
              dato="cuenta-de-cobro"
              etiqueta={textosDeCobrar.cuentaDeCobro}
              textoDeElegir={textosDeCobrar.sinElegir}
              valor={pago.cuentaId}
              alCambiar={(cuentaId) => {
                setPago({ ...pago, cuentaId });
              }}
              opciones={medio.cuentas.map((c) => ({ valor: c.id, etiqueta: c.nombre }))}
              deshabilitado={congelado}
            />
          )}
          {medio === undefined ? null : (
            <DatosDelMedio
              admite={medio.datosQuePide}
              datos={pago.datos}
              errores={cuenta?.filas[0]?.erroresDeDatos ?? {}}
              marcas={hoja.opciones.marcasDeTarjeta}
              textos={textosDeCobrar}
              alCambiar={(dato, valor) => {
                setPago(cambiarUnDato(pago, dato, valor));
              }}
              deshabilitado={congelado}
            />
          )}
        </>
      )}
      {cajas.length === 0 ? (
        <Aviso tono="aviso">{textos.sinCaja}</Aviso>
      ) : (
        <>
          <Selector
            dato="caja-de-cobro-a-cuenta"
            etiqueta={textos.caja}
            textoDeElegir={textosDeCobrar.sinElegir}
            valor={cajaId}
            alCambiar={setCajaId}
            opciones={cajas.map((c) => ({ valor: c.cajaId, etiqueta: c.etiqueta }))}
            deshabilitado={congelado}
          />
          <p className={estilos["suave"]}>{lineaDeLaCaja(cajas, cajaId)}</p>
        </>
      )}
      {envio.estado.tipo === "rechazado" ? <ErrorDeRespuesta error={envio.estado.rechazo} /> : null}
      {inesperado === null ? null : <ErrorDeRespuesta error={inesperado} />}
      <div className={estilos["acciones"]}>
        <a className={estilos["secundario"]} href={hrefDeLaFicha}>
          {textos.cancelar}
        </a>
        <Boton
          deshabilitado={!puede || envio.bloqueado}
          motivo={envio.motivoQueNoPuede}
          enviando={envio.enCurso}
          textoEnviando={textosDeCobrar.enviando}
          alTocar={alCobrar}
        >
          {textoDeCobrar(hoja)}
        </Boton>
      </div>
    </div>
  );
}
