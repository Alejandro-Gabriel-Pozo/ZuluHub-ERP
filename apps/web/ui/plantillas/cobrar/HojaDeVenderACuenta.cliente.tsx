"use client";

import { useEffect, useId, useRef, useState } from "react";
import {
  errorDeCodigo,
  type ErrorPublico,
} from "../../../../../src/capacidades/experiencia/respuesta";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonIcono } from "../../componentes/BotonIcono";
import { Selector } from "../../componentes/Selector";
import { ErrorDeRespuesta } from "../../patrones/ErrorDeRespuesta";
import { formatearImporte } from "../../patrones/formato-fiscal";
import estilos from "./Cobrar.module.css";
import {
  superaElLimite,
  type ClienteElegidoAlVender,
  type ClienteParaElegirAlVender,
  type VentaACuentaDelCobro,
  type VentaACuenta,
} from "./modelo-de-vender-a-cuenta";
import type { TextosDeCobrar } from "./textos-de-cobrar";
import {
  rotuloDelCuit,
  rotuloDelPlazo,
  type TextosDeVenderACuenta,
} from "./textos-de-vender-a-cuenta";
import { useEnvioDelPedido } from "./useEnvioDelPedido.cliente";

export type PropsDeHojaDeVenderACuenta = Readonly<{
  /** El total de la venta: el que cotizó el servidor y vio quien vende (es el `totalEsperado`). */
  total: Readonly<{ moneda: string; monto: string }>;
  /** Los clientes, el saldo de uno y la confirmación (acciones de servidor). */
  aCuenta: VentaACuentaDelCobro;
  textos: TextosDeVenderACuenta;
  textosDelCobro: TextosDeCobrar;
  /** El pedido de confirmar con los ids de la venta (los mismos del intento de cobro) y el cliente elegido. */
  pedidoDeLaVenta: (clienteId: string) => Readonly<Record<string, unknown>> | null;
  /** Solo la mesa: la cuenta de consumo ABIERTA donde se vende (la venta rápida no tiene cuenta hasta confirmar). */
  cuentaDeConsumoId?: string | undefined;
  /** La venta quedó cargada a la cuenta del cliente: el cobro muestra su resultado. */
  alVendida: (venta: VentaACuenta) => void;
  alVolver: () => void;
  esperaEntreVerificacionesMs?: number | undefined;
}>;

type Vista =
  | Readonly<{ tipo: "sin_elegir" }>
  | Readonly<{ tipo: "cargando" }>
  | Readonly<{ tipo: "listo"; cliente: ClienteElegidoAlVender }>
  | Readonly<{ tipo: "error"; error: ErrorPublico }>;

const etiquetaDelCliente = (c: ClienteParaElegirAlVender, cuit: (c: string) => string): string =>
  [c.nombre ?? "", c.cuit === null ? "" : cuit(c.cuit), rotuloDelPlazo(c.plazoDias)]
    .filter((parte) => parte !== "")
    .join(" · ");

/**
 * La hoja «Vender a cuenta corriente» (CC-5 B1b; maquetas `cuenta-corriente-elegir-cliente` y `cuenta-corriente-aprobar-exceso`): se elige el cliente, se ve su saldo, su crédito disponible y lo que pasaría con ESTA
 * venta (todo calculado por el servidor: la pantalla no suma dinero) y se confirma. El servidor decide todo lo que importa (permiso, cliente de la empresa y con cuenta habilitada, límite, total que cambió, stock):
 * la pantalla solo ofrece lo que él ofreció.
 *
 * Primera etapa, decisión del dueño (DEC-CCL-008): NO hay hoja de aprobar. Con el límite pasado, «Confirmar» queda apagado para todos y solo se puede elegir otro cliente; quien tiene `aprobar_exceso` sube el límite del
 * cliente por «Condiciones» y vuelve. Quien NO la tiene ve además que no puede aprobar (lo dice el servidor: `puedeAprobarElExceso`). El pedido nunca lleva aprobación del exceso.
 *
 * Idempotencia: la cuenta, el ejemplar y las líneas son los del intento de cobro y el envío se fija una vez; un doble toque en «Confirmar» es UN envío (la guarda es síncrona) y, mientras el resultado es incierto, no se
 * puede cambiar de cliente ni volver: otro pedido podría cargar la venta a dos cuentas. Elegir un cliente deja su constancia de consulta; las respuestas viejas (se eligió otro después) se descartan.
 */
