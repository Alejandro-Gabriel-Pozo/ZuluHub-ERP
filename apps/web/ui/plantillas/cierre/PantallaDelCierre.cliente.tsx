"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import type { ErrorPublico, Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Aviso } from "../../componentes/Aviso";
import { Boton } from "../../componentes/Boton.cliente";
import { BotonIcono } from "../../componentes/BotonIcono";
import { Insignia } from "../../componentes/Insignia";
import { ErrorDelDetalle } from "../../patrones/ErrorDelDetalle";
import { BotonDeAccionDelCierre, type AccionDelCierre } from "./BotonDeAccionDelCierre.cliente";
import { ControlesQueSoloInforman, GrupoDeControles } from "./GrupoDeControles";
import { ListaDeCobros } from "./ListaDeCobros";
import { LineaDeConciliacion } from "./LineaDeConciliacion.cliente";
import { ModalDeCorregirMedio } from "./ModalDeCorregirMedio.cliente";
import { ModalDeReconocer } from "./ModalDeReconocer.cliente";
import type { CobroVisto, ControlVisto, ModeloDelCierre } from "./modelo-del-cierre";
import estilos from "./PantallaDelCierre.module.css";
import { PuntosDelCierre } from "./PuntosDelCierre";

/** Las acciones del servidor que usa la pantalla (vienen ligadas por la página; el navegador solo les pasa el pedido). */
export type AccionesDelServidorDelCierre = Readonly<{
  empezar: AccionDelCierre;
  cancelar: AccionDelCierre;
  cerrar: AccionDelCierre;
  corregir: AccionDelCierre;
  declarar: AccionDelCierre;
  conforme: AccionDelCierre;
}>;

type Paso = 1 | 2 | 3;
type Marca = Readonly<{ cantidad: number; observacion: string }>;
type Dialogo =
  | Readonly<{ tipo: "reconocer"; control: ControlVisto }>
  | Readonly<{ tipo: "corregir"; cobro: CobroVisto }>;

type Props = Readonly<{ modelo: ModeloDelCierre; servidor: AccionesDelServidorDelCierre }>;

function Lista({ children }: Readonly<{ children: ReactNode }>) {
  return <ul className={estilos["lista"]}>{children}</ul>;
}

function Plegable({ rotulo, children }: Readonly<{ rotulo: string; children: ReactNode }>) {
  return (
    <details className={estilos["plegable"]}>
      <summary>{rotulo}</summary>
      <div className={estilos["plegableCuerpo"]}>{children}</div>
    </details>
  );
}

/**
 * «Cierre del día», de punta a punta (maqueta aceptada `cierre-del-dia.html`, tres pasos; ficha `conceptos/pantalla-cierre-del-dia.md`). Un paso por vez con puntos 1 · 2 · 3 y UN solo botón
 * lleno por pantalla: «Empezar el cierre» (jornada abierta); en cierre, 1 «Cobros» (con «Corregir medio») → 2 «Conciliación por medio» (con «Conforme general») → 3 lo que «Hay que reconocer»
 * y «Cerrar el día»; cerrada, solo lectura con quién y cuándo. Lo que «Impide cerrar» va arriba en cualquier paso. «Solo informa» va plegado.
 *
 * Las marcas de «Reconocer» viven en la pantalla (nada se manda hasta cerrar, DDD:172 2 A): valen mientras el control mantenga su clave y su cantidad, y se pierden al cancelar el cierre. Cada
 * respuesta definitiva vuelve a leer el día (`router.refresh`): la pantalla nunca decide qué es verdad. Un rechazo muestra el aviso del servidor (el genérico, salvo «Cambió algo mientras
 * mirabas»); no se replica ninguna regla ni se apaga un botón por lo que el servidor rechazará (interfaz sobria).
 */
