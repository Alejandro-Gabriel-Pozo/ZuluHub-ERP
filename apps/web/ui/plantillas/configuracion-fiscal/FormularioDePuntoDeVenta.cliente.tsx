"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type SyntheticEvent } from "react";
import type { Respuesta } from "../../../../../src/capacidades/experiencia/respuesta";
import { texto } from "../../../../../src/capacidades/vocabulario/vocabulario";
import { Boton } from "../../componentes/Boton";
import { Campo } from "../../componentes/Campo";
import { Selector } from "../../componentes/Selector";
import { RegionDeEstado } from "../../patrones/RegionDeEstado";
import { Pila } from "../../primitivas/Pila";
import { ErrorDelDetalle } from "../facturacion/ErrorDelDetalle";
import estilos from "./FormularioDePuntoDeVenta.module.css";
import {
  OPCIONES_DE_PROVINCIA,
  VALORES_EN_BLANCO,
  armarElPedidoDeAlta,
  armarElPedidoDeEdicion,
  lugarDelError,
  valoresParaEditar,
  type CampoDelFormulario,
  type IdsDelFormulario,
  type PuntoParaConfigurar,
  type ValoresDelFormulario,
} from "./modelo-de-puntos-de-venta";
import { useEnvioFijado } from "./useEnvioFijado";

export type PropsDeFormularioDePuntoDeVenta = Readonly<{
  /** El emisor al que se agrega (alta). Viaja en el pedido; el servidor lo valida contra la empresa. */
  emisorId: string;
  /** El punto de venta que se edita; `null`: es un alta. */
  original: PuntoParaConfigurar | null;
  sucursales: readonly Readonly<{ valor: string; etiqueta: string }>[];
  /** La acción del servidor: `crearPuntoDeVentaAccion` o `editarPuntoDeVentaAccion`. Recibe el pedido tal cual se armó. */
  guardar: (pedido: unknown) => Promise<Respuesta<unknown>>;
  /** Adónde se va al guardar. */
  rutaAlTerminar: string;
  /** Adónde se va con «Cancelar». */
  rutaAlCancelar: string;
}>;

const nuevosIds = (): IdsDelFormulario => ({
  puntoDeVentaId: crypto.randomUUID(),
  domicilioId: crypto.randomUUID(),
});

/**
 * Alta y edición de un punto de venta en una sola pantalla (PROTO-PV, pantalla 2), con el domicilio propio del punto de venta (D-63).
 *  - Idempotencia: el `id` del punto de venta y el del domicilio nuevo se generan UNA vez, al abrir el formulario; el primer envío
 *    fija el pedido entero y un reintento (red cortada) reenvía lo mismo. Dos toques seguidos son un solo envío.
 *  - Edición: lleva la versión que vio la pantalla. Si otra persona cambió el punto de venta, el servidor responde «versión
 *    desactualizada», se recarga lo último y el formulario vuelve a los valores nuevos (no se pisa lo de la otra persona).
 *  - Errores: el que trae un `campo` se marca en ese campo, con su texto, asociado por `aria-describedby`, y el foco va al primero.
 *    Los demás se dicen arriba, con el texto del catálogo y la referencia si es inesperado. La validez la decide el servidor.
 */
