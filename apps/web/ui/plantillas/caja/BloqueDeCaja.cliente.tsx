"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Insignia } from "../../componentes/Insignia";
import { FormularioDeApertura } from "./FormularioDeApertura.cliente";
import type { AccionesDeLaPantallaDeCaja } from "./lista-de-caja";
import {
  botonesDeLaCaja,
  cabeceraDeJornada,
  estadoDeLaCaja,
  textoDelEfectivo,
  type CajaDeLaPantalla,
} from "./modelo-de-la-caja";
import estilos from "./PantallaDeCaja.module.css";

/** Las acciones de servidor de la pantalla (`acciones-de-sesion-de-caja.ts`): reciben el pedido tal cual se armó y devuelven la respuesta ya traducida. */
export type AccionesDelServidorDeCaja = Readonly<{
  abrir: (pedido: unknown) => Promise<Respuesta<unknown>>;
}>;

export type PropsDeBloqueDeCaja = Readonly<{
  caja: CajaDeLaPantalla;
  permisos: AccionesDeLaPantallaDeCaja;
  acciones: AccionesDelServidorDeCaja;
}>;

type Vista = "inicio" | "abrir";

/**
 * Una caja de la sucursal en la pantalla «Caja» del mostrador (maqueta `caja.html`): caja cerrada con «Abrir caja» (formulario del fondo inicial) y caja abierta con su jornada y el efectivo
 * esperado. Qué vista se ve lo decide el servidor (el estado de la caja) más lo que la persona abrió (el formulario). Abrir termina con una recarga (`router.refresh`) y la pantalla no cambia
 * hasta tener la respuesta. El botón apagado es una ayuda: ocultar no es autorizar, el servidor decide al enviar y su rechazo se muestra como viene.
 */
export function BloqueDeCaja({ caja, permisos, acciones }: PropsDeBloqueDeCaja) {
  const router = useRouter();
  const [, empezarTransicion] = useTransition();
  const [vista, setVista] = useState<Vista>("inicio");
  const sesion = caja.sesion;
  const botones = botonesDeLaCaja(caja.estado, permisos);
  const estado = estadoDeLaCaja(caja.estado);

  // Recargar y, junto con la respuesta nueva, volver al inicio: así la pantalla no muestra el estado viejo entre una cosa y la otra.
  const alAbrir = () => {
    empezarTransicion(() => {
      router.refresh();
      setVista("inicio");
    });
  };

  if (sesion === null && vista === "abrir") {
    return (
      <section className={estilos["bloque"]} aria-label={caja.nombre}>
        <div className={estilos["cabecera"]}>
          <h2 className={estilos["titulo"]}>{texto({}, "caja.sesion.abrir")}</h2>
        </div>
        <FormularioDeApertura
          cajaId={caja.cajaId}
          abrir={acciones.abrir}
          puedeAbrir={permisos.abrir}
          alTerminar={alAbrir}
          alCancelar={() => {
            setVista("inicio");
          }}
        />
      </section>
    );
  }

  return (
    <section className={estilos["bloque"]} aria-label={caja.nombre}>
      <div className={estilos["cabecera"]}>
        <h2 className={estilos["titulo"]}>{caja.nombre}</h2>
        <Insignia tono={estado.tono}>{estado.texto}</Insignia>
      </div>
      {sesion === null ? (
        <div>
          <Boton
            alTocar={() => {
              setVista("abrir");
            }}
            deshabilitado={!botones.abrir}
          >
            {texto({}, "caja.sesion.abrir")}
          </Boton>
        </div>
      ) : (
        <>
          <p className={estilos["suave"]}>
            {cabeceraDeJornada(sesion.fechaDeNegocio, sesion.horaDeCorte)}
          </p>
          <p className={estilos["destacado"]}>{textoDelEfectivo(sesion.lineas)}</p>
        </>
      )}
    </section>
  );
}