export function HojaDeVenderACuenta({
  total,
  aCuenta,
  textos,
  textosDelCobro,
  pedidoDeLaVenta,
  cuentaDeConsumoId,
  alVendida,
  alVolver,
  esperaEntreVerificacionesMs,
}: PropsDeHojaDeVenderACuenta) {
  const [clienteId, setClienteId] = useState("");
  const [vista, setVista] = useState<Vista>({ tipo: "sin_elegir" });
  const consulta = useRef(0);
  const idDelTitulo = useId();
  const tituloRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    tituloRef.current?.focus();
  }, []);

  const { envio, enviar, inesperado } = useEnvioDelPedido<VentaACuenta>({
    mandar: aCuenta.confirmar,
    textos: { sinConexion: textosDelCobro.noSePuedeEnviar, verificando: textosDelCobro.verificando },
    esperaEntreVerificacionesMs,
  });
  const congelado =
    envio.enCurso || envio.estado.tipo === "incierto" || envio.estado.tipo === "hecho";

  const vendida = envio.estado.tipo === "hecho" ? envio.estado.valor : null;
  useEffect(() => {
    if (vendida !== null) alVendida(vendida);
  }, [vendida, alVendida]);

  const elegir = (id: string) => {
    setClienteId(id);
    consulta.current += 1;
    const esta = consulta.current;
    if (id === "") {
      setVista({ tipo: "sin_elegir" });
      return;
    }
    setVista({ tipo: "cargando" });
    void aCuenta
      .verCliente({
        clienteId: id,
        totalDeLaVenta: total.monto,
        ...(cuentaDeConsumoId === undefined ? {} : { cuentaDeConsumoId }),
      })
      .then((respuesta) => {
        if (consulta.current !== esta) return;
        setVista(
          respuesta.ok
            ? { tipo: "listo", cliente: respuesta.dato }
            : { tipo: "error", error: respuesta.error },
        );
      })
      .catch(() => {
        if (consulta.current !== esta) return;
        setVista({ tipo: "error", error: errorDeCodigo("NO_DISPONIBLE") });
      });
  };

  const cliente = vista.tipo === "listo" ? vista.cliente : null;
  const excede = cliente !== null && superaElLimite(cliente);
  const suspendida = cliente?.estado === "SUSPENDIDA";
  const puedeConfirmar = cliente !== null && !excede && !suspendida && clienteId !== "";

  const alConfirmar = () => {
    if (!puedeConfirmar) return;
    const pedido = pedidoDeLaVenta(clienteId);
    if (pedido !== null) enviar(pedido);
  };

  return (
    <section className={estilos["vista"]} aria-labelledby={idDelTitulo}>
      <header className={estilos["encabezado"]}>
        <BotonIcono
          etiqueta={textosDelCobro.volverAlCobro}
          icono="atras"
          deshabilitado={congelado}
          alTocar={alVolver}
        />
        <h2 id={idDelTitulo} ref={tituloRef} tabIndex={-1} className={estilos["titulo"]}>
          {textos.titulo}
        </h2>
      </header>
      <div className={estilos["cuerpo"]}>
        <p className={estilos["total"]}>
          <span>{textosDelCobro.total}</span>
          <strong>{formatearImporte(total.monto)}</strong>
        </p>
        <Selector
          dato="cliente-a-cuenta-de-la-venta"
          etiqueta={textos.cliente}
          valor={clienteId}
          alCambiar={elegir}
          deshabilitado={congelado}
          textoDeElegir={textosDelCobro.sinElegir}
          opciones={aCuenta.clientes.map((c) => ({
            valor: c.parteId,
            etiqueta: etiquetaDelCliente(c, rotuloDelCuit),
          }))}
        />
        {vista.tipo === "error" ? <ErrorDeRespuesta error={vista.error} /> : null}
        {cliente === null ? null : (
          <>
            {suspendida ? (
              <p className={estilos["estado"]}>
                {textos.estado}: {textos.suspendida}
              </p>
            ) : null}
            <ul className={estilos["resumen"]}>
              <li>
                <span>{textos.saldoActual}</span>
                <span>{formatearImporte(cliente.saldo.monto)}</span>
              </li>
              <li>
                <span>{textos.creditoDisponible}</span>
                <span>{formatearImporte(cliente.disponible.monto)}</span>
              </li>
              <li>
                <span>{textos.estaVenta}</span>
                <span>{formatearImporte(total.monto)}</span>
              </li>
              {cliente.saldoDespues === null ? null : (
                <li>
                  <strong>{textos.saldoDespues}</strong>
                  <strong>{formatearImporte(cliente.saldoDespues.monto)}</strong>
                </li>
              )}
            </ul>
            {excede ? (
              <Aviso tono="peligro">
                {textos.superaElLimite}
                {cliente.puedeAprobarElExceso ? null : ` ${textos.sinPermisoParaAprobar}`}
              </Aviso>
            ) : null}
          </>
        )}
        {envio.estado.tipo === "rechazado" ? <ErrorDeRespuesta error={envio.estado.rechazo} /> : null}
        {inesperado === null ? null : <ErrorDeRespuesta error={inesperado} />}
        {excede && !congelado ? (
          <Boton
            variante="secundaria"
            ancho="completo"
            alTocar={() => {
              elegir("");
            }}
          >
            {textos.elegirOtroCliente}
          </Boton>
        ) : null}
      </div>
      <div className={estilos["pie"]}>
        <Boton
          ancho="completo"
          deshabilitado={!puedeConfirmar || envio.bloqueado}
          motivo={envio.motivoQueNoPuede}
          enviando={envio.enCurso}
          textoEnviando={textosDelCobro.enviando}
          alTocar={alConfirmar}
        >
          {textos.confirmar}
        </Boton>
      </div>
    </section>
  );
}
