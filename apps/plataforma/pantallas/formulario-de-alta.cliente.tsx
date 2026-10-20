"use client";

import { useRef, useState } from "react";
import { Aviso } from "../../web/ui/componentes/Aviso";
import { Boton } from "../../web/ui/componentes/Boton";
import { Campo } from "../../web/ui/componentes/Campo";
import { Selector } from "../../web/ui/componentes/Selector";
import { useEnvioConClave } from "../../web/ui/patrones/useEnvioConClave";
import { Pila } from "../../web/ui/primitivas/Pila";
import { Texto } from "../../web/ui/primitivas/Texto";
import { altaDeEmpresaAccion } from "../app/empresas/acciones";
import type { EntradaDelAlta } from "../logica/entrada-del-alta";
import type { CampoDelAlta, ErrorParaLaPantalla } from "../logica/errores-de-plataforma";
import { CANCELADO, conSegundoFactor } from "../logica/segundo-factor";
import estilos from "./empresas.module.css";
import { useVentanaDeCodigo } from "./ventana-de-codigo.cliente";

type SubmarcaDelAlta = Readonly<{
  id: string;
  nombre: string;
  elegible: boolean;
  motivoSiNo: string | null;
  planPorDefecto: string | null;
  modulosIniciales: readonly string[];
}>;

type PlanDelAlta = Readonly<{ versionDePlanId: string; nombre: string }>;

export type PropsDeFormularioDeAlta = Readonly<{
  submarcas: readonly SubmarcaDelAlta[];
  planes: readonly PlanDelAlta[];
}>;

const ZONA_POR_DEFECTO = "America/Argentina/Buenos_Aires";
const ZONAS_HORARIAS = [
  { valor: ZONA_POR_DEFECTO, etiqueta: "Buenos Aires (Argentina)" },
  { valor: "America/Argentina/Cordoba", etiqueta: "Córdoba (Argentina)" },
  { valor: "America/Argentina/Mendoza", etiqueta: "Mendoza (Argentina)" },
  { valor: "America/Montevideo", etiqueta: "Montevideo (Uruguay)" },
  { valor: "America/Santiago", etiqueta: "Santiago (Chile)" },
  { valor: "America/Sao_Paulo", etiqueta: "São Paulo (Brasil)" },
] as const;

/** Lo que el hook considera «rechazo»: un error de negocio (con su referencia) o que la persona canceló el código. */
type Rechazo =
  | Readonly<{ tipo: "ERROR"; error: ErrorParaLaPantalla; referencia: string | undefined }>
  | Readonly<{ tipo: "CANCELADO" }>;

type Hecho = Readonly<{ yaExistia: boolean; email: string }>;

type EntradaFijada = Omit<EntradaDelAlta, "claveDeIdempotencia">;

const OBLIGATORIO = "obligatorio";
const TEXTO_FALTA = "Completá este dato.";

/**
 * El alta de una empresa. La clave de idempotencia es del INTENTO: se reusa en cada reintento, y los valores del
 * pedido se fijan al primer toque (si el resultado es incierto, el formulario queda bloqueado hasta saberlo).
 */