export function PantallaDelCierre({ modelo, servidor }: Props) {
  const router = useRouter();
  const [paso, setPaso] = useState<Paso>(1);
  const [marcas, setMarcas] = useState<Readonly<Record<string, Marca>>>({});
  const [dialogo, setDialogo] = useState<Dialogo | null>(null);
  const [mensaje, setMensaje] = useState<ErrorPublico | null>(null);
  const [fallo, setFallo] = useState(false);
  const titulo = useRef<HTMLHeadingElement>(null);
  const raiz = useRef<HTMLDivElement>(null);
  const primeraVez = useRef(true);

  useEffect(() => {
    if (primeraVez.current) {
      primeraVez.current = false;
      return;
    }
    // Al cambiar de paso el foco va al título del paso (el que se lee primero); si el paso no tiene título (el 3 sin nada que reconocer), a la pantalla: nunca queda perdido en el botón que ya no está.
    (titulo.current ?? raiz.current)?.focus();
  }, [paso]);

  const enCierre = modelo.estado === "EN_AUDITORIA";
  const cerrada = modelo.estado === "CERRADA";
  const marcado = (control: ControlVisto): boolean =>
    marcas[control.clave]?.cantidad === control.cantidad;

  /** Cada respuesta definitiva muestra su aviso (si fue un rechazo) y vuelve a leer el día. */
  const responder = (despues?: () => void) => (respuesta: Respuesta<unknown>) => {
    setMensaje(respuesta.ok ? null : respuesta.error);
    if (respuesta.ok) despues?.();
    router.refresh();
  };

  const alternarMarca = (control: ControlVisto) => {
    if (marcado(control)) {
      setMarcas(
        Object.fromEntries(Object.entries(marcas).filter(([clave]) => clave !== control.clave)),
      );
      setMensaje(null);
    } else {
      setDialogo({ tipo: "reconocer", control });
    }
  };

  const cabecera = (
    <div className={estilos["cabecera"]}>
      <div className={estilos["fila"]}>
        <span className={estilos["jornada"]}>
          {texto({}, "caja.sesion.jornada")} {modelo.fecha}
        </span>
        {cerrada ? null : <Insignia tono={modelo.tonoDeEstado}>{modelo.etiquetaDeEstado}</Insignia>}
      </div>
      {enCierre ? <PuntosDelCierre actual={paso} /> : null}
      {cerrada ? (
        <Aviso tono="exito">
          <strong>{modelo.etiquetaDeEstado}</strong>
          {modelo.cerradaPor === null ? null : <p>{modelo.cerradaPor}</p>}
        </Aviso>
      ) : null}
      {mensaje === null ? null : <ErrorDelDetalle error={mensaje} />}
    </div>
  );

  // Lo que impide cerrar va arriba en cualquier paso; con el día abierto solo se muestra después de intentar empezar.
  const impiden =
    enCierre || fallo ? <GrupoDeControles severidad="bloquea" controles={modelo.bloquean} /> : null;

  const cancelar = (
    <BotonDeAccionDelCierre
      variante="secundaria"
      deshabilitado={!modelo.acciones.cancelar}
      accion={servidor.cancelar}
      conClave={false}
      armarPedido={() => ({ fechaDeNegocio: modelo.fechaDeNegocio })}
      alResponder={responder(() => {
        setPaso(1);
        setMarcas({});
      })}
    >
      {texto({}, "caja.sesion.cancelar_cierre")}
    </BotonDeAccionDelCierre>
  );

  let cuerpo: ReactNode = null;
  let pie: ReactNode = null;
  if (modelo.estado === "ABIERTA") {
    pie = (
      <BotonDeAccionDelCierre
        deshabilitado={!modelo.acciones.empezar}
        accion={servidor.empezar}
        conClave={false}
        armarPedido={() => ({ fechaDeNegocio: modelo.fechaDeNegocio })}
        alResponder={(respuesta) => {
          setFallo(!respuesta.ok);
          responder()(respuesta);
        }}
      >
        {texto({}, "cierre.accion.iniciar")}
      </BotonDeAccionDelCierre>
    );
  } else if (enCierre) {
    // El botón de avance lleva el nombre aprobado del paso al que va (decisión del dueño, 21/11/2026), con el «›» de la maqueta; no hay «Siguiente».
    const siguiente = (
      <Boton
        ancho="completo"
        alTocar={() => {
          setPaso(paso === 1 ? 2 : 3);
          setMensaje(null);
        }}
      >
        {texto(
          {},
          paso === 1 ? "cierre.control.conciliacion_por_medio" : "cierre.severidad.reconocible",
        )}{" "}
        <span aria-hidden="true">›</span>
      </Boton>
    );
    if (paso === 1) {
      cuerpo = (
        <>
          <h2 ref={titulo} tabIndex={-1} className={estilos["paso"]}>
            {texto({}, "ventas.ticket.cobros")}
          </h2>
          <ListaDeCobros
            cobros={modelo.cobros ?? []}
            editable
            alCorregir={(cobro) => {
              setDialogo({ tipo: "corregir", cobro });
            }}
          />
        </>
      );
      pie = (
        <>
          {siguiente}
          {cancelar}
        </>
      );
    } else if (paso === 2) {
      cuerpo = (
        <>
          <h2 ref={titulo} tabIndex={-1} className={estilos["paso"]}>
            {texto({}, "cierre.control.conciliacion_por_medio")}
          </h2>
          <BotonDeAccionDelCierre
            variante="secundaria"
            deshabilitado={!modelo.acciones.declarar}
            accion={servidor.conforme}
            conClave
            armarPedido={() => ({ fechaDeNegocio: modelo.fechaDeNegocio })}
            alResponder={responder()}
          >
            {texto({}, "caja.conforme_general")}
          </BotonDeAccionDelCierre>
          <Lista>
            {(modelo.lineas ?? []).map((linea) => (
              <LineaDeConciliacion
                key={linea.clave}
                linea={linea}
                fechaDeNegocio={modelo.fechaDeNegocio}
                editable
                puedeDeclarar={modelo.acciones.declarar}
                declarar={servidor.declarar}
                alDeclarar={responder()}
              />
            ))}
          </Lista>
        </>
      );
      pie = (
        <>
          {siguiente}
          {cancelar}
        </>
      );
    } else {
      cuerpo = (
        <>
          <GrupoDeControles
            severidad="reconocible"
            tituloRef={titulo}
            controles={modelo.porReconocer}
            marcable={{
              marcado,
              alTocar: alternarMarca,
              deshabilitado: !modelo.acciones.cerrar,
            }}
          />
          <ControlesQueSoloInforman controles={modelo.informan} />
        </>
      );
      pie = (
        <>
          <BotonDeAccionDelCierre
            deshabilitado={!modelo.acciones.cerrar}
            accion={servidor.cerrar}
            conClave={false}
            armarPedido={() => ({
              fechaDeNegocio: modelo.fechaDeNegocio,
              huellaVista: modelo.huella,
              reconocimientos: modelo.porReconocer.filter(marcado).map((c) => ({
                modulo: c.modulo,
                clave: c.clave,
                texto: marcas[c.clave]?.observacion ?? null,
              })),
            })}
            alResponder={responder()}
          >
            {texto({}, "cierre.accion.cerrar")}
          </BotonDeAccionDelCierre>
          {cancelar}
        </>
      );
    }
  } else {
    cuerpo = (
      <>
        <GrupoDeControles severidad="reconocible" controles={modelo.porReconocer} />
        <ControlesQueSoloInforman controles={modelo.informan} />
        <Plegable rotulo={texto({}, "cierre.control.conciliacion_por_medio")}>
          <Lista>
            {(modelo.lineas ?? []).map((linea) => (
              <LineaDeConciliacion
                key={linea.clave}
                linea={linea}
                fechaDeNegocio={modelo.fechaDeNegocio}
                editable={false}
                puedeDeclarar={false}
                declarar={servidor.declarar}
                alDeclarar={responder()}
              />
            ))}
          </Lista>
        </Plegable>
        <Plegable rotulo={texto({}, "ventas.ticket.cobros")}>
          <ListaDeCobros
            cobros={modelo.cobros ?? []}
            editable={false}
            alCorregir={() => undefined}
          />
        </Plegable>
      </>
    );
  }

  return (
    <div ref={raiz} tabIndex={-1} className={estilos["raiz"]}>
      {enCierre && paso > 1 ? (
        <div className={estilos["volver"]}>
          <BotonIcono
            etiqueta={texto({}, "ventas.ticket.volver")}
            icono="atras"
            alTocar={() => {
              setPaso(paso === 3 ? 2 : 1);
              setMensaje(null);
            }}
          />
        </div>
      ) : null}
      {cabecera}
      {impiden}
      {cuerpo}
      {pie === null ? null : <div className={estilos["pie"]}>{pie}</div>}
      {dialogo?.tipo === "reconocer" ? (
        <ModalDeReconocer
          control={dialogo.control}
          alCancelar={() => {
            setDialogo(null);
          }}
          alMarcar={(observacion) => {
            setMarcas({
              ...marcas,
              [dialogo.control.clave]: { cantidad: dialogo.control.cantidad, observacion },
            });
            setMensaje(null);
            setDialogo(null);
          }}
        />
      ) : null}
      {dialogo?.tipo === "corregir" ? (
        <ModalDeCorregirMedio
          cobro={dialogo.cobro}
          medios={modelo.medios}
          corregir={servidor.corregir}
          alCancelar={() => {
            setDialogo(null);
          }}
          alCorregir={() => {
            setDialogo(null);
            setMensaje(null);
            router.refresh();
          }}
        />
      ) : null}
    </div>
  );
}
