"use client";

import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Pila } from "../../primitivas/Pila";
import estilos from "./AsistenteDeCertificado.module.css";
import { AvisosDelEnvio } from "./AvisosDelEnvio";
import {
  armarElPedidoDeCertificado,
  lugarDelErrorDelPedido,
  type AmbienteDeCertificado,
  type CampoDelPedido,
  type ValoresDelPedido,
} from "./modelo-de-certificado";
import { useEnvioFijado } from "./useEnvioFijado";

export type PedidoGenerado = Readonly<{ certificadoId: string; pedidoPem: string }>;

export type PropsDePasoGenerarPedido = Readonly<{
  emisorId: string;
  ambiente: AmbienteDeCertificado;
  /** El alias con el que se abre (en un reemplazo, el del certificado vigente: dueño, 2026-11-03, cuestionario «Reemplazar»). */
  aliasInicial: string;
  /** `generarPedidoDeCertificadoAccion`: recibe el pedido tal cual se armó. */
  generar: (pedido: unknown) => Promise<Respuesta<PedidoGenerado>>;
  /** Con el pedido ya generado: pasa al paso 2. */
  alGenerar: (generado: PedidoGenerado, alias: string) => void;
  alCancelar: () => void;
}>;

/**
 * Paso 1 del asistente del certificado: los tres datos del pedido. Idempotencia: el `id` del pedido se genera UNA vez al abrir el paso
 * (cada vez que se abre es un pedido nuevo, explícito: nunca uno silencioso) y el primer envío fija el pedido entero; un reintento tras
 * un corte reenvía lo mismo y el servidor devuelve el mismo pedido sin otra clave. Los rechazos de negocio sin texto aprobado salen con el
 * mensaje genérico y su referencia, y la pantalla queda libre para corregir (`inesperadoEsDefinitivo`). Lo que se escribe se valida en el
 * servidor. Nunca se registra ni se guarda el pedido recibido: vive solo en la pantalla.
 */
export function PasoGenerarPedido({
  emisorId,
  ambiente,
  aliasInicial,
  generar,
  alGenerar,
  alCancelar,
}: PropsDePasoGenerarPedido) {
  const formulario = useRef<HTMLFormElement>(null);
  const [id] = useState(() => crypto.randomUUID());
  const [valores, setValores] = useState<ValoresDelPedido>({
    alias: aliasInicial,
    cuitTitular: "",
    organizacion: "",
  });
  const { envio, enviarCon, referenciaIncierta } = useEnvioFijado<object, PedidoGenerado>(generar, {
    inesperadoEsDefinitivo: true,
  });
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueado = envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const lugar = rechazo === null ? null : lugarDelErrorDelPedido(rechazo.campo);
  const entregado = useRef(false);

  useEffect(() => {
    if (estado.tipo !== "hecho" || entregado.current) return;
    entregado.current = true;
    alGenerar(estado.valor, valores.alias);
  }, [estado, alGenerar, valores.alias]);

  useEffect(() => {
    if (rechazo === null) return;
    // El foco va al primer campo marcado: la persona lo corrige sin buscarlo.
    formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [rechazo]);

  function poner(campo: CampoDelPedido, valor: string): void {
    setValores((previo) => ({ ...previo, [campo]: valor }));
    envio.reiniciar();
  }

  const campo = (
    clave: CampoDelPedido,
    etiqueta: Parameters<typeof texto>[1],
    extra: Partial<Parameters<typeof Campo>[0]> = {},
  ) => (
    <Campo
      etiqueta={texto({}, etiqueta)}
      valor={valores[clave]}
      alCambiar={(v) => {
        poner(clave, v);
      }}
      autoComplete="off"
      autoCapitalize="off"
      error={rechazo !== null && lugar === clave ? texto({}, rechazo.clave) : undefined}
      deshabilitado={bloqueado}
      {...extra}
      dato="pendiente"
    />
  );

  function alEnviar(evento: SyntheticEvent): void {
    evento.preventDefault();
    // Con Enter dentro de un campo, el foco está en un campo que se apaga (`disabled`) al enviar y caería al <body>: pasa al botón de
    // envío, que durante el envío queda `aria-disabled` y lo conserva.
    formulario.current?.querySelector<HTMLElement>('button[type="submit"]')?.focus();
    enviarCon(armarElPedidoDeCertificado(valores, id, emisorId, ambiente));
  }

  return (
    <form ref={formulario} noValidate onSubmit={alEnviar}>
      <Pila separacion={4}>
        <AvisosDelEnvio
          enCurso={envio.enCurso}
          incierto={incierto}
          referenciaIncierta={referenciaIncierta}
          rechazo={rechazo !== null && lugar === null ? rechazo : null}
        />
        {campo("alias", "fiscal.pantalla.config_cert_alias")}
        {campo("cuitTitular", "fiscal.pantalla.config_cert_cuit_titular", { inputMode: "numeric" })}
        {campo("organizacion", "fiscal.pantalla.config_cert_organizacion")}
        <div className={estilos["botones"]}>
          <Boton variante="secundaria" enviando={envio.enCurso} alTocar={alCancelar}>
            {texto({}, "fiscal.pantalla.config_pv_cancelar")}
          </Boton>
          <Boton
            tipo="submit"
            enviando={envio.enCurso}
            textoEnviando={texto({}, "fiscal.pantalla.config_pv_guardando")}
            deshabilitado={!envio.enCurso && envio.bloqueado}
            motivo={envio.motivoQueNoPuede}
          >
            {texto({}, "fiscal.pantalla.config_cert_generar_pedido")}
          </Boton>
        </div>
      </Pila>
    </form>
  );
}
