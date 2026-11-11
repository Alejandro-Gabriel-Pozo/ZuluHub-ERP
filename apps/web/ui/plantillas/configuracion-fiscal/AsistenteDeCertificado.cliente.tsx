"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Insignia } from "../../componentes/Insignia";
import { Pila } from "../../primitivas/Pila";
import { Texto } from "../../primitivas/Texto";
import estilos from "./AsistenteDeCertificado.module.css";
import { DatosParaLeer } from "./DatosParaLeer";
import type { AmbienteDeCertificado, ArranqueDelAmbiente } from "./modelo-de-certificado";
import { PasoCargarCertificado } from "./PasoCargarCertificado.cliente";
import { PasoDelPedido } from "./PasoDelPedido.cliente";
import { PasoGenerarPedido, type PedidoGenerado } from "./PasoGenerarPedido.cliente";

export type PropsDeAsistenteDeCertificado = Readonly<{
  emisorId: string;
  ambiente: AmbienteDeCertificado;
  arranque: ArranqueDelAmbiente;
  /** `generarPedidoDeCertificadoAccion`. */
  generar: (pedido: unknown) => Promise<Respuesta<PedidoGenerado>>;
  /** `cargarCertificadoAccion`. */
  cargar: (pedido: unknown) => Promise<Respuesta<unknown>>;
  /** La lista de ambientes: adónde se va con «Cancelar» y al terminar. */
  rutaALaLista: string;
}>;

type Vista =
  | Readonly<{ paso: "detalle" }>
  | Readonly<{ paso: 1 }>
  | Readonly<{ paso: 2; certificadoId: string; pedidoPem: string; alias: string }>
  | Readonly<{ paso: 3; certificadoId: string }>;

const vistaInicial = (a: ArranqueDelAmbiente): Vista =>
  a.vista === "detalle"
    ? { paso: "detalle" }
    : a.vista === "generar"
      ? { paso: 1 }
      : { paso: 3, certificadoId: a.certificadoId };

const CLAVE_DEL_TITULO = {
  1: "fiscal.pantalla.config_cert_generar_pedido",
  2: "fiscal.pantalla.config_cert_pedido",
  3: "fiscal.pantalla.config_cert_certificado",
} as const;

/** Los tres pasos, numerados: los números no son un texto. El actual lleva `aria-current="step"`. */
export function PasosNumerados({ actual }: Readonly<{ actual: 1 | 2 | 3 }>) {
  return (
    <ol className={estilos["pasos"]}>
      {([1, 2, 3] as const).map((numero) => (
        <li key={numero} className={estilos["pasoEnvoltura"]}>
          {numero === 1 ? null : <span aria-hidden="true" className={estilos["linea"]} />}
          <span className={estilos["paso"]} aria-current={numero === actual ? "step" : undefined}>
            {numero}
          </span>
        </li>
      ))}
    </ol>
  );
}

/**
 * La pantalla de un ambiente del certificado de ARCA (opción B: asistente de 3 pasos por ambiente; dueño, 2026-11-03, cuestionario
 * «Certificado»): 1 generar el pedido, 2 el pedido para subir a ARCA (se ve UNA sola vez) y 3 cargar el certificado que devolvió ARCA.
 *  - Falta cargar: arranca en el paso 1. Pedido generado (pendiente): arranca en el paso 3, porque el pedido no se vuelve a ver.
 *    Vigente (o vencido): el detalle con «Reemplazar», que lleva al paso 1 con el alias del certificado actual, y con una renovación en curso
 *    (D-94) también «Cargar certificado», que lleva al paso 3 contra ese pedido.
 *  - El estado de cada ambiente viene del servidor; lo que se ve acá solo se mueve con lo que la persona hace en esta pantalla.
 *  - El certificado se carga contra el pedido que el estado informa como pendiente (o el que se acaba de generar), nunca otro.
 */