export function FormularioDeAlta({ submarcas, planes }: PropsDeFormularioDeAlta) {
  const [razonSocial, setRazonSocial] = useState("");
  const [cuit, setCuit] = useState("");
  const [marcaId, setMarcaId] = useState("");
  const [versionDePlanId, setVersionDePlanId] = useState("");
  const [emailGerente, setEmailGerente] = useState("");
  const [zonaHoraria, setZonaHoraria] = useState<string>(ZONA_POR_DEFECTO);
  const [locales, setLocales] = useState<Partial<Record<CampoDelAlta, string>>>({});
  const fijada = useRef<EntradaFijada | null>(null);
  const { pedirCodigo, ventana } = useVentanaDeCodigo();

  const envio = useEnvioConClave<Hecho, Rechazo>({
    textos: {
      sinConexion: "Sin conexión. Cuando vuelva, podés dar de alta la empresa.",
      verificando: "Verificando si el alta quedó registrada…",
    },
    enviar: async (clave) => {
      const base = fijada.current;
      if (base === null) throw new Error("Sin pedido fijado");
      const entrada: EntradaDelAlta = { ...base, claveDeIdempotencia: clave };
      // Lo que lance (red cortada) es «incierto» y se reintenta con la misma clave y los mismos valores.
      const resultado = await conSegundoFactor({
        intento: () => altaDeEmpresaAccion(entrada),
        pideCodigo: (r) => !r.ok && r.error.tipo === "SEGUNDO_FACTOR",
        pedirCodigo,
      });
      fijada.current = null;
      if (resultado === CANCELADO) return { ok: false, rechazo: { tipo: "CANCELADO" } };
      if (resultado.ok) {
        return {
          ok: true,
          valor: { yaExistia: resultado.dato.yaExistia, email: entrada.emailGerente },
        };
      }
      return {
        ok: false,
        rechazo: { tipo: "ERROR", error: resultado.error, referencia: resultado.referencia },
      };
    },
  });

  const estado = envio.estado;
  const incierto = estado.tipo === "incierto";
  const bloqueadaLaEdicion = envio.enCurso || incierto;
  const rechazo = estado.tipo === "rechazado" ? estado.rechazo : null;
  const errorDeServidor = rechazo?.tipo === "ERROR" ? rechazo.error : null;

  const submarca = submarcas.find((s) => s.id === marcaId);

  function errorDe(campo: CampoDelAlta): string | undefined {
    if (locales[campo] !== undefined) return locales[campo];
    if (errorDeServidor?.tipo === "CAMPO" && errorDeServidor.campo === campo) {
      return errorDeServidor.texto;
    }
    return undefined;
  }

  /** Editar un campo limpia sus errores: lo que se ve siempre corresponde a lo que está escrito. */
  function editar(campo: CampoDelAlta, poner: () => void) {
    poner();
    setLocales((previo) => {
      const resto = { ...previo };
      delete resto[campo];
      return resto;
    });
    envio.reiniciar();
  }

  function validar(): Partial<Record<CampoDelAlta, string>> {
    const faltas: Partial<Record<CampoDelAlta, string>> = {};
    if (razonSocial.trim() === "") faltas.razonSocial = TEXTO_FALTA;
    if (cuit.trim() === "") faltas.cuit = TEXTO_FALTA;
    if (marcaId === "") faltas.marcaId = "Elegí una submarca.";
    else if (submarca !== undefined && !submarca.elegible) {
      faltas.marcaId = submarca.motivoSiNo ?? "Esa submarca no está disponible para dar de alta.";
    }
    if (emailGerente.trim() === "") faltas.emailGerente = TEXTO_FALTA;
    if (zonaHoraria === "") faltas.zonaHoraria = "Elegí una zona horaria.";
    return faltas;
  }

  function tocarDarDeAlta() {
    if (envio.enCurso) return;
    if (fijada.current === null) {
      const faltas = validar();
      setLocales(faltas);
      if (Object.keys(faltas).length > 0) return;
      // Los valores del pedido se fijan acá, al primer toque del intento, y se reusan en cada reintento.
      fijada.current = {
        razonSocial: razonSocial.trim(),
        cuit: cuit.trim(),
        marcaId,
        versionDePlanId: versionDePlanId === "" ? null : versionDePlanId,
        emailGerente: emailGerente.trim(),
        zonaHoraria,
      };
    }
    envio.enviar();
  }

  if (estado.tipo === "hecho") {
    return (
      <Pila separacion={4}>
        <Aviso tono="exito" titulo="Empresa dada de alta">
          <Texto>
            {estado.valor.yaExistia
              ? "Esta alta ya estaba hecha; no se duplicó."
              : `Empresa dada de alta. Le enviamos una invitación a ${estado.valor.email}.`}
          </Texto>
        </Aviso>
        <a className={estilos["enlaceSimple"]} href="/empresas">
          Volver a Empresas
        </a>
      </Pila>
    );
  }

  const nombreDelPlanPorDefecto = submarca?.planPorDefecto ?? null;
  const textoDelPlanPorDefecto =
    nombreDelPlanPorDefecto === null
      ? "El de la submarca"
      : `El de la submarca (${nombreDelPlanPorDefecto})`;

  return (
    <form
      className={estilos["formulario"]}
      noValidate
      onSubmit={(evento) => {
        evento.preventDefault();
        tocarDarDeAlta();
      }}
    >
      <Pila separacion={4}>
        {errorDeServidor === null || errorDeServidor.tipo === "CAMPO" ? null : (
          <Aviso tono={errorDeServidor.tipo === "OCULTAR_ACCION" ? "aviso" : "peligro"}>
            <Texto>{textoGeneral(errorDeServidor)}</Texto>
            {errorDeServidor.tipo === "INESPERADO" &&
            rechazo?.tipo === "ERROR" &&
            rechazo.referencia !== undefined ? (
              <Texto>Código de referencia: {rechazo.referencia}</Texto>
            ) : null}
          </Aviso>
        )}
        {rechazo?.tipo === "CANCELADO" ? (
          <Aviso tono="info">
            <Texto>Cancelaste la confirmación. La empresa no se dio de alta.</Texto>
          </Aviso>
        ) : null}
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
                "No supimos si el alta quedó registrada. Reintentá: no se va a duplicar."}
            </Texto>
          </Aviso>
        ) : null}
        <Campo
          etiqueta="Nombre de la empresa"
          nombre="razonSocial"
          obligatorio={OBLIGATORIO}
          autoComplete="off"
          valor={razonSocial}
          alCambiar={(v) => {
            editar("razonSocial", () => {
              setRazonSocial(v);
            });
          }}
          error={errorDe("razonSocial")}
          deshabilitado={bloqueadaLaEdicion}
        />
        <Campo
          etiqueta="CUIT"
          nombre="cuit"
          obligatorio={OBLIGATORIO}
          autoComplete="off"
          inputMode="numeric"
          ayuda="Once números, con o sin guiones."
          valor={cuit}
          alCambiar={(v) => {
            editar("cuit", () => {
              setCuit(v);
            });
          }}
          error={errorDe("cuit")}
          deshabilitado={bloqueadaLaEdicion}
        />
        <Selector
          etiqueta="Submarca"
          nombre="marcaId"
          obligatorio={OBLIGATORIO}
          textoDeElegir="Elegí una submarca"
          opciones={submarcas.map((s) => ({
            valor: s.id,
            etiqueta: s.elegible
              ? s.nombre
              : `${s.nombre} (no disponible: ${s.motivoSiNo ?? "no admite empresas nuevas"})`,
          }))}
          valor={marcaId}
          alCambiar={(v) => {
            editar("marcaId", () => {
              setMarcaId(v);
            });
          }}
          error={errorDe("marcaId")}
          deshabilitado={bloqueadaLaEdicion}
        />
        <Selector
          etiqueta="Plan"
          nombre="versionDePlanId"
          textoDeElegir={textoDelPlanPorDefecto}
          opciones={planes.map((p) => ({ valor: p.versionDePlanId, etiqueta: p.nombre }))}
          valor={versionDePlanId}
          alCambiar={(v) => {
            editar("versionDePlanId", () => {
              setVersionDePlanId(v);
            });
          }}
          error={errorDe("versionDePlanId")}
          deshabilitado={bloqueadaLaEdicion}
        />
        <Campo
          etiqueta="Email del primer gerente"
          nombre="emailGerente"
          tipo="email"
          inputMode="email"
          autoComplete="off"
          obligatorio={OBLIGATORIO}
          ayuda="Se le envía una invitación; no se muestra su clave ni se la elegís vos."
          valor={emailGerente}
          alCambiar={(v) => {
            editar("emailGerente", () => {
              setEmailGerente(v);
            });
          }}
          error={errorDe("emailGerente")}
          deshabilitado={bloqueadaLaEdicion}
        />
        <Selector
          etiqueta="Zona horaria"
          nombre="zonaHoraria"
          obligatorio={OBLIGATORIO}
          opciones={ZONAS_HORARIAS}
          valor={zonaHoraria}
          alCambiar={(v) => {
            editar("zonaHoraria", () => {
              setZonaHoraria(v);
            });
          }}
          error={errorDe("zonaHoraria")}
          deshabilitado={bloqueadaLaEdicion}
        />
        <div className={estilos["modulos"]}>
          <p className={estilos["modulosTitulo"]}>Módulos iniciales</p>
          <Texto>
            {submarca === undefined
              ? "Elegí una submarca para ver sus módulos iniciales."
              : submarca.modulosIniciales.length === 0
                ? "Esta submarca no trae módulos iniciales."
                : submarca.modulosIniciales.join(", ")}
          </Texto>
        </div>
        <div className={estilos["acciones"]}>
          <Boton
            tipo="submit"
            enviando={envio.enCurso}
            textoEnviando="Dando de alta…"
            deshabilitado={!envio.enCurso && envio.bloqueado}
            motivo={envio.motivoQueNoPuede}
          >
            Dar de alta
          </Boton>
          <a className={estilos["enlaceSimple"]} href="/empresas">
            Cancelar
          </a>
        </div>
      </Pila>
      {ventana}
    </form>
  );
}

/** El texto de un error que no es de un campo; el de campo se ve junto a su campo. */
function textoGeneral(error: ErrorParaLaPantalla): string {
  switch (error.tipo) {
    case "GENERAL":
    case "PANTALLA_VIEJA":
      return error.texto;
    case "OCULTAR_ACCION":
      return "No tenés permiso para dar de alta empresas.";
    case "CAMPO":
    case "SEGUNDO_FACTOR":
    case "INESPERADO":
      return "No pudimos dar de alta la empresa.";
  }
}