export function FormularioDePuntoDeVenta({
  emisorId,
  original,
  sucursales,
  guardar,
  rutaAlTerminar,
  rutaAlCancelar,
}: PropsDeFormularioDePuntoDeVenta) {
  const router = useRouter();
  const formulario = useRef<HTMLFormElement>(null);
  const [ids, setIds] = useState(nuevosIds);
  const [valores, setValores] = useState<ValoresDelFormulario>(() =>
    original !== null
      ? valoresParaEditar(original)
      : {
          ...VALORES_EN_BLANCO,
          sucursalId: sucursales.length === 1 ? (sucursales[0]?.valor ?? "") : "",
        },
  );
  const [versionVista, setVersionVista] = useState(original?.version ?? null);

  // Llegó una versión nueva del punto de venta (después de «versión desactualizada»): se parte de lo último.
  if (original !== null && original.version !== versionVista) {
    setVersionVista(original.version);
    setValores(valoresParaEditar(original));
    setIds(nuevosIds());
  }

  const { envio, enviarCon, referenciaIncierta } = useEnvioFijado<object, unknown>(guardar);
  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueado = envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const lugar = rechazo === null ? null : lugarDelError(rechazo.campo);
  const hecho = estado.tipo === "hecho";

  useEffect(() => {
    if (hecho) router.push(rutaAlTerminar);
  }, [hecho, router, rutaAlTerminar]);

  useEffect(() => {
    if (rechazo === null) return;
    if (rechazo.codigo === "FISCAL_VERSION_DESACTUALIZADA") router.refresh();
    // El foco va al primer campo marcado: la persona lo corrige sin buscarlo.
    formulario.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus();
  }, [rechazo, router]);

  function poner(campo: CampoDelFormulario, valor: string): void {
    setValores((previo) => ({ ...previo, [campo]: valor }));
    envio.reiniciar();
  }

  const errorEn = (campo: CampoDelFormulario): string | undefined =>
    rechazo !== null && lugar === campo ? texto({}, rechazo.clave) : undefined;

  const campo = (
    campoDelFormulario: CampoDelFormulario,
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

  function alEnviar(evento: SyntheticEvent): void {
    evento.preventDefault();
    enviarCon(
      original === null
        ? armarElPedidoDeAlta(valores, ids, emisorId)
        : armarElPedidoDeEdicion(valores, ids, original),
    );
  }

  return (
    <form ref={formulario} noValidate onSubmit={alEnviar}>
      <Pila separacion={4}>
        <RegionDeEstado urgencia="cortes" ocupada={envio.enCurso}>
          {incierto ? texto({}, "conexion.verificando") : null}
        </RegionDeEstado>
        {incierto && referenciaIncierta !== undefined ? (
          <ErrorDelDetalle
            error={{
              codigo: "ERROR_INTERNO",
              clave: "error.inesperado",
              presentacion: "INESPERADO",
              referencia: referenciaIncierta,
            }}
          />
        ) : null}
        {rechazo !== null && lugar === null ? <ErrorDelDetalle error={rechazo} /> : null}
        {campo("numero", "fiscal.pantalla.config_pv_campo_numero", {
          nombre: "numero",
          inputMode: "numeric",
        })}
        <Selector
          etiqueta={texto({}, "fiscal.pantalla.listado_rotulo_sucursal")}
          nombre="sucursalId"
          valor={valores.sucursalId}
          alCambiar={(v) => {
            poner("sucursalId", v);
          }}
          opciones={sucursales}
          {...(valores.sucursalId === ""
            ? { textoDeElegir: texto({}, "error.fiscal_sucursal_no_elegida") }
            : {})}
          error={errorEn("sucursalId")}
          deshabilitado={bloqueado}
        />
        <fieldset className={estilos["domicilio"]} disabled={bloqueado}>
          <legend className={estilos["leyenda"]}>
            {texto({}, "fiscal.pantalla.config_pv_domicilio")}
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
            textoDeElegir=""
            error={errorEn("provincia")}
            deshabilitado={bloqueado}
          />
          {campo("codigoPostal", "fiscal.pantalla.config_pv_codigo_postal", {
            autoComplete: "postal-code",
          })}
        </fieldset>
        <div className={estilos["botones"]}>
          <Boton
            variante="secundaria"
            deshabilitado={envio.enCurso}
            alTocar={() => {
              router.push(rutaAlCancelar);
            }}
          >
            {texto({}, "fiscal.pantalla.config_pv_cancelar")}
          </Boton>
          <Boton
            tipo="submit"
            enviando={envio.enCurso}
            deshabilitado={!envio.enCurso && envio.bloqueado}
            motivo={envio.motivoQueNoPuede}
          >
            {texto({}, "fiscal.pantalla.config_pv_guardar")}
          </Boton>
        </div>
      </Pila>
    </form>
  );
}