export function AsistenteDeCertificado({
  emisorId,
  ambiente,
  arranque,
  generar,
  cargar,
  rutaALaLista,
}: PropsDeAsistenteDeCertificado) {
  const router = useRouter();
  const [vista, setVista] = useState<Vista>(() => vistaInicial(arranque));
  const idDelTitulo = useId();
  const titulo = useRef<HTMLDivElement>(null);
  const primera = useRef(true);

  // Al cambiar de paso el foco pasa al título del paso nuevo: el lector de pantalla anuncia dónde está.
  useEffect(() => {
    if (primera.current) {
      primera.current = false;
      return;
    }
    titulo.current?.focus();
  }, [vista.paso]);

  const alGenerar = useCallback((generado: PedidoGenerado, alias: string) => {
    setVista({
      paso: 2,
      certificadoId: generado.certificadoId,
      pedidoPem: generado.pedidoPem,
      alias,
    });
  }, []);
  const irALaLista = useCallback(() => {
    router.push(rutaALaLista);
  }, [router, rutaALaLista]);
  const cancelarElPedido = useCallback(() => {
    if (arranque.vista === "detalle") setVista({ paso: "detalle" });
    else router.push(rutaALaLista);
  }, [arranque.vista, router, rutaALaLista]);

  // El pedido contra el que se carga el certificado: el del estado (D-94, también con un certificado vigente), nunca otro.
  const pendiente =
    arranque.vista === "detalle"
      ? arranque.pedidoPendiente
      : arranque.vista === "cargar"
        ? arranque
        : null;

  if (vista.paso === "detalle") {
    if (arranque.vista !== "detalle") return null;
    return (
      <Pila separacion={4}>
        {arranque.cartel === null ? null : (
          <div>
            <Insignia tono={arranque.cartel.tono}>{arranque.cartel.texto}</Insignia>
          </div>
        )}
        <DatosParaLeer filas={arranque.datos} />
        <div className={estilos["botones"]}>
          <Boton
            variante="secundaria"
            alTocar={() => {
              setVista({ paso: 1 });
            }}
          >
            {texto({}, "fiscal.pantalla.config_cert_reemplazar")}
          </Boton>
          {pendiente === null ? null : (
            <Boton
              alTocar={() => {
                setVista({ paso: 3, certificadoId: pendiente.certificadoId });
              }}
            >
              {texto({}, "fiscal.pantalla.config_cert_cargar")}
            </Boton>
          )}
        </div>
      </Pila>
    );
  }

  return (
    <Pila separacion={4}>
      <PasosNumerados actual={vista.paso} />
      <div ref={titulo} tabIndex={-1} className={estilos["titulo"]}>
        <Texto como="h2" variante="subtitulo" id={idDelTitulo}>
          {texto({}, CLAVE_DEL_TITULO[vista.paso])}
        </Texto>
      </div>
      {vista.paso === 1 ? (
        <PasoGenerarPedido
          emisorId={emisorId}
          ambiente={ambiente}
          aliasInicial={arranque.vista === "detalle" ? arranque.aliasInicial : ""}
          generar={generar}
          alGenerar={alGenerar}
          alCancelar={cancelarElPedido}
        />
      ) : null}
      {vista.paso === 2 ? (
        <PasoDelPedido
          pedidoPem={vista.pedidoPem}
          alias={vista.alias}
          idDelTitulo={idDelTitulo}
          alSiguiente={() => {
            setVista({ paso: 3, certificadoId: vista.certificadoId });
          }}
        />
      ) : null}
      {vista.paso === 3 ? (
        <>
          {pendiente?.certificadoId === vista.certificadoId ? (
            <DatosParaLeer filas={pendiente.datos} />
          ) : null}
          <PasoCargarCertificado
            certificadoId={vista.certificadoId}
            cargar={cargar}
            alTerminar={irALaLista}
            alCancelar={irALaLista}
            idDelTitulo={idDelTitulo}
          />
          {arranque.vista === "cargar" && arranque.certificadoId === vista.certificadoId ? (
            // SUPUESTO (DEC-0050) del ingeniero: con el pedido perdido, la única salida es generar OTRO (decisión del dueño); es un `id` nuevo y
            // explícito. Revertirlo es quitar este botón.
            <div className={estilos["botones"]}>
              <Boton
                variante="secundaria"
                alTocar={() => {
                  setVista({ paso: 1 });
                }}
              >
                {texto({}, "fiscal.pantalla.config_cert_generar_pedido")}
              </Boton>
            </div>
          ) : null}
        </>
      ) : null}
    </Pila>
  );
}
