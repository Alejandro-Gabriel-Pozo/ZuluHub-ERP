"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton";
import { Campo } from "../../componentes/Campo";
import { Pila } from "../../primitivas/Pila";
import { AvisosDelEnvio } from "../configuracion-fiscal/AvisosDelEnvio";
import { useEnvioFijado } from "../configuracion-fiscal/useEnvioFijado";
import estilos from "./PantallaDeContactoDeLaSucursal.module.css";
import {
  armarElPedidoDeContacto,
  lugarDelErrorDeContacto,
  valoresDelContacto,
  type CampoDeContacto,
  type ContactoDeLaSucursal,
  type ValoresDeContacto,
} from "./modelo-de-contacto-de-la-sucursal";

export type PropsDePantallaDeContactoDeLaSucursal = Readonly<{
  sucursalId: string;
  /** El nombre actual de la sucursal: `editarSucursal` lo exige; no se edita acá y viaja como está. */
  nombre: string;
  /** La versión de la ficha que se está mirando: viaja como versión esperada. */
  version: number;
  /** El contacto actual de la ficha. */
  contacto: ContactoDeLaSucursal;
  /** `editarSucursal` (acción de servidor): el servidor decide el permiso y la validez de cada dato. */
  guardar: (pedido: unknown) => Promise<Respuesta<unknown>>;
  /** Adónde se va al guardar (también si no había nada que guardar). */
  rutaAlGuardar: string;
  /** Adónde se va con «Cancelar». */
  rutaAlCancelar: string;
}>;

/**
 * Contacto de la sucursal elegida en el dispositivo (D-98, alcance A de D-113): teléfono, correo y web, los tres opcionales.
 *  - Solo envía lo que cambió: un campo no tocado va ausente (no se toca) y uno vaciado va `null` (se borra); sin cambios no se envía nada
 *    y se vuelve como si hubiera guardado (`modelo-de-contacto-de-la-sucursal.ts`).
 *  - Idempotencia: el primer envío fija el pedido entero y un reintento tras un corte reenvía lo mismo (`useEnvioFijado`); además el
 *    servidor trata una edición ya aplicada como éxito.
 *  - Concurrencia: lleva la versión que vio la pantalla. Con «versión desactualizada» se vuelve a leer y el formulario parte de la ficha
 *    nueva (lo escrito se descarta: otra persona cambió la sucursal).
 *  - Errores: el que trae un `campo` se marca en ese campo y el foco va a él; los demás se dicen arriba. La validez la decide el servidor
 *    y la pantalla no valida permisos.
 */
export function PantallaDeContactoDeLaSucursal({
  sucursalId,
  nombre,
  version,
  contacto,
  guardar,
  rutaAlGuardar,
  rutaAlCancelar,
}: PropsDePantallaDeContactoDeLaSucursal) {
  const router = useRouter();
  const formulario = useRef<HTMLFormElement>(null);
  const [valores, setValores] = useState<ValoresDeContacto>(() => valoresDelContacto(contacto));
  const clave = `${sucursalId}:${String(version)}`;
  const [claveVista, setClaveVista] = useState(clave);

  // Llegó otra versión de la ficha (después de «versión desactualizada»): se parte de lo último.
  if (clave !== claveVista) {
    setClaveVista(clave);
    setValores(valoresDelContacto(contacto));
  }

  const { envio, enviarCon, fijado, referenciaIncierta } = useEnvioFijado<
    Readonly<Record<string, unknown>>,
    unknown
  >(guardar);
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueado = envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const lugar = rechazo === null ? null : lugarDelErrorDeContacto(rechazo.campo);
  const hecho = estado.tipo === "hecho";

  useEffect(() => {
    if (hecho) router.push(rutaAlGuardar);
  }, [hecho, router, rutaAlGuardar]);

  useEffect(() => {
    if (rechazo === null) return;
    if (rechazo.codigo === "FISCAL_VERSION_DESACTUALIZADA") router.refresh();
    // El foco va al campo marcado: la persona lo corrige sin buscarlo.
    formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [rechazo, router]);

  function poner(campo: CampoDeContacto, valor: string): void {
    setValores((previo) => ({ ...previo, [campo]: valor }));
    envio.reiniciar();
  }

  const errorEn = (campo: CampoDeContacto): string | undefined =>
    rechazo !== null && lugar === campo ? texto({}, rechazo.clave) : undefined;

  function alEnviar(evento: SyntheticEvent): void {
    evento.preventDefault();
    // Con Enter dentro de un campo, el foco está en un campo que se apaga (`disabled`) al enviar y caería al <body>: pasa al botón de
    // envío, que durante el envío queda `aria-disabled` y lo conserva.
    formulario.current?.querySelector<HTMLElement>('button[type="submit"]')?.focus();
    const pedido = armarElPedidoDeContacto({ sucursalId, nombre, version }, contacto, valores);
    // Nada cambió: no hay qué guardar, y se vuelve igual que tras un guardado.
    if (pedido === null) {
      if (!envio.enCurso) router.push(rutaAlGuardar);
      return;
    }
    enviarCon(pedido);
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
        <Campo
          etiqueta={texto({}, "sucursal.telefono")}
          nombre="telefono"
          tipo="tel"
          inputMode="tel"
          autoComplete="tel"
          valor={valores.telefono}
          alCambiar={(v) => {
            poner("telefono", v);
          }}
          error={errorEn("telefono")}
          deshabilitado={bloqueado}
        />
        <Campo
          etiqueta={texto({}, "sucursal.correo")}
          nombre="correo"
          tipo="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          valor={valores.correo}
          alCambiar={(v) => {
            poner("correo", v);
          }}
          error={errorEn("correo")}
          deshabilitado={bloqueado}
        />
        <Campo
          etiqueta={texto({}, "sucursal.web")}
          nombre="web"
          // Texto y no `url`: se guarda sin esquema, así que el navegador no debe exigir ni completar `https://`.
          tipo="text"
          inputMode="url"
          autoComplete="url"
          autoCapitalize="off"
          valor={valores.web}
          alCambiar={(v) => {
            poner("web", v);
          }}
          error={errorEn("web")}
          deshabilitado={bloqueado}
        />
        <div className={estilos["botones"]}>
          <Boton
            tipo="submit"
            enviando={envio.enCurso}
            textoEnviando={
              fijado === null ? undefined : texto({}, "fiscal.pantalla.config_pv_guardando")
            }
            deshabilitado={!envio.enCurso && envio.bloqueado}
            motivo={envio.motivoQueNoPuede}
          >
            {texto({}, "fiscal.pantalla.config_pv_guardar")}
          </Boton>
          <Boton
            variante="secundaria"
            // Mientras guarda no se puede cancelar, pero sin `disabled`: el foco no se pierde y el toque se ignora.
            enviando={envio.enCurso}
            alTocar={() => {
              router.push(rutaAlCancelar);
            }}
          >
            {texto({}, "fiscal.pantalla.config_pv_cancelar")}
          </Boton>
        </div>
      </Pila>
    </form>
  );
}
