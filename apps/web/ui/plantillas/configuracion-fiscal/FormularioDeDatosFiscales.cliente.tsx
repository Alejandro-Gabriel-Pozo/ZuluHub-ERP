"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton.cliente";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { Pila } from "../../primitivas/Pila";
import { AvisosDelEnvio } from "./AvisosDelEnvio";
import estilos from "./FormularioDePuntoDeVenta.module.css";
import {
  armarElPedidoDeConfirmacion,
  armarElPedidoDeGuardado,
  borradorTrasGuardar,
  filaDelCuit,
  lugarDelError,
  MODO_NO_CONTRIBUYENTE,
  MODO_NUMERO,
  valoresDelBorrador,
  type BorradorDeDatosFiscales,
  type CampoDeDatosFiscales,
  type IdsDeDatosFiscales,
  type OpcionDeCondicionDeIva,
  type PedidoDelFormulario,
  type ValoresDeDatosFiscales,
  type VigenteDeDatosFiscales,
} from "./modelo-de-datos-fiscales";
import { OPCIONES_DE_PROVINCIA } from "./modelo-de-puntos-de-venta";
import { DatosParaLeer } from "./DatosParaLeer";

import { useEnvioFijado } from "./useEnvioFijado";

export type PropsDeFormularioDeDatosFiscales = Readonly<{
  emisorId: string;
  /** El CUIT de la empresa, 11 dígitos: solo para leer (D-65). */
  cuit: string;
  /** El borrador que ya existe (D-68): se abre con su id y su versión. `null`: todavía no hay. */
  borrador: BorradorDeDatosFiscales | null;
  /** Lo que rige hoy (D-88): sin borrador, el formulario se abre con esto. `null` (y sin borrador): se empieza en blanco. */
  vigente: VigenteDeDatosFiscales | null;
  condicionesDeIva: readonly OpcionDeCondicionDeIva[];
  /** `guardarBorradorDeDatosFiscalesAccion`: devuelve la versión que quedó guardada. */
  guardar: (pedido: unknown) => Promise<Respuesta<Readonly<{ version: number }>>>;
  /** `confirmarDatosFiscalesAccion`. */
  confirmar: (pedido: unknown) => Promise<Respuesta<unknown>>;
  /** Adónde se va al guardar el borrador. */
  rutaAlGuardar: string;
  /** Adónde se va al confirmar. */
  rutaAlConfirmar: string;
  /** Adónde se va con «Cancelar». */
  rutaAlCancelar: string;
}>;

const nuevosIds = (borrador: BorradorDeDatosFiscales | null): IdsDeDatosFiscales => ({
  borradorId: borrador?.id ?? crypto.randomUUID(),
  domicilioId: crypto.randomUUID(),
});

// Qué se le mostró a la persona: el borrador con su versión o, sin borrador, la versión vigente (si cambió, se vuelve a partir de ella).
const claveDe = (b: BorradorDeDatosFiscales | null, v: VigenteDeDatosFiscales | null): string =>
  b !== null ? `b:${b.id}:${String(b.version)}` : v === null ? "" : `v:${v.id}`;

/**
 * Datos fiscales (D-88): el formulario se abre directo, con el borrador que ya existe (D-68), si no con lo vigente (D-62) y, si nunca
 * hubo nada, en blanco. El CUIT va solo para leer (D-65) y hay tres botones: «Cancelar», «Guardar borrador» y «Confirmar», que rige desde
 * ya (D-61). Abrirlo no escribe nada: el borrador se crea en el primer «Guardar borrador» o «Confirmar».
 *  - «Confirmar» guarda el borrador con lo que se ve y lo confirma con la versión que devolvió el guardado: la persona confirma lo que
 *    tiene delante. Repetir el guardado con el mismo contenido no escribe nada, así que un reintento tras un corte es seguro.
 *  - Idempotencia: el `borradorId` (si todavía no hay borrador) y el id del domicilio nuevo se generan UNA vez al abrir el formulario
 *    (recargar no crea nada: no se escribió); el primer envío fija el pedido entero y un reintento reenvía lo mismo (`useEnvioFijado`).
 *  - Tras un guardado exitoso el borrador pasa a ser el guardado (su id, la versión que devolvió el servidor y su domicilio): si la
 *    confirmación se rechaza y la persona corrige, el siguiente guardado sale con esa versión y, si cambió el domicilio, con un id de
 *    domicilio nuevo (un domicilio no se edita: el mismo id con otro contenido es `ID_EN_USO`).
 *  - Concurrencia: lleva la versión que vio la pantalla. Con «versión desactualizada» se vuelve a leer: con borrador, el formulario se
 *    abre con SU id y SU versión (el borrador es de la empresa, no de la pestaña); sin él, parte de lo vigente.
 *  - Errores: el que trae un `campo` se marca en ese campo y el foco va al primero; los demás se dicen arriba. La validez la decide
 *    el servidor.
 */
