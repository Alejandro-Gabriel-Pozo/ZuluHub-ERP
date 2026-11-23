"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, useTransition } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton.cliente";
import { Superposicion } from "../../web/ui/patrones/Superposicion";
import { useEnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { cambiarModuloAccion } from "../app/empresas/[id]/plan/acciones";
import type { ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import type { AccionDelModulo } from "../logica/modulo-de-empresa";
import { rotuloDeModulo } from "../logica/plan";
import { CANCELADO, conSegundoFactor } from "../logica/segundo-factor";
import { useVentanaDeCodigo } from "./ventana-de-codigo.cliente";

export type PropsDeCambioDeModulo = Readonly<{
  empresaId: string;
  empresa: string;
  modulo: string;
  /** Lo que ofrece `accionDelModulo` para esta fila; la pantalla no decide nada más. */
  accion: AccionDelModulo;
}>;

type Rechazo =
  | Readonly<{ tipo: "ERROR"; error: ErrorParaLaPantalla; referencia: string | undefined }>
  | Readonly<{ tipo: "CANCELADO" }>;

const ROTULO_DE_LA_ACCION: Readonly<Record<AccionDelModulo, string>> = {
  ACTIVAR: "Activar",
  DESACTIVAR: "Desactivar",
};

function textoDelError(error: ErrorParaLaPantalla): string {
  switch (error.tipo) {
    case "GENERAL":
    case "PANTALLA_VIEJA":
    case "MARCA_RETIRADA":
    case "CAMPO":
      return error.texto;
    case "OCULTAR_ACCION":
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return "Esta acción no está permitida.";
  }
}

/**
 * El botón de la fila y la confirmación de activar o desactivar un módulo. Lo que se manda (activar o desactivar) se
 * FIJA al primer toque del intento, junto con la clave de idempotencia, y se reusa en cada reintento: si cambiara,
 * el servidor respondería CLAVE_REUTILIZADA. Al terminar, bien o rechazado, la pantalla vuelve a leer el plan: la fila
 * nunca se actualiza a mano. El segundo factor se pide en otra ventana, apilada encima.
 */
export function CambioDeModulo({ empresaId, empresa, modulo, accion }: PropsDeCambioDeModulo) {
  const router = useRouter();
  const [, enTransicion] = useTransition();
  const [abierta, setAbierta] = useState(false);
  const fijada = useRef<AccionDelModulo | null>(null);
  const [delIntento, setDelIntento] = useState<AccionDelModulo | null>(null);
  const [referenciaIncierta, setReferenciaIncierta] = useState<string | undefined>(undefined);
  const { pedirCodigo, ventana } = useVentanaDeCodigo();

  const poner = (valor: AccionDelModulo | null) => {
    fijada.current = valor;
    setDelIntento(valor);
  };

  const envio = useEnvioConClave<{ yaEstaba: boolean }, Rechazo>({
    textos: {
      sinConexion: "Sin conexión. Cuando vuelva, podés reintentar.",
      verificando: "Verificando si el cambio quedó registrado…",
    },
    enviar: async (clave) => {
      const base = fijada.current;
      if (base === null) throw new Error("Sin pedido fijado");
      // Lo que lance (red cortada) es «incierto» y se reintenta con la misma clave y el mismo pedido.
      const resultado = await conSegundoFactor({
        intento: () =>
          cambiarModuloAccion({
            claveDeIdempotencia: clave,
            empresaId,
            modulo,
            activar: base === "ACTIVAR",
          }),
        pideCodigo: (r) => !r.ok && r.error.tipo === "SEGUNDO_FACTOR",
        pedirCodigo,
      });
      if (resultado === CANCELADO) {
        poner(null);
        setReferenciaIncierta(undefined);
        return { ok: false, rechazo: { tipo: "CANCELADO" } };
      }
      // Un error inesperado no es una respuesta definitiva (puede que el cambio haya quedado hecho): se lanza para
      // que el intento quede «incierto» y se reintente con la MISMA clave y el MISMO pedido.
      if (!resultado.ok && resultado.error.tipo === "INESPERADO") {
        setReferenciaIncierta(resultado.referencia);
        throw new Error("Resultado inesperado: se reintenta con la misma clave");
      }
      poner(null);
      setReferenciaIncierta(undefined);
      if (resultado.ok) return { ok: true, valor: { yaEstaba: resultado.dato.yaEstaba } };
      return {
        ok: false,
        rechazo: { tipo: "ERROR", error: resultado.error, referencia: resultado.referencia },
      };
    },
  });

  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const hecho = estado.tipo === "hecho";
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const errorDeServidor = rechazo?.tipo === "ERROR" ? rechazo.error : null;
  const bloqueada = envio.enCurso || incierto;
  const enCurso = bloqueada ? (delIntento ?? accion) : accion;

  // Al terminar bien la ventana se cierra y se vuelve a leer el plan; un rechazo también lo vuelve a leer (el estado
  // real pudo cambiar) y deja el motivo a la vista.
  useEffect(() => {
    if (!hecho && errorDeServidor === null) return;
    enTransicion(() => {
      router.refresh();
    });
  }, [hecho, errorDeServidor, router, enTransicion]);

  function tocarConfirmar() {
    if (envio.enCurso) return;
    if (fijada.current === null) poner(accion);
    envio.enviar();
  }

  function cerrar() {
    envio.reiniciar();
    setAbierta(false);
  }

  const titulo = `${ROTULO_DE_LA_ACCION[enCurso]} ${rotuloDeModulo(modulo)} en ${empresa}`;

  return (
    <>
      <Boton
        variante="secundaria"
        alTocar={() => {
          envio.reiniciar();
          setAbierta(true);
        }}
      >
        {ROTULO_DE_LA_ACCION[accion]}
      </Boton>
      <Superposicion
        abierta={abierta && !hecho}
        titulo={titulo}
        proposito="confirmar"
        cerrable={!envio.enCurso}
        etiquetaDeCerrar="Cerrar"
        alCerrar={cerrar}
      >
        <form
          noValidate
          onSubmit={(evento) => {
            evento.preventDefault();
            tocarConfirmar();
          }}
        >
          <Pila separacion={4}>
            {errorDeServidor === null ? null : (
              <Aviso tono={errorDeServidor.tipo === "OCULTAR_ACCION" ? "aviso" : "peligro"}>
                <Texto>{textoDelError(errorDeServidor)}</Texto>
              </Aviso>
            )}
            {incierto ? (
              <Aviso
                tono="aviso"
                accion={
                  envio.enCurso ? null : (
                    <Boton variante="secundaria" alTocar={envio.enviar}>
                      Reintentar
                    </Boton>
                  )
                }
              >
                <Texto>
                  {envio.motivoQueNoPuede ??
                    "No supimos si el cambio quedó registrado. Reintentá: no se va a duplicar."}
                </Texto>
                {referenciaIncierta === undefined ? null : (
                  <Texto>Código de referencia: {referenciaIncierta}</Texto>
                )}
              </Aviso>
            ) : null}
            {enCurso === "DESACTIVAR" ? (
              <Texto>Los datos del módulo quedan guardados y vuelven al activarlo.</Texto>
            ) : null}
            <Boton
              tipo="submit"
              ancho="completo"
              enviando={envio.enCurso}
              textoEnviando="Confirmando…"
              deshabilitado={!envio.enCurso && envio.bloqueado}
              motivo={envio.motivoQueNoPuede}
            >
              {ROTULO_DE_LA_ACCION[enCurso]}
            </Boton>
            <Boton
              variante="secundaria"
              ancho="completo"
              deshabilitado={envio.enCurso}
              alTocar={cerrar}
            >
              Cancelar
            </Boton>
          </Pila>
        </form>
      </Superposicion>
      {/* Aparte de la ventana y de su formulario: se abre encima cuando el servidor pide el segundo factor. */}
      {ventana}
    </>
  );
}