export function FormularioDeDatosFiscales({
  emisorId,
  cuit,
  borrador,
  vigente,
  condicionesDeIva,
  guardar,
  confirmar,
  rutaAlGuardar,
  rutaAlConfirmar,
  rutaAlCancelar,
}: PropsDeFormularioDeDatosFiscales) {
  const router = useRouter();
  const formulario = useRef<HTMLFormElement>(null);
  const cual = useRef<"guardar" | "confirmar">("guardar");
  const [ids, setIds] = useState(() => nuevosIds(borrador));
  const [valores, setValores] = useState<ValoresDeDatosFiscales>(() =>
    valoresDelBorrador(borrador, vigente),
  );
  // El borrador tal como quedó guardado: al abrir es el que llegó; tras cada guardado exitoso pasa a ser el que se guardó (con su
  // versión), y el próximo guardado se compara con él y sale con esa versión. `null`: todavía no se creó.
  const [guardadoYa, setGuardadoYa] = useState(borrador);
  const [claveVista, setClaveVista] = useState(claveDe(borrador, vigente));

  // Llegó otro borrador u otra versión vigente (después de «versión desactualizada»): se parte de lo último, con su id y su versión.
  const clave = claveDe(borrador, vigente);
  if (clave !== claveVista) {
    setClaveVista(clave);
    setValores(valoresDelBorrador(borrador, vigente));
    setGuardadoYa(borrador);
    setIds(nuevosIds(borrador));
  }

  // Guardar y, si se pidió, confirmar con la versión que dejó el guardado. Un reintento repite las dos cosas: el servidor devuelve lo
  // mismo para lo ya hecho. Tras 3 intentos inciertos queda en «Verificando…» (límite de `useEnvioConClave`): ver `useEnvioFijado`.
  const { envio, enviarCon, fijado, referenciaIncierta } = useEnvioFijado<
    PedidoDelFormulario,
    unknown
  >(async (pedido) => {
    const guardado = await guardar(pedido.guardar);
    if (!guardado.ok) return guardado;
    // Lo guardado queda como el borrador que existe: si lo que sigue se rechaza, el próximo intento parte de él (su id, su versión
    // y su domicilio) y no choca con su propio guardado. El domicilio es de solo inserción: el id usado no se reutiliza.
    setGuardadoYa({ ...pedido.tras, version: guardado.dato.version });
    setIds((previos) => ({ ...previos, domicilioId: crypto.randomUUID() }));
    if (pedido.confirmar === null) return guardado;
    return confirmar({ ...pedido.confirmar, versionEsperada: guardado.dato.version });
  });
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueado = envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const lugar = rechazo === null ? null : lugarDelError(rechazo.campo);
  const hecho = estado.tipo === "hecho";

  useEffect(() => {
    if (hecho) router.push(cual.current === "confirmar" ? rutaAlConfirmar : rutaAlGuardar);
  }, [hecho, router, rutaAlConfirmar, rutaAlGuardar]);

  useEffect(() => {
    if (rechazo === null) return;
    if (rechazo.codigo === "FISCAL_VERSION_DESACTUALIZADA") router.refresh();
    // El foco va al primer campo marcado: la persona lo corrige sin buscarlo.
    formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [rechazo, router]);

  function poner(campo: CampoDeDatosFiscales, valor: string): void {
    setValores((previo) => ({ ...previo, [campo]: valor }));
    envio.reiniciar();
  }

  const errorEn = (campo: CampoDeDatosFiscales): string | undefined =>
    rechazo !== null && lugar === campo ? texto({}, rechazo.clave) : undefined;

  const campo = (
    campoDelFormulario: CampoDeDatosFiscales,
    etiqueta: Parameters<typeof texto>[1],
    extra: Partial<Parameters<typeof Campo>[0]> = {},
  ) => (
    <Campo
      etiqueta={texto({}, etiqueta)}
      valor={valores[campoDelFormulario]}
      alCambiar={(v) => {
        poner(campoDelFormulario, v);
      }}
      autoComplete="off"
      error={errorEn(campoDelFormulario)}
      deshabilitado={bloqueado}
      {...extra}
    />
  );

  function enviar(que: "guardar" | "confirmar"): void {
    // Un intento en marcha (o incierto) sigue siendo el que se fijó: no se cambia de botón a mitad de camino.
    if (fijado === null && !envio.enCurso) cual.current = que;
    enviarCon({
      guardar: armarElPedidoDeGuardado(
        valores,
        ids,
        emisorId,
        guardadoYa?.version ?? null,
        guardadoYa,
      ),
      tras: borradorTrasGuardar(valores, ids, guardadoYa),
      confirmar: que === "confirmar" ? armarElPedidoDeConfirmacion(emisorId, ids.borradorId) : null,
    });
  }

  function alEnviar(evento: SyntheticEvent): void {
    evento.preventDefault();
    // Con Enter dentro de un campo, el foco está en un campo que se apaga (`disabled`) al enviar y caería al <body>: pasa a «Guardar
    // borrador» (el botón de envío del formulario, no el que confirma), que durante el envío queda `aria-disabled` y lo conserva.
    formulario.current?.querySelector<HTMLElement>('button[type="submit"]')?.focus();
    enviar("guardar");
  }

  const esperando = (que: "guardar" | "confirmar"): string | undefined =>
    fijado !== null && (fijado.confirmar !== null) === (que === "confirmar")
      ? texto({}, "fiscal.pantalla.config_pv_guardando")
      : undefined;

  return (
    <form ref={formulario} noValidate onSubmit={alEnviar}>
      <Pila separacion={4}>
        <AvisosDelEnvio
          enCurso={envio.enCurso}
          incierto={incierto}
          referenciaIncierta={referenciaIncierta}
          rechazo={rechazo !== null && lugar === null ? rechazo : null}
        />
        <DatosParaLeer filas={[filaDelCuit(cuit)]} />
        {campo("razonSocial", "fiscal.pantalla.config_df_razon_social")}
        <Selector
          etiqueta={texto({}, "fiscal.pantalla.config_df_condicion_iva")}
          nombre="condicionIva"
          valor={valores.condicionIva}
          alCambiar={(v) => {
            poner("condicionIva", v);
          }}
          opciones={condicionesDeIva}
          // La opción vacía lleva el nombre del campo para que el lector de pantalla no la diga sin nombre.
          textoDeElegir={texto({}, "fiscal.pantalla.config_df_condicion_iva")}
          error={errorEn("condicionIva")}
          deshabilitado={bloqueado}
        />
        <fieldset className={estilos["domicilio"]} disabled={bloqueado}>
          <legend className={estilos["leyenda"]}>
            {texto({}, "fiscal.pantalla.config_df_domicilio_fiscal")}
          </legend>
          <div className={estilos["par"]}>
            {campo("calle", "fiscal.pantalla.config_pv_calle", { autoComplete: "address-line1" })}
            {campo("numeroDeCalle", "fiscal.pantalla.config_pv_numero_de_calle")}
          </div>
          <div className={estilos["parParejo"]}>
            {campo("piso", "fiscal.pantalla.config_pv_piso")}
            {campo("departamento", "fiscal.pantalla.config_pv_departamento")}
          </div>
          {campo("localidad", "fiscal.pantalla.config_pv_localidad", {
            autoComplete: "address-level2",
          })}
          <Selector
            etiqueta={texto({}, "fiscal.pantalla.config_pv_provincia")}
            nombre="provincia"
            valor={valores.provincia}
            alCambiar={(v) => {
              poner("provincia", v);
            }}
            opciones={OPCIONES_DE_PROVINCIA}
            textoDeElegir={texto({}, "fiscal.pantalla.config_pv_provincia")}
            error={errorEn("provincia")}
            deshabilitado={bloqueado}
          />
          {campo("codigoPostal", "fiscal.pantalla.config_pv_codigo_postal", {
            autoComplete: "postal-code",
          })}
        </fieldset>
        <Selector
          etiqueta={texto({}, "fiscal.pantalla.imprimir_ingresos_brutos")}
          nombre="ingresosBrutos"
          valor={valores.ingresosBrutos}
          alCambiar={(v) => {
            poner("ingresosBrutos", v);
          }}
          opciones={[
            { valor: MODO_NUMERO, etiqueta: texto({}, "fiscal.pantalla.config_df_iibb_numero") },
            {
              valor: MODO_NO_CONTRIBUYENTE,
              etiqueta: texto({}, "fiscal.pantalla.config_df_iibb_no_contribuyente"),
            },
          ]}
          textoDeElegir={texto({}, "selector.elegir_una_opcion")}
          error={errorEn("ingresosBrutos")}
          deshabilitado={bloqueado}
        />
        {valores.ingresosBrutos === MODO_NUMERO
          ? campo("iibbNumero", "fiscal.pantalla.config_df_iibb_numero")
          : null}
        {campo("inicioActividades", "fiscal.pantalla.config_df_inicio_actividades", {
          inputMode: "numeric",
        })}
        <div className={estilos["botones"]}>
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
          <Boton
            variante="secundaria"
            tipo="submit"
            enviando={envio.enCurso}
            textoEnviando={esperando("guardar")}
            deshabilitado={!envio.enCurso && envio.bloqueado}
          >
            {texto({}, "fiscal.pantalla.config_df_guardar_borrador")}
          </Boton>
          <Boton
            enviando={envio.enCurso}
            textoEnviando={esperando("confirmar")}
            deshabilitado={!envio.enCurso && envio.bloqueado}
            motivo={envio.motivoQueNoPuede}
            alTocar={() => {
              enviar("confirmar");
            }}
          >
            {texto({}, "fiscal.pantalla.config_df_que_rija")}
          </Boton>
        </div>
      </Pila>
    </form>
  );
}
